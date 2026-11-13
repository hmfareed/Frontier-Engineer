-- Frontier Engineer Phase 7.5: Engineering Memory & Repository Evolution Intelligence
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
END;
