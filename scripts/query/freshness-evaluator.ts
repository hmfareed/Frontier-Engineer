/**
 * Phase 7.4 — Index Freshness & Staleness Evaluator
 * Non-destructive assessment of indexed repository state and filesystem synchronization.
 */

import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { FreshnessAssessment, SnapshotFreshnessStatus } from "./types.ts";

export class FreshnessEvaluator {
  public static evaluate(
    db: SqliteDatabase,
    repositoryId: number,
    rootPath: string,
    explicitScanId?: number,
  ): FreshnessAssessment {
    // 1. Resolve scan to evaluate
    let targetScanId = explicitScanId;
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

    // 2. Fetch scan run details
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

    const isPartial = scanRow.status === "PARTIAL";
    let isStale = false;
    let staleReason: string | undefined;

    // 3. Detect filesystem modification drift
    try {
      if (fs.existsSync(rootPath)) {
        const scanStartTimeMs = new Date(scanRow.startedAt).getTime();

        // Check key configuration and manifest files
        const keyFiles = [
          "package.json",
          "tsconfig.json",
          "Cargo.toml",
          "pyproject.toml",
          "go.mod",
        ];

        for (const kf of keyFiles) {
          const fullPath = path.join(rootPath, kf);
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > scanStartTimeMs + 1000) {
              isStale = true;
              staleReason = `Configuration file '${kf}' modified after index was created (${new Date(stat.mtimeMs).toISOString()}).`;
              break;
            }
          }
        }

        // Also check if latest file mtime in files table is older than workspace files
        if (!isStale) {
          const latestDbFile = db
            .prepare("SELECT MAX(modified_at) AS maxMtime FROM files WHERE scan_id = ?")
            .get(scanRow.id) as { maxMtime: number | null };

          if (latestDbFile && latestDbFile.maxMtime) {
            // Check workspace root mtime
            const rootStat = fs.statSync(rootPath);
            if (rootStat.mtimeMs > scanStartTimeMs + 5000) {
              // Informational drift
              isStale = true;
              staleReason = "Workspace directory modified after last scan.";
            }
          }
        }
      }
    } catch {
      // Non-fatal if filesystem stat check fails
    }

    let status: SnapshotFreshnessStatus = "COMPLETE";
    if (isPartial) {
      status = "PARTIAL";
    } else if (isStale) {
      status = "STALE";
    }

    return {
      status,
      lastIndexedAt: scanRow.completedAt ?? scanRow.startedAt,
      isStale,
      staleReason,
      activeScanId: scanRow.id,
      isPartial,
    };
  }
}
