/**
 * Phase 7.3 — Database Migration Runner
 * Transactional, deterministic schema migrations with version tracking and corruption safety.
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

// Embedded migrations ensure standalone execution even in bundled / sandbox environments
export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: "001-initial-schema",
    sql: `-- Frontier Engineer Phase 7.3: Initial Intelligence Schema
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
CREATE INDEX IF NOT EXISTS idx_components_category ON architecture_components(scan_id, category);`,
  },
  {
    version: 2,
    name: "002-composite-foreign-keys",
    sql: `-- Frontier Engineer Phase 7.3.3: Composite Foreign-Key Isolation
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

CREATE INDEX IF NOT EXISTS idx_components_category ON architecture_components(scan_id, category);`,
  },
  {
    version: 3,
    name: "003-engineering-memory-evolution",
    sql: `-- Frontier Engineer Phase 7.5: Engineering Memory & Repository Evolution Intelligence
-- Migration: 003-engineering-memory-evolution.sql
-- Persistent engineering memories, memory evidence, evolution events, memory relationships, and versions.

-- 0. Ensure unique index on graph_edges for composite foreign key references from memory_evidence
CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_repo_scan_id ON graph_edges(repository_id, scan_id, id);

-- 1. Persistent Engineering Memories
CREATE TABLE IF NOT EXISTS engineering_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'architectural_knowledge',
    'engineering_convention',
    'architectural_decision',
    'technical_debt',
    'project_context',
    'evolution_record'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  confidence_tier TEXT NOT NULL CHECK(confidence_tier IN ('CONFIRMED', 'INFERRED', 'CANDIDATE', 'UNRESOLVED')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'STALE', 'SUPERSEDED', 'DISPUTED', 'ARCHIVED')),
  first_seen_scan_id INTEGER NULL,
  last_seen_scan_id INTEGER NULL,
  superseded_by_id INTEGER NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  UNIQUE(repository_id, memory_key),
  UNIQUE(repository_id, id),
  CHECK(superseded_by_id IS NULL OR superseded_by_id != id),
  FOREIGN KEY(repository_id, superseded_by_id) REFERENCES engineering_memories(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, first_seen_scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(repository_id, last_seen_scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_memories_repo_cat_status ON engineering_memories(repository_id, category, status);

-- 2. Memory Evidence and Provenance
CREATE TABLE IF NOT EXISTS memory_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  memory_id INTEGER NOT NULL,
  scan_id INTEGER NOT NULL,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN (
    'source_file',
    'symbol',
    'import',
    'component',
    'adr',
    'graph_edge',
    'test',
    'diff',
    'manual'
  )),
  source_path TEXT NOT NULL,
  line_start INTEGER NULL CHECK(line_start IS NULL OR line_start >= 1),
  line_end INTEGER NULL CHECK(line_end IS NULL OR line_end >= line_start),
  source_hash TEXT NULL,
  symbol_identity TEXT NULL,
  graph_node_id INTEGER NULL,
  graph_edge_id INTEGER NULL,
  description TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  is_contradictory INTEGER NOT NULL DEFAULT 0 CHECK(is_contradictory IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(repository_id, scan_id, id),
  FOREIGN KEY(repository_id, memory_id) REFERENCES engineering_memories(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, graph_node_id) REFERENCES graph_nodes(repository_id, scan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, scan_id, graph_edge_id) REFERENCES graph_edges(repository_id, scan_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory ON memory_evidence(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_evidence_repo_scan ON memory_evidence(repository_id, scan_id);

-- 3. Evolution Events
CREATE TABLE IF NOT EXISTS evolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  base_scan_id INTEGER NOT NULL,
  target_scan_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('file', 'symbol', 'dependency', 'architecture', 'decision', 'debt')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  confidence_tier TEXT NOT NULL CHECK(confidence_tier IN ('CONFIRMED', 'INFERRED', 'CANDIDATE')),
  details_json TEXT NULL,
  created_at TEXT NOT NULL,
  CHECK(base_scan_id != target_scan_id),
  FOREIGN KEY(repository_id, base_scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, target_scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evolution_events_target ON evolution_events(repository_id, target_scan_id);
CREATE INDEX IF NOT EXISTS idx_evolution_events_base ON evolution_events(repository_id, base_scan_id);

-- 4. Memory Relationships
CREATE TABLE IF NOT EXISTS memory_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  source_memory_id INTEGER NOT NULL,
  target_memory_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
    'IMPLEMENTS',
    'SUPERSEDES',
    'CONTRADICTS',
    'RELATES_TO',
    'DOCUMENTS',
    'DEPENDS_ON'
  )),
  created_at TEXT NOT NULL,
  CHECK(source_memory_id != target_memory_id),
  UNIQUE(repository_id, source_memory_id, target_memory_id, relationship_type),
  FOREIGN KEY(repository_id, source_memory_id) REFERENCES engineering_memories(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, target_memory_id) REFERENCES engineering_memories(repository_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_relationships_source ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_target ON memory_relationships(target_memory_id);

-- 5. Memory Versions (Immutable History)
CREATE TABLE IF NOT EXISTS memory_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  memory_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'STALE', 'SUPERSEDED', 'DISPUTED', 'ARCHIVED')),
  previous_content_hash TEXT NULL,
  new_content_hash TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  source_scan_id INTEGER NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, version),
  FOREIGN KEY(repository_id, memory_id) REFERENCES engineering_memories(repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, source_scan_id) REFERENCES scan_runs(repository_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_ver ON memory_versions(memory_id, version);

-- 6. Immutability Triggers for Memory Versions
CREATE TRIGGER IF NOT EXISTS trg_memory_versions_no_update
BEFORE UPDATE ON memory_versions
BEGIN
  SELECT RAISE(ABORT, 'memory_versions records are immutable and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_memory_versions_no_direct_delete
BEFORE DELETE ON memory_versions
WHEN (SELECT COUNT(*) FROM engineering_memories WHERE id = OLD.memory_id) > 0
BEGIN
  SELECT RAISE(ABORT, 'Direct deletion of memory_versions is prohibited; versions are immutable');
END;

-- 7. Initial State, Lifecycle Transitions, and Supersession Guards on Engineering Memories
CREATE TRIGGER IF NOT EXISTS trg_engineering_memories_insert_guard
BEFORE INSERT ON engineering_memories
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.status != 'ACTIVE' THEN
      RAISE(ABORT, 'Illegal initial status: newly created memories must start in ACTIVE status')
    WHEN NEW.superseded_by_id IS NOT NULL THEN
      RAISE(ABORT, 'Illegal initial state: newly created memories cannot specify superseded_by_id')
    WHEN NEW.version != 1 THEN
      RAISE(ABORT, 'Illegal initial version: newly created memories must start at version 1')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_engineering_memories_update_guard
BEFORE UPDATE ON engineering_memories
FOR EACH ROW
BEGIN
  -- Terminal statuses & supersession immutability
  SELECT CASE
    WHEN OLD.status = 'SUPERSEDED' AND NEW.status != 'SUPERSEDED' THEN
      RAISE(ABORT, 'Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed')
    WHEN OLD.status = 'SUPERSEDED' AND (NEW.superseded_by_id IS NULL OR NEW.superseded_by_id != OLD.superseded_by_id) THEN
      RAISE(ABORT, 'Illegal supersession mutation: a SUPERSEDED memory cannot change or clear its replacement')
    WHEN OLD.status = 'ARCHIVED' AND NEW.status != 'ARCHIVED' THEN
      RAISE(ABORT, 'Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed')
    WHEN OLD.status = 'ARCHIVED' AND NEW.superseded_by_id IS NOT NULL THEN
      RAISE(ABORT, 'Illegal state: an ARCHIVED memory cannot specify superseded_by_id')
  END;

  -- Allowable transitions
  SELECT CASE
    WHEN OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE', 'STALE', 'DISPUTED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from ACTIVE')
    WHEN OLD.status = 'STALE' AND NEW.status NOT IN ('STALE', 'ACTIVE', 'DISPUTED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from STALE')
    WHEN OLD.status = 'DISPUTED' AND NEW.status NOT IN ('DISPUTED', 'ACTIVE', 'STALE', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from DISPUTED')
  END;

  -- Non-SUPERSEDED memories cannot have superseded_by_id
  SELECT CASE
    WHEN NEW.status != 'SUPERSEDED' AND NEW.superseded_by_id IS NOT NULL THEN
      RAISE(ABORT, 'Illegal state: only SUPERSEDED memories can specify superseded_by_id')
  END;

  -- SUPERSEDED requirements
  SELECT CASE
    WHEN NEW.status = 'SUPERSEDED' AND NEW.superseded_by_id IS NULL THEN
      RAISE(ABORT, 'Illegal supersession: a SUPERSEDED memory must have a non-null superseded_by_id')
    WHEN NEW.status = 'SUPERSEDED' AND NEW.superseded_by_id = NEW.id THEN
      RAISE(ABORT, 'Illegal supersession: self-supersession is prohibited')
    WHEN NEW.status = 'SUPERSEDED' AND (
      SELECT status FROM engineering_memories
      WHERE repository_id = NEW.repository_id AND id = NEW.superseded_by_id
    ) IN ('SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal supersession: replacement memory cannot be in SUPERSEDED or ARCHIVED status')
  END;

  -- A memory referenced as replacement by one or more SUPERSEDED memories cannot become SUPERSEDED or ARCHIVED
  SELECT CASE
    WHEN NEW.status IN ('SUPERSEDED', 'ARCHIVED') AND (
      SELECT COUNT(*) FROM engineering_memories
      WHERE repository_id = OLD.repository_id
        AND superseded_by_id = OLD.id
        AND status = 'SUPERSEDED'
        AND id != OLD.id
    ) > 0 THEN
      RAISE(ABORT, 'Illegal status transition: cannot supersede or archive a memory that is currently an active replacement for superseded memories')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_engineering_memories_no_delete_replacement
BEFORE DELETE ON engineering_memories
WHEN (SELECT COUNT(*) FROM repositories WHERE id = OLD.repository_id) > 0
  AND (SELECT COUNT(*) FROM engineering_memories WHERE superseded_by_id = OLD.id) > 0
BEGIN
  SELECT RAISE(ABORT, 'Illegal operation: cannot delete a memory that is currently a replacement for superseded memories');
END;`,
  },
  {
    version: 4,
    name: "004-relax-supersession-chain",
    sql: `-- Frontier Engineer Phase 8.2: Multi-Generation Supersession Chain & Lifecycle Invariants
-- Migration: 004-relax-supersession-chain.sql
-- Relaxes supersession constraints on engineering_memories to permit multi-generation
-- decision evolution chains (A -> B -> C) while preventing cycles, self-links,
-- cross-repository relationships, and direct archival of active replacements.

-- 1. Drop existing update guard trigger from migration 003
DROP TRIGGER IF EXISTS trg_engineering_memories_update_guard;

-- 2. Recreate update guard trigger with Option B multi-generation support
CREATE TRIGGER IF NOT EXISTS trg_engineering_memories_update_guard
BEFORE UPDATE ON engineering_memories
FOR EACH ROW
BEGIN
  -- Terminal statuses & supersession immutability
  SELECT CASE
    WHEN OLD.status = 'SUPERSEDED' AND NEW.status != 'SUPERSEDED' THEN
      RAISE(ABORT, 'Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed')
    WHEN OLD.status = 'SUPERSEDED' AND (NEW.superseded_by_id IS NULL OR NEW.superseded_by_id != OLD.superseded_by_id) THEN
      RAISE(ABORT, 'Illegal supersession mutation: a SUPERSEDED memory cannot change or clear its replacement')
    WHEN OLD.status = 'ARCHIVED' AND NEW.status != 'ARCHIVED' THEN
      RAISE(ABORT, 'Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed')
    WHEN OLD.status = 'ARCHIVED' AND NEW.superseded_by_id IS NOT NULL THEN
      RAISE(ABORT, 'Illegal state: an ARCHIVED memory cannot specify superseded_by_id')
  END;

  -- Allowable transitions
  SELECT CASE
    WHEN OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE', 'STALE', 'DISPUTED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from ACTIVE')
    WHEN OLD.status = 'STALE' AND NEW.status NOT IN ('STALE', 'ACTIVE', 'DISPUTED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from STALE')
    WHEN OLD.status = 'DISPUTED' AND NEW.status NOT IN ('DISPUTED', 'ACTIVE', 'STALE', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal status transition from DISPUTED')
  END;

  -- Non-SUPERSEDED memories cannot have superseded_by_id
  SELECT CASE
    WHEN NEW.status != 'SUPERSEDED' AND NEW.superseded_by_id IS NOT NULL THEN
      RAISE(ABORT, 'Illegal state: only SUPERSEDED memories can specify superseded_by_id')
  END;

  -- SUPERSEDED requirements
  SELECT CASE
    WHEN NEW.status = 'SUPERSEDED' AND NEW.superseded_by_id IS NULL THEN
      RAISE(ABORT, 'Illegal supersession: a SUPERSEDED memory must have a non-null superseded_by_id')
    WHEN NEW.status = 'SUPERSEDED' AND NEW.superseded_by_id = NEW.id THEN
      RAISE(ABORT, 'Illegal supersession: self-supersession is prohibited')
    WHEN NEW.status = 'SUPERSEDED' AND (
      SELECT repository_id FROM engineering_memories WHERE id = NEW.superseded_by_id
    ) != NEW.repository_id THEN
      RAISE(ABORT, 'Illegal supersession: replacement memory must belong to the same repository')
    WHEN NEW.status = 'SUPERSEDED' AND (
      SELECT status FROM engineering_memories
      WHERE repository_id = NEW.repository_id AND id = NEW.superseded_by_id
    ) IN ('SUPERSEDED', 'ARCHIVED') THEN
      RAISE(ABORT, 'Illegal supersession: replacement memory cannot be in SUPERSEDED or ARCHIVED status')
  END;

  -- Cycle prevention in supersession chains using recursive CTE
  SELECT CASE
    WHEN NEW.status = 'SUPERSEDED' AND EXISTS (
      WITH RECURSIVE chain(id, superseded_by_id) AS (
        SELECT id, superseded_by_id FROM engineering_memories
        WHERE id = NEW.superseded_by_id AND repository_id = NEW.repository_id
        UNION ALL
        SELECT m.id, m.superseded_by_id
        FROM engineering_memories m
        JOIN chain c ON m.id = c.superseded_by_id
        WHERE m.repository_id = NEW.repository_id AND m.superseded_by_id IS NOT NULL
      )
      SELECT 1 FROM chain WHERE id = NEW.id
    ) THEN
      RAISE(ABORT, 'Illegal supersession: cycle detected in supersession chain')
  END;

  -- Replacement protection: an active replacement cannot be ARCHIVED directly without replacement
  SELECT CASE
    WHEN NEW.status = 'ARCHIVED' AND (
      SELECT COUNT(*) FROM engineering_memories
      WHERE repository_id = OLD.repository_id
        AND superseded_by_id = OLD.id
        AND status = 'SUPERSEDED'
        AND id != OLD.id
    ) > 0 THEN
      RAISE(ABORT, 'Illegal status transition: cannot archive a memory that is currently an active replacement for superseded memories')
  END;
END;`,
  },
  {
    version: 5,
    name: "005-persistent-task-graph",
    sql: `-- Frontier Engineer Phase 8.3: Persistent Task Graph, Execution Plans & Bidirectional Handoff Lifecycle
CREATE TABLE IF NOT EXISTS execution_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED')) DEFAULT 'DRAFT',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NULL,
  metadata TEXT NULL,
  UNIQUE(repository_id, plan_key),
  UNIQUE(repository_id, id)
);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  assigned_agent TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED')) DEFAULT 'PENDING',
  priority INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NULL,
  result_summary TEXT NULL,
  failure_reason TEXT NULL,
  metadata TEXT NULL,
  UNIQUE(plan_id, task_key),
  UNIQUE(plan_id, id),
  FOREIGN KEY(repository_id, plan_id) REFERENCES execution_plans(repository_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  prerequisite_task_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, prerequisite_task_id),
  CHECK(task_id != prerequisite_task_id),
  FOREIGN KEY(plan_id, task_id) REFERENCES plan_tasks(plan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(plan_id, prerequisite_task_id) REFERENCES plan_tasks(plan_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_file_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  lock_type TEXT NOT NULL CHECK(lock_type IN ('EXCLUSIVE', 'SHARED')) DEFAULT 'EXCLUSIVE',
  status TEXT NOT NULL CHECK(status IN ('HELD', 'RELEASED')) DEFAULT 'HELD',
  acquired_at TEXT NOT NULL,
  released_at TEXT NULL,
  FOREIGN KEY(plan_id, task_id) REFERENCES plan_tasks(plan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, plan_id) REFERENCES execution_plans(repository_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS handoff_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('OUTGOING_HANDOFF', 'INCOMING_RESPONSE')),
  payload_json TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK(validation_status IN ('VALID', 'INVALID')),
  validation_errors TEXT NULL,
  from_agent TEXT NULL,
  to_agent TEXT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(plan_id, task_id) REFERENCES plan_tasks(plan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, plan_id) REFERENCES execution_plans(repository_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PASSED', 'FAILED', 'BLOCKED')),
  commands_json TEXT NOT NULL,
  outcomes_json TEXT NOT NULL,
  test_states_json TEXT NOT NULL,
  summary TEXT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(plan_id, task_id) REFERENCES plan_tasks(plan_id, id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id, plan_id) REFERENCES execution_plans(repository_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_plans_repo_status ON execution_plans(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_status ON plan_tasks(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_repo ON plan_tasks(repository_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_prereq ON task_dependencies(prerequisite_task_id);
CREATE INDEX IF NOT EXISTS idx_task_file_locks_active ON task_file_locks(repository_id, relative_path) WHERE status = 'HELD';
CREATE INDEX IF NOT EXISTS idx_handoff_records_task ON handoff_records(task_id, direction);
CREATE INDEX IF NOT EXISTS idx_verification_runs_task ON verification_runs(task_id);

CREATE TRIGGER IF NOT EXISTS trg_task_dependencies_cycle_guard
BEFORE INSERT ON task_dependencies
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.task_id = NEW.prerequisite_task_id THEN
      RAISE(ABORT, 'Illegal task dependency: self-dependency is prohibited')
  END;

  SELECT CASE
    WHEN (SELECT plan_id FROM plan_tasks WHERE id = NEW.task_id) != NEW.plan_id
      OR (SELECT plan_id FROM plan_tasks WHERE id = NEW.prerequisite_task_id) != NEW.plan_id THEN
      RAISE(ABORT, 'Illegal task dependency: tasks must belong to the same execution plan')
  END;

  SELECT CASE
    WHEN EXISTS (
      WITH RECURSIVE dep_chain(task_id, prereq_id) AS (
        SELECT task_id, prerequisite_task_id FROM task_dependencies
        WHERE task_id = NEW.prerequisite_task_id AND plan_id = NEW.plan_id
        UNION ALL
        SELECT d.task_id, d.prerequisite_task_id
        FROM task_dependencies d
        JOIN dep_chain c ON d.task_id = c.prereq_id
        WHERE d.plan_id = NEW.plan_id
      )
      SELECT 1 FROM dep_chain WHERE prereq_id = NEW.task_id
    ) THEN
      RAISE(ABORT, 'Illegal task dependency: cycle detected in task DAG')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_plan_tasks_prereq_guard
BEFORE UPDATE OF status ON plan_tasks
FOR EACH ROW
WHEN NEW.status IN ('IN_PROGRESS', 'COMPLETED')
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM task_dependencies td
      JOIN plan_tasks pt ON td.prerequisite_task_id = pt.id
      WHERE td.task_id = NEW.id
        AND td.plan_id = NEW.plan_id
        AND pt.status != 'COMPLETED'
    ) THEN
      RAISE(ABORT, 'Illegal task status transition: all prerequisite tasks must be in COMPLETED status')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_task_file_locks_exclusive_guard
BEFORE INSERT ON task_file_locks
FOR EACH ROW
WHEN NEW.status = 'HELD'
BEGIN
  SELECT CASE
    WHEN NEW.lock_type = 'EXCLUSIVE' AND EXISTS (
      SELECT 1 FROM task_file_locks
      WHERE repository_id = NEW.repository_id
        AND relative_path = NEW.relative_path
        AND status = 'HELD'
        AND task_id != NEW.task_id
    ) THEN
      RAISE(ABORT, 'Lock conflict: cannot acquire EXCLUSIVE lock on file currently held by another task')
    WHEN NEW.lock_type = 'SHARED' AND EXISTS (
      SELECT 1 FROM task_file_locks
      WHERE repository_id = NEW.repository_id
        AND relative_path = NEW.relative_path
        AND status = 'HELD'
        AND lock_type = 'EXCLUSIVE'
        AND task_id != NEW.task_id
    ) THEN
      RAISE(ABORT, 'Lock conflict: cannot acquire SHARED lock on file currently held exclusively by another task')
  END;
END;`,
  },
];

export const CURRENT_SCHEMA_VERSION = 5;

/**
 * Retrieves the current applied migration version from the database.
 * Returns 0 if the schema_migrations table does not exist.
 */
