/**
 * Phase 7.4 — Architecture Decision Record (ADR) Detector
 * Discovers, parses, and associates documented architecture decisions with repository components.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { AdrFinding, AdrVerificationStatus } from "./types.ts";

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export class AdrDetector {
  public static detect(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
    rootPath: string,
    options: { requireSha256?: boolean } = {},
  ): AdrFinding[] {
    const findings: AdrFinding[] = [];
    const seenIds = new Set<string>();

    // Determine active scan to prevent live-disk edits from contaminating historical scans
    const repoRow = db
      .prepare("SELECT active_scan_id AS activeScanId FROM repositories WHERE id = ?")
      .get(repositoryId) as { activeScanId: number | null } | undefined;
    const isHistoricalScan =
      repoRow?.activeScanId !== null &&
      repoRow?.activeScanId !== undefined &&
      scanId !== repoRow.activeScanId;

    // 1. Query snapshot-scoped indexed files matching ADR path conventions
    const adrFiles = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, content_hash AS contentHash, size_bytes AS sizeBytes
         FROM files
         WHERE repository_id = ?
           AND scan_id = ?
           AND (
             normalized_path LIKE 'docs/adr/ADR-%.md'
             OR normalized_path LIKE 'docs/%/ADR-%.md'
             OR normalized_path LIKE 'adr/ADR-%.md'
             OR normalized_path LIKE 'ADR-%.md'
           )
         ORDER BY normalized_path ASC, id ASC`,
      )
      .all(repositoryId, scanId) as {
      id: number;
      normalizedPath: string;
      contentHash: string | null;
      sizeBytes: number;
    }[];

    // 2. Load snapshot-scoped ADR metadata JSON evidence (if persisted in source_evidence)
    const metaByPath = new Map<
      string,
      {
        adrId: string;
        number?: number;
        title?: string;
        status?: string;
        date?: string;
        phase?: string;
        governedComponents?: string[];
        relatedDocuments?: string[];
      }
    >();
    const metaRows = db
      .prepare(
        `SELECT f.normalized_path AS filePath, se.evidence_description AS description
         FROM source_evidence se
         JOIN files f ON f.id = se.file_id
         WHERE se.repository_id = ? AND se.scan_id = ? AND se.evidence_type = 'ADR_METADATA_JSON'
         ORDER BY f.normalized_path ASC, se.id ASC`,
      )
      .all(repositoryId, scanId) as { filePath: string; description: string }[];
    for (const mr of metaRows) {
      try {
        const parsedMeta = JSON.parse(mr.description);
        if (parsedMeta && typeof parsedMeta.adrId === "string") {
          metaByPath.set(mr.filePath, parsedMeta);
        }
      } catch {
        // Ignore malformed snapshot metadata rows cleanly
      }
    }

    // 3. Query components scoped by both repository_id and scan_id
    const componentRows = db
      .prepare(
        `SELECT component_identity AS identity, name, root_path AS rootPath, category
         FROM architecture_components
         WHERE repository_id = ? AND scan_id = ?`,
      )
      .all(repositoryId, scanId) as {
      identity: string;
      name: string;
      rootPath: string;
      category: string;
    }[];

    const realWsRoot = fs.existsSync(rootPath) ? fs.realpathSync(rootPath) : path.resolve(rootPath);

    for (const file of adrFiles) {
      const snapMeta = metaByPath.get(file.normalizedPath);
      const expectedHash = file.contentHash ?? null;
      const hasSha256 = typeof expectedHash === "string" && SHA256_HEX_REGEX.test(expectedHash);

      const fullPath = path.resolve(rootPath, file.normalizedPath);
      let diskBuffer: Buffer | null = null;
      let diskFailureReason: { status: AdrVerificationStatus; reason: string } | null = null;

      try {
        if (!fs.existsSync(fullPath)) {
          diskFailureReason = {
            status: "DISK_FILE_MISSING",
            reason: `ADR file missing on disk during scan ${scanId} inspection`,
          };
        } else {
          const realFilePath = fs.realpathSync(fullPath);
          const rel = path.relative(realWsRoot, realFilePath);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            diskFailureReason = {
              status: "DISK_HASH_MISMATCH",
              reason: "file path resolves outside workspace root",
            };
          } else {
            diskBuffer = fs.readFileSync(realFilePath);
          }
        }
      } catch {
        diskFailureReason = {
          status: "DISK_FILE_MISSING",
          reason: "unable to read ADR file from disk",
        };
      }

      // Skip legitimately empty ADR files on active verified disk reads
      if (diskBuffer !== null && diskBuffer.toString("utf8").trim().length === 0) {
        if (!hasSha256 || file.sizeBytes === 0) {
          continue;
        }
        const emptyHash = createHash("sha256").update(diskBuffer).digest("hex");
        if (emptyHash === expectedHash!.toLowerCase()) {
          continue;
        }
      }

      let resolvedFinding: AdrFinding | null = null;
      let fallbackReason = diskFailureReason?.reason ?? "snapshot content could not be verified";
      let fallbackStatus: AdrVerificationStatus =
        diskFailureReason?.status ?? "MISSING_CONTENT_HASH";

      if (diskBuffer !== null) {
        if (hasSha256) {
          const actualHash = createHash("sha256").update(diskBuffer).digest("hex");
          if (actualHash === expectedHash!.toLowerCase()) {
            const parsed = this.parseAdrContent(
              file.normalizedPath,
              diskBuffer.toString("utf8"),
              componentRows,
            );
            if (parsed) {
              resolvedFinding = {
                ...parsed,
                verificationStatus: "CONFIRMED",
                snapshotHash: expectedHash,
                isFallback: false,
              };
            }
          } else {
            fallbackStatus = "DISK_HASH_MISMATCH";
            fallbackReason = "disk content hash differs from indexed snapshot";
          }
        } else if (!expectedHash) {
          fallbackStatus = "MISSING_CONTENT_HASH";
          fallbackReason = "indexed snapshot lacks a stored content_hash";
        } else if (isHistoricalScan || options.requireSha256) {
          fallbackStatus = "UNVERIFIED_HASH";
          fallbackReason = "historical snapshot lacks SHA-256 verification";
        } else {
          // Active scan with synthetic non-SHA256 hash (legacy test fixtures)
          const parsed = this.parseAdrContent(
            file.normalizedPath,
            diskBuffer.toString("utf8"),
            componentRows,
          );
          if (parsed) {
            resolvedFinding = {
              ...parsed,
              verificationStatus: "LEGACY_ACTIVE_MOCK",
              snapshotHash: expectedHash,
              isFallback: false,
            };
          }
        }
      }

      // Snapshot-scoped ADR_METADATA_JSON satisfies snapshot retrieval when disk differs/missing
      if (!resolvedFinding && snapMeta) {
        const numMatch = snapMeta.adrId.match(/ADR-(\d+)/i);
        const num = snapMeta.number ?? (numMatch ? parseInt(numMatch[1], 10) : 0);
        resolvedFinding = {
          adrId: snapMeta.adrId.toUpperCase(),
          number: num,
          title: snapMeta.title ?? snapMeta.adrId,
          status: snapMeta.status ?? "Proposed",
          date: snapMeta.date,
          phase: snapMeta.phase,
          filePath: file.normalizedPath,
          governedComponents: snapMeta.governedComponents ?? [],
          relatedDocuments: snapMeta.relatedDocuments ?? [],
          evidenceDescription: `Snapshot ADR metadata from source_evidence for ${file.normalizedPath} (scan ${scanId})`,
          confidence: 1.0,
          verificationStatus: "SNAPSHOT_METADATA",
          snapshotHash: expectedHash,
          isFallback: false,
        };
      }

      // Never parse unverified/modified disk content or silently drop deleted historical ADRs
      if (!resolvedFinding) {
        const fileBase = path.posix.basename(file.normalizedPath, ".md");
        const numMatch = fileBase.match(/ADR-(\d+)/i);
        if (numMatch) {
          const number = parseInt(numMatch[1], 10);
          const adrId = `ADR-${String(number).padStart(3, "0")}`;
          resolvedFinding = {
            adrId,
            number,
            title: fileBase,
            status: "Unverified",
            filePath: file.normalizedPath,
            governedComponents: [],
            relatedDocuments: [],
            evidenceDescription: `Historical ADR fallback from indexed path ${file.normalizedPath} (scan ${scanId}: ${fallbackReason})`,
            confidence: 0.7,
            verificationStatus: fallbackStatus,
            snapshotHash: expectedHash,
            isFallback: true,
          };
        }
      }

      if (resolvedFinding && !seenIds.has(resolvedFinding.adrId)) {
        seenIds.add(resolvedFinding.adrId);
        findings.push(resolvedFinding);
      }
    }

    // Sort deterministically by ADR number ASC, then ADR ID ASC
    findings.sort((a, b) => a.number - b.number || a.adrId.localeCompare(b.adrId));

    return findings;
  }

  private static parseAdrContent(
    filePath: string,
    content: string,
    components: { identity: string; name: string; rootPath: string; category: string }[],
  ): AdrFinding | null {
    if (content.trim().length === 0) return null;
    const lines = content.split(/\r?\n/);

    // 1. Extract Title and ID
    let adrId = "";
    let number = 0;
    let title = "";

    const titleMatch = content.match(/^#\s+(ADR-(\d+)[^:\n]*):\s*(.+)$/m);
    if (titleMatch) {
      adrId = titleMatch[1].trim();
      number = parseInt(titleMatch[2], 10);
      title = titleMatch[3].trim();
    } else {
      // Fallback matching
      const simpleMatch = content.match(/^#\s+(ADR-(\d+)[^\n]*)/m);
      if (simpleMatch) {
        adrId = simpleMatch[1].trim();
        number = parseInt(simpleMatch[2], 10);
        title = adrId;
      } else {
        const fileBase = path.posix.basename(filePath, ".md");
        const numMatch = fileBase.match(/ADR-(\d+)/i);
        if (numMatch) {
          number = parseInt(numMatch[1], 10);
          adrId = `ADR-${String(number).padStart(3, "0")}`;
          title = fileBase;
        } else {
          return null;
        }
      }
    }

    // 2. Extract Metadata (Status, Date, Phase, Related)
    let status = "Proposed";
    let date: string | undefined;
    let phase: string | undefined;
    const relatedDocuments: string[] = [];

    const statusMatch = content.match(/[-*]\s+\*\*Status:\*\*\s*([^\n\r]+)/i);
    if (statusMatch) {
      status = statusMatch[1].trim();
    }

    const dateMatch = content.match(/[-*]\s+\*\*Date:\*\*\s*([^\n\r]+)/i);
    if (dateMatch) {
      date = dateMatch[1].trim();
    }

    const phaseMatch = content.match(/[-*]\s+\*\*Phase:\*\*\s*([^\n\r]+)/i);
    if (phaseMatch) {
      phase = phaseMatch[1].trim();
    }

    // Extract links in Related line
    const relatedSectionMatch = content.match(/[-*]\s+\*\*Related:\*\*\s*([^\n\r]+)/i);
    if (relatedSectionMatch) {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(relatedSectionMatch[1])) !== null) {
        relatedDocuments.push(m[2]);
      }
    }

    // 3. Identify Governed Components
    const governedComponents: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const comp of components) {
      const compBase = path.posix.basename(comp.rootPath).toLowerCase();
      if (
        lowerContent.includes(comp.rootPath.toLowerCase()) ||
        lowerContent.includes(`comp:${comp.name.toLowerCase()}`) ||
        (compBase.length >= 4 && lowerContent.includes(compBase))
      ) {
        if (!governedComponents.includes(comp.identity)) {
          governedComponents.push(comp.identity);
        }
      }
    }

    return {
      adrId,
      number,
      title,
      status,
      date,
      phase,
      filePath,
      governedComponents,
      relatedDocuments,
      evidenceDescription: `Architecture Decision Record parsed from ${filePath} (Status: ${status}, Phase: ${phase ?? "N/A"})`,
      confidence: 1.0,
    };
  }
}
