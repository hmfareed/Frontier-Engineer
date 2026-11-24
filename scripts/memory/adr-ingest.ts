/**
 * Phase 8.2B — Architectural Decision Record (ADR) Ingestion Pipeline
 * Discovers, validates, parses, and ingests ADR Markdown documents into SQLite engineering memories.
 * Enforces explicit human authority, idempotency, path containment, and audit tracking.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { generateMemoryKey } from "./memory-authoring.ts";
import type {
  EngineeringMemoryRecord,
  MemoryCategory,
  MemoryConfidenceTier,
} from "../storage/types.ts";

export const MAX_ADR_FILE_BYTES = 5 * 1024 * 1024; // 5 MB bounded parser size

export interface ParsedAdr {
  adrId?: string;
  number?: number;
  title: string;
  status: string;
  normalizedStatus: "ACTIVE" | "SUPERSEDED" | "ARCHIVED";
  date?: string;
  deciders?: string;
  supersedesRef?: string;
  relatedRefs: string[];
  governedComponents: string[];
  context?: string;
  decision?: string;
  consequences?: string;
  normalizedBody: string;
}

export interface IngestItemResult {
  id?: number;
  key: string;
  title: string;
  file: string;
  previousVersion?: number;
  currentVersion?: number;
}

export interface UnresolvedSupersession {
  sourceAdr: string;
  targetRef: string;
  reason: string;
}

export interface IngestAdrReport {
  success: boolean;
  dryRun: boolean;
  totalScanned: number;
  created: IngestItemResult[];
  updated: IngestItemResult[];
  unchanged: IngestItemResult[];
  unresolvedSupersessions: UnresolvedSupersession[];
  errors: Array<{ file: string; error: string }>;
}

export interface IngestAdrOptions {
  pathOrGlob?: string;
  dryRun?: boolean;
  scanId?: number | null;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Validates that a file path resides strictly inside the workspace root.
 * Resolves symlinks via fs.realpathSync to prevent path traversal attacks.
 */
export function validateWorkspaceContainment(workspaceRoot: string, targetPath: string): string {
  const realWsRoot = fs.existsSync(workspaceRoot)
    ? fs.realpathSync(workspaceRoot)
    : path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(workspaceRoot, targetPath);

  if (!fs.existsSync(resolvedTarget)) {
    // If target doesn't exist yet, check its resolved parent
    const rel = path.relative(realWsRoot, resolvedTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Security Error: Path '${targetPath}' resolves outside workspace root`);
    }
    return resolvedTarget;
  }

  const realTarget = fs.realpathSync(resolvedTarget);
  const rel = path.relative(realWsRoot, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Security Error: Path '${targetPath}' resolves outside workspace root`);
  }
  return realTarget;
}

/**
 * Parses an ADR Markdown string with YAML frontmatter or bullet-list metadata.
 */
