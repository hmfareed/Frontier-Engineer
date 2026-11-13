import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { MemoryLifecycleEvaluator } from "../../scripts/memory/memory-lifecycle-evaluator.ts";
import { SnapshotComparator, SnapshotComparisonError } from "../../scripts/evolution/index.ts";

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

    // Scan 2: becomes STALE; lastSeenScanId must remain scan1 (last positively verified scan)
    const eval2 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    expect(eval2.transitionedToStale).toBe(1);
    const staleMem = store.getMemory(repoId, mem.id)!;
    expect(staleMem.status).toBe("STALE");
    expect(staleMem.version).toBe(2);
    expect(staleMem.lastSeenScanId).toBe(scan1);
    const versionsAfterStale = store.getMemoryVersions(repoId, mem.id);
    expect(versionsAfterStale).toHaveLength(1);
    expect(versionsAfterStale[0].sourceScanId).toBe(scan2);

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

  it("EVO-MEM-REMEDIATION-01: enforces scan ownership/completeness guards (DEFECT-EV-01) and PARTIAL downgrade (DEFECT-EV-05)", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    insertFile(scan1, "src/core.ts", "h1");

    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "core_mem",
      category: "architectural_knowledge",
      title: "Core Module",
      content: "Anchored to src/core.ts",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/core.ts",
      description: "Core file",
    });

    // Missing scan throws ERR_SCAN_NOT_FOUND
    expect(() => MemoryLifecycleEvaluator.evaluateRepository(db, repoId, 99999)).toThrow(
      SnapshotComparisonError,
    );

    // Foreign repository scan throws ERR_REPOSITORY_MISMATCH
    const otherRepoId = Number(
      db
        .prepare(
          "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('other_mem_repo', '/other', 'Other', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 3)",
        )
        .run().lastInsertRowid,
    );
    const foreignScan = Number(
      db
        .prepare(
          "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active) VALUES (?, '2026-11-02T00:00:00Z', '2026-11-02T00:01:00Z', 'COMPLETE', 0, 0, 0, 0, 0, '0.6.3', '0.6.3', 0)",
        )
        .run(otherRepoId).lastInsertRowid,
    );
    expect(() => MemoryLifecycleEvaluator.evaluateRepository(db, repoId, foreignScan)).toThrow(
      /belongs to repository/,
    );

    // FAILED scan rejected
    const failedScan = Number(
      db
        .prepare(
          "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active) VALUES (?, '2026-11-02T10:00:00Z', '2026-11-02T10:01:00Z', 'FAILED', 1, 0, 0, 1, 1, '0.6.3', '0.6.3', 0)",
        )
        .run(repoId).lastInsertRowid,
    );
    expect(() => MemoryLifecycleEvaluator.evaluateRepository(db, repoId, failedScan)).toThrow(
      /FAILED/,
    );

    // PARTIAL scan rejected without allowPartial, and with allowPartial downgrades MISSING -> UNVERIFIED
    const partialScan = Number(
      db
        .prepare(
          "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active) VALUES (?, '2026-11-03T10:00:00Z', '2026-11-03T10:01:00Z', 'PARTIAL', 5, 1, 4, 0, 1, '0.6.3', '0.6.3', 0)",
        )
        .run(repoId).lastInsertRowid,
    );
    expect(() => MemoryLifecycleEvaluator.evaluateRepository(db, repoId, partialScan)).toThrow(
      /PARTIAL/,
    );

    const partialEval = MemoryLifecycleEvaluator.evaluateRepository(
      db,
      repoId,
      partialScan,
      undefined,
      {
        allowPartial: true,
        applyLifecycle: true,
      },
    );
    expect(partialEval.transitionedToStale).toBe(0);
    expect(partialEval.verifiedActive).toBe(0);
    expect(partialEval.evaluations[0].proposedStatus).toBe("ACTIVE");
    expect(partialEval.evaluations[0].unverifiedCount).toBe(1);
    expect(partialEval.limitations?.[0].code).toBe("LIM_PARTIAL_SNAPSHOT_EVALUATION");
  });

  it("EVO-MEM-REMEDIATION-02: handles manual/diff UNVERIFIED, sourceHash mismatch, ambiguous relocation, symbol fingerprint drift, import/component/ADR historical checks", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    const f1 = insertFile(scan1, "src/hash-check.ts", "hash_v1");
    insertSymbol(scan1, f1, "sym:src/hash-check.ts#fnA", "fnA");
    insertFile(scan1, "src/imp.ts", "imp1");
    const ui1 = insertFile(scan1, "src/ui/Page.tsx", "u1");
    insertFile(scan1, "docs/adr/ADR-050.md", "adr_hash_orig", "documentation");

    // Scan 2: hash-check changes contentHash and symbol fingerprint changes; imp has UNRESOLVED import; ui reclassified? No, comp shifts; ADR edited on disk with mismatched hash
    const f2 = insertFile(scan2, "src/hash-check.ts", "hash_v2");
    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, 'sym:src/hash-check.ts#fnA', 'fnA', 'function', 1, 1, 10, 0, 1, 'fp_v2', 1.0, 'COMPLETE')`,
    ).run(repoId, scan2, f2);
    const imp2 = insertFile(scan2, "src/imp.ts", "imp2");
    db.prepare(
      `INSERT INTO imports (
        repository_id, scan_id, source_file_id, imported_specifier,
        import_kind, resolved_file_id, resolution_status, start_line, end_line
      ) VALUES (?, ?, ?, './dyn', 'es_import', NULL, 'UNRESOLVED', 4, 4)`,
    ).run(repoId, scan2, imp2);

    // Ambiguous relocation targets in comparison
    const amb1 = insertFile(scan1, "src/amb/mod.ts", "am1");
    insertSymbol(scan1, amb1, "sym:src/amb/mod.ts#helper", "helper");
    const amb2a = insertFile(scan2, "src/amb/a.ts", "am2a");
    insertSymbol(scan2, amb2a, "sym:src/amb/a.ts#helper", "helper");
    const amb2b = insertFile(scan2, "src/amb/b.ts", "am2b");
    insertSymbol(scan2, amb2b, "sym:src/amb/b.ts#helper", "helper");

    // Tamper live ADR on disk so its SHA-256 differs from scan2's 'adr_hash_orig'
    const adrDiskDir = path.join(tmpDir, "docs", "adr");
    fs.mkdirSync(adrDiskDir, { recursive: true });
    fs.writeFileSync(
      path.join(adrDiskDir, "ADR-050.md"),
      "# ADR-050: Live Tampered\n\n- **Status:** Accepted\n",
      "utf8",
    );
    insertFile(
      scan2,
      "docs/adr/ADR-050.md",
      createHash("sha256").update("original").digest("hex"),
      "documentation",
    );

    // 1. Unanchored manual & diff -> UNVERIFIED, zero false verification
    const manualMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "manual_unanchored",
      category: "project_context",
      title: "Manual Note",
      content: "Note without file anchor",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: manualMem.id,
      scanId: scan1,
      evidenceType: "manual",
      sourcePath: "manual",
      description: "Free-form note",
    });

    // 2. Two supporting files (1 exists, 1 missing) -> conjunctive STALE (DEFECT-LC-01)
    const multiMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "conjunctive_mem",
      category: "architectural_knowledge",
      title: "Conjunctive Multi-File",
      content: "Depends on hash-check + ui/Page",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: multiMem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/hash-check.ts",
      description: "First file",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: multiMem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/ui/Page.tsx",
      description: "Deleted file in scan 2",
    });

    // 3. Symbol fingerprint drift -> MISSING -> STALE (not DISPUTED) (ISSUE-EV-09)
    const fpMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "fp_drift_mem",
      category: "architectural_knowledge",
      title: "Symbol Fingerprint Drift",
      content: "Pinned to fnA fp_1",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: fpMem.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/hash-check.ts",
      symbolIdentity: "sym:src/hash-check.ts#fnA",
      sourceHash: "fp_1",
      description: "fnA hash",
    });

    // 4. File contentHash drift -> MISSING -> STALE (DEFECT-EV-04)
    const fileHashMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "file_hash_mem",
      category: "architectural_knowledge",
      title: "File Hash Check",
      content: "Pinned to hash_v1",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: fileHashMem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/hash-check.ts",
      sourceHash: "hash_v1",
      description: "hash-check content hash",
    });

    // 5. UNRESOLVED import -> UNVERIFIED (not DISPUTED), and live-tampered ADR -> UNVERIFIED (DEFECT-EV-06, ISSUE-EV-07)
    const impMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "import_unresolved_mem",
      category: "architectural_knowledge",
      title: "Unresolved Import Mem",
      content: "Depends on ./dyn",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: impMem.id,
      scanId: scan1,
      evidenceType: "import",
      sourcePath: "src/imp.ts",
      symbolIdentity: "./dyn",
      lineStart: 4,
      description: "Dynamic import",
    });

    const adrTamperMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "adr_tamper_mem",
      category: "architectural_decision",
      title: "ADR 050",
      content: "Historical ADR verification",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: adrTamperMem.id,
      scanId: scan1,
      evidenceType: "adr",
      sourcePath: "docs/adr/ADR-050.md",
      description: "ADR-050",
    });

    // 6. Ambiguous relocation -> UNVERIFIED
    const comparison = new SnapshotComparator(db).compare(scan1, scan2, { workspaceRoot: tmpDir });
    const ambMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "ambiguous_sym_mem",
      category: "architectural_knowledge",
      title: "Ambiguous Relocation",
      content: "fn helper moved ambiguously",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: ambMem.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/amb/mod.ts",
      symbolIdentity: "sym:src/amb/mod.ts#helper",
      description: "helper moved to 2 candidates",
    });

    const summary = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, comparison, {
      applyLifecycle: true,
      workspaceRoot: tmpDir,
    });
    const byKey = new Map(summary.evaluations.map((e) => [e.memoryKey, e]));

    expect(byKey.get("manual_unanchored")?.unverifiedCount).toBe(1);
    expect(byKey.get("manual_unanchored")?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, manualMem.id)!.lastSeenScanId).toBe(scan1);

    expect(byKey.get("conjunctive_mem")?.proposedStatus).toBe("STALE");
    expect(byKey.get("fp_drift_mem")?.proposedStatus).toBe("STALE");
    expect(byKey.get("file_hash_mem")?.proposedStatus).toBe("STALE");
    expect(byKey.get("import_unresolved_mem")?.unverifiedCount).toBe(1);
    expect(byKey.get("import_unresolved_mem")?.proposedStatus).toBe("ACTIVE");
    expect(byKey.get("adr_tamper_mem")?.unverifiedCount).toBe(1);
    expect(byKey.get("ambiguous_sym_mem")?.evidenceEvaluations[0].status).toMatch(
      /UNVERIFIED|MISSING/,
    );
  });

  it("EVO-MEM-REMEDIATION-03: blocks deep chains (>32 hops) fail-closed and blocks STALE superseders (DEFECT-REL-01, DEFECT-REL-02)", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    insertFile(scan1, "src/keep.ts", "k1");
    insertFile(scan2, "src/keep.ts", "k2");

    // STALE superseder must NOT supersede active target (DEFECT-REL-02)
    const targetMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "active_target",
      category: "architectural_decision",
      title: "Active Target",
      content: "Still active",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: targetMem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/keep.ts",
      description: "Active anchor",
    });
    const staleCand = store.createMemory({
      repositoryId: repoId,
      memoryKey: "stale_cand",
      category: "architectural_decision",
      title: "Stale Candidate",
      content: "Not healthy",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: staleCand.id,
      targetStatus: "STALE",
      changeReason: "Stale before supersession attempt",
    });
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: staleCand.id,
      targetMemoryId: targetMem.id,
      relationshipType: "SUPERSEDES",
    });

    const evalRes = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    expect(evalRes.transitionedToSuperseded).toBe(0);
    expect(store.getMemory(repoId, targetMem.id)!.status).toBe("ACTIVE");

    // Deep chain > 32 hops fails closed (DEFECT-REL-01)
    const nodes: number[] = [];
    for (let i = 0; i < 35; i++) {
      nodes.push(
        store.createMemory({
          repositoryId: repoId,
          memoryKey: `chain_${i}`,
          category: "project_context",
          title: `Chain ${i}`,
          content: `Node ${i}`,
        }).id,
      );
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: nodes[i],
        targetMemoryId: nodes[i + 1],
        relationshipType: "DEPENDS_ON",
      });
    }
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: nodes[nodes.length - 1],
        targetMemoryId: nodes[0],
        relationshipType: "DEPENDS_ON",
      }),
    ).toThrow(/ERR_MEMORY_RELATIONSHIP_DEPTH_EXCEEDED/);
  });
});
