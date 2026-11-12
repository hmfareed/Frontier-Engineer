import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import {
  runMigrations,
  getCurrentSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from "../../scripts/storage/schema/migration-runner.ts";

describe("storage-cross-scan-integrity (Snapshot Foreign-Key Boundary Enforcement)", () => {
  let db: SqliteDatabase;
  const now = new Date().toISOString();

  let repo1Id: number;
  let repo2Id: number;
  let scan1Id: number; // Repo 1 Scan 1
  let scan2Id: number; // Repo 1 Scan 2
  let scan3Id: number; // Repo 2 Scan 3

  let file1Id: number; // Repo 1 Scan 1
  let file2Id: number; // Repo 1 Scan 1
  let file3Id: number; // Repo 1 Scan 2
  let file4Id: number; // Repo 2 Scan 3

  let sym1Id: number; // Repo 1 Scan 1
  let sym2Id: number; // Repo 1 Scan 2

  let ev1Id: number; // Repo 1 Scan 1
  let ev2Id: number; // Repo 1 Scan 2

  let node1Id: number; // Repo 1 Scan 1
  let node2Id: number; // Repo 1 Scan 1
  let node3Id: number; // Repo 1 Scan 2

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    // Setup 2 repositories
    const r1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_alpha", "/repos/alpha", "Alpha", now, now, CURRENT_SCHEMA_VERSION);
    repo1Id = Number(r1.lastInsertRowid);

    const r2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_beta", "/repos/beta", "Beta", now, now, CURRENT_SCHEMA_VERSION);
    repo2Id = Number(r2.lastInsertRowid);

    // Setup scans
    const s1 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    scan1Id = Number(s1.lastInsertRowid);

    const s2 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repo1Id, now);
    scan2Id = Number(s2.lastInsertRowid);

    const s3 = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repo2Id, now);
    scan3Id = Number(s3.lastInsertRowid);

    // Setup files
    const f1 = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'src/index.ts', 'src/index.ts', '.ts', 'typescript', 'source', 100, 1700000000, 'NONE', 'INDEXED', ?)",
      )
      .run(repo1Id, scan1Id, now);
    file1Id = Number(f1.lastInsertRowid);

    const f2 = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'src/utils.ts', 'src/utils.ts', '.ts', 'typescript', 'source', 200, 1700000000, 'NONE', 'INDEXED', ?)",
      )
      .run(repo1Id, scan1Id, now);
    file2Id = Number(f2.lastInsertRowid);

    const f3 = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'src/index.ts', 'src/index.ts', '.ts', 'typescript', 'source', 100, 1700000000, 'NONE', 'INDEXED', ?)",
      )
      .run(repo1Id, scan2Id, now);
    file3Id = Number(f3.lastInsertRowid);

    const f4 = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'src/index.ts', 'src/index.ts', '.ts', 'typescript', 'source', 100, 1700000000, 'NONE', 'INDEXED', ?)",
      )
      .run(repo2Id, scan3Id, now);
    file4Id = Number(f4.lastInsertRowid);

    // Setup base symbols
    const sym1 = db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, parent_symbol_id, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:alpha:s1:base', 'Base', 'class', NULL, 1, 50, 0, 1, 'fp1', 1.0, 'SUCCESS')",
      )
      .run(repo1Id, scan1Id, file1Id);
    sym1Id = Number(sym1.lastInsertRowid);

    const sym2 = db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, parent_symbol_id, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:alpha:s2:base', 'Base', 'class', NULL, 1, 50, 0, 1, 'fp2', 1.0, 'SUCCESS')",
      )
      .run(repo1Id, scan2Id, file3Id);
    sym2Id = Number(sym2.lastInsertRowid);

    // Setup base source evidence
    const ev1 = db.rawDb
      .prepare(
        "INSERT INTO source_evidence (repository_id, scan_id, file_id, symbol_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description) VALUES (?, ?, ?, ?, 'ast_definition', 1, 50, 0, 1, 1.0, 'Evidence S1')",
      )
      .run(repo1Id, scan1Id, file1Id, sym1Id);
    ev1Id = Number(ev1.lastInsertRowid);

    const ev2 = db.rawDb
      .prepare(
        "INSERT INTO source_evidence (repository_id, scan_id, file_id, symbol_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description) VALUES (?, ?, ?, ?, 'ast_definition', 1, 50, 0, 1, 1.0, 'Evidence S2')",
      )
      .run(repo1Id, scan2Id, file3Id, sym2Id);
    ev2Id = Number(ev2.lastInsertRowid);

    // Setup base graph nodes
    const n1 = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s1:file1', 'file', 'index.ts', ?, NULL)",
      )
      .run(repo1Id, scan1Id, file1Id);
    node1Id = Number(n1.lastInsertRowid);

    const n2 = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s1:file2', 'file', 'utils.ts', ?, NULL)",
      )
      .run(repo1Id, scan1Id, file2Id);
    node2Id = Number(n2.lastInsertRowid);

    const n3 = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s2:file3', 'file', 'index.ts', ?, NULL)",
      )
      .run(repo1Id, scan2Id, file3Id);
    node3Id = Number(n3.lastInsertRowid);
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("1. rejects imports whose resolved_file_id belongs to another scan or repository", () => {
    // Attempt Scan 1 import resolving to Scan 2 file (same repo, different scan)
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line) VALUES (?, ?, ?, './utils', 'value', ?, 'RESOLVED', 5, 5)",
        )
        .run(repo1Id, scan1Id, file1Id, file3Id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Attempt Scan 1 import resolving to Scan 3 file (different repo, different scan)
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line) VALUES (?, ?, ?, './utils', 'value', ?, 'RESOLVED', 5, 5)",
        )
        .run(repo1Id, scan1Id, file1Id, file4Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("2. rejects imports whose evidence_id belongs to another scan", () => {
    // Attempt Scan 1 import referencing Scan 2 evidence
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line, evidence_id) VALUES (?, ?, ?, './utils', 'value', ?, 'RESOLVED', 5, 5, ?)",
        )
        .run(repo1Id, scan1Id, file1Id, file2Id, ev2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("3. rejects graph edges whose evidence_id belongs to another scan", () => {
    // Attempt Scan 1 edge referencing Scan 2 evidence
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, evidence_id, confidence, relationship_status, created_at) VALUES (?, ?, 'edge:s1:invalid_ev', ?, ?, 'IMPORTS', ?, 1.0, 'CONFIRMED', ?)",
        )
        .run(repo1Id, scan1Id, node1Id, node2Id, ev2Id, now);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("4. rejects architecture components whose evidence_id belongs to another scan", () => {
    // Attempt Scan 1 component referencing Scan 2 evidence
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO architecture_components (repository_id, scan_id, component_identity, name, category, root_path, detection_method, confidence, status, evidence_id) VALUES (?, ?, 'comp:s1:invalid', 'Core', 'backend', 'src', 'rule', 1.0, 'CONFIRMED', ?)",
        )
        .run(repo1Id, scan1Id, ev2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("5. rejects graph nodes whose file_id belongs to another scan", () => {
    // Attempt Scan 1 node referencing Scan 2 file
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s1:cross_file', 'file', 'index.ts', ?, NULL)",
        )
        .run(repo1Id, scan1Id, file3Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("6. rejects graph nodes whose symbol_id belongs to another scan", () => {
    // Attempt Scan 1 node referencing Scan 2 symbol
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s1:cross_sym', 'symbol', 'Base', ?, ?)",
        )
        .run(repo1Id, scan1Id, file1Id, sym2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("7. rejects source evidence whose symbol_id belongs to another scan", () => {
    // Attempt Scan 1 evidence referencing Scan 2 symbol
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO source_evidence (repository_id, scan_id, file_id, symbol_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description) VALUES (?, ?, ?, ?, 'ast_definition', 10, 20, 0, 1, 1.0, 'Cross Evidence')",
        )
        .run(repo1Id, scan1Id, file1Id, sym2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("8. rejects symbols whose parent_symbol_id belongs to another scan", () => {
    // Attempt Scan 1 symbol referencing Scan 2 parent symbol
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, parent_symbol_id, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:s1:child_bad', 'Child', 'method', ?, 10, 20, 2, 4, 'fp_child', 1.0, 'SUCCESS')",
        )
        .run(repo1Id, scan1Id, file1Id, sym2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("9. rejects exports whose symbol_id or evidence_id belongs to another scan", () => {
    // Cross-scan symbol_id
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, ?, 'Base', 'class', 1, 50, ?)",
        )
        .run(repo1Id, scan1Id, file1Id, sym2Id, ev1Id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Cross-scan evidence_id
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, ?, 'Base', 'class', 1, 50, ?)",
        )
        .run(repo1Id, scan1Id, file1Id, sym1Id, ev2Id);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("10. permits valid entity insertions within the same scan", () => {
    // Valid same-scan import
    const impRes = db.rawDb
      .prepare(
        "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line, evidence_id) VALUES (?, ?, ?, './utils', 'value', ?, 'RESOLVED', 5, 5, ?)",
      )
      .run(repo1Id, scan1Id, file1Id, file2Id, ev1Id);
    expect(impRes.lastInsertRowid).toBeDefined();

    // Valid same-scan symbol child
    const symChild = db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, parent_symbol_id, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:s1:child_valid', 'Child', 'method', ?, 10, 20, 2, 4, 'fp_child', 1.0, 'SUCCESS')",
      )
      .run(repo1Id, scan1Id, file1Id, sym1Id);
    expect(symChild.lastInsertRowid).toBeDefined();

    // Valid same-scan export
    const expRes = db.rawDb
      .prepare(
        "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, ?, 'BaseExport', 'class', 1, 50, ?)",
      )
      .run(repo1Id, scan1Id, file1Id, sym1Id, ev1Id);
    expect(expRes.lastInsertRowid).toBeDefined();

    // Valid same-scan edge
    const edgeRes = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, evidence_id, confidence, relationship_status, created_at) VALUES (?, ?, 'edge:s1:valid', ?, ?, 'IMPORTS', ?, 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, node1Id, node2Id, ev1Id, now);
    expect(edgeRes.lastInsertRowid).toBeDefined();

    // Valid same-scan component
    const compRes = db.rawDb
      .prepare(
        "INSERT INTO architecture_components (repository_id, scan_id, component_identity, name, category, root_path, detection_method, confidence, status, evidence_id) VALUES (?, ?, 'comp:s1:valid', 'Core', 'backend', 'src', 'rule', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, ev1Id);
    expect(compRes.lastInsertRowid).toBeDefined();
  });

  it("11. permits nullable foreign-key fields without violating composite foreign-key constraints", () => {
    // Symbol without parent
    const symOrphan = db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, parent_symbol_id, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, 'sym:s1:root_fn', 'rootFn', 'function', NULL, 10, 20, 0, 1, 'fp_fn', 1.0, 'SUCCESS')",
      )
      .run(repo1Id, scan1Id, file1Id);
    expect(symOrphan.lastInsertRowid).toBeDefined();

    // Evidence without symbol
    const evFileOnly = db.rawDb
      .prepare(
        "INSERT INTO source_evidence (repository_id, scan_id, file_id, symbol_id, evidence_type, start_line, end_line, start_column, end_column, confidence, evidence_description) VALUES (?, ?, ?, NULL, 'file_structure', 1, 100, 0, 0, 0.9, 'File evidence')",
      )
      .run(repo1Id, scan1Id, file1Id);
    expect(evFileOnly.lastInsertRowid).toBeDefined();

    // Unresolved import (no resolved file, no evidence)
    const impUnresolved = db.rawDb
      .prepare(
        "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line, evidence_id) VALUES (?, ?, ?, 'unresolved-pkg', 'external', NULL, 'UNRESOLVED', 1, 1, NULL)",
      )
      .run(repo1Id, scan1Id, file1Id);
    expect(impUnresolved.lastInsertRowid).toBeDefined();

    // Export without symbol and without evidence
    const expReexport = db.rawDb
      .prepare(
        "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, NULL, 'wildcard', 'all', 1, 1, NULL)",
      )
      .run(repo1Id, scan1Id, file1Id);
    expect(expReexport.lastInsertRowid).toBeDefined();

    // Graph node without file and without symbol (e.g., repository or component node)
    const nodeRepo = db.rawDb
      .prepare(
        "INSERT INTO graph_nodes (repository_id, scan_id, node_identity, category, name, file_id, symbol_id) VALUES (?, ?, 'node:s1:repo', 'repository', 'Alpha', NULL, NULL)",
      )
      .run(repo1Id, scan1Id);
    expect(nodeRepo.lastInsertRowid).toBeDefined();

    // Graph edge without evidence
    const edgeDirect = db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, evidence_id, confidence, relationship_status, created_at) VALUES (?, ?, 'edge:s1:direct', ?, ?, 'CONTAINS', NULL, 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, node1Id, node2Id, now);
    expect(edgeDirect.lastInsertRowid).toBeDefined();

    // Architecture component without evidence
    const compStatic = db.rawDb
      .prepare(
        "INSERT INTO architecture_components (repository_id, scan_id, component_identity, name, category, root_path, detection_method, confidence, status, evidence_id) VALUES (?, ?, 'comp:s1:static', 'Docs', 'docs', 'docs', 'heuristic', 0.8, 'INFERRED', NULL)",
      )
      .run(repo1Id, scan1Id);
    expect(compStatic.lastInsertRowid).toBeDefined();
  });

  it("12. confirms PRAGMA foreign_key_check returns zero violations across all tables", () => {
    // Populate full suite of entities
    db.rawDb
      .prepare(
        "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line, evidence_id) VALUES (?, ?, ?, './utils', 'value', ?, 'RESOLVED', 5, 5, ?)",
      )
      .run(repo1Id, scan1Id, file1Id, file2Id, ev1Id);

    db.rawDb
      .prepare(
        "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, ?, 'Base', 'class', 1, 50, ?)",
      )
      .run(repo1Id, scan1Id, file1Id, sym1Id, ev1Id);

    db.rawDb
      .prepare(
        "INSERT INTO graph_edges (repository_id, scan_id, edge_identity, source_node_id, target_node_id, relationship_type, evidence_id, confidence, relationship_status, created_at) VALUES (?, ?, 'edge:s1:defines', ?, ?, 'DEFINES', ?, 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, node1Id, node2Id, ev1Id, now);

    db.rawDb
      .prepare(
        "INSERT INTO architecture_components (repository_id, scan_id, component_identity, name, category, root_path, detection_method, confidence, status, evidence_id) VALUES (?, ?, 'comp:s1:core', 'Core', 'backend', 'src', 'rule', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan1Id, ev1Id);

    const violations = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(violations).toHaveLength(0);
  });

  it("13. cascading delete of a scan run removes all snapshot-owned records cleanly without constraint errors", () => {
    // Add child entities in Scan 2
    db.rawDb
      .prepare(
        "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line, evidence_id) VALUES (?, ?, ?, './other', 'value', NULL, 'UNRESOLVED', 1, 1, ?)",
      )
      .run(repo1Id, scan2Id, file3Id, ev2Id);

    db.rawDb
      .prepare(
        "INSERT INTO exports (repository_id, scan_id, file_id, symbol_id, export_name, export_kind, start_line, end_line, evidence_id) VALUES (?, ?, ?, ?, 'Base2', 'class', 1, 50, ?)",
      )
      .run(repo1Id, scan2Id, file3Id, sym2Id, ev2Id);

    db.rawDb
      .prepare(
        "INSERT INTO architecture_components (repository_id, scan_id, component_identity, name, category, root_path, detection_method, confidence, status, evidence_id) VALUES (?, ?, 'comp:s2:core', 'Core2', 'backend', 'src', 'rule', 1.0, 'CONFIRMED', ?)",
      )
      .run(repo1Id, scan2Id, ev2Id);

    // Delete Scan 2 run
    db.rawDb.prepare("DELETE FROM scan_runs WHERE id = ?").run(scan2Id);

    // Verify all Scan 2 records are gone
    const s2Files = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM files WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Symbols = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM symbols WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Evidence = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM source_evidence WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Imports = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM imports WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Exports = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM exports WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Nodes = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE scan_id = ?")
      .get(scan2Id) as { c: number };
    const s2Components = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM architecture_components WHERE scan_id = ?")
      .get(scan2Id) as { c: number };

    expect(s2Files.c).toBe(0);
    expect(s2Symbols.c).toBe(0);
    expect(s2Evidence.c).toBe(0);
    expect(s2Imports.c).toBe(0);
    expect(s2Exports.c).toBe(0);
    expect(s2Nodes.c).toBe(0);
    expect(s2Components.c).toBe(0);

    // Scan 1 records remain completely intact
    const s1Files = db.rawDb
      .prepare("SELECT COUNT(*) AS c FROM files WHERE scan_id = ?")
      .get(scan1Id) as { c: number };
    expect(s1Files.c).toBe(2);

    // PRAGMA foreign_key_check remains 0
    const violations = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(violations).toHaveLength(0);
  });

  it("14. migration 002 pre-check catches corrupted cross-scan data and aborts migration atomically", () => {
    // Create an isolated fresh database
    const freshDb = new SqliteDatabase({ path: ":memory:" });

    // Apply only migration 1
    freshDb.rawDb.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const m1 = require("../../scripts/storage/schema/migration-runner.ts").MIGRATIONS[0];
    freshDb.rawDb.exec(m1.sql);
    freshDb.rawDb
      .prepare("INSERT INTO schema_migrations VALUES (1, '001-initial-schema', ?)")
      .run(now);

    // Populate valid repository and scans
    freshDb.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run("repo_corrupt", "/repo/c", "Corrupt", now, now);
    freshDb.rawDb
      .prepare(
        "INSERT INTO scan_runs (id, repository_id, started_at, status, scanner_version, extractor_version) VALUES (1, 1, ?, 'COMPLETE', '0.6.3', '0.6.3'), (2, 1, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(now, now);

    freshDb.rawDb
      .prepare(
        "INSERT INTO files (id, repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (1, 1, 1, 'a.ts', 'a.ts', '.ts', 'typescript', 'source', 10, 100, 'NONE', 'INDEXED', ?), (2, 1, 2, 'b.ts', 'b.ts', '.ts', 'typescript', 'source', 10, 100, 'NONE', 'INDEXED', ?)",
      )
      .run(now, now);

    // In v1, imports could point to a file in another scan without violating FK because FK was only on files(id)!
    freshDb.rawDb
      .prepare(
        "INSERT INTO imports (repository_id, scan_id, source_file_id, imported_specifier, import_kind, resolved_file_id, resolution_status, start_line, end_line) VALUES (1, 1, 1, './b', 'value', 2, 'RESOLVED', 1, 1)",
      )
      .run();

    // Now try running migration 2 via runMigrations
    expect(() => {
      runMigrations(freshDb.rawDb);
    }).toThrow(/CHECK constraint failed: violation_count = 0/);

    // Verify migration was rolled back and version is still 1
    expect(getCurrentSchemaVersion(freshDb.rawDb)).toBe(1);

    freshDb.close();
  });
});