export function getCurrentSchemaVersion(db: DatabaseSync): number {
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name?: string } | undefined;

    if (!tableExists || !tableExists.name) {
      return 0;
    }

    const row = db.prepare("SELECT MAX(version) AS max_version FROM schema_migrations").get() as
      { max_version: number | null } | undefined;

    return row?.max_version ?? 0;
  } catch (err) {
    throw new Error(
      `Failed to query schema_migrations: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Applies pending migrations sequentially within immediate transactions.
 * Fails safely if the database version is higher than supported.
 */
export function runMigrations(db: DatabaseSync): { applied: number; currentVersion: number } {
  const currentVersion = getCurrentSchemaVersion(db);

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported newer database schema version ${currentVersion}. Frontier Engineer supports up to version ${CURRENT_SCHEMA_VERSION}. Please update the plugin.`,
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return {
      applied: 0,
      currentVersion,
    };
  }

  // SQLite requires PRAGMA foreign_keys = OFF outside transactions during table recreation migrations
  const fkRow = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number } | undefined;
  const fkWASOn = fkRow ? fkRow.foreign_keys === 1 : false;

  if (fkWASOn) {
    db.exec("PRAGMA foreign_keys = OFF;");
  }

  let appliedCount = 0;
  try {
    for (const migration of pending) {
      db.exec("BEGIN IMMEDIATE;");
      try {
        db.exec(migration.sql);

        // Verify foreign key integrity within transaction before recording migration
        const fkCheck = db.prepare("PRAGMA foreign_key_check;").all();
        if (fkCheck.length > 0) {
          throw new Error(
            `Foreign key integrity check failed after migration ${migration.version} (${migration.name}): ${fkCheck.length} violations found`,
          );
        }

        const stmt = db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        );
        stmt.run(migration.version, migration.name, new Date().toISOString());
        db.exec("COMMIT;");
        appliedCount++;
      } catch (err) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // Rollback attempt
        }
        throw new Error(
          `Migration ${migration.version} (${migration.name}) failed and was rolled back: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  } finally {
    if (fkWASOn) {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  return {
    applied: appliedCount,
    currentVersion: getCurrentSchemaVersion(db),
  };
}
