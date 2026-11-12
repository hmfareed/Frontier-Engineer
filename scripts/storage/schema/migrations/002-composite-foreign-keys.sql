-- Frontier Engineer Phase 7.3.3: Composite Foreign-Key Isolation
-- Migration: 002-composite-foreign-keys.sql
-- Tightens relational constraints so that all snapshot-owned records
-- reference entities strictly within the same repository and scan.

-- Pre-migration integrity check: verify no existing cross-scan references exist
CREATE TEMP TABLE _migration_002_precheck (
  violation_count INTEGER NOT NULL CHECK(violation_count = 0)
);

INSERT INTO _migration_002_precheck (violation_count)
SELECT (
  (SELECT COUNT(*) FROM imports i JOIN files f ON i.resolved_file_id = f.id WHERE i.resolved_file_id IS NOT NULL AND (i.repository_id != f.repository_id OR i.scan_id != f.scan_id)) +
  (SELECT COUNT(*) FROM imports i JOIN source_evidence e ON i.evidence_id = e.id WHERE i.evidence_id IS NOT NULL AND (i.repository_id != e.repository_id OR i.scan_id != e.scan_id)) +
  (SELECT COUNT(*) FROM exports ex JOIN symbols s ON ex.symbol_id = s.id WHERE ex.symbol_id IS NOT NULL AND (ex.repository_id != s.repository_id OR ex.scan_id != s.scan_id)) +
  (SELECT COUNT(*) FROM exports ex JOIN source_evidence e ON ex.evidence_id = e.id WHERE ex.evidence_id IS NOT NULL AND (ex.repository_id != e.repository_id OR ex.scan_id != e.scan_id)) +
  (SELECT COUNT(*) FROM symbols s JOIN symbols p ON s.parent_symbol_id = p.id WHERE s.parent_symbol_id IS NOT NULL AND (s.repository_id != p.repository_id OR s.scan_id != p.scan_id)) +
  (SELECT COUNT(*) FROM source_evidence e JOIN symbols s ON e.symbol_id = s.id WHERE e.symbol_id IS NOT NULL AND (e.repository_id != s.repository_id OR e.scan_id != s.scan_id)) +
  (SELECT COUNT(*) FROM graph_nodes n JOIN files f ON n.file_id = f.id WHERE n.file_id IS NOT NULL AND (n.repository_id != f.repository_id OR n.scan_id != f.scan_id)) +
  (SELECT COUNT(*) FROM graph_nodes n JOIN symbols s ON n.symbol_id = s.id WHERE n.symbol_id IS NOT NULL AND (n.repository_id != s.repository_id OR n.scan_id != s.scan_id)) +
  (SELECT COUNT(*) FROM graph_edges e JOIN source_evidence ev ON e.evidence_id = ev.id WHERE e.evidence_id IS NOT NULL AND (e.repository_id != ev.repository_id OR e.scan_id != ev.scan_id)) +
  (SELECT COUNT(*) FROM architecture_components c JOIN source_evidence ev ON c.evidence_id = ev.id WHERE c.evidence_id IS NOT NULL AND (c.repository_id != ev.repository_id OR c.scan_id != ev.scan_id))
);

DROP TABLE _migration_002_precheck;

-- 1. Recreate symbols table with composite parent_symbol_id foreign key
CREATE TABLE symbols_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  symbol_identity TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NULL,
  parent_symbol_id INTEGER NULL,
  is_exported INTEGER NOT NULL DEFAULT 0 CHECK(is_exported IN (0, 1)),
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  start_column INTEGER NOT NULL CHECK(start_column >= 0),
  end_column INTEGER NOT NULL CHECK(end_column >= 0),
  fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  extraction_status TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, parent_symbol_id) REFERENCES symbols_v2(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id),
  UNIQUE(scan_id, symbol_identity)
);

INSERT INTO symbols_v2 SELECT * FROM symbols;
DROP TABLE symbols;
ALTER TABLE symbols_v2 RENAME TO symbols;

CREATE INDEX IF NOT EXISTS idx_symbols_identity ON symbols(scan_id, symbol_identity);
CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(scan_id, name, kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);

-- 2. Recreate source_evidence table with composite symbol_id foreign key
CREATE TABLE source_evidence_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  symbol_id INTEGER NULL,
  evidence_type TEXT NOT NULL,
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  start_column INTEGER NOT NULL CHECK(start_column >= 0),
  end_column INTEGER NOT NULL CHECK(end_column >= 0),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  evidence_description TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, symbol_id) REFERENCES symbols(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id)
);

