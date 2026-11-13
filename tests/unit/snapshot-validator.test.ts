import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { SnapshotValidator } from "../../scripts/evolution/snapshot-validator.ts";
import { ScanStore } from "../../scripts/storage/repositories/scan-store.ts";

describe("snapshot-validator (Repository Isolation, Completeness & Chronology)", () => {
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let scanStore: ScanStore;
  let repoId: number;

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    scanStore = new ScanStore(db);
    repoId = connectionManager.getRepository().id;
  });

  afterEach(async () => {
    connectionManager.close();
  });

  function createCompletedScan(params: {
    repositoryId?: number;
    startedAt: string;
    completedAt?: string;
    status?: "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" | "RUNNING" | "VALIDATING";
  }): number {
    const rId = params.repositoryId ?? repoId;
    const stmt = db.prepare(
      `INSERT INTO scan_runs (
        repository_id, started_at, completed_at, status, files_discovered,
        files_indexed, files_skipped, files_failed, diagnostic_count,
        scanner_version, extractor_version, is_active
      ) VALUES (?, ?, ?, ?, 10, 10, 0, 0, 0, '1.0.0', '1.0.0', 0)`,
    );
    const res = stmt.run(
      rId,
      params.startedAt,
      params.completedAt ?? new Date().toISOString(),
      params.status ?? "COMPLETE",
    );
    return Number(res.lastInsertRowid);
  }

  it("1. validates valid chronological snapshots in the same repository", () => {
    const baseId = createCompletedScan({ startedAt: "2026-11-01T10:00:00.000Z" });
    const targetId = createCompletedScan({ startedAt: "2026-11-02T10:00:00.000Z" });

    const result = SnapshotValidator.validate(db, baseId, targetId);
    expect(result.isValid).toBe(true);
    expect(result.repositoryId).toBe(repoId);
    expect(result.baseScanId).toBe(baseId);
    expect(result.targetScanId).toBe(targetId);
    expect(result.failedChecks).toHaveLength(0);
    expect(result.passedChecks).toContain("REPOSITORY_IDENTITY_MATCH");
    expect(result.passedChecks).toContain("BASE_SNAPSHOT_COMPLETENESS");
    expect(result.passedChecks).toContain("TARGET_SNAPSHOT_COMPLETENESS");
    expect(result.passedChecks).toContain("CHRONOLOGICAL_ORDER");
  });

  it("2. rejects identical base and target scan IDs", () => {
    const scanId = createCompletedScan({ startedAt: "2026-11-01T10:00:00.000Z" });
    const result = SnapshotValidator.validate(db, scanId, scanId);

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_IDENTICAL_SNAPSHOTS");
    expect(result.errorMessage).toContain("cannot be identical");
    expect(result.failedChecks).toContain("IDENTICAL_SNAPSHOT_IDS");
  });

  it("3. rejects missing base snapshot", () => {
    const targetId = createCompletedScan({ startedAt: "2026-11-02T10:00:00.000Z" });
    const result = SnapshotValidator.validate(db, 99999, targetId);

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_BASE_SNAPSHOT_NOT_FOUND");
    expect(result.failedChecks).toContain("BASE_SNAPSHOT_EXISTS");
  });

  it("4. rejects missing target snapshot", () => {
    const baseId = createCompletedScan({ startedAt: "2026-11-01T10:00:00.000Z" });
    const result = SnapshotValidator.validate(db, baseId, 99999);

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_TARGET_SNAPSHOT_NOT_FOUND");
    expect(result.failedChecks).toContain("TARGET_SNAPSHOT_EXISTS");
  });

  it("5. rejects snapshots belonging to different repositories", () => {
    // Create a second repository record
    const res2 = db
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_other', '/tmp/other', 'other', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 3)",
      )
      .run();
    const repo2Id = Number(res2.lastInsertRowid);

    const baseId = createCompletedScan({
      repositoryId: repoId,
      startedAt: "2026-11-01T10:00:00.000Z",
    });
    const targetId = createCompletedScan({
      repositoryId: repo2Id,
      startedAt: "2026-11-02T10:00:00.000Z",
    });

    const result = SnapshotValidator.validate(db, baseId, targetId);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_CROSS_REPOSITORY_COMPARISON");
    expect(result.failedChecks).toContain("REPOSITORY_IDENTITY_MATCH");
  });

  it("6. rejects base snapshot in progress (RUNNING or VALIDATING)", () => {
    const baseId = createCompletedScan({
      startedAt: "2026-11-01T10:00:00.000Z",
      status: "RUNNING",
      completedAt: undefined,
    });
    const targetId = createCompletedScan({ startedAt: "2026-11-02T10:00:00.000Z" });

    const result = SnapshotValidator.validate(db, baseId, targetId);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_BASE_SNAPSHOT_IN_PROGRESS");
    expect(result.failedChecks).toContain("BASE_SNAPSHOT_COMPLETENESS");
  });

  it("7. rejects target snapshot in progress (RUNNING or VALIDATING)", () => {
    const baseId = createCompletedScan({ startedAt: "2026-11-01T10:00:00.000Z" });
    const targetId = createCompletedScan({
      startedAt: "2026-11-02T10:00:00.000Z",
      status: "VALIDATING",
      completedAt: undefined,
    });

    const result = SnapshotValidator.validate(db, baseId, targetId);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_TARGET_SNAPSHOT_IN_PROGRESS");
    expect(result.failedChecks).toContain("TARGET_SNAPSHOT_COMPLETENESS");
  });

  it("8. rejects FAILED and CANCELLED snapshots", () => {
    const baseFailed = createCompletedScan({
      startedAt: "2026-11-01T10:00:00.000Z",
      status: "FAILED",
    });
    const targetCancelled = createCompletedScan({
      startedAt: "2026-11-02T10:00:00.000Z",
      status: "CANCELLED",
    });

    const res1 = SnapshotValidator.validate(db, baseFailed, targetCancelled);
    expect(res1.isValid).toBe(false);
    expect(res1.errorCode).toBe("ERR_BASE_SNAPSHOT_INCOMPLETE");

    const baseOk = createCompletedScan({ startedAt: "2026-11-01T10:00:00.000Z" });
    const res2 = SnapshotValidator.validate(db, baseOk, targetCancelled);
    expect(res2.isValid).toBe(false);
    expect(res2.errorCode).toBe("ERR_TARGET_SNAPSHOT_INCOMPLETE");
  });

  it("9. handles PARTIAL snapshots conditionally on allowPartial option", () => {
    const basePartial = createCompletedScan({
      startedAt: "2026-11-01T10:00:00.000Z",
      status: "PARTIAL",
    });
    const targetOk = createCompletedScan({ startedAt: "2026-11-02T10:00:00.000Z" });

    // Disallowed by default
    const resDefault = SnapshotValidator.validate(db, basePartial, targetOk);
    expect(resDefault.isValid).toBe(false);
    expect(resDefault.errorCode).toBe("ERR_BASE_SNAPSHOT_PARTIAL");

    // Allowed when opted-in
    const resOptIn = SnapshotValidator.validate(db, basePartial, targetOk, { allowPartial: true });
    expect(resOptIn.isValid).toBe(true);
  });

  it("10. rejects chronology violations (target started earlier than base)", () => {
    const baseId = createCompletedScan({ startedAt: "2026-11-05T12:00:00.000Z" });
    const targetId = createCompletedScan({ startedAt: "2026-11-01T12:00:00.000Z" }); // Earlier!

    const result = SnapshotValidator.validate(db, baseId, targetId);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_CHRONOLOGY_VIOLATION");
    expect(result.failedChecks).toContain("CHRONOLOGICAL_ORDER");
  });

  it("11. rejects snapshots with unparseable timestamps", () => {
    const baseBadTime = createCompletedScan({ startedAt: "not-a-valid-date" });
    const targetOk = createCompletedScan({ startedAt: "2026-11-02T10:00:00.000Z" });

    const result = SnapshotValidator.validate(db, baseBadTime, targetOk);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("ERR_INVALID_SCAN_TIMESTAMP");
    expect(result.failedChecks).toContain("CHRONOLOGY_PARSEABLE");
  });
});
