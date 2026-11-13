/**
 * Phase 7.5 Stage 3 — Deterministic Architecture Decision Record (ADR) Diff Engine
 * Discovers and compares documented decisions, status transitions, and content hash modifications without interpretation.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import type { AdrFinding } from "../architecture/types.ts";
import type {
  AdrDiffItem,
  AdrDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

interface AdrFileRecord {
  id: number;
  normalizedPath: string;
  contentHash: string | null;
}

export interface ResolvedAdrEntry {
  adrId: string;
  number: number;
  title: string;
  status?: string;
  date?: string;
  filePath: string;
  governedComponents: string[];
  evidenceDescription: string;
  confidence: number;
  isFallback: boolean;
  contentHash: string | null;
  rawContent?: string;
}

export interface HistoricalAdrResolution {
  adrs: ResolvedAdrEntry[];
  byId: Map<string, ResolvedAdrEntry>;
  byPath: Map<string, ResolvedAdrEntry>;
  limitations: ComparisonLimitation[];
}

export class AdrDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: AdrDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Resolve workspace root from options or repositories table
    let rootPath = options.workspaceRoot;
    if (!rootPath) {
      const repoRow = db
        .prepare("SELECT root_path AS rootPath FROM repositories WHERE id = ?")
        .get(repositoryId) as { rootPath: string } | undefined;
      rootPath = repoRow?.rootPath ?? process.cwd();
    }

    const baseFiles = this.queryAdrFiles(db, repositoryId, baseScanId);
    const targetFiles = this.queryAdrFiles(db, repositoryId, targetScanId);

    const baseComponents = this.loadScanComponents(db, repositoryId, baseScanId);
    const targetComponents = this.loadScanComponents(db, repositoryId, targetScanId);

    let fallbackCount = 0;
    let missingHashCount = 0;

    const baseMap = this.resolveAdrMap(
      baseScanId,
      baseFiles,
      baseComponents,
      rootPath,
      () => {
        fallbackCount++;
      },
      () => {
        missingHashCount++;
      },
    );

    const targetMap = this.resolveAdrMap(
      targetScanId,
      targetFiles,
      targetComponents,
      rootPath,
      () => {
        fallbackCount++;
      },
      () => {
        missingHashCount++;
      },
    );

    const allIds = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
    const sortedIds = Array.from(allIds).sort((a, b) => {
      const itemA = baseMap.get(a) ?? targetMap.get(a);
      const itemB = baseMap.get(b) ?? targetMap.get(b);
      const numA = itemA?.number ?? 0;
      const numB = itemB?.number ?? 0;
      return numA - numB || a.localeCompare(b);
    });

    const changes: AdrDiffItem[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;

    for (const id of sortedIds) {
      const baseItem = baseMap.get(id);
      const targetItem = targetMap.get(id);

      if (!baseItem && targetItem) {
        addedCount++;
        const evidenceId = `ev:adr:add:${targetScanId}:${id}`;
        changes.push({
          adrId: id,
          number: targetItem.number,
          title: targetItem.title,
          changeType: "ADDED",
          targetPath: targetItem.filePath,
          targetStatus: targetItem.status,
          targetContentHash: targetItem.contentHash,
          date: targetItem.date,
          governedComponents: targetItem.governedComponents,
          evidenceDescription: targetItem.evidenceDescription,
          evidenceId,
          confidence: targetItem.confidence,
          isFallback: targetItem.isFallback || undefined,
        });

        evidence.push({
          evidenceId,
          repositoryId,
          snapshotId: targetScanId,
          sourcePath: targetItem.filePath,
          sourceHash: targetItem.contentHash,
          entityIdentity: `adr:${id}`,
          evidenceType: targetItem.isFallback ? "adr_addition_fallback" : "adr_addition",
          confidence: targetItem.confidence,
          isInferred: targetItem.isFallback ? true : undefined,
          supportedClassification: "ADDED",
        });
      } else if (baseItem && !targetItem) {
        removedCount++;
        const evidenceId = `ev:adr:rem:${baseScanId}:${id}`;
        changes.push({
          adrId: id,
          number: baseItem.number,
          title: baseItem.title,
          changeType: "REMOVED",
          basePath: baseItem.filePath,
          baseStatus: baseItem.status,
          baseContentHash: baseItem.contentHash,
          date: baseItem.date,
          governedComponents: baseItem.governedComponents,
          evidenceDescription: baseItem.evidenceDescription,
          evidenceId,
          confidence: baseItem.confidence,
          isFallback: baseItem.isFallback || undefined,
        });

        evidence.push({
          evidenceId,
          repositoryId,
          snapshotId: baseScanId,
          sourcePath: baseItem.filePath,
          sourceHash: baseItem.contentHash,
          entityIdentity: `adr:${id}`,
          evidenceType: baseItem.isFallback ? "adr_removal_fallback" : "adr_removal",
          confidence: baseItem.confidence,
          isInferred: baseItem.isFallback ? true : undefined,
          supportedClassification: "REMOVED",
        });
      } else if (baseItem && targetItem) {
        if (!baseItem.contentHash || !targetItem.contentHash) {
          // Missing historical content hash prevents verified MODIFIED or UNCHANGED classification.
          continue;
        }

        const hashChanged = baseItem.contentHash !== targetItem.contentHash;
        const statusChanged =
          baseItem.status !== undefined &&
          targetItem.status !== undefined &&
          baseItem.status !== targetItem.status;
        const titleChanged = baseItem.title !== targetItem.title;
        const pathChanged = baseItem.filePath !== targetItem.filePath;
        const isFallback = baseItem.isFallback || targetItem.isFallback;
        const confidence = Math.min(baseItem.confidence, targetItem.confidence);

        const isModified = hashChanged || statusChanged || titleChanged || pathChanged;

        if (isModified) {
          modifiedCount++;
          const evidenceId = `ev:adr:mod:${targetScanId}:${id}`;
          changes.push({
            adrId: id,
            number: targetItem.number,
            title: targetItem.title,
            changeType: "MODIFIED",
            basePath: baseItem.filePath,
            targetPath: targetItem.filePath,
            baseStatus: baseItem.status,
            targetStatus: targetItem.status,
            baseContentHash: baseItem.contentHash,
            targetContentHash: targetItem.contentHash,
            date: targetItem.date,
            governedComponents: targetItem.governedComponents,
            evidenceDescription: targetItem.evidenceDescription,
            evidenceId,
            confidence,
            isFallback: isFallback || undefined,
          });

          evidence.push({
            evidenceId,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: targetItem.filePath,
            sourceHash: targetItem.contentHash,
            entityIdentity: `adr:${id}`,
            evidenceType: isFallback ? "adr_modification_fallback" : "adr_modification",
            confidence,
            isInferred: isFallback ? true : undefined,
            supportedClassification: "MODIFIED",
          });
        } else {
          unchangedCount++;
          if (includeUnchanged) {
            changes.push({
              adrId: id,
              number: targetItem.number,
              title: targetItem.title,
              changeType: "UNCHANGED",
              basePath: baseItem.filePath,
              targetPath: targetItem.filePath,
              baseStatus: baseItem.status,
              targetStatus: targetItem.status,
              baseContentHash: baseItem.contentHash,
              targetContentHash: targetItem.contentHash,
              date: targetItem.date,
              governedComponents: targetItem.governedComponents,
              evidenceDescription: targetItem.evidenceDescription,
              confidence,
              isFallback: isFallback || undefined,
            });
          }
        }
      }
    }

    if (missingHashCount > 0) {
      limitations.push({
        code: "LIM_ADR_MISSING_HISTORICAL_HASH",
        description:
          "One or more indexed ADR files lacked a stored historical content hash; verified MODIFIED/UNCHANGED comparison and disk hash verification were withheld.",
        domain: "adr",
        affectedEntityCount: missingHashCount,
      });
    }

    if (fallbackCount > 0) {
      limitations.push({
        code: "LIM_ADR_HISTORICAL_CONTENT_FALLBACK",
        description:
          "Historical ADR markdown content on disk was missing or failed SHA-256 verification against the indexed snapshot hash; compared using indexed path and content hash without fabricating status metadata.",
        domain: "adr",
        affectedEntityCount: fallbackCount,
      });
    }

    // Sort deterministically: number ASC, then adrId ASC
    changes.sort((a, b) => a.number - b.number || a.adrId.localeCompare(b.adrId));

    return {
      result: {
        changes,
        addedCount,
        removedCount,
        modifiedCount,
        unchangedCount,
      },
      evidence,
      limitations,
    };
  }

  /**
   * Resolves historical ADRs strictly for the given snapshot without falling back
   * to unverified workspace disk content.
   */
  public static resolveHistoricalAdrs(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
    workspaceRoot?: string,
  ): HistoricalAdrResolution {
    let rootPath = workspaceRoot;
    if (!rootPath) {
      const repoRow = db
        .prepare("SELECT root_path AS rootPath FROM repositories WHERE id = ?")
        .get(repositoryId) as { rootPath: string } | undefined;
      rootPath = repoRow?.rootPath ?? process.cwd();
    }

    const files = this.queryAdrFiles(db, repositoryId, scanId);
    const components = this.loadScanComponents(db, repositoryId, scanId);
    const limitations: ComparisonLimitation[] = [];
    let fallbackCount = 0;
    let missingHashCount = 0;

    const map = this.resolveAdrMap(
      scanId,
      files,
      components,
      rootPath,
      () => {
        fallbackCount++;
      },
      () => {
        missingHashCount++;
      },
    );

    const byId = new Map<string, ResolvedAdrEntry>(map);
    const byPath = new Map<string, ResolvedAdrEntry>();
    for (const entry of byId.values()) {
      byPath.set(entry.filePath, entry);
    }

    // Snapshot-scoped ADR_METADATA_JSON rows in source_evidence take precedence when present
    // for offline/synthetic DB snapshots, without overwriting verified rawContent.
    const adrMetaRows = db
      .prepare(
        `SELECT f.normalized_path AS filePath, f.content_hash AS contentHash, se.evidence_description AS description
         FROM source_evidence se
         JOIN files f ON f.id = se.file_id
         WHERE se.repository_id = ? AND se.scan_id = ? AND se.evidence_type = 'ADR_METADATA_JSON'
         ORDER BY f.normalized_path ASC, se.id ASC`,
      )
      .all(repositoryId, scanId) as unknown as {
      filePath: string;
      contentHash: string | null;
      description: string;
    }[];

    let resolvedFromMeta = 0;
    for (const row of adrMetaRows) {
      try {
        const meta = JSON.parse(row.description) as {
          adrId?: string;
          number?: number;
          title?: string;
          status?: string;
          date?: string;
          governedComponents?: string[];
        };
        if (!meta.adrId) continue;
        const normalizedId = meta.adrId.toUpperCase();
        const existing = byId.get(normalizedId) ?? byPath.get(row.filePath);
        const numMatch = normalizedId.match(/ADR-(\d+)/i);
        const num = meta.number ?? existing?.number ?? (numMatch ? parseInt(numMatch[1], 10) : 0);
        const entry: ResolvedAdrEntry = {
          adrId: normalizedId,
          number: num,
          title: meta.title ?? existing?.title ?? normalizedId,
          status: meta.status ?? existing?.status,
          date: meta.date ?? existing?.date,
          filePath: row.filePath,
          governedComponents: meta.governedComponents ?? existing?.governedComponents ?? [],
          evidenceDescription:
            existing?.evidenceDescription ??
            `Snapshot ADR metadata for ${normalizedId} from ${row.filePath}`,
          confidence: 1.0,
          isFallback: false,
          contentHash: row.contentHash ?? existing?.contentHash ?? null,
          rawContent: existing?.rawContent,
        };
        byId.set(normalizedId, entry);
        byPath.set(row.filePath, entry);
        resolvedFromMeta++;
      } catch {
        // Ignore malformed metadata JSON
      }
    }

    // Only emit fallback/missing-hash limitations for ADRs that were NOT satisfied by snapshot metadata
    const unresolvedFallbacks = Math.max(0, fallbackCount - resolvedFromMeta);
    if (missingHashCount > 0 && unresolvedFallbacks > 0) {
      limitations.push({
        code: "LIM_ADR_MISSING_HISTORICAL_HASH",
        description:
          "One or more indexed ADR files lacked a stored historical content hash; disk hash verification was withheld.",
        domain: "adr",
        affectedEntityCount: missingHashCount,
      });
    }
    if (unresolvedFallbacks > 0) {
      limitations.push({
        code: "LIM_ADR_HISTORICAL_CONTENT_FALLBACK",
        description:
          "Historical ADR markdown content on disk was missing or failed SHA-256 verification against the indexed snapshot hash; ADR status and content rules could not be confirmed.",
        domain: "adr",
        affectedEntityCount: unresolvedFallbacks,
      });
    }

    const adrs = Array.from(byId.values()).sort(
      (a, b) => a.number - b.number || a.adrId.localeCompare(b.adrId),
    );
    return { adrs, byId, byPath, limitations };
  }

  private static queryAdrFiles(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
  ): AdrFileRecord[] {
    return db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, content_hash AS contentHash
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
      .all(repositoryId, scanId) as unknown as AdrFileRecord[];
  }

  private static loadScanComponents(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
  ): { identity: string; name: string; rootPath: string; category: string }[] {
    const stored = db
      .prepare(
        `SELECT component_identity AS identity, name, root_path AS rootPath, category
         FROM architecture_components
         WHERE repository_id = ? AND scan_id = ?
         ORDER BY component_identity ASC`,
      )
      .all(repositoryId, scanId) as {
      identity: string;
      name: string;
      rootPath: string;
      category: string;
    }[];

    if (stored.length > 0) {
      return stored;
    }

    return ComponentDetector.detect(db, repositoryId, scanId).map((comp) => ({
      identity: comp.componentIdentity,
      name: comp.name,
      rootPath: comp.rootPath,
      category: comp.category,
    }));
  }

  private static resolveAdrMap(
    scanId: number,
    files: AdrFileRecord[],
    components: { identity: string; name: string; rootPath: string; category: string }[],
    rootPath: string,
    onFallback: () => void,
    onMissingHash: () => void,
  ): Map<string, ResolvedAdrEntry> {
    const map = new Map<string, ResolvedAdrEntry>();
    const realWsRoot = fs.existsSync(rootPath) ? fs.realpathSync(rootPath) : path.resolve(rootPath);

    for (const file of files) {
      const contentHash = file.contentHash ?? null;
      let parsed: AdrFinding | null = null;
      let verifiedContent: { content: string | null; reason?: string } | null = null;
      let mismatchReason = "historical content unavailable on disk";

      if (!contentHash) {
        onMissingHash();
        mismatchReason = "missing indexed content hash";
      } else {
        const verifiedContentResult = this.readHashVerifiedDiskFile(
          realWsRoot,
          rootPath,
          file.normalizedPath,
          contentHash,
        );
        if (verifiedContentResult.content !== null) {
          parsed = this.parseAdrContent(
            file.normalizedPath,
            verifiedContentResult.content,
            components,
          );
          verifiedContent = verifiedContentResult;
        } else if (verifiedContentResult.reason) {
          mismatchReason = verifiedContentResult.reason;
        }
      }

      if (parsed) {
        map.set(parsed.adrId, {
          adrId: parsed.adrId,
          number: parsed.number,
          title: parsed.title,
          status: parsed.status,
          date: parsed.date,
          filePath: parsed.filePath,
          governedComponents: parsed.governedComponents,
          evidenceDescription: parsed.evidenceDescription,
          confidence: parsed.confidence,
          isFallback: false,
          contentHash,
          rawContent: verifiedContent?.content ?? undefined,
        });
        continue;
      }

      const basename = path.posix.basename(file.normalizedPath);
      const match = basename.match(/^ADR-(\d+)/i);
      if (!match) {
        continue;
      }

      const num = parseInt(match[1], 10);
      const adrId = `ADR-${match[1].padStart(3, "0")}`;
      if (map.has(adrId)) {
        continue;
      }

      onFallback();
      map.set(adrId, {
        adrId,
        number: num,
        title: basename.replace(/\.md$/i, ""),
        status: undefined,
        filePath: file.normalizedPath,
        governedComponents: [],
        evidenceDescription: `Historical ADR metadata fallback from indexed path ${file.normalizedPath} (scan ${scanId}: ${mismatchReason})`,
        confidence: 0.7,
        isFallback: true,
        contentHash,
      });
    }

    return map;
  }

  private static readHashVerifiedDiskFile(
    realWsRoot: string,
    rootPath: string,
    normalizedPath: string,
    expectedHash: string,
  ): { content: string | null; reason?: string } {
    const fullPath = path.resolve(rootPath, normalizedPath);
    try {
      if (!fs.existsSync(fullPath)) {
        return { content: null, reason: "historical content unavailable on disk" };
      }
      const realFilePath = fs.realpathSync(fullPath);
      const rel = path.relative(realWsRoot, realFilePath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { content: null, reason: "file path outside workspace root" };
      }

      const rawBuffer = fs.readFileSync(realFilePath);
      const actualHash = createHash("sha256").update(rawBuffer).digest("hex");
      if (actualHash !== expectedHash) {
        return { content: null, reason: "disk content hash differs from indexed snapshot" };
      }

      return { content: rawBuffer.toString("utf8") };
    } catch {
      return { content: null, reason: "unable to read file from disk" };
    }
  }

  private static parseAdrContent(
    filePath: string,
    content: string,
    components: { identity: string; name: string; rootPath: string; category: string }[],
  ): AdrFinding | null {
    if (content.trim().length === 0) return null;

    let adrId = "";
    let number = 0;
    let title = "";

    const titleMatch = content.match(/^#\s+(ADR-(\d+)[^:\n]*):\s*(.+)$/m);
    if (titleMatch) {
      adrId = titleMatch[1].trim();
      number = parseInt(titleMatch[2], 10);
      title = titleMatch[3].trim();
    } else {
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

    const relatedSectionMatch = content.match(/[-*]\s+\*\*Related:\*\*\s*([^\n\r]+)/i);
    if (relatedSectionMatch) {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(relatedSectionMatch[1])) !== null) {
        relatedDocuments.push(m[2]);
      }
    }

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
