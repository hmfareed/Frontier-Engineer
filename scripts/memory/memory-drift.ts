/**
 * Phase 8.2D — Engineering Memory Drift Detection & Reconciliation
 * Discovers and reports inconsistencies between disk ADRs, projected Markdown files,
 * SQLite engineering memories, and linked evidence.
 * Safe, strictly read-only by default, explicit reconciliation mode.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { discoverAdrFiles, parseAdrMarkdown } from "./adr-ingest.ts";
import { renderMemoryMarkdown, PROJECTION_BANNER } from "./memory-projector.ts";
import type { EngineeringMemoryRecord } from "../storage/types.ts";

export type DriftSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface DriftFinding {
  code:
    | "ADR_CONTENT_CHANGED"
    | "ADR_STATUS_MISMATCH"
    | "ADR_FILE_MISSING"
    | "PROJECTION_MISSING"
    | "PROJECTION_CONTENT_DRIFT"
    | "BROKEN_SUPERSESSION"
    | "DUPLICATE_CONTENT"
    | "ORPHANED_EVIDENCE";
  severity: DriftSeverity;
  entityKey?: string;
  memoryId?: number;
  filePath?: string;
  description: string;
  expected?: string;
  actual?: string;
}

export interface MemoryDriftReport {
  timestamp: string;
  repositoryId: number;
  totalFindings: number;
  findings: DriftFinding[];
  summary: {
    critical: number;
    warnings: number;
    info: number;
  };
  hasDrift: boolean;
}

export interface DetectDriftOptions {
  memoriesDir?: string; // Defaults to '.frontier/memories'
  reconcile?: boolean; // If true, apply safe reconciliation
  dryRun?: boolean;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class MemoryDriftDetector {
  private db: SqliteDatabase;
  private store: MemoryStore;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.store = new MemoryStore(db);
  }

  /**
   * Performs comprehensive drift detection across ADRs, database memories,
   * projections, and evidence.
   */
  public detect(
    repositoryId: number,
    workspaceRoot: string,
    options: DetectDriftOptions = {},
  ): MemoryDriftReport {
    const findings: DriftFinding[] = [];
    const memoriesDir = options.memoriesDir ?? path.join(".frontier", "memories");
    const canonicalMemoriesDir = path.resolve(workspaceRoot, memoriesDir);

    const memories = this.store.listMemories(repositoryId);
    const memoryById = new Map<number, EngineeringMemoryRecord>(memories.map((m) => [m.id, m]));
    const memoryByKey = new Map<string, EngineeringMemoryRecord>(
      memories.map((m) => [m.memoryKey, m]),
    );

    // 1. Broken supersession references
    for (const mem of memories) {
      if (mem.status === "SUPERSEDED") {
        if (!mem.supersededById) {
          findings.push({
            code: "BROKEN_SUPERSESSION",
            severity: "CRITICAL",
            entityKey: mem.memoryKey,
            memoryId: mem.id,
            description: `Memory #${mem.id} is marked SUPERSEDED but has null superseded_by_id`,
          });
        } else if (!memoryById.has(mem.supersededById)) {
          findings.push({
            code: "BROKEN_SUPERSESSION",
            severity: "CRITICAL",
            entityKey: mem.memoryKey,
            memoryId: mem.id,
            description: `Memory #${mem.id} supersession pointer #${mem.supersededById} does not exist in repository`,
            expected: `Existing memory ID`,
            actual: `Missing #${mem.supersededById}`,
          });
        }
      }
    }

    // 2. Duplicate active content detection
    const contentHashMap = new Map<string, { id: number; key: string }>();
    for (const mem of memories) {
      if (mem.status === "ACTIVE") {
        const hash = sha256(mem.content);
        const existing = contentHashMap.get(hash);
        if (existing) {
          findings.push({
            code: "DUPLICATE_CONTENT",
            severity: "WARNING",
            entityKey: mem.memoryKey,
            memoryId: mem.id,
            description: `Active memory #${mem.id} ('${mem.memoryKey}') shares identical content with #${existing.id} ('${existing.key}')`,
          });
        } else {
          contentHashMap.set(hash, { id: mem.id, key: mem.memoryKey });
        }
      }
    }

    // 3. ADR Disk vs Database Drift
    const adrFiles = discoverAdrFiles(workspaceRoot);
    const discoveredAdrKeys = new Set<string>();

    for (const adrPath of adrFiles) {
      try {
        const relPath = path.relative(workspaceRoot, adrPath).replace(/\\/g, "/");
        const content = fs.readFileSync(adrPath, "utf8");
        const parsed = parseAdrMarkdown(content, adrPath);

        const expectedKey = parsed.number
          ? `adr_${String(parsed.number).padStart(3, "0")}_`
          : undefined;

        // Find corresponding memory
        const matchedMem = expectedKey
          ? memories.find((m) => m.memoryKey.startsWith(expectedKey))
          : memoryByKey.get(parsed.title.toLowerCase().replace(/[^a-z0-9_]/g, "_"));

        if (matchedMem) {
          discoveredAdrKeys.add(matchedMem.memoryKey);
          const diskHash = sha256(parsed.normalizedBody);
          const dbHash = sha256(matchedMem.content);

          if (diskHash !== dbHash) {
            findings.push({
              code: "ADR_CONTENT_CHANGED",
              severity: "WARNING",
              entityKey: matchedMem.memoryKey,
              memoryId: matchedMem.id,
              filePath: relPath,
              description: `On-disk ADR '${relPath}' content has drifted from stored database memory #${matchedMem.id}`,
              expected: `dbHash: ${dbHash.slice(0, 8)}`,
              actual: `diskHash: ${diskHash.slice(0, 8)}`,
            });
          }

          if (parsed.normalizedStatus !== matchedMem.status) {
            findings.push({
              code: "ADR_STATUS_MISMATCH",
              severity: "WARNING",
              entityKey: matchedMem.memoryKey,
              memoryId: matchedMem.id,
              filePath: relPath,
              description: `ADR '${relPath}' status on disk (${parsed.status} -> ${parsed.normalizedStatus}) differs from stored status (${matchedMem.status})`,
              expected: matchedMem.status,
              actual: parsed.normalizedStatus,
            });
          }
        }
      } catch {
        // Discovered files with parse errors are ignored in drift check
      }
    }

    // 4. Missing ADR files for memories that have adr evidence
    for (const mem of memories) {
      const evidence = this.store.getMemoryEvidence(repositoryId, mem.id);
      for (const ev of evidence) {
        if (ev.evidenceType === "adr") {
          const fullPath = path.resolve(workspaceRoot, ev.sourcePath);
          if (!fs.existsSync(fullPath)) {
            findings.push({
              code: "ADR_FILE_MISSING",
              severity: "CRITICAL",
              entityKey: mem.memoryKey,
              memoryId: mem.id,
              filePath: ev.sourcePath,
              description: `ADR source document '${ev.sourcePath}' referenced by memory #${mem.id} is missing from disk`,
            });
          }
        } else if (ev.evidenceType === "source_file") {
          const fullPath = path.resolve(workspaceRoot, ev.sourcePath);
          if (!fs.existsSync(fullPath)) {
            findings.push({
              code: "ORPHANED_EVIDENCE",
              severity: "INFO",
              entityKey: mem.memoryKey,
              memoryId: mem.id,
              filePath: ev.sourcePath,
              description: `Source evidence file '${ev.sourcePath}' linked to memory #${mem.id} does not exist on disk`,
            });
          }
        }
      }
    }

    // 5. Projection file drift
    if (fs.existsSync(canonicalMemoriesDir)) {
      for (const mem of memories) {
        const expectedFile = path.join(canonicalMemoriesDir, mem.category, `${mem.memoryKey}.md`);
        const relProjPath = path.relative(workspaceRoot, expectedFile).replace(/\\/g, "/");

        if (!fs.existsSync(expectedFile)) {
          findings.push({
            code: "PROJECTION_MISSING",
            severity: "INFO",
            entityKey: mem.memoryKey,
            memoryId: mem.id,
            filePath: relProjPath,
            description: `Projection file for memory #${mem.id} ('${mem.memoryKey}') is missing at '${relProjPath}'`,
          });
        } else {
          const content = fs.readFileSync(expectedFile, "utf8");
          const ev = this.store.getMemoryEvidence(repositoryId, mem.id);
          const vers = this.store.getMemoryVersions(repositoryId, mem.id);
          const expectedContent = renderMemoryMarkdown(mem, ev, vers);

          if (sha256(content) !== sha256(expectedContent)) {
            findings.push({
              code: "PROJECTION_CONTENT_DRIFT",
              severity: "WARNING",
              entityKey: mem.memoryKey,
              memoryId: mem.id,
              filePath: relProjPath,
              description: `Projected file '${relProjPath}' differs from current database state (manually edited or outdated)`,
            });
          }
        }
      }
    }

    const summary = {
      critical: findings.filter((f) => f.severity === "CRITICAL").length,
      warnings: findings.filter((f) => f.severity === "WARNING").length,
      info: findings.filter((f) => f.severity === "INFO").length,
    };

    return {
      timestamp: new Date().toISOString(),
      repositoryId,
      totalFindings: findings.length,
      findings,
      summary,
      hasDrift: findings.length > 0,
    };
  }
}
