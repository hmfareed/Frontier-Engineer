/**
 * Phase 7.3 — Scan Run Repository Store
 * Manages scan run lifecycles, states, and active scan pointer tracking.
 */

import type { SqliteDatabase } from "../database.ts";
import type { ScanRecord, ScanRunStatus } from "../types.ts";

export class ScanStore {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public createScanRun(params: {
    repositoryId: number;
    scannerVersion: string;
    extractorVersion: string;
  }): ScanRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO scan_runs (
        repository_id, started_at, status, files_discovered, files_indexed,
        files_skipped, files_failed, diagnostic_count, scanner_version,
        extractor_version, is_active
      ) VALUES (?, ?, 'RUNNING', 0, 0, 0, 0, 0, ?, ?, 0)`,
    );

    const res = stmt.run(params.repositoryId, now, params.scannerVersion, params.extractorVersion);

    return {
      id: Number(res.lastInsertRowid),
      repositoryId: params.repositoryId,
      startedAt: now,
      completedAt: null,
      status: "RUNNING",
      filesDiscovered: 0,
      filesIndexed: 0,
      filesSkipped: 0,
      filesFailed: 0,
      diagnosticCount: 0,
      scannerVersion: params.scannerVersion,
      extractorVersion: params.extractorVersion,
      isActive: false,
      failureReason: null,
    };
  }

  public updateProgress(params: {
    scanId: number;
    filesDiscovered?: number;
    filesIndexed?: number;
    filesSkipped?: number;
    filesFailed?: number;
    diagnosticCount?: number;
    status?: ScanRunStatus;
  }): void {
    const updates: string[] = [];
    const values: (number | string)[] = [];

    if (params.filesDiscovered !== undefined) {
      updates.push("files_discovered = ?");
      values.push(params.filesDiscovered);
    }
    if (params.filesIndexed !== undefined) {
      updates.push("files_indexed = ?");
      values.push(params.filesIndexed);
    }
    if (params.filesSkipped !== undefined) {
      updates.push("files_skipped = ?");
      values.push(params.filesSkipped);
    }
    if (params.filesFailed !== undefined) {
      updates.push("files_failed = ?");
      values.push(params.filesFailed);
    }
    if (params.diagnosticCount !== undefined) {
      updates.push("diagnostic_count = ?");
      values.push(params.diagnosticCount);
    }
    if (params.status !== undefined) {
      updates.push("status = ?");
      values.push(params.status);
    }

    if (updates.length === 0) return;

    values.push(params.scanId);
    const sql = `UPDATE scan_runs SET ${updates.join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  public completeScan(scanId: number, status: "COMPLETE" | "PARTIAL" = "COMPLETE"): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE scan_runs SET status = ?, completed_at = ? WHERE id = ?")
      .run(status, now, scanId);
  }

