-- Frontier Engineer Phase 8.2: Multi-Generation Supersession Chain & Lifecycle Invariants
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
END;
