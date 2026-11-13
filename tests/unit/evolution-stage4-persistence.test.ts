import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { SnapshotComparator, EvolutionAnalyzer } from "../../scripts/evolution/index.ts";

describe("evolution-stage4-persistence (Coexistence, Idempotency & Atomic Rollback)", () => {
  let tmpDir: string;
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let repoId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-evo-persist4-"));
    connectionManager = new ConnectionManager({
      workspaceRoot: tmpDir,
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    repoId = connectionManager.getRepository().id;
  });

  afterEach(() => {
    connectionManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createScan(startedAt: string): number {
    const res = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, 'COMPLETE', 5, 5, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
      )
      .run(repoId, startedAt, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  function insertFile(scanId: number, normalizedPath: string, hash = "h1"): number {
    const ext = path.posix.extname(normalizedPath) || ".ts";
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, 'typescript', 'source', 100, 1700000000000, ?, 'SAFE', 'INDEXED', ?)`,
      )
      .run(repoId, scanId, normalizedPath, normalizedPath, ext, hash, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  function insertImport(
    scanId: number,
    srcId: number,
    specifier: string,
    dstId: number | null,
    status: "RESOLVED" | "EXTERNAL",
  ): void {
    db.prepare(
      `INSERT INTO imports (
        repository_id, scan_id, source_file_id, imported_specifier,
        import_kind, resolved_file_id, resolution_status, start_line, end_line
      ) VALUES (?, ?, ?, ?, 'es_import', ?, ?, 1, 1)`,
    ).run(repoId, scanId, srcId, specifier, dstId, status);
  }

  it("EVO-PERSIST-01: Stage 3 factual events and Stage 4 analytical events coexist idempotently without clobbering", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    insertFile(scan1, "src/ui/App.tsx", "ui1");
    insertFile(scan1, "src/db/schema.sql", "sql1");

    const ui2 = insertFile(scan2, "src/ui/App.tsx", "ui2");
    const db2 = insertFile(scan2, "src/db/conn.ts", "conn2");
    insertFile(scan2, "src/db/schema.sql", "sql1");
    insertImport(scan2, ui2, "../db/conn", db2, "RESOLVED");

    const comparator = new SnapshotComparator(db);
    const analyzer = new EvolutionAnalyzer(db);

    const getCounts = () => {
      const rows = db
        .prepare(
          `SELECT event_type AS eventType, COUNT(*) AS count
           FROM evolution_events
           WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?
           GROUP BY event_type`,
        )
        .all(repoId, scan1, scan2) as unknown as { eventType: string; count: number }[];
      return new Map(rows.map((r) => [r.eventType, r.count]));
    };

    // 1. Stage 3 compare persists factual events
    comparator.compare(scan1, scan2, { persistEvents: true });
    const afterStage3 = getCounts();
    expect(afterStage3.get("FILE_MODIFIED")).toBe(1);
    expect(afterStage3.get("FILE_ADDED")).toBe(1);
    expect(afterStage3.get("COMPONENT_MODIFIED")).toBe(1);

    // 2. Stage 4 analyze persists analytical events twice (idempotency + coexistence)
    analyzer.analyze(scan1, scan2, { persistEvents: true });
    const afterStage4Run1 = getCounts();
    analyzer.analyze(scan1, scan2, { persistEvents: true });
    const afterStage4Run2 = getCounts();

    expect(afterStage4Run1).toEqual(afterStage4Run2);
    expect(afterStage4Run2.get("FILE_MODIFIED")).toBe(1);
    expect(afterStage4Run2.get("COMPONENT_MODIFIED")).toBe(1);
    expect(afterStage4Run2.get("DRIFT_LAYER_VIOLATION_INTRODUCED")).toBe(1);

    // 3. Re-running Stage 3 compare must NOT delete Stage 4 analytical events!
    comparator.compare(scan1, scan2, { persistEvents: true });
    const afterStage3Rerun = getCounts();
    expect(afterStage3Rerun).toEqual(afterStage4Run2);
  });

  it("EVO-PERSIST-02: rolls back memory lifecycle updates, versions, relationships, and evolution_events atomically on failure", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    insertFile(scan1, "src/old.ts", "h1");
    insertFile(scan2, "src/new.ts", "h2");

    const memStore = new MemoryStore(db);
    const mem = memStore.createMemory({
      repositoryId: repoId,
      memoryKey: "rollback_mem",
      category: "project_context",
      title: "Rollback Target",
      content: "Original",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    memStore.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/old.ts",
      description: "Deleted file evidence",
    });

    const analyzer = new EvolutionAnalyzer(db);
    expect(() =>
      analyzer.analyze(scan1, scan2, {
        persistEvents: true,
        applyLifecycle: true,
        simulateFailure: true,
      }),
    ).toThrow(/Simulated Stage 4 lifecycle failure/);

    // Memory remains untouched at ACTIVE, v1, scan1
    const afterMem = memStore.getMemory(repoId, mem.id)!;
    expect(afterMem.status).toBe("ACTIVE");
    expect(afterMem.version).toBe(1);
    expect(afterMem.lastSeenScanId).toBe(scan1);
    expect(memStore.getMemoryVersions(mem.id)).toHaveLength(0);

    // Zero events persisted in evolution_events
    const evCount = db.prepare("SELECT COUNT(*) AS count FROM evolution_events").get() as {
      count: number;
    };
    expect(evCount.count).toBe(0);
  });
});
