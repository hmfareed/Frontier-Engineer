-- Frontier Engineer Phase 7.3: Initial Intelligence Schema
-- Migration: 001-initial-schema.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  active_scan_id INTEGER NULL
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'VALIDATING', 'COMPLETE', 'PARTIAL', 'CANCELLED', 'FAILED')),
  files_discovered INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER NOT NULL DEFAULT 0,
  files_skipped INTEGER NOT NULL DEFAULT 0,
  files_failed INTEGER NOT NULL DEFAULT 0,
  diagnostic_count INTEGER NOT NULL DEFAULT 0,
  scanner_version TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
  failure_reason TEXT NULL,
  UNIQUE(repository_id, id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  extension TEXT NOT NULL,
  language TEXT NOT NULL,
  classification TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  modified_at INTEGER NOT NULL,
  content_hash TEXT NULL,
  sensitivity_status TEXT NOT NULL,
  index_status TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id),
  UNIQUE(scan_id, normalized_path)
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  symbol_identity TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NULL,
  parent_symbol_id INTEGER NULL REFERENCES symbols(id) ON DELETE SET NULL,
  is_exported INTEGER NOT NULL DEFAULT 0 CHECK(is_exported IN (0, 1)),
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  start_column INTEGER NOT NULL CHECK(start_column >= 0),
  end_column INTEGER NOT NULL CHECK(end_column >= 0),
  fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  extraction_status TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id),
  UNIQUE(scan_id, symbol_identity)
);

CREATE TABLE IF NOT EXISTS source_evidence (
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
  FOREIGN KEY(symbol_id) REFERENCES symbols(id) ON DELETE SET NULL,
  UNIQUE(repository_id, scan_id, id)
);

CREATE TABLE IF NOT EXISTS imports (
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
  evidence_id INTEGER NULL REFERENCES source_evidence(id) ON DELETE SET NULL,
  FOREIGN KEY(repository_id, scan_id, source_file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_file_id) REFERENCES files(id) ON DELETE SET NULL,
  UNIQUE(scan_id, source_file_id, imported_specifier, start_line)
);

CREATE TABLE IF NOT EXISTS exports (
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
  evidence_id INTEGER NULL REFERENCES source_evidence(id) ON DELETE SET NULL,
  FOREIGN KEY(repository_id, scan_id, file_id) REFERENCES files(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(symbol_id) REFERENCES symbols(id) ON DELETE SET NULL,
  UNIQUE(scan_id, file_id, export_name, start_line)
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  node_identity TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('repository', 'directory', 'file', 'symbol', 'package', 'module', 'test', 'database', 'component', 'adr')),
  name TEXT NOT NULL,
  file_id INTEGER NULL REFERENCES files(id) ON DELETE SET NULL,
  symbol_id INTEGER NULL REFERENCES symbols(id) ON DELETE SET NULL,
  metadata_json TEXT NULL,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(repository_id, scan_id, id),
  UNIQUE(scan_id, node_identity)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  edge_identity TEXT NOT NULL,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('CONTAINS', 'DEFINES', 'IMPORTS', 'EXPORTS', 'DEPENDS_ON', 'TESTS', 'REFERENCES', 'IMPLEMENTS', 'DOCUMENTS', 'MODIFIES', 'DECIDED_BY')),
  evidence_id INTEGER NULL REFERENCES source_evidence(id) ON DELETE SET NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  relationship_status TEXT NOT NULL CHECK(relationship_status IN ('CONFIRMED', 'INFERRED', 'UNRESOLVED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(repository_id, scan_id, source_node_id) REFERENCES graph_nodes(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, target_node_id) REFERENCES graph_nodes(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, edge_identity)
);

CREATE TABLE IF NOT EXISTS architecture_components (
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
  evidence_id INTEGER NULL REFERENCES source_evidence(id) ON DELETE SET NULL,
  metadata_json TEXT NULL,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  UNIQUE(scan_id, component_identity)
);

-- Performance & Query Indexes
CREATE INDEX IF NOT EXISTS idx_repositories_identity ON repositories(identity);
CREATE INDEX IF NOT EXISTS idx_scan_runs_repo_status ON scan_runs(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_files_scan_path ON files(scan_id, normalized_path);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(scan_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_identity ON symbols(scan_id, symbol_identity);
CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(scan_id, name, kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_evidence_file ON source_evidence(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_file_id);
CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_file_id);
CREATE INDEX IF NOT EXISTS idx_exports_file ON exports(file_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_identity ON graph_nodes(scan_id, node_identity);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_category ON graph_nodes(scan_id, category);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_rel ON graph_edges(scan_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_components_category ON architecture_components(scan_id, category);
