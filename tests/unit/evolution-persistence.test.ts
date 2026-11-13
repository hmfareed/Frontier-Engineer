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

  it("5. validates repository ownership even on empty comparisons and isolates events across repositories and scan pairs", () => {
    // Seed a second repository
    const repo2Res = db
      .prepare(
        `INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version)
         VALUES ('repo-two', '/tmp/repo-two', 'repo-two', ?, ?, 3)`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
    const repo2Id = Number(repo2Res.lastInsertRowid);

    const r1Base = createScan("2026-11-01T10:00:00.000Z");
    const r1Mid = createScan("2026-11-02T10:00:00.000Z");
    const r1Target = createScan("2026-11-03T10:00:00.000Z");

    insertFile(r1Base, "src/a.ts", "h1");
    insertFile(r1Mid, "src/a.ts", "h2");
    insertFile(r1Target, "src/a.ts", "h3");

    const r2Base = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (
            repository_id, started_at, completed_at, status, files_discovered,
            files_indexed, files_skipped, files_failed, diagnostic_count,
            scanner_version, extractor_version, is_active
          ) VALUES (?, '2026-11-01T10:00:00.000Z', ?, 'COMPLETE', 1, 1, 0, 0, 0, '1.0.0', '1.0.0', 0)`,
        )
        .run(repo2Id, new Date().toISOString()).lastInsertRowid,
    );
    const r2Target = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (
            repository_id, started_at, completed_at, status, files_discovered,
            files_indexed, files_skipped, files_failed, diagnostic_count,
            scanner_version, extractor_version, is_active
          ) VALUES (?, '2026-11-02T10:00:00.000Z', ?, 'COMPLETE', 1, 1, 0, 0, 0, '1.0.0', '1.0.0', 0)`,
        )
        .run(repo2Id, new Date().toISOString()).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO files (
        repository_id, scan_id, relative_path, normalized_path, extension,
        language, classification, size_bytes, modified_at, content_hash,
        sensitivity_status, index_status, indexed_at
      ) VALUES (?, ?, 'src/other.ts', 'src/other.ts', '.ts', 'typescript', 'source', 100, 1700000000000, 'h_r2_1', 'SAFE', 'INDEXED', ?)`,
    ).run(repo2Id, r2Base, new Date().toISOString());
    db.prepare(
      `INSERT INTO files (
        repository_id, scan_id, relative_path, normalized_path, extension,
        language, classification, size_bytes, modified_at, content_hash,
        sensitivity_status, index_status, indexed_at
      ) VALUES (?, ?, 'src/other.ts', 'src/other.ts', '.ts', 'typescript', 'source', 100, 1700000000000, 'h_r2_2', 'SAFE', 'INDEXED', ?)`,
    ).run(repo2Id, r2Target, new Date().toISOString());

    const comparator = new SnapshotComparator(db);
    // Persist repo1 (base->mid), repo1 (mid->target), and repo2 (r2Base->r2Target)
    comparator.compare(r1Base, r1Mid, { persistEvents: true });
    comparator.compare(r1Mid, r1Target, { persistEvents: true });
    comparator.compare(r2Base, r2Target, { persistEvents: true });

    // Re-persisting repo1 (base->mid) must leave repo1 (mid->target) and repo2 intact
    comparator.compare(r1Base, r1Mid, { persistEvents: true });

    const r1Pair1 = db
      .prepare(
        "SELECT COUNT(*) AS count FROM evolution_events WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?",
      )
      .get(repoId, r1Base, r1Mid) as { count: number };
    const r1Pair2 = db
      .prepare(
        "SELECT COUNT(*) AS count FROM evolution_events WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?",
      )
      .get(repoId, r1Mid, r1Target) as { count: number };
    const r2Pair = db
      .prepare(
        "SELECT COUNT(*) AS count FROM evolution_events WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?",
      )
      .get(repo2Id, r2Base, r2Target) as { count: number };

    expect(r1Pair1.count).toBe(1);
    expect(r1Pair2.count).toBe(1);
    expect(r2Pair.count).toBe(1);

    // An empty comparison with mismatched repositoryId must throw BEFORE deleting anything
    const validComparison = comparator.compare(r1Base, r1Mid, { persistEvents: false });
    const emptyMismatched = {
      ...validComparison,
      repositoryId: repo2Id,
      files: { changes: [], addedCount: 0, modifiedCount: 0, deletedCount: 0, unchangedCount: 0 },
      symbols: {
        changes: [],
        addedCount: 0,
        removedCount: 0,
        modifiedCount: 0,
        relocatedCount: 0,
        unchangedCount: 0,
      },
      dependencies: {
        changes: [],
        addedCount: 0,
        removedCount: 0,
        modifiedCount: 0,
        unresolvedCount: 0,
        unchangedCount: 0,
      },
      components: {
        changes: [],
        addedCount: 0,
        removedCount: 0,
        modifiedCount: 0,
        unchangedCount: 0,
      },
      adrs: { changes: [], addedCount: 0, removedCount: 0, modifiedCount: 0, unchangedCount: 0 },
    };

    expect(() => {
      EventPersistenceBoundary.persist(db, emptyMismatched as any);
    }).toThrow(/repository ownership mismatch/i);
  });
});