export function parseAdrMarkdown(content: string, filePath: string): ParsedAdr {
  if (Buffer.byteLength(content, "utf8") > MAX_ADR_FILE_BYTES) {
    throw new Error(`ADR file exceeds maximum permitted size of ${MAX_ADR_FILE_BYTES} bytes`);
  }

  let body = content;
  let frontmatter: Record<string, string> = {};

  // 1. Extract optional YAML frontmatter (--- ... ---)
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    const rawFm = fmMatch[1];
    body = body.slice(fmMatch[0].length);
    const lines = rawFm.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim().toLowerCase();
        const v = line
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        frontmatter[k] = v;
      }
    }
  }

  // 2. Extract Title and ADR Number
  let adrId: string | undefined = frontmatter["id"] ?? frontmatter["adr_id"];
  let number: number | undefined = frontmatter["number"]
    ? parseInt(frontmatter["number"], 10)
    : undefined;
  let title = frontmatter["title"] ?? "";

  const titleHeaderMatch = body.match(/^#\s+(ADR-(\d+)[^:\n\-]*)(?:[:\-]\s*(.+))?$/m);
  if (titleHeaderMatch) {
    if (!adrId) adrId = titleHeaderMatch[1].trim();
    if (number === undefined && titleHeaderMatch[2]) {
      number = parseInt(titleHeaderMatch[2], 10);
    }
    if (!title && titleHeaderMatch[3]) {
      title = titleHeaderMatch[3].trim();
    }
  } else if (!title) {
    const genericHeaderMatch = body.match(/^#\s+(.+)$/m);
    if (genericHeaderMatch) {
      title = genericHeaderMatch[1].trim();
    }
  }

  // Fallback to filename if title or number is missing
  const baseName = path.basename(filePath, path.extname(filePath));
  const fileNumMatch = baseName.match(/ADR-(\d+)/i);
  if (number === undefined && fileNumMatch) {
    number = parseInt(fileNumMatch[1], 10);
    if (!adrId) adrId = `ADR-${String(number).padStart(3, "0")}`;
  }
  if (!title) {
    title = baseName
      .replace(/^[Aa][Dd][Rr][-_]\d+[-_]?/, "")
      .replace(/[-_]/g, " ")
      .trim();
    if (!title) title = baseName;
  }

  // 3. Extract Metadata from body bullet lines if not in frontmatter
  let status = frontmatter["status"] ?? "Accepted";
  let date = frontmatter["date"];
  let deciders = frontmatter["deciders"] ?? frontmatter["decider"];
  let supersedesRef = frontmatter["supersedes"] ?? frontmatter["superseded_by"];
  const relatedRefs: string[] = [];
  const governedComponents: string[] = [];

  const statusMatch = body.match(/[-*]\s+\*\*Status:\*\*\s*([^\n\r]+)/i);
  if (statusMatch && !frontmatter["status"]) {
    status = statusMatch[1].trim();
  }

  const dateMatch = body.match(/[-*]\s+\*\*Date:\*\*\s*([^\n\r]+)/i);
  if (dateMatch && !frontmatter["date"]) {
    date = dateMatch[1].trim();
  }

  const decidersMatch = body.match(/[-*]\s+\*\*Deciders:\*\*\s*([^\n\r]+)/i);
  if (decidersMatch && !frontmatter["deciders"]) {
    deciders = decidersMatch[1].trim();
  }

  const supersedesMatch = body.match(/[-*]\s+\*\*(?:Supersedes|Replaces):\*\*\s*([^\n\r]+)/i);
  if (supersedesMatch && !supersedesRef) {
    supersedesRef = supersedesMatch[1].trim();
  }

  const relatedMatch = body.match(/[-*]\s+\*\*Related:\*\*\s*([^\n\r]+)/i);
  if (relatedMatch) {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(relatedMatch[1])) !== null) {
      relatedRefs.push(m[2]);
    }
  }

  // 4. Normalize Status
  const sLower = status.toLowerCase();
  let normalizedStatus: "ACTIVE" | "SUPERSEDED" | "ARCHIVED" = "ACTIVE";
  if (sLower.includes("supersed") || sLower.includes("deprecat") || sLower.includes("replac")) {
    normalizedStatus = "SUPERSEDED";
  } else if (
    sLower.includes("archiv") ||
    sLower.includes("reject") ||
    sLower.includes("withdrawn")
  ) {
    normalizedStatus = "ARCHIVED";
  }

  // Clean supersedes reference string
  if (supersedesRef) {
    const match = supersedesRef.match(/ADR-(\d+)/i);
    if (match) {
      supersedesRef = `ADR-${String(parseInt(match[1], 10)).padStart(3, "0")}`;
    } else {
      supersedesRef = supersedesRef.replace(/\[([^\]]+)\]\([^)]+\)/, "$1").trim();
    }
  }

  return {
    adrId,
    number,
    title,
    status,
    normalizedStatus,
    date,
    deciders,
    supersedesRef: supersedesRef || undefined,
    relatedRefs,
    governedComponents,
    normalizedBody: body.trim(),
  };
}

/**
 * Discovers ADR files in workspace following documented conventions or explicit target paths.
 */