  public failScan(scanId: number, failureReason: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE scan_runs SET status = 'FAILED', completed_at = ?, failure_reason = ? WHERE id = ?",
      )
      .run(now, failureReason, scanId);
  }

  public cancelScan(scanId: number, cancelReason: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE scan_runs SET status = 'CANCELLED', completed_at = ?, failure_reason = ? WHERE id = ?",
      )
      .run(now, cancelReason, scanId);
  }

  public getScanById(scanId: number): ScanRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, started_at AS startedAt,
          completed_at AS completedAt, status, files_discovered AS filesDiscovered,
          files_indexed AS filesIndexed, files_skipped AS filesSkipped,
          files_failed AS filesFailed, diagnostic_count AS diagnosticCount,
          scanner_version AS scannerVersion, extractor_version AS extractorVersion,
          is_active AS isActive, failure_reason AS failureReason
        FROM scan_runs WHERE id = ?`,
      )
      .get(scanId) as ScanRecord | undefined;

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive),
    };
  }

  public getActiveScan(repositoryId: number): ScanRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          s.id, s.repository_id AS repositoryId, s.started_at AS startedAt,
          s.completed_at AS completedAt, s.status, s.files_discovered AS filesDiscovered,
          s.files_indexed AS filesIndexed, s.files_skipped AS filesSkipped,
          s.files_failed AS filesFailed, s.diagnostic_count AS diagnosticCount,
          s.scanner_version AS scannerVersion, s.extractor_version AS extractorVersion,
          s.is_active AS isActive, s.failure_reason AS failureReason
        FROM scan_runs s
        JOIN repositories r ON r.active_scan_id = s.id
        WHERE r.id = ?`,
      )
      .get(repositoryId) as ScanRecord | undefined;

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive),
    };
  }

  public promoteScan(
    repositoryId: number,
    scanId: number,
    options?: { allowPartial?: boolean },
  ): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const target = this.db
        .prepare("SELECT id, repository_id AS repositoryId, status FROM scan_runs WHERE id = ?")
        .get(scanId) as { id: number; repositoryId: number; status: ScanRunStatus } | undefined;

      if (!target) {
        throw new Error(`Cannot promote missing scan ${scanId}.`);
      }
      if (target.repositoryId !== repositoryId) {
        throw new Error(
          `Cannot promote scan ${scanId}: belongs to repository ${target.repositoryId}, expected ${repositoryId}.`,
        );
      }
      if (target.status !== "COMPLETE" && target.status !== "PARTIAL") {
        throw new Error(`Cannot promote scan ${scanId} with status '${target.status}'.`);
      }

      if (target.status === "PARTIAL") {
        if (options?.allowPartial === false) {
          throw new Error(`Cannot promote PARTIAL scan ${scanId} when allowPartial is false.`);
        }
        const active = this.getActiveScan(repositoryId);
        if (active && active.id !== scanId && active.status === "COMPLETE") {
          throw new Error(
            `Cannot promote PARTIAL scan ${scanId} over active COMPLETE scan ${active.id}.`,
          );
        }
      }

      // Mark all scans inactive for this repository
      this.db
        .prepare("UPDATE scan_runs SET is_active = 0 WHERE repository_id = ?")
        .run(repositoryId);

      // Mark target scan active
      this.db.prepare("UPDATE scan_runs SET is_active = 1 WHERE id = ?").run(scanId);

      // Update active_scan_id on repository record
      this.db
        .prepare("UPDATE repositories SET active_scan_id = ?, updated_at = ? WHERE id = ?")
        .run(scanId, now, repositoryId);
    });
  }

  public recoverInterruptedScans(repositoryId: number): number {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const interrupted = this.db
        .prepare(
          `SELECT id FROM scan_runs
           WHERE repository_id = ? AND status IN ('RUNNING', 'VALIDATING')`,
        )
        .all(repositoryId) as Array<{ id: number }>;

      if (interrupted.length === 0) {
        return 0;
      }

      const deleteFilesStmt = this.db.prepare("DELETE FROM files WHERE scan_id = ?");
      const deleteNodesStmt = this.db.prepare("DELETE FROM graph_nodes WHERE scan_id = ?");
      const deleteComponentsStmt = this.db.prepare(
        "DELETE FROM architecture_components WHERE scan_id = ?",
      );
      const clearActiveRepoStmt = this.db.prepare(
        "UPDATE repositories SET active_scan_id = NULL, updated_at = ? WHERE id = ? AND active_scan_id = ?",
      );

      for (const row of interrupted) {
        clearActiveRepoStmt.run(now, repositoryId, row.id);
        deleteFilesStmt.run(row.id);
        deleteNodesStmt.run(row.id);
        deleteComponentsStmt.run(row.id);
      }

      const res = this.db
        .prepare(
          `UPDATE scan_runs
           SET status = 'FAILED', is_active = 0, completed_at = ?, failure_reason = 'Interrupted by process termination or crash'
           WHERE repository_id = ? AND status IN ('RUNNING', 'VALIDATING')`,
        )
        .run(now, repositoryId);

      return Number(res.changes);
    });
  }
}
