import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { EvidenceEvaluator } from "../../scripts/memory/evidence-evaluator.ts";
import { MemoryLifecycleEvaluator } from "../../scripts/memory/memory-lifecycle-evaluator.ts";
import {
  EvolutionAnalyzer,
  SnapshotComparator,
  SnapshotComparisonError,
} from "../../scripts/evolution/index.ts";
import { computeSymbolId } from "../../scripts/extractor/symbol-identity.ts";

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

  it("EVO-MEM-SEMANTICS: enforces flat conjunctive support, UNVERIFIED non-mutation, CONTRADICTED -> DISPUTED, and PARTIAL downgrade", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");
    const scanPartialRes = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, 'PARTIAL', 5, 4, 1, 0, 0, '0.6.3', '0.6.3', 0)`,
      )
      .run(repoId, "2026-11-04T10:00:00.000Z", new Date().toISOString());
    const scanPartial = Number(scanPartialRes.lastInsertRowid);

    // Scan 1 artifacts
    const f1a = insertFile(scan1, "src/a.ts", "ha1");
    insertSymbol(scan1, f1a, "sym:src/a.ts#fnA", "fnA");
    insertFile(scan1, "src/b.ts", "hb1");
    insertFile(scan1, "src/c.ts", "hc1");

    // Scan 2: src/a.ts and src/b.ts valid, src/c.ts missing, unanchored manual & contradictory diff target
    const f2a = insertFile(scan2, "src/a.ts", "ha1");
    insertSymbol(scan2, f2a, "sym:src/a.ts#fnA", "fnA");
    insertFile(scan2, "src/b.ts", "hb1");
    insertFile(scan2, "src/contradict.ts", "hcontra1");

    // Scan 3: src/c.ts restored
    const f3a = insertFile(scan3, "src/a.ts", "ha1");
    insertSymbol(scan3, f3a, "sym:src/a.ts#fnA", "fnA");
    insertFile(scan3, "src/b.ts", "hb1");
    insertFile(scan3, "src/c.ts", "hc1");

    // Scan Partial: src/a.ts exists, src/b.ts absent
    insertFile(scanPartial, "src/a.ts", "ha1");

    // 1. Two valid supporting items -> VERIFIED_ACTIVE
    const memBothValid = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_both_valid",
      category: "architectural_knowledge",
      title: "Both Valid",
      content: "Requires src/a.ts and src/b.ts",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memBothValid.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/a.ts",
      sourceHash: "ha1",
      description: "File A",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memBothValid.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/b.ts",
      sourceHash: "hb1",
      description: "File B",
    });

    // 2. Two supporting items: 1 valid, 1 missing -> STALE
    const memOneMissing = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_one_missing",
      category: "architectural_knowledge",
      title: "One Missing",
      content: "Requires src/a.ts and src/c.ts",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memOneMissing.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/a.ts",
      sourceHash: "ha1",
      description: "File A",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memOneMissing.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/c.ts",
      sourceHash: "hc1",
      description: "File C",
    });

    // 3. Two supporting items on initially STALE memory: 1 valid + 1 unanchored UNVERIFIED -> stays STALE, no verification stamp
    const memMixedUnverified = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_mixed_unverified",
      category: "architectural_knowledge",
      title: "Mixed Valid and Unverified",
      content: "Requires src/a.ts plus unanchored manual note",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memMixedUnverified.id,
      targetStatus: "STALE",
      changeReason: "Pre-mark stale for recovery block test",
      sourceScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memMixedUnverified.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/a.ts",
      sourceHash: "ha1",
      description: "File A",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memMixedUnverified.id,
      scanId: scan1,
      evidenceType: "manual",
      sourcePath: "",
      description: "Unanchored manual note",
    });

    // 4. Single UNVERIFIED item on ACTIVE memory -> NO_CHANGE_NON_TERMINAL, stays ACTIVE, lastSeenScanId unchanged
    const memSingleUnverified = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_single_unverified",
      category: "project_context",
      title: "Single Unverified",
      content: "Only unanchored manual item",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memSingleUnverified.id,
      scanId: scan1,
      evidenceType: "manual",
      sourcePath: "",
      description: "Unanchored note",
    });

    // 5. Supporting valid + contradicting item -> DISPUTED
    const memContradicted = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_contradicted",
      category: "architectural_knowledge",
      title: "Contradicted Memory",
      content: "Valid source plus contradicting artifact",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContradicted.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/a.ts",
      sourceHash: "ha1",
      description: "Valid File A",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContradicted.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/contradict.ts",
      sourceHash: "hcontra1",
      description: "Contradicting artifact",
      isContradictory: true,
    });

    // 6. Zero supporting evidence (both ACTIVE and STALE) -> NO_CHANGE_NON_TERMINAL, no verification stamp
    const memZeroActive = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_zero_active",
      category: "project_context",
      title: "Zero Active",
      content: "No evidence",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    const memZeroStale = store.createMemory({
      repositoryId: repoId,
      memoryKey: "sem_zero_stale",
      category: "project_context",
      title: "Zero Stale",
      content: "No evidence stale",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memZeroStale.id,
      targetStatus: "STALE",
      changeReason: "Pre-mark stale without evidence",
      sourceScanId: scan1,
    });

    const summary2 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    const byId2 = new Map(summary2.evaluations.map((e) => [e.memoryId, e]));

    expect(byId2.get(memBothValid.id)?.action).toBe("VERIFIED_ACTIVE");
    expect(store.getMemory(repoId, memBothValid.id)?.lastSeenScanId).toBe(scan2);

    expect(byId2.get(memOneMissing.id)?.action).toBe("TRANSITION_STALE");
    expect(store.getMemory(repoId, memOneMissing.id)?.status).toBe("STALE");

    expect(byId2.get(memMixedUnverified.id)?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(byId2.get(memMixedUnverified.id)?.unverifiedCount).toBe(1);
    expect(store.getMemory(repoId, memMixedUnverified.id)?.status).toBe("STALE");
    expect(store.getMemory(repoId, memMixedUnverified.id)?.lastSeenScanId).toBe(scan1);

    expect(byId2.get(memSingleUnverified.id)?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, memSingleUnverified.id)?.status).toBe("ACTIVE");
    expect(store.getMemory(repoId, memSingleUnverified.id)?.lastSeenScanId).toBe(scan1);

    expect(byId2.get(memContradicted.id)?.action).toBe("TRANSITION_DISPUTED");
    expect(store.getMemory(repoId, memContradicted.id)?.status).toBe("DISPUTED");

    expect(byId2.get(memZeroActive.id)?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, memZeroActive.id)?.lastSeenScanId).toBe(scan1);
    expect(byId2.get(memZeroStale.id)?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, memZeroStale.id)?.status).toBe("STALE");
    expect(store.getMemory(repoId, memZeroStale.id)?.lastSeenScanId).toBe(scan1);

    // Scan 3 recovers memOneMissing once BOTH supporting items verify
    const summary3 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan3, undefined, {
      applyLifecycle: true,
    });
    const byId3 = new Map(summary3.evaluations.map((e) => [e.memoryId, e]));
    expect(byId3.get(memOneMissing.id)?.action).toBe("RECOVER_ACTIVE");
    expect(store.getMemory(repoId, memOneMissing.id)?.status).toBe("ACTIVE");
    expect(store.getMemory(repoId, memOneMissing.id)?.lastSeenScanId).toBe(scan3);

    // PARTIAL scan with allowPartial: true downgrades MISSING -> UNVERIFIED and emits LIM_PARTIAL_SNAPSHOT_EVALUATION
    const summaryPartial = MemoryLifecycleEvaluator.evaluateRepository(
      db,
      repoId,
      scanPartial,
      undefined,
      { applyLifecycle: true, allowPartial: true },
    );
    expect(
      summaryPartial.limitations?.some((l) => l.code === "LIM_PARTIAL_SNAPSHOT_EVALUATION"),
    ).toBe(true);
    const partialEval = summaryPartial.evaluations.find((e) => e.memoryId === memBothValid.id);
    expect(partialEval?.missingCount).toBe(0);
    expect(partialEval?.unverifiedCount).toBe(1);
    expect(partialEval?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, memBothValid.id)?.status).toBe("ACTIVE");
  });

  it("EVO-MEM-GRAPH-EDGE: resolves graph_edge via graphEdgeId (ISSUE-EV-09) and enforces scan/repository ownership", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");
    const scan4 = createScan("2026-11-04T10:00:00.000Z");

    const insertNode = (
      targetRepoId: number,
      scanId: number,
      nodeId: string,
      name: string,
    ): number => {
      const res = db
        .prepare(
          `INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name)
           VALUES (?, ?, ?, 'file', ?)`,
        )
        .run(targetRepoId, scanId, nodeId, name);
      return Number(res.lastInsertRowid);
    };

    const insertEdge = (
      targetRepoId: number,
      scanId: number,
      edgeIdentity: string,
      srcNodeId: number,
      dstNodeId: number,
      relType: string,
    ): number => {
      const res = db
        .prepare(
          `INSERT INTO graph_edges (
            repository_id, scan_id, edge_identity, source_node_id, target_node_id,
            relationship_type, confidence, relationship_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1.0, 'CONFIRMED', ?)`,
        )
        .run(
          targetRepoId,
          scanId,
          edgeIdentity,
          srcNodeId,
          dstNodeId,
          relType,
          new Date().toISOString(),
        );
      return Number(res.lastInsertRowid);
    };

    // Scan 1: edge_valid (src/a -> src/b, IMPORTS) and edge_to_remove (src/c -> src/d, IMPORTS)
    const n1a = insertNode(repoId, scan1, "file:src/a.ts", "a.ts");
    const n1b = insertNode(repoId, scan1, "file:src/b.ts", "b.ts");
    const n1c = insertNode(repoId, scan1, "file:src/c.ts", "c.ts");
    const n1d = insertNode(repoId, scan1, "file:src/d.ts", "d.ts");
    const e1Valid = insertEdge(repoId, scan1, "edge:a->b", n1a, n1b, "IMPORTS");
    const e1Removed = insertEdge(repoId, scan1, "edge:c->d", n1c, n1d, "IMPORTS");

    // Scan 2: edge:a->b preserved identically; edge:c->d omitted
    const n2a = insertNode(repoId, scan2, "file:src/a.ts", "a.ts");
    const n2b = insertNode(repoId, scan2, "file:src/b.ts", "b.ts");
    insertEdge(repoId, scan2, "edge:a->b", n2a, n2b, "IMPORTS");

    // Scan 3: edge:a->b mutates endpoint / relationshipType
    const n3a = insertNode(repoId, scan3, "file:src/a.ts", "a.ts");
    const n3x = insertNode(repoId, scan3, "file:src/x.ts", "x.ts");
    insertEdge(repoId, scan3, "edge:a->b", n3a, n3x, "DEPENDS_ON");

    // Foreign repository edge + scan mismatch edge
    const foreignRepoId = Number(
      db
        .prepare(
          `INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version)
           VALUES ('repo://foreign', '/foreign', 'foreign', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 3)`,
        )
        .run().lastInsertRowid,
    );
    const foreignScan = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (
            repository_id, started_at, completed_at, status, files_discovered,
            files_indexed, files_skipped, files_failed, diagnostic_count,
            scanner_version, extractor_version, is_active
          ) VALUES (?, '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z', 'COMPLETE', 1, 1, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
        )
        .run(foreignRepoId).lastInsertRowid,
    );
    const nf1 = insertNode(foreignRepoId, foreignScan, "file:src/a.ts", "a.ts");
    const nf2 = insertNode(foreignRepoId, foreignScan, "file:src/b.ts", "b.ts");
    const foreignEdgeId = insertEdge(foreignRepoId, foreignScan, "edge:a->b", nf1, nf2, "IMPORTS");
    insertNode(repoId, scan4, "file:src/a.ts", "a.ts");
    insertNode(repoId, scan4, "file:src/b.ts", "b.ts");
    const mismatchedScanEdgeId = insertEdge(
      repoId,
      scan4,
      "edge:other-scan",
      insertNode(repoId, scan4, "file:src/m1.ts", "m1.ts"),
      insertNode(repoId, scan4, "file:src/m2.ts", "m2.ts"),
      "IMPORTS",
    );

    const memValid = store.createMemory({
      repositoryId: repoId,
      memoryKey: "edge_valid_mem",
      category: "architectural_knowledge",
      title: "Valid Graph Edge",
      content: "Tracked solely by graphEdgeId with null symbolIdentity",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memValid.id,
      scanId: scan1,
      evidenceType: "graph_edge",
      sourcePath: "src/a.ts",
      symbolIdentity: null,
      graphEdgeId: e1Valid,
      description: "Primary import edge",
    });

    const memRemoved = store.createMemory({
      repositoryId: repoId,
      memoryKey: "edge_removed_mem",
      category: "architectural_knowledge",
      title: "Removed Graph Edge",
      content: "Tracked edge deleted in scan 2",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memRemoved.id,
      scanId: scan1,
      evidenceType: "graph_edge",
      sourcePath: "src/c.ts",
      symbolIdentity: null,
      graphEdgeId: e1Removed,
      description: "Deleted import edge",
    });

    const memForeignEdge = store.createMemory({
      repositoryId: repoId,
      memoryKey: "edge_foreign_mem",
      category: "architectural_knowledge",
      title: "Foreign Repo Edge",
      content: "Points to edge owned by foreign repo",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    expect(() =>
      store.addEvidence({
        repositoryId: repoId,
        memoryId: memForeignEdge.id,
        scanId: scan1,
        evidenceType: "graph_edge",
        sourcePath: "src/a.ts",
        symbolIdentity: null,
        graphEdgeId: foreignEdgeId,
        description: "Cross-repo edge ID",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    const memScanMismatchEdge = store.createMemory({
      repositoryId: repoId,
      memoryKey: "edge_scan_mismatch_mem",
      category: "architectural_knowledge",
      title: "Scan Mismatch Edge",
      content: "Evidence scanId=scan1 points to edge from scan4",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    expect(() =>
      store.addEvidence({
        repositoryId: repoId,
        memoryId: memScanMismatchEdge.id,
        scanId: scan1,
        evidenceType: "graph_edge",
        sourcePath: "src/m1.ts",
        symbolIdentity: null,
        graphEdgeId: mismatchedScanEdgeId,
        description: "Mismatched scan edge ID",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    const res2 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: true,
    });
    const byId2 = new Map(res2.evaluations.map((e) => [e.memoryId, e]));

    expect(byId2.get(memValid.id)?.evidenceEvaluations[0].status).toBe("VERIFIED");
    expect(byId2.get(memValid.id)?.action).toBe("VERIFIED_ACTIVE");

    expect(byId2.get(memRemoved.id)?.evidenceEvaluations[0].status).toBe("MISSING");
    expect(byId2.get(memRemoved.id)?.action).toBe("TRANSITION_STALE");

    // Defense-in-depth: even for an in-memory/corrupted record referencing foreignEdgeId or a scan-mismatched edge,
    // EvidenceEvaluator classifies both as UNVERIFIED (never VERIFIED or STALE).
    const ctx2 = EvidenceEvaluator.createContext(db, repoId, scan2);
    const foreignEval = EvidenceEvaluator.evaluateEvidence(ctx2, {
      id: 9901,
      repositoryId: repoId,
      memoryId: memForeignEdge.id,
      scanId: scan1,
      evidenceType: "graph_edge",
      sourcePath: "src/a.ts",
      lineStart: null,
      lineEnd: null,
      sourceHash: null,
      symbolIdentity: null,
      graphNodeId: null,
      graphEdgeId: foreignEdgeId,
      description: "Foreign edge record",
      confidence: 1.0,
      isContradictory: false,
      createdAt: new Date().toISOString(),
    });
    expect(foreignEval.status).toBe("UNVERIFIED");

    const scanMismatchEval = EvidenceEvaluator.evaluateEvidence(ctx2, {
      id: 9902,
      repositoryId: repoId,
      memoryId: memScanMismatchEdge.id,
      scanId: scan1,
      evidenceType: "graph_edge",
      sourcePath: "src/m1.ts",
      lineStart: null,
      lineEnd: null,
      sourceHash: null,
      symbolIdentity: null,
      graphNodeId: null,
      graphEdgeId: mismatchedScanEdgeId,
      description: "Scan mismatch edge record",
      confidence: 1.0,
      isContradictory: false,
      createdAt: new Date().toISOString(),
    });
    expect(scanMismatchEval.status).toBe("UNVERIFIED");

    // Scan 3 mutates endpoints/relationship_type -> MISSING / STALE
    const res3 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan3, undefined, {
      applyLifecycle: true,
    });
    const eval3Valid = res3.evaluations.find((e) => e.memoryId === memValid.id)!;
    expect(eval3Valid.evidenceEvaluations[0].status).toBe("MISSING");
    expect(eval3Valid.action).toBe("TRANSITION_STALE");
  });

  it("EVO-MEM-RELOCATION: resolves unique computeSymbolId SHA-256 relocation, rejects ambiguous relocation, and flags modified body as STALE (DEFECT-EV-02, DEFECT-EV-03)", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");
    const scan4 = createScan("2026-11-04T10:00:00.000Z");

    const f1Old = insertFile(scan1, "src/old-loc.ts", "h_old");
    const origUniqueId = computeSymbolId("src/old-loc.ts", null, "function", "movedHelper");
    const origAmbigId = computeSymbolId("src/old-loc.ts", null, "function", "sharedHelper");
    const origModifiedId = computeSymbolId("src/old-loc.ts", null, "function", "stableName");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan1, f1Old, origUniqueId, "movedHelper", "fp_unique_1");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 10, 15, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan1, f1Old, origAmbigId, "sharedHelper", "fp_ambig_1");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 20, 25, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan1, f1Old, origModifiedId, "stableName", "fp_mod_1");

    // Scan 2:
    // - movedHelper moves to src/new-loc.ts with same name::kind::scope::fingerprint (unique match)
    // - sharedHelper appears in BOTH src/dup-a.ts and src/dup-b.ts (ambiguous match -> UNVERIFIED)
    // - stableName stays at origModifiedId in src/old-loc.ts with changed fingerprint fp_mod_changed (STALE, not DISPUTED)
    const f2Old = insertFile(scan2, "src/old-loc.ts", "h_old_2");
    const f2New = insertFile(scan2, "src/new-loc.ts", "h_new");
    const f2DupA = insertFile(scan2, "src/dup-a.ts", "hda");
    const f2DupB = insertFile(scan2, "src/dup-b.ts", "hdb");

    const relocatedUniqueId = computeSymbolId("src/new-loc.ts", null, "function", "movedHelper");
    const ambigAId = computeSymbolId("src/dup-a.ts", null, "function", "sharedHelper");
    const ambigBId = computeSymbolId("src/dup-b.ts", null, "function", "sharedHelper");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan2, f2New, relocatedUniqueId, "movedHelper", "fp_unique_1");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan2, f2DupA, ambigAId, "sharedHelper", "fp_ambig_1");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan2, f2DupB, ambigBId, "sharedHelper", "fp_ambig_1");

    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 20, 25, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan2, f2Old, origModifiedId, "stableName", "fp_mod_changed");

    // Scan 3: relocated movedHelper also gets a modified fingerprint fp_unique_2 -> MISSING / STALE
    const f3New = insertFile(scan3, "src/new-loc.ts", "h_new_2");
    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan3, f3New, relocatedUniqueId, "movedHelper", "fp_unique_2");

    // Scan 4: movedHelper matches original fingerprint again -> RECOVER_ACTIVE
    const f4New = insertFile(scan4, "src/new-loc.ts", "h_new");
    db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name, kind, scope,
        is_exported, start_line, end_line, start_column, end_column,
        fingerprint, confidence, extraction_status
      ) VALUES (?, ?, ?, ?, ?, 'function', NULL, 1, 1, 5, 0, 1, ?, 1.0, 'COMPLETE')`,
    ).run(repoId, scan4, f4New, relocatedUniqueId, "movedHelper", "fp_unique_1");

    const memRelocated = store.createMemory({
      repositoryId: repoId,
      memoryKey: "reloc_unique",
      category: "engineering_convention",
      title: "Unique Relocation",
      content: "Tracks movedHelper across file move",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memRelocated.id,
      targetStatus: "STALE",
      changeReason: "Pre-stale to verify recovery via unique relocation",
      sourceScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memRelocated.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/old-loc.ts",
      symbolIdentity: origUniqueId,
      sourceHash: "fp_unique_1",
      description: "movedHelper original identity",
    });

    const memAmbig = store.createMemory({
      repositoryId: repoId,
      memoryKey: "reloc_ambig",
      category: "engineering_convention",
      title: "Ambiguous Relocation",
      content: "Tracks sharedHelper duplicated into two files",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memAmbig.id,
      targetStatus: "STALE",
      changeReason: "Ambiguous relocation must NOT recover STALE -> ACTIVE",
      sourceScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memAmbig.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/old-loc.ts",
      symbolIdentity: origAmbigId,
      sourceHash: "fp_ambig_1",
      description: "sharedHelper original identity",
    });

    const memInPlaceMod = store.createMemory({
      repositoryId: repoId,
      memoryKey: "mod_in_place",
      category: "engineering_convention",
      title: "In-place Symbol Modified",
      content: "Tracks stableName whose body fingerprint changed",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memInPlaceMod.id,
      scanId: scan1,
      evidenceType: "symbol",
      sourcePath: "src/old-loc.ts",
      symbolIdentity: origModifiedId,
      sourceHash: "fp_mod_1",
      description: "stableName original fingerprint",
    });

    const comparison12 = new SnapshotComparator(db).compare(scan1, scan2);
    const res2 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, comparison12, {
      applyLifecycle: true,
    });
    const byId2 = new Map(res2.evaluations.map((e) => [e.memoryId, e]));

    expect(byId2.get(memRelocated.id)?.evidenceEvaluations[0].status).toBe("VERIFIED");
    expect(byId2.get(memRelocated.id)?.action).toBe("RECOVER_ACTIVE");
    expect(store.getMemory(repoId, memRelocated.id)?.status).toBe("ACTIVE");

    expect(byId2.get(memAmbig.id)?.evidenceEvaluations[0].status).toBe("UNVERIFIED");
    expect(byId2.get(memAmbig.id)?.action).toBe("NO_CHANGE_NON_TERMINAL");
    expect(store.getMemory(repoId, memAmbig.id)?.status).toBe("STALE");

    expect(byId2.get(memInPlaceMod.id)?.evidenceEvaluations[0].status).toBe("MISSING");
    expect(byId2.get(memInPlaceMod.id)?.action).toBe("TRANSITION_STALE");
    expect(store.getMemory(repoId, memInPlaceMod.id)?.status).toBe("STALE");

    // Scan 3: relocated symbol has modified fingerprint -> MISSING / STALE
    const res3 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan3, undefined, {
      applyLifecycle: true,
    });
    const reloc3 = res3.evaluations.find((e) => e.memoryId === memRelocated.id)!;
    expect(reloc3.evidenceEvaluations[0].status).toBe("MISSING");
    expect(reloc3.action).toBe("TRANSITION_STALE");
    expect(store.getMemory(repoId, memRelocated.id)?.status).toBe("STALE");

    // Scan 4 (without explicit SnapshotComparison, using DB scan resolution): restored fingerprint recovers STALE -> ACTIVE
    const res4 = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan4, undefined, {
      applyLifecycle: true,
    });
    const reloc4 = res4.evaluations.find((e) => e.memoryId === memRelocated.id)!;
    expect(reloc4.evidenceEvaluations[0].status).toBe("VERIFIED");
    expect(reloc4.action).toBe("RECOVER_ACTIVE");
    expect(store.getMemory(repoId, memRelocated.id)?.status).toBe("ACTIVE");
  });

  it("EVO-MEM-DIFF: enforces concrete artifact verification for supporting and contradictory diff evidence (DEFECT-EV-05)", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scanPartialRes = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, 'PARTIAL', 5, 4, 1, 0, 0, '0.6.3', '0.6.3', 0)`,
      )
      .run(repoId, "2026-11-03T10:00:00.000Z", new Date().toISOString());
    const scanPartial = Number(scanPartialRes.lastInsertRowid);

    insertFile(scan1, "src/feature.ts", "h_feat_1");
    insertFile(scan2, "src/feature.ts", "h_feat_2");

    // Foreign repository scan for ownership test
    const foreignRepoId = Number(
      db
        .prepare(
          `INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version)
           VALUES ('repo://foreign-diff', '/foreign-diff', 'foreign-diff', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 3)`,
        )
        .run().lastInsertRowid,
    );
    const foreignScan = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (
            repository_id, started_at, completed_at, status, files_discovered,
            files_indexed, files_skipped, files_failed, diagnostic_count,
            scanner_version, extractor_version, is_active
          ) VALUES (?, '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z', 'COMPLETE', 1, 1, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
        )
        .run(foreignRepoId).lastInsertRowid,
    );

    const memUnanchored = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_unanchored",
      category: "architectural_knowledge",
      title: "Unanchored Diff",
      content: "No sourcePath or symbolIdentity",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memUnanchored.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "",
      description: "Unanchored diff note",
    });

    const memAnchoredMatch = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_anchored_match",
      category: "architectural_knowledge",
      title: "Anchored Matching Diff",
      content: "Matches src/feature.ts h_feat_2",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memAnchoredMatch.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "src/feature.ts",
      sourceHash: "h_feat_2",
      description: "Target diff hash verified",
    });

    const memAnchoredMissing = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_anchored_missing",
      category: "architectural_knowledge",
      title: "Anchored Missing Diff",
      content: "Points to deleted file",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memAnchoredMissing.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "src/absent.ts",
      description: "Missing file diff",
    });

    const memContraMatch = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_contra_match",
      category: "architectural_knowledge",
      title: "Contradictory Anchored Diff",
      content: "Contradicted by src/feature.ts h_feat_2",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContraMatch.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/feature.ts",
      description: "Supporting file",
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContraMatch.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "src/feature.ts",
      sourceHash: "h_feat_2",
      description: "Contradicting diff artifact",
      isContradictory: true,
    });

    const memContraMismatch = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_contra_mismatch",
      category: "architectural_knowledge",
      title: "Contradictory Hash Mismatch Diff",
      content: "Hash mismatch on contradicting diff",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContraMismatch.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "src/feature.ts",
      sourceHash: "wrong_hash",
      description: "Mismatched hash",
      isContradictory: true,
    });

    const memContraUnanchored = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_contra_unanchored",
      category: "architectural_knowledge",
      title: "Contradictory Unanchored Diff",
      content: "Unanchored contradicting diff",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: memContraUnanchored.id,
      scanId: scan1,
      evidenceType: "diff",
      sourcePath: "",
      description: "Unanchored contradicting diff",
      isContradictory: true,
    });

    const memForeignDiff = store.createMemory({
      repositoryId: repoId,
      memoryKey: "diff_foreign_scan",
      category: "architectural_knowledge",
      title: "Foreign Repo Scan Diff",
      content: "Diff recorded under foreign scan",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    expect(() =>
      store.addEvidence({
        repositoryId: repoId,
        memoryId: memForeignDiff.id,
        scanId: foreignScan,
        evidenceType: "diff",
        sourcePath: "src/feature.ts",
        sourceHash: "h_feat_2",
        description: "Foreign-owned evidence scan",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Both without comparison and with SnapshotComparison: unanchored diff stays UNVERIFIED
    const comparison12 = new SnapshotComparator(db).compare(scan1, scan2);
    const resWithout = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, undefined, {
      applyLifecycle: false,
    });
    const resWith = MemoryLifecycleEvaluator.evaluateRepository(db, repoId, scan2, comparison12, {
      applyLifecycle: true,
    });
    expect(
      resWithout.evaluations.find((e) => e.memoryId === memUnanchored.id)?.evidenceEvaluations[0]
        .status,
    ).toBe("UNVERIFIED");

    const byId = new Map(resWith.evaluations.map((e) => [e.memoryId, e]));
    expect(byId.get(memUnanchored.id)?.evidenceEvaluations[0].status).toBe("UNVERIFIED");
    expect(byId.get(memAnchoredMatch.id)?.evidenceEvaluations[0].status).toBe("VERIFIED");
    expect(byId.get(memAnchoredMissing.id)?.evidenceEvaluations[0].status).toBe("MISSING");
    expect(byId.get(memContraMatch.id)?.evidenceEvaluations[1].status).toBe("CONTRADICTED");
    expect(store.getMemory(repoId, memContraMatch.id)?.status).toBe("DISPUTED");
    expect(byId.get(memContraMismatch.id)?.evidenceEvaluations[0].status).toBe("MISSING");
    expect(byId.get(memContraUnanchored.id)?.evidenceEvaluations[0].status).toBe("UNVERIFIED");

    const ctx2 = EvidenceEvaluator.createContext(db, repoId, scan2, comparison12);
    const foreignDiffEval = EvidenceEvaluator.evaluateEvidence(ctx2, {
      id: 9903,
      repositoryId: repoId,
      memoryId: memForeignDiff.id,
      scanId: foreignScan,
      evidenceType: "diff",
      sourcePath: "src/feature.ts",
      lineStart: null,
      lineEnd: null,
      sourceHash: "h_feat_2",
      symbolIdentity: null,
      graphNodeId: null,
      graphEdgeId: null,
      description: "Foreign-owned evidence scan",
      confidence: 1.0,
      isContradictory: false,
      createdAt: new Date().toISOString(),
    });
    expect(foreignDiffEval.status).toBe("UNVERIFIED");

    // Partial snapshot downgrades missing supporting diff artifact to UNVERIFIED
    const ctxPartial = EvidenceEvaluator.createContext(
      db,
      repoId,
      scanPartial,
      undefined,
      undefined,
      {
        allowPartial: true,
      },
    );
    const missingEv = store.getMemoryEvidence(repoId, memAnchoredMissing.id)[0];
    expect(EvidenceEvaluator.evaluateEvidence(ctxPartial, missingEv).status).toBe("UNVERIFIED");
  });

  it("EVO-MEM-SCAN-GUARDS: rejects non-complete, foreign, missing, and non-chronological evaluations with zero DB mutation (DEFECT-LC-03)", () => {
    const validScan = createScan("2026-11-02T10:00:00.000Z");
    const olderScan = createScan("2026-11-01T10:00:00.000Z");
    insertFile(validScan, "src/guard.ts", "hg");
    insertFile(olderScan, "src/guard.ts", "hg");

    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "guard_mem",
      category: "project_context",
      title: "Guard Memory",
      content: "Must stay untouched on invalid scan evaluation",
      firstSeenScanId: olderScan,
      lastSeenScanId: olderScan,
    });
    store.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: olderScan,
      evidenceType: "source_file",
      sourcePath: "src/guard.ts",
      description: "Present file",
    });

    const insertStatusScan = (targetRepo: number, status: string, startedAt: string): number => {
      const res = db
        .prepare(
          `INSERT INTO scan_runs (
            repository_id, started_at, completed_at, status, files_discovered,
            files_indexed, files_skipped, files_failed, diagnostic_count,
            scanner_version, extractor_version, is_active
          ) VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
        )
        .run(
          targetRepo,
          startedAt,
          status === "RUNNING" || status === "VALIDATING" ? null : new Date().toISOString(),
          status,
        );
      return Number(res.lastInsertRowid);
    };

    const foreignRepoId = Number(
      db
        .prepare(
          `INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version)
           VALUES ('repo://foreign-guard', '/foreign-guard', 'foreign-guard', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 3)`,
        )
        .run().lastInsertRowid,
    );

    const runningScan = insertStatusScan(repoId, "RUNNING", "2026-11-03T10:00:00.000Z");
    const validatingScan = insertStatusScan(repoId, "VALIDATING", "2026-11-03T11:00:00.000Z");
    const failedScan = insertStatusScan(repoId, "FAILED", "2026-11-03T12:00:00.000Z");
    const cancelledScan = insertStatusScan(repoId, "CANCELLED", "2026-11-03T13:00:00.000Z");
    const partialScan = insertStatusScan(repoId, "PARTIAL", "2026-11-03T14:00:00.000Z");
    const foreignScan = insertStatusScan(foreignRepoId, "COMPLETE", "2026-11-03T15:00:00.000Z");

    const snapshotDbState = () => ({
      memories: db.prepare("SELECT * FROM engineering_memories ORDER BY id").all(),
      versions: db.prepare("SELECT * FROM memory_versions ORDER BY id").all(),
      relationships: db.prepare("SELECT * FROM memory_relationships ORDER BY id").all(),
      events: db.prepare("SELECT * FROM evolution_events ORDER BY id").all(),
    });
    const before = snapshotDbState();

    const invalidCases: { scanId: number; code: RegExp }[] = [
      { scanId: 999999, code: /ERR_SCAN_NOT_FOUND|does not exist/i },
      { scanId: runningScan, code: /ERR_SCAN_INCOMPLETE|RUNNING/i },
      { scanId: validatingScan, code: /ERR_SCAN_INCOMPLETE|VALIDATING/i },
      { scanId: failedScan, code: /ERR_SCAN_FAILED|FAILED/i },
      { scanId: cancelledScan, code: /ERR_SCAN_FAILED|CANCELLED/i },
      { scanId: partialScan, code: /ERR_PARTIAL_SCAN_NOT_ALLOWED|PARTIAL/i },
      { scanId: foreignScan, code: /ERR_REPOSITORY_MISMATCH|belongs to repository/i },
    ];

    for (const c of invalidCases) {
      expect(() =>
        MemoryLifecycleEvaluator.evaluateRepository(db, repoId, c.scanId, undefined, {
          applyLifecycle: true,
        }),
      ).toThrow(c.code);
      expect(snapshotDbState()).toEqual(before);
    }

    // Reversed chronology through EvolutionAnalyzer.analyze fails validation cleanly without mutations
    expect(() =>
      new EvolutionAnalyzer(db).analyze(validScan, olderScan, {
        expectedRepositoryId: repoId,
        persistEvents: true,
        applyLifecycle: true,
      }),
    ).toThrow(SnapshotComparisonError);
    expect(snapshotDbState()).toEqual(before);
  });

  it("EVO-MEM-REL-DEPTH: enforces shortest-path BFS up to exact MAX_DEPTH=32 boundary, diamond DAGs, and disconnected subgraphs (DEFECT-REL-01)", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const makeNode = (idx: number): number =>
      store.createMemory({
        repositoryId: repoId,
        memoryKey: `bfs_node_${idx}`,
        category: "architectural_knowledge",
        title: `BFS Node ${idx}`,
        content: `Node ${idx}`,
        firstSeenScanId: scan1,
        lastSeenScanId: scan1,
      }).id;

    // Chain nodes[0] -> nodes[1] -> ... -> nodes[32] (32 edges = exact MAX_DEPTH=32 boundary)
    const nodes: number[] = [];
    for (let i = 0; i <= 34; i += 1) {
      nodes.push(makeNode(i));
    }
    for (let i = 0; i < 32; i += 1) {
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: nodes[i],
        targetMemoryId: nodes[i + 1],
        relationshipType: "DEPENDS_ON",
      });
    }

    // 1. Adding an edge whose target reaches exactly 32 hops (safeRoot -> nodes[0]) succeeds
    const safeRoot = makeNode(100);
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: safeRoot,
        targetMemoryId: nodes[0],
        relationshipType: "DEPENDS_ON",
      }),
    ).not.toThrow();

    // 2. Cycle at depth <= 32 fails with ERR_MEMORY_RELATIONSHIP_CYCLE
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: nodes[31],
        targetMemoryId: nodes[0],
        relationshipType: "DEPENDS_ON",
      }),
    ).toThrow(/ERR_MEMORY_RELATIONSHIP_CYCLE/);

    // 3. Extend chain to 33 hops (nodes[32] -> nodes[33])
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: nodes[32],
      targetMemoryId: nodes[33],
      relationshipType: "DEPENDS_ON",
    });

    // Safe 33-hop chain from targetMemoryId fails closed with ERR_MEMORY_RELATIONSHIP_DEPTH_EXCEEDED
    const safeRoot33 = makeNode(101);
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: safeRoot33,
        targetMemoryId: nodes[0],
        relationshipType: "DEPENDS_ON",
      }),
    ).toThrow(/ERR_MEMORY_RELATIONSHIP_DEPTH_EXCEEDED/);

    // 4. Extend chain to 34 hops and attempt cycle nodes[34] -> nodes[0] (cycle reachable only at 34+ hops -> depth exceeded)
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: nodes[33],
      targetMemoryId: nodes[34],
      relationshipType: "DEPENDS_ON",
    });
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: nodes[34],
        targetMemoryId: nodes[0],
        relationshipType: "DEPENDS_ON",
      }),
    ).toThrow(/ERR_MEMORY_RELATIONSHIP_DEPTH_EXCEEDED/);

    // 5. Disconnected short subgraph still succeeds cleanly
    const isoA = makeNode(200);
    const isoB = makeNode(201);
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: isoA,
        targetMemoryId: isoB,
        relationshipType: "DEPENDS_ON",
      }),
    ).not.toThrow();

    // 6. Diamond DAG with converging paths (top -> left -> bottom, top -> right -> bottom, top2 -> top) succeeds cleanly
    const dTop = makeNode(300);
    const dLeft = makeNode(301);
    const dRight = makeNode(302);
    const dBottom = makeNode(303);
    const dEntry = makeNode(304);
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: dTop,
      targetMemoryId: dLeft,
      relationshipType: "DEPENDS_ON",
    });
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: dTop,
      targetMemoryId: dRight,
      relationshipType: "DEPENDS_ON",
    });
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: dLeft,
      targetMemoryId: dBottom,
      relationshipType: "DEPENDS_ON",
    });
    store.createRelationship({
      repositoryId: repoId,
      sourceMemoryId: dRight,
      targetMemoryId: dBottom,
      relationshipType: "DEPENDS_ON",
    });
    expect(() =>
      store.createRelationship({
        repositoryId: repoId,
        sourceMemoryId: dEntry,
        targetMemoryId: dTop,
        relationshipType: "DEPENDS_ON",
      }),
    ).not.toThrow();
  });
});