export function discoverAdrFiles(workspaceRoot: string, targetPathOrGlob?: string): string[] {
  const realWsRoot = fs.existsSync(workspaceRoot)
    ? fs.realpathSync(workspaceRoot)
    : path.resolve(workspaceRoot);

  if (targetPathOrGlob && targetPathOrGlob.trim().length > 0) {
    const trimmed = targetPathOrGlob.trim();
    const resolved = path.resolve(realWsRoot, trimmed);

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      validateWorkspaceContainment(realWsRoot, resolved);
      return [resolved];
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      validateWorkspaceContainment(realWsRoot, resolved);
      const entries = fs.readdirSync(resolved);
      return entries
        .filter((f) => f.toLowerCase().endsWith(".md"))
        .map((f) => path.join(resolved, f))
        .sort();
    }

    // Simple glob matching within directory
    const dir = path.dirname(resolved);
    const pattern = path.basename(resolved);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      validateWorkspaceContainment(realWsRoot, dir);
      const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`, "i");
      return fs
        .readdirSync(dir)
        .filter((f) => regex.test(f) && f.toLowerCase().endsWith(".md"))
        .map((f) => path.join(dir, f))
        .sort();
    }

    return [];
  }

  // Default candidate directories
  const candidates = [
    path.join(realWsRoot, "docs", "adr"),
    path.join(realWsRoot, "adr"),
    path.join(realWsRoot, "docs", "architecture-decisions"),
  ];

  const results: string[] = [];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (/^ADR-\d+.*\.md$/i.test(entry)) {
          results.push(path.join(dir, entry));
        }
      }
    }
  }

  return results.sort();
}

export class AdrIngestEngine {
  private db: SqliteDatabase;
  private store: MemoryStore;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.store = new MemoryStore(db);
  }

  /**
   * Discovers and explicitly ingests ADR files into SQLite engineering memories.
   */
  public ingest(
    repositoryId: number,
    workspaceRoot: string,
    options: IngestAdrOptions = {},
  ): IngestAdrReport {
    const dryRun = options.dryRun ?? false;
    const files = discoverAdrFiles(workspaceRoot, options.pathOrGlob);

    const report: IngestAdrReport = {
      success: true,
      dryRun,
      totalScanned: files.length,
      created: [],
      updated: [],
      unchanged: [],
      unresolvedSupersessions: [],
      errors: [],
    };

    const pendingSupersessions: Array<{
      sourceKey: string;
      sourceFile: string;
      targetRef: string;
    }> = [];

    for (const filePath of files) {
      try {
        const canonicalPath = validateWorkspaceContainment(workspaceRoot, filePath);
        const content = fs.readFileSync(canonicalPath, "utf8");
        const parsed = parseAdrMarkdown(content, canonicalPath);
        const relativePath = path.relative(workspaceRoot, canonicalPath).replace(/\\/g, "/");

        const key = generateMemoryKey("architectural_decision", parsed.title, parsed.number);
        const contentHash = sha256(parsed.normalizedBody);

        const existing = this.store.getMemoryByKey(repositoryId, key);

        if (!existing) {
          if (!dryRun) {
            this.db.transaction(() => {
              const created = this.store.createMemory({
                repositoryId,
                memoryKey: key,
                category: "architectural_decision",
                title: parsed.title,
                content: parsed.normalizedBody,
                confidence: 1.0,
                confidenceTier: "CONFIRMED",
                firstSeenScanId: options.scanId ?? null,
                lastSeenScanId: options.scanId ?? null,
              });

              if (options.scanId) {
                this.store.addEvidence({
                  repositoryId,
                  memoryId: created.id,
                  scanId: options.scanId,
                  evidenceType: "adr",
                  sourcePath: relativePath,
                  sourceHash: contentHash,
                  description: `Ingested ADR source document: ${relativePath}`,
                  confidence: 1.0,
                });
              }
            });
          }
          report.created.push({
            key,
            title: parsed.title,
            file: relativePath,
          });
        } else {
          // Check if content hash changed
          const prevHash = sha256(existing.content);
          if (prevHash === contentHash && existing.title === parsed.title) {
            report.unchanged.push({
              id: existing.id,
              key: existing.memoryKey,
              title: existing.title,
              file: relativePath,
            });
          } else {
            if (!dryRun) {
              const updated = this.store.updateMemory({
                repositoryId,
                memoryId: existing.id,
                newTitle: parsed.title,
                newContent: parsed.normalizedBody,
                changeReason: `ADR source content updated on disk (${relativePath})`,
                sourceScanId: options.scanId ?? null,
              });
              report.updated.push({
                id: existing.id,
                key: existing.memoryKey,
                title: parsed.title,
                previousVersion: existing.version,
                currentVersion: updated.version,
                file: relativePath,
              });
            } else {
              report.updated.push({
                id: existing.id,
                key: existing.memoryKey,
                title: parsed.title,
                previousVersion: existing.version,
                currentVersion: existing.version + 1,
                file: relativePath,
              });
            }
          }
        }

        if (parsed.supersedesRef) {
          pendingSupersessions.push({
            sourceKey: key,
            sourceFile: relativePath,
            targetRef: parsed.supersedesRef,
          });
        }
      } catch (err) {
        report.errors.push({
          file: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        report.success = false;
      }
    }

    // Process pending supersessions if not dryRun
    for (const sup of pendingSupersessions) {
      const sourceMem = this.store.getMemoryByKey(repositoryId, sup.sourceKey);
      if (!sourceMem) continue;

      // Find target by ADR number or key pattern
      let targetMem: EngineeringMemoryRecord | null = null;
      const numMatch = sup.targetRef.match(/ADR-(\d+)/i);
      if (numMatch) {
        const targetNumStr = String(parseInt(numMatch[1], 10)).padStart(3, "0");
        const allMemories = this.store.listMemories(repositoryId, {
          category: "architectural_decision",
        });
        targetMem =
          allMemories.find(
            (m) =>
              m.memoryKey.startsWith(`adr_${targetNumStr}_`) ||
              m.title.toUpperCase().includes(`ADR-${targetNumStr}`),
          ) ?? null;
      }

      if (targetMem) {
        if (targetMem.status === "ACTIVE" && sourceMem.status === "ACTIVE") {
          if (!dryRun) {
            try {
              this.store.transitionLifecycle({
                repositoryId,
                memoryId: targetMem.id,
                targetStatus: "SUPERSEDED",
                supersededById: sourceMem.id,
                changeReason: `Superseded by ADR decision ${sourceMem.memoryKey} (${sup.sourceFile})`,
                sourceScanId: options.scanId ?? null,
              });
            } catch (e) {
              report.unresolvedSupersessions.push({
                sourceAdr: sup.sourceKey,
                targetRef: sup.targetRef,
                reason: `Supersession failed: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }
        }
      } else {
        report.unresolvedSupersessions.push({
          sourceAdr: sup.sourceKey,
          targetRef: sup.targetRef,
          reason: `Target memory not found for reference '${sup.targetRef}'`,
        });
      }
    }

    return report;
  }
}