INSERT INTO source_evidence_v2 SELECT * FROM source_evidence;
DROP TABLE source_evidence;
ALTER TABLE source_evidence_v2 RENAME TO source_evidence;

CREATE INDEX IF NOT EXISTS idx_evidence_file ON source_evidence(file_id);

-- 3. Recreate imports table with composite resolved_file_id and evidence_id foreign keys
CREATE TABLE imports_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  source_file_id INTEGER NOT NULL,
  imported_specifier TEXT NOT NULL,
  import_kind TEXT NOT NULL,
  resolved_file_id INTEGER NULL,
  resolution_status TEXT NOT NULL CHECK(resolution_status IN ('RESOLVED', 'UNRESOLVED', 'EXTERNAL', 'BUILTIN', 'DEGRADED')),
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  evidence_id INTEGER NULL,
  FOREIGN KEY(repository_id, scan_id, source_file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, resolved_file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, evidence_id) REFERENCES source_evidence(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, source_file_id, imported_specifier, start_line)
);

INSERT INTO imports_v2 SELECT * FROM imports;
DROP TABLE imports;
ALTER TABLE imports_v2 RENAME TO imports;

CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_file_id);
CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_file_id);

-- 4. Recreate exports table with composite symbol_id and evidence_id foreign keys
CREATE TABLE exports_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  symbol_id INTEGER NULL,
  export_name TEXT NOT NULL,
  export_kind TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  evidence_id INTEGER NULL,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, symbol_id) REFERENCES symbols(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, evidence_id) REFERENCES source_evidence(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, file_id, export_name, start_line)
);

INSERT INTO exports_v2 SELECT * FROM exports;
DROP TABLE exports;
ALTER TABLE exports_v2 RENAME TO exports;

CREATE INDEX IF NOT EXISTS idx_exports_file ON exports(file_id);

-- 5. Recreate graph_nodes table with composite file_id and symbol_id foreign keys
CREATE TABLE graph_nodes_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  node_identity TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('repository', 'directory', 'file', 'symbol', 'package', 'module', 'test', 'database', 'component', 'adr')),
  name TEXT NOT NULL,
  file_id INTEGER NULL,
  symbol_id INTEGER NULL,
  metadata_json TEXT NULL,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, symbol_id) REFERENCES symbols(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id),
  UNIQUE(scan_id, node_identity)
);

INSERT INTO graph_nodes_v2 SELECT * FROM graph_nodes;
DROP TABLE graph_nodes;
ALTER TABLE graph_nodes_v2 RENAME TO graph_nodes;

CREATE INDEX IF NOT EXISTS idx_graph_nodes_identity ON graph_nodes(scan_id, node_identity);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_category ON graph_nodes(scan_id, category);

-- 6. Recreate graph_edges table with composite evidence_id foreign key
CREATE TABLE graph_edges_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  edge_identity TEXT NOT NULL,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('CONTAINS', 'DEFINES', 'IMPORTS', 'EXPORTS', 'DEPENDS_ON', 'TESTS', 'REFERENCES', 'IMPLEMENTS', 'DOCUMENTS', 'MODIFIES', 'DECIDED_BY')),
  evidence_id INTEGER NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  relationship_status TEXT NOT NULL CHECK(relationship_status IN ('CONFIRMED', 'INFERRED', 'UNRESOLVED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id, source_node_id) REFERENCES graph_nodes(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, target_node_id) REFERENCES graph_nodes(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, evidence_id) REFERENCES source_evidence(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, edge_identity)
);

INSERT INTO graph_edges_v2 SELECT * FROM graph_edges;
DROP TABLE graph_edges;
ALTER TABLE graph_edges_v2 RENAME TO graph_edges;

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_rel ON graph_edges(scan_id, relationship_type);

-- 7. Recreate architecture_components table with composite evidence_id foreign key
CREATE TABLE architecture_components_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  component_identity TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('frontend', 'backend', 'api', 'database', 'auth', 'shared_lib', 'test', 'build', 'infrastructure', 'docs', 'unknown')),
  root_path TEXT NOT NULL,
  detection_method TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'INFERRED', 'CANDIDATE')),
  evidence_id INTEGER NULL,
  metadata_json TEXT NULL,
  FOREIGN KEY(repository_id, scan_id, evidence_id) REFERENCES source_evidence(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, component_identity)
);

INSERT INTO architecture_components_v2 SELECT * FROM architecture_components;
DROP TABLE architecture_components;
ALTER TABLE architecture_components_v2 RENAME TO architecture_components;

CREATE INDEX IF NOT EXISTS idx_components_category ON architecture_components(scan_id, category);
