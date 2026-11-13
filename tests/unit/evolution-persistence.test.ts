import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { SnapshotComparator } from "../../scripts/evolution/snapshot-comparator.ts";
import { EventPersistenceBoundary } from "../../scripts/evolution/event-persistence.ts";

describe("evolution-persistence (Transactional, Idempotent Event Boundary)", () => {
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let repoId: number;

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    repoId = connectionManager.getRepository().id;
  });

  afterEach(async () => {
    connectionManager.close();
  });

  function createScan(startedAt: string, status = "COMPLETE"): number {
    const res = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, ?, 10, 10, 0, 0, 0, '1.0.0', '1.0.0', 0)`,
      )
      .run(repoId, startedAt, new Date().toISOString(), status);
    return Number(res.lastInsertRowid);
  }

  function insertFile(scanId: number, normalizedPath: string, contentHash: string | null): number {
    const ext = normalizedPath.slice(normalizedPath.lastIndexOf("."));
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, 'typescript', 'source', 200, 1700000000000, ?, 'SAFE', 'INDEXED', ?)`,
      )
      .run(
        repoId,
        scanId,
        normalizedPath,
        normalizedPath,
        ext,
        contentHash,
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  }

  it("1. transactionally persists factual change events to evolution_events table", () => {
    const baseScan = createScan("2026-11-01T10:00:00.000Z");
    const targetScan = createScan("2026-11-02T10:00:00.000Z");

    insertFile(baseScan, "src/old.ts", "h_old");
    insertFile(targetScan, "src/new.ts", "h_new");

    const comparator = new SnapshotComparator(db);
    const comparison = comparator.compare(baseScan, targetScan, { persistEvents: true });

    const rows = db
      .prepare(
        "SELECT * FROM evolution_events WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?",
      )
      .all(repoId, baseScan, targetScan) as any[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.event_type === "FILE_DELETED")).toBe(true);
    expect(rows.some((r) => r.event_type === "FILE_ADDED")).toBe(true);
  });

  it("2. guarantees idempotency: repeated comparisons do not accumulate duplicate events", () => {
    const baseScan = createScan("2026-11-01T10:00:00.000Z");
    const targetScan = createScan("2026-11-02T10:00:00.000Z");

    insertFile(baseScan, "src/mod.ts", "h1");
    insertFile(targetScan, "src/mod.ts", "h2");

    const comparator = new SnapshotComparator(db);

    // First comparison with persistEvents
    comparator.compare(baseScan, targetScan, { persistEvents: true });
    const countFirst = db
      .prepare(
        "SELECT COUNT(*) AS count FROM evolution_events WHERE base_scan_id = ? AND target_scan_id = ?",
      )
      .get(baseScan, targetScan) as { count: number };

    // Second comparison with persistEvents
    comparator.compare(baseScan, targetScan, { persistEvents: true });
    const countSecond = db
      .prepare(
        "SELECT COUNT(*) AS count FROM evolution_events WHERE base_scan_id = ? AND target_scan_id = ?",
      )
      .get(baseScan, targetScan) as { count: number };

    expect(countSecond.count).toBe(countFirst.count);
    expect(countFirst.count).toBe(1); // exactly 1 FILE_MODIFIED event
  });

  it("3. rolls back completely if event persistence encounters an error", () => {
    const baseScan = createScan("2026-11-01T10:00:00.000Z");
    const targetScan = createScan("2026-11-02T10:00:00.000Z");

    insertFile(baseScan, "src/mod.ts", "h1");
    insertFile(targetScan, "src/mod.ts", "h2");

    const comparator = new SnapshotComparator(db);
    const comparison = comparator.compare(baseScan, targetScan, { persistEvents: false });

    // Intentionally corrupt repositoryId in comparison to violate foreign key
    const corruptedComparison = {
      ...comparison,
      repositoryId: 999999, // Non-existent repository ID
    };

    expect(() => {
      EventPersistenceBoundary.persist(db, corruptedComparison as any);
    }).toThrow();

    // Verify 0 events exist in database
    const count = db.prepare("SELECT COUNT(*) AS count FROM evolution_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it("4. does not write events when comparison validation fails", () => {
    const baseScan = createScan("2026-11-02T10:00:00.000Z");
    const targetScan = createScan("2026-11-01T10:00:00.000Z"); // Chronology violation!

    const comparator = new SnapshotComparator(db);

    expect(() => {
      comparator.compare(baseScan, targetScan, { persistEvents: true });
    }).toThrow();

    const count = db.prepare("SELECT COUNT(*) AS count FROM evolution_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
