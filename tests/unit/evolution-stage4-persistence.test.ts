import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import {
  SnapshotComparator,
  EvolutionAnalyzer,
  EvolutionEventWriter,
  SnapshotComparisonError,
} from "../../scripts/evolution/index.ts";

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

  it("EVO-PERSIST-REMEDIATION-01: keeps db.activeTransactionDepth balanced when BEGIN fails and blocks unvalidated EvolutionEventWriter writes", () => {
    // DEFECT-TX-01: Force BEGIN IMMEDIATE failure while a read/locked connection or closed hook occurs
    const originalExec = db.rawDb.exec.bind(db.rawDb);
    let failFirstBegin = true;
    db.rawDb.exec = ((sql: string) => {
      if (failFirstBegin && sql.startsWith("BEGIN IMMEDIATE")) {
        failFirstBegin = false;
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return originalExec(sql);
    }) as typeof db.rawDb.exec;

    expect(() => db.transaction(() => "never")).toThrow(/SQLITE_BUSY/);
    expect(db.activeTransactionDepth).toBe(0);

    // Subsequent transaction still opens a real top-level BEGIN IMMEDIATE and rolls back on error
    expect(() =>
      db.transaction(() => {
        db.exec(
          "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('tx_test', '/tx', 'TX', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 3)",
        );
        throw new Error("Force rollback");
      }),
    ).toThrow(/Force rollback/);
    expect(db.activeTransactionDepth).toBe(0);
    const txRepo = db.prepare("SELECT id FROM repositories WHERE identity = 'tx_test'").get() as
      { id: number } | undefined;
    expect(txRepo).toBeUndefined();

    // ISSUE-PERSIST-01: EvolutionEventWriter must validate repository ownership BEFORE deleting prior events
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    insertFile(scan1, "src/a.ts", "a1");
    insertFile(scan2, "src/a.ts", "a2");

    const analyzer = new EvolutionAnalyzer(db);
    const validAnalysis = analyzer.analyze(scan1, scan2, { persistEvents: true });
    const countBefore = (
      db.prepare("SELECT COUNT(*) AS count FROM evolution_events").get() as { count: number }
    ).count;
    expect(countBefore).toBeGreaterThan(0);

    const forgedAnalysis = {
      ...validAnalysis,
      repositoryId: repoId + 999,
    };
    expect(() => EvolutionEventWriter.persist(db, forgedAnalysis)).toThrow(SnapshotComparisonError);
    const countAfter = (
      db.prepare("SELECT COUNT(*) AS count FROM evolution_events").get() as { count: number }
    ).count;
    expect(countAfter).toBe(countBefore);
  });

  it("EVO-PERSIST-REMEDIATION-02: recovers cleanly from top-level BEGIN, nested SAVEPOINT, and nested callback failures while preserving depth and DB integrity", () => {
    const store = new MemoryStore(db);
    const scan1 = createScan("2026-11-01T10:00:00.000Z");

    // Helper to restore original exec cleanly across fault injections
    const originalExec = db.rawDb.exec.bind(db.rawDb);

    // 1. Top-level BEGIN IMMEDIATE failure -> activeTransactionDepth stays 0 & integrity OK
    expect(db.activeTransactionDepth).toBe(0);
    let failBeginOnce = true;
    db.rawDb.exec = ((sql: string) => {
      if (failBeginOnce && sql.startsWith("BEGIN IMMEDIATE")) {
        failBeginOnce = false;
        throw new Error("SQLITE_BUSY: simulated BEGIN IMMEDIATE failure");
      }
      return originalExec(sql);
    }) as typeof db.rawDb.exec;

    expect(() =>
      db.transaction(() => {
        store.createMemory({
          repositoryId: repoId,
          memoryKey: "should_not_run_begin",
          category: "project_context",
          title: "Never Created",
          content: "Never",
          firstSeenScanId: scan1,
          lastSeenScanId: scan1,
        });
      }),
    ).toThrow(/SQLITE_BUSY/);
    db.rawDb.exec = originalExec;
    expect(db.activeTransactionDepth).toBe(0);
    expect(db.integrityCheck().ok).toBe(true);

    // 4. Subsequent top-level transaction succeeds after failed BEGIN IMMEDIATE
    const afterBeginMem = db.transaction(() => {
      expect(db.activeTransactionDepth).toBe(1);
      return store.createMemory({
        repositoryId: repoId,
        memoryKey: "after_begin_fail",
        category: "project_context",
        title: "Recovered Top-Level",
        content: "Top-level works after BEGIN failure",
        firstSeenScanId: scan1,
        lastSeenScanId: scan1,
      });
    });
    expect(db.activeTransactionDepth).toBe(0);
    expect(store.getMemory(repoId, afterBeginMem.id)?.memoryKey).toBe("after_begin_fail");
    expect(db.integrityCheck().ok).toBe(true);

    // 2. Nested SAVEPOINT creation failure -> throws, keeps outer depth === 1 when caught, outer commits, depth returns to 0
    let failSavepointOnce = true;
    db.rawDb.exec = ((sql: string) => {
      if (failSavepointOnce && sql.startsWith("SAVEPOINT ")) {
        failSavepointOnce = false;
        throw new Error("SQLITE_ERROR: simulated SAVEPOINT failure");
      }
      return originalExec(sql);
    }) as typeof db.rawDb.exec;

    db.transaction(() => {
      expect(db.activeTransactionDepth).toBe(1);
      const outerKept = store.createMemory({
        repositoryId: repoId,
        memoryKey: "outer_survives_sp_fail",
        category: "project_context",
        title: "Outer Survives",
        content: "Outer memory stays committed",
        firstSeenScanId: scan1,
        lastSeenScanId: scan1,
      });
      expect(() =>
        db.transaction(() => {
          throw new Error("Should not enter inner body when SAVEPOINT fails");
        }),
      ).toThrow(/simulated SAVEPOINT failure/);
      db.rawDb.exec = originalExec;
      expect(db.activeTransactionDepth).toBe(1);

      // 5. Subsequent nested transaction succeeds inside outer transaction after failed SAVEPOINT
      db.transaction(() => {
        expect(db.activeTransactionDepth).toBe(2);
        store.createMemory({
          repositoryId: repoId,
          memoryKey: "nested_after_sp_fail",
          category: "project_context",
          title: "Nested Recovered",
          content: "Nested works after SAVEPOINT failure",
          firstSeenScanId: scan1,
          lastSeenScanId: scan1,
        });
      });
      expect(db.activeTransactionDepth).toBe(1);
      expect(store.getMemory(repoId, outerKept.id)).toBeDefined();
    });
    db.rawDb.exec = originalExec;
    expect(db.activeTransactionDepth).toBe(0);
    expect(db.integrityCheck().ok).toBe(true);
    expect(store.listMemories(repoId).map((m) => m.memoryKey)).toContain("nested_after_sp_fail");

    // 3. Nested callback failure rolls back nested savepoint ONLY while outer transaction commits
    db.transaction(() => {
      expect(db.activeTransactionDepth).toBe(1);
      store.createMemory({
        repositoryId: repoId,
        memoryKey: "outer_before_inner_abort",
        category: "project_context",
        title: "Outer Before Inner Abort",
        content: "Persists when inner savepoint rolls back",
        firstSeenScanId: scan1,
        lastSeenScanId: scan1,
      });

      expect(() =>
        db.transaction(() => {
          expect(db.activeTransactionDepth).toBe(2);
          store.createMemory({
            repositoryId: repoId,
            memoryKey: "inner_rolled_back",
            category: "project_context",
            title: "Inner Aborted",
            content: "Must roll back to savepoint",
            firstSeenScanId: scan1,
            lastSeenScanId: scan1,
          });
          throw new Error("Intentional inner callback failure");
        }),
      ).toThrow(/Intentional inner callback failure/);

      // 6. Depth returns cleanly to 1 after inner rollback, then 0 on outer commit
      expect(db.activeTransactionDepth).toBe(1);
    });
    expect(db.activeTransactionDepth).toBe(0);
    expect(db.integrityCheck().ok).toBe(true);

    const keys = store.listMemories(repoId).map((m) => m.memoryKey);
    expect(keys).toContain("outer_before_inner_abort");
    expect(keys).not.toContain("inner_rolled_back");

    // 6b & 7. Uncaught nested failure rolling back whole transaction still resets activeTransactionDepth to 0 and preserves DB integrity
    expect(() =>
      db.transaction(() => {
        expect(db.activeTransactionDepth).toBe(1);
        db.transaction(() => {
          expect(db.activeTransactionDepth).toBe(2);
          throw new Error("Uncaught full-stack abort");
        });
      }),
    ).toThrow(/Uncaught full-stack abort/);
    expect(db.activeTransactionDepth).toBe(0);
    expect(db.integrityCheck().ok).toBe(true);
  });
});
