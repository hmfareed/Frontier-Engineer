import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { MemoryLifecycleEvaluator } from "../../scripts/memory/memory-lifecycle-evaluator.ts";

describe("memory-lifecycle-intelligence (Stage 4 Evidence Evaluation, Lifecycle & Relationships)", () => {
  let tmpDir: string;
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let store: MemoryStore;
  let repoId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-mem-life-"));
    connectionManager = new ConnectionManager({
      workspaceRoot: tmpDir,
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    repoId = connectionManager.getRepository().id;
    store = new MemoryStore(db);
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

  function insertFile(
    scanId: number,
    normalizedPath: string,
    hash = "h1",
    classification = "source",
  ): number {
    const ext = path.posix.extname(normalizedPath) || ".ts";
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 100, 1700000000000, ?, 'SAFE', 'INDEXED', ?)`,
      )
      .run(
        repoId,
        scanId,
        normalizedPath,
        normalizedPath,
        ext,
        ext === ".md" ? "markdown" : "typescript",
        classification,
        hash,
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  }

  function insertSymbol(
    scanId: number,
    fileId: number,
    symbolIdentity: string,
    name: string,
  ): number {
    const res = db
      .prepare(
        `INSERT INTO symbols (
          repository_id, scan_id, file_id, symbol_identity, name, kind,
          is_exported, start_line, end_line, start_column, end_column,
          fingerprint, confidence, extraction_status
        ) VALUES (?, ?, ?, ?, ?, 'function', 1, 1, 10, 0, 1, 'fp_1', 1.0, 'COMPLETE')`,
      )
      .run(repoId, scanId, fileId, symbolIdentity, name);
    return Number(res.lastInsertRowid);
  }

  it("EVO-MEM-01: re-verifies ACTIVE memory on newer scan without incrementing version", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    const f1 = insertFile(scan1, "src/index.ts", "h1");
    insertSymbol(scan1, f1, "sym:src/index.ts#main", "main");

    const f2 = insertFile(scan2, "src/index.ts", "h1");
    insertSymbol(scan2, f2, "sym:src/index.ts#main", "main");

    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "entry_main",
      category: "architectural_knowledge",
      title: "Main Entrypoint",
      content: "Application boots from src/index.ts#main",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });

    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/index.ts",
      description: "Verified source file",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/index.ts",
      symbolIdentity: "sym:src/index.ts#main",
      description: "Verified main symbol",
    });

    const summary = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });

    expect(summary.verifiedActive).toBe(1);
    expect(summary.evaluations[0].action).toBe("VERIFIED_ACTIVE");

    const updated = store.getMemory(repoId, mem.id)!;
    expect(updated.status).toBe("ACTIVE");
    expect(updated.version).toBe(1); // No version increment!
    expect(updated.lastSeenScanId).toBe(scan2);
    expect(store.getMemoryVersions(mem.id)).toHaveLength(0);
  });

  it("EVO-MEM-02 & EVO-MEM-03: transitions ACTIVE -> STALE when all supporting evidence missing, then recovers STALE -> ACTIVE when restored", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");

    insertFile(scan1, "src/old.ts", "h_old");
    // scan2 deletes src/old.ts
    insertFile(scan2, "src/other.ts", "h_other");
    // scan3 restores src/old.ts
    insertFile(scan3, "src/old.ts", "h_old");

    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "legacy_module",
      category: "project_context",
      title: "Legacy Module",
      content: "Maintained in src/old.ts",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });

    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/old.ts",
      description: "src/old.ts reference",
    });

    // Scan 2: becomes STALE
    const eval2 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    expect(eval2.transitionedToStale).toBe(1);
    const staleMem = store.getMemory(repoId, mem.id)!;
    expect(staleMem.status).toBe("STALE");
    expect(staleMem.version).toBe(2);
    expect(staleMem.lastSeenScanId).toBe(scan2);
    expect(store.getMemoryVersions(mem.id)).toHaveLength(1);

    // Scan 3: recovers ACTIVE
    const eval3 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan3, undefined, {
      applyLifecycle: true,
    });
    expect(eval3.recoveredToActive).toBe(1);
    const recoveredMem = store.getMemory(repoId, mem.id)!;
    expect(recoveredMem.status).toBe("ACTIVE");
    expect(recoveredMem.version).toBe(3);
    expect(recoveredMem.lastSeenScanId).toBe(scan3);
    expect(store.getMemoryVersions(mem.id)).toHaveLength(2);
  });

  it("EVO-MEM-04: transitions ACTIVE -> DISPUTED on deprecated ADR or contradictory evidence", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    const adr1 = insertFile(scan1, "docs/adr/ADR-002.md", "h1", "documentation");
    db.prepare(
      `INSERT INTO source_evidence (
        repository_id, scan_id, file_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description
      ) VALUES (?, ?, ?, 'ADR_METADATA_JSON', 1, 1, 0, 1, 1.0, ?)`,
    ).run(repoId, scan1, adr1, JSON.stringify({ adrId: "ADR-002", status: "Accepted" }));

    const adr2 = insertFile(scan2, "docs/adr/ADR-002.md", "h2", "documentation");
    db.prepare(
      `INSERT INTO source_evidence (
        repository_id, scan_id, file_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description
      ) VALUES (?, ?, ?, 'ADR_METADATA_JSON', 1, 1, 0, 1, 1.0, ?)`,
    ).run(repoId, scan2, adr2, JSON.stringify({ adrId: "ADR-002", status: "Deprecated" }));

    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "adr_002_rule",
      category: "architectural_decision",
      title: "ADR-002 Rule",
      content: "Enforce ADR-002 policy",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "adr",
      sourcePath: "docs/adr/ADR-002.md",
      description: "ADR-002 decision document",
    });

    const evalRes = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    expect(evalRes.transitionedToDisputed).toBe(1);
    const updated = store.getMemory(repoId, mem.id)!;
    expect(updated.status).toBe("DISPUTED");
    expect(updated.version).toBe(2);
  });

  it("EVO-MEM-05: transitions ACTIVE -> SUPERSEDED via SUPERSEDES relationship and preserves terminal lock", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    insertFile(scan1, "src/auth.ts", "h1");
    insertFile(scan2, "src/auth.ts", "h2");

    const oldMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "auth_v1",
      category: "architectural_decision",
      title: "Session Auth v1",
      content: "Cookie sessions",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });

    const newMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "auth_v2",
      category: "architectural_decision",
      title: "Bearer JWT v2",
      content: "Stateless JWT",
      firstSeenScanId: scan2,
      lastSeenScanId: scan2,
    });

    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: newMem.id,
      targetMemoryId: oldMem.id,
      relationshipType: "SUPERSEDES",
    });

    const summary = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    expect(summary.transitionedToSuperseded).toBe(1);

    const checkOld = store.getMemory(repoId, oldMem.id)!;
    expect(checkOld.status).toBe("SUPERSEDED");
    expect(checkOld.supersededById).toBe(newMem.id);
    expect(checkOld.version).toBe(2);

    // Terminal lock & active replacement protection remain enforced
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: oldMem.id,
        targetStatus: "ACTIVE",
        changeReason: "Should fail",
      });
    }).toThrow(/terminal state/);

    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: newMem.id,
        targetStatus: "ARCHIVED",
        changeReason: "Should fail",
      });
    }).toThrow(/active replacement/);
  });

  it("EVO-MEM-06: rejects relationship cycles, self-loops, conflicting types, and cross-repository edges", () => {
    const r2 = db
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('other_repo', '/other', 'Other', ?, ?, 3)",
      )
      .run(new Date().toISOString(), new Date().toISOString());
    const otherRepoId = Number(r2.lastInsertRowid);

    const a = store.createMemory({
      repositoryId: repoId,
      memoryKey: "mem_a",
      category: "architectural_knowledge",
      title: "A",
      content: "A",
    });
    const b = store.createMemory({
      repositoryId: repoId,
      memoryKey: "mem_b",
      category: "architectural_knowledge",
      title: "B",
      content: "B",
    });
    const c = store.createMemory({
      repositoryId: repoId,
      memoryKey: "mem_c",
      category: "architectural_knowledge",
      title: "C",
      content: "C",
    });
    const x = store.createMemory({
      repositoryId: otherRepoId,
      memoryKey: "mem_x",
      category: "architectural_knowledge",
      title: "X",
      content: "X",
    });

    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: a.id,
      targetMemoryId: b.id,
      relationshipType: "DEPENDS_ON",
    });
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: b.id,
      targetMemoryId: c.id,
      relationshipType: "DEPENDS_ON",
    });

    // Cycle C -> A must fail
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: c.id,
        targetMemoryId: a.id,
        relationshipType: "DEPENDS_ON",
      }),
    ).toThrow(/ERR_MEMORY_RELATIONSHIP_CYCLE/);

    // Self-loop must fail
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: a.id,
        targetMemoryId: a.id,
        relationshipType: "RELATES_TO",
      }),
    ).toThrow(/Self-referential/);

    // Cross-repo must fail
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: a.id,
        targetMemoryId: x.id,
        relationshipType: "RELATES_TO",
      }),
    ).toThrow(/Cross-repository/);

    // Conflicting IMPLEMENTS vs CONTRADICTS must fail
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: a.id,
      targetMemoryId: c.id,
      relationshipType: "IMPLEMENTS",
    });
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: a.id,
        targetMemoryId: c.id,
        relationshipType: "CONTRADICTS",
      }),
    ).toThrow(/Conflicting memory relationship/);
  });
});
