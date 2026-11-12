/**
 * Phase 7.4 / 7.4.1 — Index Freshness & Staleness Evaluator
 * Non-destructive assessment of indexed repository state and filesystem synchronization.
 *
 * Evaluates:
 * 1. Source file modifications after indexing
 * 2. Source file deletions after indexing
 * 3. Source file additions after indexing
 * 4. Manifest modifications after indexing
 * 5. Content modifications with preserved timestamps (size changes & content-hash verification)
 * 6. Partial snapshots
 * 7. Failed latest scan superseding older complete active snapshots
 * 8. Missing active snapshots
 * 9. Missing or inaccessible repository roots
 */

import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import { classifyFile } from "../scanner/file-classifier.ts";
import { IgnoreStack } from "../scanner/ignore-evaluator.ts";
import { stableReadFileAndHash } from "../scanner/stable-hasher.ts";
import type {
  FreshnessAssessment,
  FreshnessEvaluationOptions,
  SnapshotFreshnessStatus,
} from "./types.ts";

export class FreshnessEvaluator {
  public static evaluate(
    db: SqliteDatabase,
    repositoryId: number,
    rootPath: string,
    explicitScanIdOrOptions?: number | FreshnessEvaluationOptions,
  ): FreshnessAssessment {
    const options: FreshnessEvaluationOptions =
      typeof explicitScanIdOrOptions === "number"
        ? { explicitScanId: explicitScanIdOrOptions }
        : (explicitScanIdOrOptions ?? {});

    // 1. Condition 9: Verify repository root existence and accessibility
    let rootAccessible = false;
    try {
      if (fs.existsSync(rootPath)) {
        fs.accessSync(rootPath, fs.constants.R_OK);
        rootAccessible = true;
      }
    } catch {
      rootAccessible = false;
    }

    if (!rootAccessible) {
      return {
        status: "FAILED",
        lastIndexedAt: null,
        isStale: true,
        staleReason: `Repository root path does not exist or is inaccessible: ${rootPath}`,
        activeScanId: null,
        isPartial: false,
      };
    }

    // 2. Condition 8: Resolve target scan to evaluate
    let targetScanId = options.explicitScanId;
    if (targetScanId === undefined) {
      const repoRow = db
        .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
        .get(repositoryId) as { active_scan_id: number | null } | undefined;

      targetScanId = repoRow?.active_scan_id ?? undefined;
    }

    if (!targetScanId) {
      return {
        status: "NONE",
        lastIndexedAt: null,
        isStale: true,
        staleReason:
          "No active scan index exists for this repository. Run repository scan to index.",
        activeScanId: null,
        isPartial: false,
      };
    }

    // 3. Fetch scan run details
    const scanRow = db
      .prepare(
        `SELECT id, started_at AS startedAt, completed_at AS completedAt, status, failure_reason AS failureReason
         FROM scan_runs WHERE repository_id = ? AND id = ?`,
      )
      .get(repositoryId, targetScanId) as
      | {
          id: number;
          startedAt: string;
          completedAt: string | null;
          status: string;
          failureReason: string | null;
        }
      | undefined;

    if (!scanRow) {
      return {
        status: "NONE",
        lastIndexedAt: null,
        isStale: true,
        staleReason: `Referenced scan ID ${targetScanId} was not found.`,
        activeScanId: null,
        isPartial: false,
      };
    }

    if (scanRow.status === "FAILED") {
      return {
        status: "FAILED",
        lastIndexedAt: scanRow.completedAt,
        isStale: true,
        staleReason: `Scan failed: ${scanRow.failureReason ?? "Unknown failure"}`,
        activeScanId: scanRow.id,
        isPartial: false,
      };
    }

    // 4. Condition 7: Detect failed latest scan with older complete active snapshot
    if (options.explicitScanId === undefined) {
      const latestScan = db
        .prepare(
          `SELECT id, status, failure_reason AS failureReason
           FROM scan_runs WHERE repository_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(repositoryId) as
        { id: number; status: string; failureReason: string | null } | undefined;

      if (latestScan && latestScan.id !== targetScanId && latestScan.status === "FAILED") {
        return {
          status: "STALE",
          lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
          isStale: true,
          staleReason: `Latest scan run (ID ${latestScan.id}) failed: ${
            latestScan.failureReason ?? "Unknown failure"
          }. Active scan ID ${targetScanId} is an older snapshot.`,
          activeScanId: scanRow.id,
          isPartial: scanRow.status === "PARTIAL" || scanRow.status === "PARTIAL_WITH_ERRORS",
        };
      }
    }

    // 5. Condition 6: Partial snapshot check
    const isPartial = scanRow.status === "PARTIAL" || scanRow.status === "PARTIAL_WITH_ERRORS";
    const scanStartTimeMs = new Date(scanRow.startedAt).getTime();

    // 6. Condition 4: Detect manifest modifications after indexing
    const keyManifests = [
      "package.json",
      "tsconfig.json",
      "Cargo.toml",
      "pyproject.toml",
      "go.mod",
      "pom.xml",
      "build.gradle",
    ];

    for (const kf of keyManifests) {
      const fullPath = path.join(rootPath, kf);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > scanStartTimeMs + 1000) {
            return {
              status: "STALE",
              lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
              isStale: true,
              staleReason: `Configuration manifest '${kf}' modified after index was created (${new Date(
                stat.mtimeMs,
              ).toISOString()}).`,
              activeScanId: scanRow.id,
              isPartial,
            };
          }
        } catch {
          // Non-fatal if stat fails
        }
      }
    }

    // 7. Indexed repository file inventory evaluation (Conditions 1, 2, 5)
    const dbFiles = db
      .prepare(
        `SELECT normalized_path AS normalizedPath, classification, size_bytes AS sizeBytes,
                modified_at AS modifiedAt, content_hash AS contentHash,
                sensitivity_status AS sensitivityStatus
         FROM files WHERE scan_id = ?`,
      )
      .all(scanRow.id) as {
      normalizedPath: string;
      classification: string;
      sizeBytes: number;
      modifiedAt: number;
      contentHash: string | null;
      sensitivityStatus: string;
    }[];

    const indexedPathsSet = new Set<string>();

    for (const f of dbFiles) {
      indexedPathsSet.add(f.normalizedPath);
      const fullPath = path.join(rootPath, f.normalizedPath);

      // Condition 2: Indexed source file deleted after indexing
      if (!fs.existsSync(fullPath)) {
        return {
          status: "STALE",
          lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
          isStale: true,
          staleReason: `Indexed ${f.classification} file '${f.normalizedPath}' was deleted after indexing.`,
          activeScanId: scanRow.id,
          isPartial,
        };
      }

      try {
        const stat = fs.statSync(fullPath);

        // Condition 1: Indexed source/manifest file modified after indexing
        if (stat.mtimeMs > f.modifiedAt + 1000) {
          return {
            status: "STALE",
            lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
            isStale: true,
            staleReason: `${
              f.classification === "manifest" ? "Manifest" : "Source"
            } file '${f.normalizedPath}' modified after indexing (disk: ${new Date(
              stat.mtimeMs,
            ).toISOString()}, indexed: ${new Date(f.modifiedAt).toISOString()}).`,
            activeScanId: scanRow.id,
            isPartial,
          };
        }

        // Condition 5: File content change with preserved modification timestamp
        // 5a. File size change
        if (stat.size !== f.sizeBytes) {
          return {
            status: "STALE",
            lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
            isStale: true,
            staleReason: `File '${f.normalizedPath}' content/size changed while modification timestamp was preserved (disk: ${stat.size} bytes, indexed: ${f.sizeBytes} bytes).`,
            activeScanId: scanRow.id,
            isPartial,
          };
        }

        // 5b. Content-hash verification when requested or practical
        if (options.verifyContentHashes && f.contentHash && f.sensitivityStatus === "SAFE") {
          const hashRes = stableReadFileAndHash(fullPath);
          if (hashRes.contentHash && hashRes.contentHash !== f.contentHash) {
            return {
              status: "STALE",
              lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
              isStale: true,
              staleReason: `File '${f.normalizedPath}' content changed while modification timestamp was preserved (content hash mismatch).`,
              activeScanId: scanRow.id,
              isPartial,
              strategy: "CONTENT_HASH",
            };
          }
        }
      } catch {
        // Non-fatal if single file stat fails
      }
    }

    // 8. Condition 3: Detect new source files added after indexing
    // Walk workspace directories using existing IgnoreStack and classifyFile
    try {
      const ignoreStack = new IgnoreStack();
      const newFileFound = this.detectAddedSourceFiles(
        rootPath,
        rootPath,
        ignoreStack,
        indexedPathsSet,
      );
      if (newFileFound) {
        return {
          status: "STALE",
          lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
          isStale: true,
          staleReason: `New source file '${newFileFound.path}' added after indexing.`,
          activeScanId: scanRow.id,
          isPartial,
        };
      }
    } catch {
      // Non-fatal if directory traversal check encounters an unreadable branch
    }

    // 9. Status determination
    let status: SnapshotFreshnessStatus = "FRESH";
    if (isPartial) {
      status = "PARTIAL";
    }

    return {
      status,
      lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
      isStale: false,
      activeScanId: scanRow.id,
      isPartial,
      checkedFilesCount: dbFiles.length,
      strategy: options.verifyContentHashes ? "CONTENT_HASH" : "INVENTORY_METADATA",
    };
  }

  /**
   * Bounded directory walker leveraging scanner IgnoreStack and classifyFile
   * to detect newly added source, test, and manifest files without full extraction.
   */
  private static detectAddedSourceFiles(
    rootPath: string,
    currentDir: string,
    ignoreStack: IgnoreStack,
    indexedPaths: Set<string>,
  ): { path: string } | null {
    const relDir = path.relative(rootPath, currentDir).replace(/\\/g, "/");

    if (
      relDir !== "" &&
      (ignoreStack.isHardExcluded(relDir) || ignoreStack.isIgnored(relDir, true))
    ) {
      return null;
    }

    const gitignorePath = path.join(currentDir, ".gitignore");
    let pushedScope = false;
    if (fs.existsSync(gitignorePath)) {
      try {
        const lines = fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/);
        ignoreStack.pushScope(relDir, lines);
        pushedScope = true;
      } catch {
        // ignore read error
      }
    }

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          const subResult = this.detectAddedSourceFiles(
            rootPath,
            fullPath,
            ignoreStack,
            indexedPaths,
          );
          if (subResult) return subResult;
        } else if (entry.isFile()) {
          if (ignoreStack.isHardExcluded(relPath) || ignoreStack.isIgnored(relPath, false)) {
            continue;
          }

          const classification = classifyFile(relPath);

          // Condition 3: Detect unindexed source files added after indexing
          if (classification === "source" && !indexedPaths.has(relPath)) {
            return { path: relPath };
          }
        }
      }
    } finally {
      if (pushedScope) {
        ignoreStack.popScope();
      }
    }

    return null;
  }
}
