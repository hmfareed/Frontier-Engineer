import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import {
  runMigrations,
  getCurrentSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
} from "../../scripts/storage/schema/migration-runner.ts";

describe("storage-migration-003 (Engineering Memory & Evolution Data Model)", () => {
  let db: SqliteDatabase;
  const now = new Date().toISOString();

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("1. applies migration 003 cleanly to a fresh database and establishes schema version 3", () => {
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(0);
    const result = runMigrations(db.rawDb);

    expect(result.applied).toBe(3);
    expect(result.currentVersion).toBe(3);
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(3);

    const tables = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('engineering_memories', 'memory_evidence', 'evolution_events', 'memory_relationships', 'memory_versions') ORDER BY name ASC",
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      "engineering_memories",
      "evolution_events",
      "memory_evidence",
      "memory_relationships",
      "memory_versions",
    ]);

    const triggers = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%' ORDER BY name ASC",
      )
      .all() as { name: string }[];

    expect(triggers.map((t) => t.name)).toEqual([
      "trg_engineering_memories_insert_guard",
      "trg_engineering_memories_no_delete_replacement",
      "trg_engineering_memories_update_guard",
      "trg_memory_versions_no_direct_delete",
      "trg_memory_versions_no_update",
    ]);

    const fkCheck = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(fkCheck).toHaveLength(0);

    const integrity = db.integrityCheck();
    expect(integrity.ok).toBe(true);
    expect(integrity.message).toBe("ok");
  });

  it("2. migrates seamlessly from schema version 2 and preserves existing records", () => {
    // Apply migrations 1 and 2 manually
    const m1 = MIGRATIONS.find((m) => m.version === 1)!;
    const m2 = MIGRATIONS.find((m) => m.version === 2)!;

    db.rawDb.exec(m1.sql);
    db.rawDb
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)")
      .run(m1.name, now);

    db.rawDb.exec("PRAGMA foreign_keys = OFF;");
    db.rawDb.exec(m2.sql);
    db.rawDb
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, ?, ?)")
      .run(m2.name, now);
    db.rawDb.exec("PRAGMA foreign_keys = ON;");

    expect(getCurrentSchemaVersion(db.rawDb)).toBe(2);

    // Populate existing schema v2 records
    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_v2", "/repo/v2", "Repo V2", now, now, 2);
    const repoId = Number(repoRes.lastInsertRowid);

    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    const scanId = Number(scanRes.lastInsertRowid);

    const fileRes = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'src/app.ts', 'src/app.ts', '.ts', 'typescript', 'source', 100, 1700000000, 'NONE', 'INDEXED', ?)",
      )
      .run(repoId, scanId, now);
    const fileId = Number(fileRes.lastInsertRowid);

    db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:main', 'main', 'function', 1, 10, 0, 1, 'fp1', 1.0, 'SUCCESS')",
      )
      .run(repoId, scanId, fileId);

    db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id) VALUES (?, ?, 'node:main', 'symbol', 'main', ?)",
      )
      .run(repoId, scanId, fileId);

    // Run migration runner to advance to v3
    const upgradeRes = runMigrations(db.rawDb);
    expect(upgradeRes.applied).toBe(1);
    expect(upgradeRes.currentVersion).toBe(3);
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(3);

    // Verify existing v2 records are completely preserved
    const fileCount = db.rawDb
      .prepare("SELECT COUNT(*) as count FROM files WHERE repository_id = ?")
      .get(repoId) as { count: number };
    const symCount = db.rawDb
      .prepare("SELECT COUNT(*) as count FROM symbols WHERE repository_id = ?")
      .get(repoId) as { count: number };
    const nodeCount = db.rawDb
      .prepare("SELECT COUNT(*) as count FROM graph_nodes WHERE repository_id = ?")
      .get(repoId) as { count: number };

    expect(fileCount.count).toBe(1);
    expect(symCount.count).toBe(1);
    expect(nodeCount.count).toBe(1);

    const fkCheck = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(fkCheck).toHaveLength(0);
  });

  it("3. injects controlled failure during actual migration 003 execution and verifies complete rollback and recovery", () => {
    // 1. Initialize to version 2 with existing data
    const m1 = MIGRATIONS.find((m) => m.version === 1)!;
    const m2 = MIGRATIONS.find((m) => m.version === 2)!;

    db.rawDb.exec(m1.sql);
    db.rawDb
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)")
      .run(m1.name, now);

    db.rawDb.exec("PRAGMA foreign_keys = OFF;");
    db.rawDb.exec(m2.sql);
    db.rawDb
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, ?, ?)")
      .run(m2.name, now);
    db.rawDb.exec("PRAGMA foreign_keys = ON;");

    expect(getCurrentSchemaVersion(db.rawDb)).toBe(2);

    // Seed existing v2 repository and scan
    const rRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_rollback', '/r', 'R', ?, ?, 2)",
      )
      .run(now, now);
    const repoId = Number(rRes.lastInsertRowid);

    db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);

    // 2. Take actual migration 003 SQL and inject controlled failure halfway through its execution
    const m3 = MIGRATIONS.find((m) => m.version === 3)!;
    const parts = m3.sql.split("-- 2. Memory Evidence");
    const poisonedM3Sql =
      parts[0] +
      "\n-- INJECTED CONTROLLED FAILURE\nINTENTIONALLY_INVALID_SQL_STATEMENT;\n-- 2. Memory Evidence" +
      parts[1];

    expect(() => {
      db.rawDb.exec("BEGIN IMMEDIATE;");
      try {
        db.rawDb.exec(poisonedM3Sql);
        db.rawDb
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, ?, ?)")
          .run(m3.name, now);
        db.rawDb.exec("COMMIT;");
      } catch (err) {
        db.rawDb.exec("ROLLBACK;");
        throw err;
      }
    }).toThrow();

    // 3. Verify rollback: schema version remains 2, no partial tables or indexes exist
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(2);

    const memTable = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'engineering_memories'",
      )
      .get();
    expect(memTable).toBeUndefined();

    const edgeIdx = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_graph_edges_repo_scan_id'",
      )
      .get();
    expect(edgeIdx).toBeUndefined();

    // Existing repository and scan run are 100% intact
    const scanCount = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM scan_runs WHERE repository_id = ?")
      .get(repoId) as { c: number };
    expect(scanCount.c).toBe(1);

    // 4. Subsequent valid migration 003 execution succeeds cleanly!
    const recoveryRes = runMigrations(db.rawDb);
    expect(recoveryRes.applied).toBe(1);
    expect(recoveryRes.currentVersion).toBe(3);
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(3);

    const recoveredTable = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'engineering_memories'",
      )
      .get();
    expect(recoveredTable).toBeDefined();

    const fkCheck = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(fkCheck).toHaveLength(0);
  });

  it("4. enforces engineering_memories repository isolation, foreign keys, and supersession constraints", () => {
    runMigrations(db.rawDb);

    // Create 2 repositories
    const r1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_alpha', '/repos/a', 'Alpha', ?, ?, 3)",
      )
      .run(now, now);
    const repo1Id = Number(r1.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_beta', '/repos/b', 'Beta', ?, ?, 3)",
      )
      .run(now, now);
    const repo2Id = Number(r2.lastInsertRowid);

    // Scan runs
    const s1 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    const scan1Id = Number(s1.lastInsertRowid);

    const s2 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo2Id, now);
    const scan2Id = Number(s2.lastInsertRowid);

    // Valid memory in Repo 1
    const mem1Res = db.rawDb
      .prepare(
        `INSERT INTO engineering_memories (
          repository_id, memory_key, category, title, content, confidence, confidence_tier,
          status, first_seen_scan_id, last_seen_scan_id, version, created_at, updated_at, last_verified_at
        ) VALUES (?, 'auth_modular', 'architectural_knowledge', 'Modular Auth', 'Uses middleware', 1.0, 'CONFIRMED', 'ACTIVE', ?, ?, 1, ?, ?, ?)`,
      )
      .run(repo1Id, scan1Id, scan1Id, now, now, now);
    const mem1Id = Number(mem1Res.lastInsertRowid);

    // Adversarial: Cross-repo scan reference (mem in repo 1 referencing scan 2 from repo 2) -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, first_seen_scan_id, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'bad_scan_mem', 'architectural_knowledge', 'Bad Scan', 'content', 1.0, 'CONFIRMED', 'ACTIVE', ?, 1, ?, ?, ?)`,
        )
        .run(repo1Id, scan2Id, now, now, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Valid memory in Repo 2
    const mem2Res = db.rawDb
      .prepare(
        `INSERT INTO engineering_memories (
          repository_id, memory_key, category, title, content, confidence, confidence_tier,
          status, first_seen_scan_id, version, created_at, updated_at, last_verified_at
        ) VALUES (?, 'db_sqlite', 'architectural_decision', 'SQLite persistence', 'content', 1.0, 'CONFIRMED', 'ACTIVE', ?, 1, ?, ?, ?)`,
      )
      .run(repo2Id, scan2Id, now, now, now);
    const mem2Id = Number(mem2Res.lastInsertRowid);

    // Adversarial: Self-supersession (mem1 superseded_by_id = mem1) -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(mem1Id, mem1Id);
    }).toThrow(/CHECK constraint failed|self-supersession is prohibited/);

    // Adversarial: Cross-repo supersession (mem1 in repo 1 superseded_by_id = mem2 in repo 2) -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(mem2Id, mem1Id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Duplicate memory key within same repository -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'auth_modular', 'architectural_knowledge', 'Duplicate Key', 'content', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)`,
        )
        .run(repo1Id, now, now, now);
    }).toThrow(
      /UNIQUE constraint failed: engineering_memories.repository_id, engineering_memories.memory_key/,
    );

    // Same memory key in DIFFERENT repository -> PERMITTED
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'auth_modular', 'architectural_knowledge', 'Other Repo Key', 'content', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)`,
        )
        .run(repo2Id, now, now, now);
    }).not.toThrow();
  });

  it("5. verifies graph-edge and graph-node composite parent key correctness and cross-scan/cross-repo rejection", () => {
    runMigrations(db.rawDb);

    const r1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_1', '/repos/1', 'R1', ?, ?, 3)",
      )
      .run(now, now);
    const repo1Id = Number(r1.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_2', '/repos/2', 'R2', ?, ?, 3)",
      )
      .run(now, now);
    const repo2Id = Number(r2.lastInsertRowid);

    // Scans in Repo 1
    const s1Res = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    const scan1Id = Number(s1Res.lastInsertRowid);

    const s1bRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    const scan1bId = Number(s1bRes.lastInsertRowid);

    // Scan in Repo 2
    const s2Res = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo2Id, now);
    const scan2Id = Number(s2Res.lastInsertRowid);

    // Graph node & edge in Repo 1 Scan 1
    const node1Res = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name) VALUES (?, ?, 'node_auth', 'component', 'auth')",
      )
      .run(repo1Id, scan1Id);
    const node1Id = Number(node1Res.lastInsertRowid);

    const edge1Res = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, confidence, relationship_status, created_at) VALUES (?, ?, 'edge_auth', ?, ?, 'CONTAINS', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, node1Id, node1Id, now);
    const edge1Id = Number(edge1Res.lastInsertRowid);

    // Graph node & edge in Repo 1 Scan 1b (same repo, different scan)
    const node1bRes = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name) VALUES (?, ?, 'node_auth_b', 'component', 'auth_b')",
      )
      .run(repo1Id, scan1bId);
    const node1bId = Number(node1bRes.lastInsertRowid);

    const edge1bRes = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, confidence, relationship_status, created_at) VALUES (?, ?, 'edge_auth_b', ?, ?, 'CONTAINS', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1bId, node1bId, node1bId, now);
    const edge1bId = Number(edge1bRes.lastInsertRowid);

    // Graph node & edge in Repo 2 Scan 2
    const node2Res = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name) VALUES (?, ?, 'node_repo2', 'component', 'comp2')",
      )
      .run(repo2Id, scan2Id);
    const node2Id = Number(node2Res.lastInsertRowid);

    const edge2Res = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, confidence, relationship_status, created_at) VALUES (?, ?, 'edge_repo2', ?, ?, 'CONTAINS', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo2Id, scan2Id, node2Id, node2Id, now);
    const edge2Id = Number(edge2Res.lastInsertRowid);

    // Memory in Repo 1
    const mem1Res = db.rawDb
      .prepare(
        "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k1', 'architectural_knowledge', 'T1', 'C1', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
      )
      .run(repo1Id, now, now, now);
    const mem1Id = Number(mem1Res.lastInsertRowid);

    // 1. Valid evidence in Repo 1 linking mem1, scan1, node1, edge1 -> SUCCEEDS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, line_start, line_end,
            graph_node_id, graph_edge_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', 1, 20, ?, ?, 'Auth evidence', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, node1Id, edge1Id, now);
    }).not.toThrow();

    // 2. Non-existent graph node -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_node_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', 999999, 'Invalid node', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 3. Non-existent graph edge -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_edge_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', 999999, 'Invalid edge', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 4. Cross-scan graph node (node from scan 1b inserted with evidence referencing scan 1) -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_node_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', ?, 'Cross-scan node', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, node1bId, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 5. Cross-scan graph edge (edge from scan 1b inserted with evidence referencing scan 1) -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_edge_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', ?, 'Cross-scan edge', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, edge1bId, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 6. Cross-repository graph node (node from repo 2 scan 2 into repo 1 scan 1) -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_node_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', ?, 'Cross-repo node', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, node2Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 7. Cross-repository graph edge (edge from repo 2 scan 2 into repo 1 scan 1) -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path, graph_edge_id, description, confidence, is_contradictory, created_at
          ) VALUES (?, ?, ?, 'source_file', 'src/auth.ts', ?, 'Cross-repo edge', 1.0, 0, ?)`,
        )
        .run(repo1Id, mem1Id, scan1Id, edge2Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("6. enforces memory-version immutability via triggers and validates transactional version creation", () => {
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_imm', '/r', 'R', ?, ?, 3)",
      )
      .run(now, now);
    const repoId = Number(r.lastInsertRowid);

    const s = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    const scanId = Number(s.lastInsertRowid);

    const m = db.rawDb
      .prepare(
        "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k1', 'architectural_knowledge', 'V1 Title', 'V1 Content', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
      )
      .run(repoId, now, now, now);
    const memId = Number(m.lastInsertRowid);

    // Insert version 1
    const v1Res = db.rawDb
      .prepare(
        `INSERT INTO memory_versions (
          repository_id, memory_id, version, title, content, status, previous_content_hash, new_content_hash, change_reason, source_scan_id, created_at
        ) VALUES (?, ?, 1, 'V1 Title', 'V1 Content', 'ACTIVE', NULL, 'hash1', 'Initial', ?, ?)`,
      )
      .run(repoId, memId, scanId, now);
    const v1Id = Number(v1Res.lastInsertRowid);

    // 1. Direct UPDATE on memory_versions must be rejected by trigger
    expect(() => {
      db.rawDb.prepare("UPDATE memory_versions SET title = 'Altered Title' WHERE id = ?").run(v1Id);
    }).toThrow(/memory_versions records are immutable and cannot be updated/);

    // 2. Direct DELETE on memory_versions must be rejected by trigger while parent memory exists
    expect(() => {
      db.rawDb.prepare("DELETE FROM memory_versions WHERE id = ?").run(v1Id);
    }).toThrow(/Direct deletion of memory_versions is prohibited; versions are immutable/);

    // 3. Transactional version creation:
    // Read current memory -> insert v2 -> update memory version to 2
    db.rawDb.exec("BEGIN IMMEDIATE;");
    const current = db.rawDb
      .prepare("SELECT version, content FROM engineering_memories WHERE id = ?")
      .get(memId) as { version: number; content: string };
    expect(current.version).toBe(1);

    db.rawDb
      .prepare(
        `INSERT INTO memory_versions (
          repository_id, memory_id, version, title, content, status, previous_content_hash, new_content_hash, change_reason, source_scan_id, created_at
        ) VALUES (?, ?, 2, 'V2 Title', 'V2 Content', 'ACTIVE', 'hash1', 'hash2', 'Updated', ?, ?)`,
      )
      .run(repoId, memId, scanId, now);

    db.rawDb
      .prepare(
        "UPDATE engineering_memories SET version = 2, content = 'V2 Content', updated_at = ? WHERE id = ?",
      )
      .run(now, memId);
    db.rawDb.exec("COMMIT;");

    const updated = db.rawDb
      .prepare("SELECT version, content FROM engineering_memories WHERE id = ?")
      .get(memId) as { version: number; content: string };
    expect(updated.version).toBe(2);
    expect(updated.content).toBe("V2 Content");

    const vCount = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM memory_versions WHERE memory_id = ?")
      .get(memId) as { c: number };
    expect(vCount.c).toBe(2);

    // 4. Failed transaction leaves both memory and versions unchanged
    expect(() => {
      db.rawDb.exec("BEGIN IMMEDIATE;");
      try {
        db.rawDb
          .prepare(
            "UPDATE engineering_memories SET version = 3, content = 'V3 Failed' WHERE id = ?",
          )
          .run(memId);
        // Intentional error: duplicate version 2
        db.rawDb
          .prepare(
            `INSERT INTO memory_versions (
              repository_id, memory_id, version, title, content, status, previous_content_hash, new_content_hash, change_reason, source_scan_id, created_at
            ) VALUES (?, ?, 2, 'V2 Duplicate', 'V2 Content', 'ACTIVE', 'hash2', 'hash3', 'Fail', ?, ?)`,
          )
          .run(repoId, memId, scanId, now);
        db.rawDb.exec("COMMIT;");
      } catch (err) {
        db.rawDb.exec("ROLLBACK;");
        throw err;
      }
    }).toThrow();

    const afterFail = db.rawDb
      .prepare("SELECT version, content FROM engineering_memories WHERE id = ?")
      .get(memId) as { version: number; content: string };
    expect(afterFail.version).toBe(2);
    expect(afterFail.content).toBe("V2 Content");
  });

  it("7. enforces engineering_memories lifecycle state transitions and initial status via triggers", () => {
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_trans', '/r', 'R', ?, ?, 3)",
      )
      .run(now, now);
    const repoId = Number(r.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_trans2', '/r2', 'R2', ?, ?, 3)",
      )
      .run(now, now);
    const repo2Id = Number(r2.lastInsertRowid);

    function createActiveMemory(rid = repoId): number {
      const res = db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, ?, 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)`,
        )
        .run(rid, `key_${Math.random()}`, now, now, now);
      return Number(res.lastInsertRowid);
    }

    // 0. Direct SQL initial state enforcement tests
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_sup', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'SUPERSEDED', 1, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial status: newly created memories must start in ACTIVE status/);

    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_arc', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'ARCHIVED', 1, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial status: newly created memories must start in ACTIVE status/);

    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_stl', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'STALE', 1, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial status: newly created memories must start in ACTIVE status/);

    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_dsp', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'DISPUTED', 1, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial status: newly created memories must start in ACTIVE status/);

    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, superseded_by_id, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_sup_id', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'ACTIVE', 1, 999, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial state: newly created memories cannot specify superseded_by_id/);

    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO engineering_memories (
            repository_id, memory_key, category, title, content, confidence, confidence_tier,
            status, version, created_at, updated_at, last_verified_at
          ) VALUES (?, 'k_init_ver2', 'architectural_knowledge', 'Title', 'Content', 1.0, 'CONFIRMED', 'ACTIVE', 2, ?, ?, ?)`,
        )
        .run(repoId, now, now, now);
    }).toThrow(/Illegal initial version: newly created memories must start at version 1/);

    // 1. Valid transitions from ACTIVE
    const a1 = createActiveMemory();
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(a1),
    ).not.toThrow();

    const a2 = createActiveMemory();
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(a2),
    ).not.toThrow();

    const replacement1 = createActiveMemory();
    const a3 = createActiveMemory();
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(replacement1, a3),
    ).not.toThrow();

    const a4 = createActiveMemory();
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?").run(a4),
    ).not.toThrow();

    // 2. Valid transitions from STALE
    const s1 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(s1);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ACTIVE' WHERE id = ?").run(s1),
    ).not.toThrow();

    const s2 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(s2);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(s2),
    ).not.toThrow();

    const s3 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(s3);
    const replacement2 = createActiveMemory();
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(replacement2, s3),
    ).not.toThrow();

    const s4 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(s4);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?").run(s4),
    ).not.toThrow();

    // 3. Valid transitions from DISPUTED
    const d1 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(d1);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ACTIVE' WHERE id = ?").run(d1),
    ).not.toThrow();

    const d2 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(d2);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(d2),
    ).not.toThrow();

    const d3 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(d3);
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?").run(d3),
    ).not.toThrow();

    const d4 = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(d4);
    const replacement3 = createActiveMemory();
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(replacement3, d4),
    ).not.toThrow();

    // 4. Forbidden transitions from terminal state SUPERSEDED
    const supReplacement = createActiveMemory();
    const sup = createActiveMemory();
    db.rawDb
      .prepare(
        "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
      )
      .run(supReplacement, sup);

    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ACTIVE' WHERE id = ?").run(sup),
    ).toThrow(
      /Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(sup),
    ).toThrow(
      /Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?").run(sup),
    ).toThrow(
      /Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed/,
    );

    // 4.1 Superseded memory cannot silently change or clear its replacement
    const anotherActive = createActiveMemory();
    expect(() =>
      db.rawDb
        .prepare("UPDATE engineering_memories SET superseded_by_id = ? WHERE id = ?")
        .run(anotherActive, sup),
    ).toThrow(
      /Illegal supersession mutation: a SUPERSEDED memory cannot change or clear its replacement/,
    );
    expect(() =>
      db.rawDb
        .prepare("UPDATE engineering_memories SET superseded_by_id = NULL WHERE id = ?")
        .run(sup),
    ).toThrow(
      /Illegal supersession mutation: a SUPERSEDED memory cannot change or clear its replacement/,
    );

    // 5. Forbidden transitions from terminal state ARCHIVED
    const arc = createActiveMemory();
    db.rawDb.prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?").run(arc);

    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'ACTIVE' WHERE id = ?").run(arc),
    ).toThrow(
      /Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'STALE' WHERE id = ?").run(arc),
    ).toThrow(
      /Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb.prepare("UPDATE engineering_memories SET status = 'DISPUTED' WHERE id = ?").run(arc),
    ).toThrow(
      /Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(anotherActive, arc),
    ).toThrow(
      /Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed/,
    );
    expect(() =>
      db.rawDb
        .prepare("UPDATE engineering_memories SET superseded_by_id = ? WHERE id = ?")
        .run(anotherActive, arc),
    ).toThrow(/Illegal state: an ARCHIVED memory cannot specify superseded_by_id/);

    // 6. Adversarial Supersession Tests
    const targetMem = createActiveMemory();

    // 6.1 Cannot enter SUPERSEDED without non-null superseded_by_id
    expect(() =>
      db.rawDb
        .prepare("UPDATE engineering_memories SET status = 'SUPERSEDED' WHERE id = ?")
        .run(targetMem),
    ).toThrow(/Illegal supersession: a SUPERSEDED memory must have a non-null superseded_by_id/);

    // 6.2 Self-supersession prohibited
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(targetMem, targetMem),
    ).toThrow(/CHECK constraint failed|self-supersession is prohibited/);

    // 6.3 Cross-repository replacement fails composite foreign key
    const crossRepoMem = createActiveMemory(repo2Id);
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(crossRepoMem, targetMem),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // 6.4 Replacement cannot be ARCHIVED
    const archivedReplacement = createActiveMemory();
    db.rawDb
      .prepare("UPDATE engineering_memories SET status = 'ARCHIVED' WHERE id = ?")
      .run(archivedReplacement);
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(archivedReplacement, targetMem),
    ).toThrow(
      /Illegal supersession: replacement memory cannot be in SUPERSEDED or ARCHIVED status/,
    );

    // 6.5 Replacement cannot be SUPERSEDED
    expect(() =>
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(sup, targetMem),
    ).toThrow(
      /Illegal supersession: replacement memory cannot be in SUPERSEDED or ARCHIVED status/,
    );

    // 6.6 Non-SUPERSEDED memories cannot have superseded_by_id
    expect(() =>
      db.rawDb
        .prepare("UPDATE engineering_memories SET superseded_by_id = ? WHERE id = ?")
        .run(anotherActive, targetMem),
    ).toThrow(/Illegal state: only SUPERSEDED memories can specify superseded_by_id/);

    // 6.7 Deleting a replacement is prevented by trigger
    const validSup = createActiveMemory();
    const validRepl = createActiveMemory();
    db.rawDb
      .prepare(
        "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
      )
      .run(validRepl, validSup);

    expect(() =>
      db.rawDb.prepare("DELETE FROM engineering_memories WHERE id = ?").run(validRepl),
    ).toThrow(
      /Illegal operation: cannot delete a memory that is currently a replacement for superseded memories/,
    );
  });

  it("8. clarifies evolution-event chronology and verifies database boundaries", () => {
    runMigrations(db.rawDb);

    const r1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_ev1', '/repos/ev1', 'EV1', ?, ?, 3)",
      )
      .run(now, now);
    const repo1Id = Number(r1.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_ev2', '/repos/ev2', 'EV2', ?, ?, 3)",
      )
      .run(now, now);
    const repo2Id = Number(r2.lastInsertRowid);

    const s1 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, "2026-11-13T01:00:00.000Z");
    const scan1Id = Number(s1.lastInsertRowid);

    const s2 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, "2026-11-13T02:00:00.000Z");
    const scan2Id = Number(s2.lastInsertRowid);

    const s3 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo2Id, "2026-11-13T03:00:00.000Z");
    const scan3Id = Number(s3.lastInsertRowid);

    // 1. Database enforces distinct scans: Base scan == Target scan -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO evolution_events (
            repository_id, base_scan_id, target_scan_id, event_type, category, title, description,
            severity, confidence, confidence_tier, created_at
          ) VALUES (?, ?, ?, 'SAME_SCAN', 'file', 'Same scan', 'desc', 'INFO', 1.0, 'CONFIRMED', ?)`,
        )
        .run(repo1Id, scan1Id, scan1Id, now);
    }).toThrow(/CHECK constraint failed: base_scan_id != target_scan_id/);

    // 2. Database enforces same repository: mixing scans from different repositories -> REJECT
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO evolution_events (
            repository_id, base_scan_id, target_scan_id, event_type, category, title, description,
            severity, confidence, confidence_tier, created_at
          ) VALUES (?, ?, ?, 'CROSS_REPO', 'file', 'Cross repo scan', 'desc', 'INFO', 1.0, 'CONFIRMED', ?)`,
        )
        .run(repo1Id, scan1Id, scan3Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 3. Valid evolution event between scan 1 (earlier) and scan 2 (later) -> SUCCEEDS
    expect(() => {
      db.rawDb
        .prepare(
          `INSERT INTO evolution_events (
            repository_id, base_scan_id, target_scan_id, event_type, category, title, description,
            severity, confidence, confidence_tier, details_json, created_at
          ) VALUES (?, ?, ?, 'FILE_ADDED', 'file', 'File added', 'src/new.ts added', 'INFO', 1.0, 'CONFIRMED', '{"path":"src/new.ts"}', ?)`,
        )
        .run(repo1Id, scan1Id, scan2Id, now);
    }).not.toThrow();
  });

  it("9. validates populated repository cascade and scan retention isolation", () => {
    runMigrations(db.rawDb);

    // Setup 2 repositories
    const r1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_pop1', '/r1', 'R1', ?, ?, 3)",
      )
      .run(now, now);
    const repo1Id = Number(r1.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_pop2', '/r2', 'R2', ?, ?, 3)",
      )
      .run(now, now);
    const repo2Id = Number(r2.lastInsertRowid);

    // Scans in Repo 1
    const s1 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    const scan1Id = Number(s1.lastInsertRowid);

    const s2 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    const scan2Id = Number(s2.lastInsertRowid);

    // Scan in Repo 2
    const s3 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repo2Id, now);
    const scan3Id = Number(s3.lastInsertRowid);

    // Graph node & edge in Repo 1 Scan 1
    const n1 = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name) VALUES (?, ?, 'n1', 'file', 'a.ts')",
      )
      .run(repo1Id, scan1Id);
    const node1Id = Number(n1.lastInsertRowid);

    const e1 = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, confidence, relationship_status, created_at) VALUES (?, ?, 'e1', ?, ?, 'CONTAINS', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, node1Id, node1Id, now);
    const edge1Id = Number(e1.lastInsertRowid);

    // Memories in Repo 1
    const m1 = db.rawDb
      .prepare(
        `INSERT INTO engineering_memories (
          repository_id, memory_key, category, title, content, confidence, confidence_tier, status, first_seen_scan_id, version, created_at, updated_at, last_verified_at
        ) VALUES (?, 'k1', 'architectural_knowledge', 'T1', 'C1', 1.0, 'CONFIRMED', 'ACTIVE', ?, 1, ?, ?, ?)`,
      )
      .run(repo1Id, scan1Id, now, now, now);
    const mem1Id = Number(m1.lastInsertRowid);

    const m2 = db.rawDb
      .prepare(
        `INSERT INTO engineering_memories (
          repository_id, memory_key, category, title, content, confidence, confidence_tier, status, first_seen_scan_id, version, created_at, updated_at, last_verified_at
        ) VALUES (?, 'k2', 'architectural_knowledge', 'T2', 'C2', 1.0, 'CONFIRMED', 'ACTIVE', ?, 1, ?, ?, ?)`,
      )
      .run(repo1Id, scan1Id, now, now, now);
    const mem2Id = Number(m2.lastInsertRowid);

    // Memory in Repo 2
    const m3 = db.rawDb
      .prepare(
        `INSERT INTO engineering_memories (
          repository_id, memory_key, category, title, content, confidence, confidence_tier, status, first_seen_scan_id, version, created_at, updated_at, last_verified_at
        ) VALUES (?, 'k3', 'architectural_knowledge', 'T3', 'C3', 1.0, 'CONFIRMED', 'ACTIVE', ?, 1, ?, ?, ?)`,
      )
      .run(repo2Id, scan3Id, now, now, now);
    const mem3Id = Number(m3.lastInsertRowid);

    // Evidence for Scan 1 and Scan 2
    db.rawDb
      .prepare(
        "INSERT INTO memory_evidence (repository_id, memory_id, scan_id, evidence_type, source_path, graph_node_id, graph_edge_id, description, confidence, is_contradictory, created_at) VALUES (?, ?, ?, 'source_file', 'a.ts', ?, ?, 'Desc', 1.0, 0, ?)",
      )
      .run(repo1Id, mem1Id, scan1Id, node1Id, edge1Id, now);

    db.rawDb
      .prepare(
        "INSERT INTO memory_evidence (repository_id, memory_id, scan_id, evidence_type, source_path, description, confidence, is_contradictory, created_at) VALUES (?, ?, ?, 'source_file', 'b.ts', 'Scan 2 only evidence', 1.0, 0, ?)",
      )
      .run(repo1Id, mem1Id, scan2Id, now);

    db.rawDb
      .prepare(
        "INSERT INTO memory_relationships (repository_id, source_memory_id, target_memory_id, relationship_type, created_at) VALUES (?, ?, ?, 'RELATES_TO', ?)",
      )
      .run(repo1Id, mem1Id, mem2Id, now);

    db.rawDb
      .prepare(
        "INSERT INTO memory_versions (repository_id, memory_id, version, title, content, status, new_content_hash, change_reason, source_scan_id, created_at) VALUES (?, ?, 1, 'T1', 'C1', 'ACTIVE', 'h1', 'init', ?, ?)",
      )
      .run(repo1Id, mem1Id, scan1Id, now);

    db.rawDb
      .prepare(
        "INSERT INTO evolution_events (repository_id, base_scan_id, target_scan_id, event_type, category, title, description, severity, confidence, confidence_tier, created_at) VALUES (?, ?, ?, 'FILE_ADDED', 'file', 'T', 'D', 'INFO', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, scan2Id, now);

    // 1. Deleting historical scan 1 while memory/version references it is BLOCKED by ON DELETE RESTRICT
    expect(() => {
      db.rawDb.prepare("DELETE FROM scan_runs WHERE id = ?").run(scan1Id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 2. Scan 2 has only snapshot-owned evidence (not referenced by memories/versions as first_seen/source_scan).
    // Deleting scan 2 succeeds and follows the documented cascade policy (cascading scan 2 evidence and evolution events)
    expect(() => {
      db.rawDb.prepare("DELETE FROM scan_runs WHERE id = ?").run(scan2Id);
    }).not.toThrow();

    const evScan2 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM memory_evidence WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    expect(evScan2.c).toBe(0);

    // Scan 1 and its memory/version remain fully intact
    const scan1Check = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM scan_runs WHERE id = ?")
      .get(scan1Id) as { c: number };
    expect(scan1Check.c).toBe(1);

    // 3. Deleting populated repository 1 cascades and cleans up all remaining records
    expect(() => {
      db.rawDb.prepare("DELETE FROM repositories WHERE id = ?").run(repo1Id);
    }).not.toThrow();

    // Verify all repo 1 entities are gone
    const memCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM engineering_memories WHERE repository_id = ?")
      .get(repo1Id) as { c: number };
    const evCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM memory_evidence WHERE repository_id = ?")
      .get(repo1Id) as { c: number };
    const relCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM memory_relationships WHERE repository_id = ?")
      .get(repo1Id) as { c: number };
    const verCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM memory_versions WHERE repository_id = ?")
      .get(repo1Id) as { c: number };
    const evtCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM evolution_events WHERE repository_id = ?")
      .get(repo1Id) as { c: number };
    const scanCount1 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM scan_runs WHERE repository_id = ?")
      .get(repo1Id) as { c: number };

    expect(memCount1.c).toBe(0);
    expect(evCount1.c).toBe(0);
    expect(relCount1.c).toBe(0);
    expect(verCount1.c).toBe(0);
    expect(evtCount1.c).toBe(0);
    expect(scanCount1.c).toBe(0);

    // 4. Verify Repo 2 is completely intact
    const memCount2 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM engineering_memories WHERE repository_id = ?")
      .get(repo2Id) as { c: number };
    const scanCount2 = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM scan_runs WHERE repository_id = ?")
      .get(repo2Id) as { c: number };
    expect(memCount2.c).toBe(1);
    expect(scanCount2.c).toBe(1);
  });

  it("10. validates database reopen and on-disk file persistence", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-test-stage2-"));
    const diskDbPath = path.join(tmpDir, "index.sqlite");

    try {
      const diskDb = new SqliteDatabase({ path: diskDbPath });
      runMigrations(diskDb.rawDb);

      const r = diskDb.rawDb
        .prepare(
          "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('persist_repo', '/p', 'Persist', ?, ?, 3)",
        )
        .run(now, now);
      const repoId = Number(r.lastInsertRowid);

      diskDb.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'p_key', 'architectural_knowledge', 'Persistent Memory', 'Preserved across reopen', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);

      diskDb.close();

      // Reopen database from disk
      const reopenedDb = new SqliteDatabase({ path: diskDbPath });
      expect(getCurrentSchemaVersion(reopenedDb.rawDb)).toBe(3);

      const mem = reopenedDb.rawDb
        .prepare(
          "SELECT title, content, status FROM engineering_memories WHERE repository_id = ? AND memory_key = 'p_key'",
        )
        .get(repoId) as { title: string; content: string; status: string };

      expect(mem.title).toBe("Persistent Memory");
      expect(mem.content).toBe("Preserved across reopen");
      expect(mem.status).toBe("ACTIVE");

      const check = reopenedDb.integrityCheck();
      expect(check.ok).toBe(true);

      reopenedDb.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("11. verifies index usage with EXPLAIN QUERY PLAN for representative queries", () => {
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_idx', '/idx', 'IDX', ?, ?, 3)",
      )
      .run(now, now);
    const repoId = Number(r.lastInsertRowid);

    const s = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    const scanId = Number(s.lastInsertRowid);

    // Plan 1: engineering_memories by repository, category, status
    const plan1 = db.rawDb
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM engineering_memories WHERE repository_id = ${repoId} AND category = 'architectural_knowledge' AND status = 'ACTIVE'`,
      )
      .all() as { detail: string }[];
    expect(plan1[0].detail).toMatch(/USING INDEX idx_memories_repo_cat_status/);

    // Plan 2: engineering_memories by repository and memory_key
    const plan2 = db.rawDb
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM engineering_memories WHERE repository_id = ${repoId} AND memory_key = 'key'`,
      )
      .all() as { detail: string }[];
    expect(plan2[0].detail).toMatch(/USING INDEX sqlite_autoindex_engineering_memories_1/);

    // Plan 3: memory_evidence by memory_id
    const plan3 = db.rawDb
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM memory_evidence WHERE memory_id = 1")
      .all() as { detail: string }[];
    expect(plan3[0].detail).toMatch(/USING INDEX idx_memory_evidence_memory/);

    // Plan 4: memory_evidence by repository_id and scan_id
    const plan4 = db.rawDb
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM memory_evidence WHERE repository_id = ${repoId} AND scan_id = ${scanId}`,
      )
      .all() as { detail: string }[];
    expect(plan4[0].detail).toMatch(/USING INDEX idx_memory_evidence_repo_scan/);

    // Plan 5: evolution_events by repository_id and target_scan_id
    const plan5 = db.rawDb
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM evolution_events WHERE repository_id = ${repoId} AND target_scan_id = ${scanId}`,
      )
      .all() as { detail: string }[];
    expect(plan5[0].detail).toMatch(/USING INDEX idx_evolution_events_target/);

    // Plan 6: memory_relationships by source_memory_id
    const plan6 = db.rawDb
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM memory_relationships WHERE source_memory_id = 1")
      .all() as { detail: string }[];
    expect(plan6[0].detail).toMatch(/USING INDEX idx_memory_relationships_source/);

    // Plan 7: memory_versions by memory_id and version
    const plan7 = db.rawDb
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM memory_versions WHERE memory_id = 1 AND version = 1",
      )
      .all() as { detail: string }[];
    expect(plan7[0].detail).toMatch(/USING INDEX sqlite_autoindex_memory_versions_1/);
  });

  it("12. rejects invalid domain values, confidence intervals, categories, and statuses via database CHECK constraints", () => {
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_chk', '/chk', 'CHK', ?, ?, 3)",
      )
      .run(now, now);
    const repoId = Number(r.lastInsertRowid);

    const s1 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    const scan1Id = Number(s1.lastInsertRowid);

    const s2 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    const scan2Id = Number(s2.lastInsertRowid);

    // Invalid memory category
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_bad_cat', 'INVALID_CAT', 'T', 'C', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);
    }).toThrow(/CHECK constraint failed/);

    // Invalid memory status
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_bad_stat', 'architectural_knowledge', 'T', 'C', 1.0, 'CONFIRMED', 'DELETED', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);
    }).toThrow(/CHECK constraint failed|newly created memories must start in ACTIVE status/);

    // Invalid confidence tier
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_bad_tier', 'architectural_knowledge', 'T', 'C', 1.0, 'SUPER_CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);
    }).toThrow(/CHECK constraint failed/);

    // Confidence out of range (< 0.0)
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_bad_conf', 'architectural_knowledge', 'T', 'C', -0.1, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);
    }).toThrow(/CHECK constraint failed/);

    // Confidence out of range (> 1.0)
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_bad_conf2', 'architectural_knowledge', 'T', 'C', 1.5, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
        )
        .run(repoId, now, now, now);
    }).toThrow(/CHECK constraint failed/);

    // Insert valid memory for evidence tests
    const memRes = db.rawDb
      .prepare(
        "INSERT INTO engineering_memories (repository_id, memory_key, category, title, content, confidence, confidence_tier, status, version, created_at, updated_at, last_verified_at) VALUES (?, 'k_valid', 'architectural_knowledge', 'T', 'C', 1.0, 'CONFIRMED', 'ACTIVE', 1, ?, ?, ?)",
      )
      .run(repoId, now, now, now);
    const memId = Number(memRes.lastInsertRowid);

    // Invalid evidence type
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO memory_evidence (repository_id, memory_id, scan_id, evidence_type, source_path, description, confidence, is_contradictory, created_at) VALUES (?, ?, ?, 'INVALID_TYPE', 'a.ts', 'D', 1.0, 0, ?)",
        )
        .run(repoId, memId, scan1Id, now);
    }).toThrow(/CHECK constraint failed/);

    // Invalid evolution category
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO evolution_events (repository_id, base_scan_id, target_scan_id, event_type, category, title, description, severity, confidence, confidence_tier, created_at) VALUES (?, ?, ?, 'EV', 'INVALID_CAT', 'T', 'D', 'INFO', 1.0, 'CONFIRMED', ?)",
        )
        .run(repoId, scan1Id, scan2Id, now);
    }).toThrow(/CHECK constraint failed/);

    // Invalid evolution severity
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO evolution_events (repository_id, base_scan_id, target_scan_id, event_type, category, title, description, severity, confidence, confidence_tier, created_at) VALUES (?, ?, ?, 'EV', 'file', 'T', 'D', 'DISASTER', 1.0, 'CONFIRMED', ?)",
        )
        .run(repoId, scan1Id, scan2Id, now);
    }).toThrow(/CHECK constraint failed/);

    // Invalid relationship type
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO memory_relationships (repository_id, source_memory_id, target_memory_id, relationship_type, created_at) VALUES (?, ?, ?, 'LOVES', ?)",
        )
        .run(repoId, memId, memId + 1, now);
    }).toThrow(/CHECK constraint failed/);
  });
});
