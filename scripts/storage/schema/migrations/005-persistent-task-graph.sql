-- Frontier Engineer Phase 8.3: Persistent Task Graph, Execution Plans & Bidirectional Handoff Lifecycle
-- Migration: 005-persistent-task-graph.sql
-- Establishes execution plans, plan tasks with DAG dependency enforcement, task file locks,
-- bidirectional handoff audit records, and verification run persistence.

-- 1. Execution Plans table
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

-- 2. Plan Tasks table
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

-- 3. Task Dependencies table (DAG prerequisites)
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

-- 4. Task File Locks table (File-ownership and concurrency guards)
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

-- 5. Handoff Records table (Bidirectional coordinator/specialist contract tracking)
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

-- 6. Verification Runs table (Execution verification results)
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

-- 7. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_execution_plans_repo_status ON execution_plans(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_status ON plan_tasks(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_repo ON plan_tasks(repository_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_prereq ON task_dependencies(prerequisite_task_id);
CREATE INDEX IF NOT EXISTS idx_task_file_locks_active ON task_file_locks(repository_id, relative_path) WHERE status = 'HELD';
CREATE INDEX IF NOT EXISTS idx_handoff_records_task ON handoff_records(task_id, direction);
CREATE INDEX IF NOT EXISTS idx_verification_runs_task ON verification_runs(task_id);

-- 8. Triggers for DAG and Concurrency Invariants

-- 8.1 Cycle Prevention Trigger on Task Dependencies
CREATE TRIGGER IF NOT EXISTS trg_task_dependencies_cycle_guard
BEFORE INSERT ON task_dependencies
FOR EACH ROW
BEGIN
  -- Direct self-dependency check
  SELECT CASE
    WHEN NEW.task_id = NEW.prerequisite_task_id THEN
      RAISE(ABORT, 'Illegal task dependency: self-dependency is prohibited')
  END;

  -- Ensure both tasks belong to the same plan
  SELECT CASE
    WHEN (SELECT plan_id FROM plan_tasks WHERE id = NEW.task_id) != NEW.plan_id
      OR (SELECT plan_id FROM plan_tasks WHERE id = NEW.prerequisite_task_id) != NEW.plan_id THEN
      RAISE(ABORT, 'Illegal task dependency: tasks must belong to the same execution plan')
  END;

  -- Transitive cycle detection using recursive CTE
  -- Checks if prerequisite_task_id already transitively depends on task_id
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

-- 8.2 Prerequisite Completion Guard on Task Status Transition
CREATE TRIGGER IF NOT EXISTS trg_plan_tasks_prereq_guard
BEFORE UPDATE OF status ON plan_tasks
FOR EACH ROW
WHEN NEW.status IN ('IN_PROGRESS', 'COMPLETED')
BEGIN
  -- A task cannot start or complete if any prerequisite task is not COMPLETED
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

-- 8.3 Exclusive File Lock Guard
CREATE TRIGGER IF NOT EXISTS trg_task_file_locks_exclusive_guard
BEFORE INSERT ON task_file_locks
FOR EACH ROW
WHEN NEW.status = 'HELD'
BEGIN
  -- If inserting an EXCLUSIVE lock, no other HELD lock may exist for the same repository and relative_path
  SELECT CASE
    WHEN NEW.lock_type = 'EXCLUSIVE' AND EXISTS (
      SELECT 1 FROM task_file_locks
      WHERE repository_id = NEW.repository_id
        AND relative_path = NEW.relative_path
        AND status = 'HELD'
        AND task_id != NEW.task_id
    ) THEN
      RAISE(ABORT, 'Lock conflict: cannot acquire EXCLUSIVE lock on file currently held by another task')
    -- If inserting a SHARED lock, no EXCLUSIVE HELD lock may exist
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
END;
