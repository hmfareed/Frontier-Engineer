/**
 * Phase 8.3 — Migration 005 Unit Tests
 * Verifies persistent task graphs, execution plans, DAG dependency cycle prevention,
 * prerequisite completion guards, and exclusive file lock conflict prevention.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import {
  runMigrations,
  getCurrentSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from "../../scripts/storage/schema/migration-runner.ts";

describe("Phase 8.3 — Migration 005 & Persistent Task Graph Schema", () => {
  let db: SqliteDatabase;
  let repoId: number;
  const now = new Date().toISOString();

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    const { applied, currentVersion } = runMigrations(db.rawDb);
    expect(currentVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(applied).toBe(CURRENT_SCHEMA_VERSION);

    // Seed test repository
    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_phase83', '/repo/p83', 'Phase 8.3 Repo', ?, ?, 5)",
      )
      .run(now, now);
    repoId = Number(r.lastInsertRowid);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
  });

  it("1. establishes schema version 5 and creates all task graph tables and triggers", () => {
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(5);

    const tables = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('execution_plans', 'plan_tasks', 'task_dependencies', 'task_file_locks', 'handoff_records', 'verification_runs') ORDER BY name ASC",
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      "execution_plans",
      "handoff_records",
      "plan_tasks",
      "task_dependencies",
      "task_file_locks",
      "verification_runs",
    ]);

    const triggers = db.rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_task_dependencies_cycle_guard', 'trg_plan_tasks_prereq_guard', 'trg_task_file_locks_exclusive_guard') ORDER BY name ASC",
      )
      .all() as { name: string }[];

    expect(triggers.map((t) => t.name)).toEqual([
      "trg_plan_tasks_prereq_guard",
      "trg_task_dependencies_cycle_guard",
      "trg_task_file_locks_exclusive_guard",
    ]);

    const integrity = db.integrityCheck();
    expect(integrity.ok).toBe(true);
  });

  it("2. supports execution plan and plan task hierarchy with cascade deletion", () => {
    // Insert execution plan
    const planRes = db.rawDb
      .prepare(
        "INSERT INTO execution_plans (repository_id, plan_key, title, description, status, created_at, updated_at) VALUES (?, 'plan_auth_refactor', 'Auth Refactoring', 'Plan desc', 'ACTIVE', ?, ?)",
      )
      .run(repoId, now, now);
    const planId = Number(planRes.lastInsertRowid);

    // Insert two tasks
    const t1 = db.rawDb
      .prepare(
        "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, description, assigned_agent, status, priority, order_index, created_at, updated_at) VALUES (?, ?, 'task_1', 'Design Spec', 'Spec desc', 'architect', 'COMPLETED', 1, 0, ?, ?)",
      )
      .run(planId, repoId, now, now);
    const task1Id = Number(t1.lastInsertRowid);

    const t2 = db.rawDb
      .prepare(
        "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, description, assigned_agent, status, priority, order_index, created_at, updated_at) VALUES (?, ?, 'task_2', 'Implement Code', 'Code desc', 'implementation-engineer', 'PENDING', 2, 1, ?, ?)",
      )
      .run(planId, repoId, now, now);
    const task2Id = Number(t2.lastInsertRowid);

    // Verify retrieval
    const taskRows = db.rawDb
      .prepare(
        "SELECT task_key, assigned_agent, status FROM plan_tasks WHERE plan_id = ? ORDER BY order_index ASC",
      )
      .all(planId) as Array<{ task_key: string; assigned_agent: string; status: string }>;
    expect(taskRows).toHaveLength(2);
    expect(taskRows[0].task_key).toBe("task_1");
    expect(taskRows[1].task_key).toBe("task_2");

    // Deleting plan cascades to tasks
    db.rawDb.prepare("DELETE FROM execution_plans WHERE id = ?").run(planId);
    const remainingTasks = db.rawDb
      .prepare("SELECT COUNT(*) as c FROM plan_tasks WHERE plan_id = ?")
      .get(planId) as { c: number };
    expect(remainingTasks.c).toBe(0);
  });

  it("3. rejects self-dependency and enforces acyclic task DAG", () => {
    const planRes = db.rawDb
      .prepare(
        "INSERT INTO execution_plans (repository_id, plan_key, title, status, created_at, updated_at) VALUES (?, 'plan_dag', 'DAG Plan', 'ACTIVE', ?, ?)",
      )
      .run(repoId, now, now);
    const planId = Number(planRes.lastInsertRowid);

    const tA = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_a', 'Task A', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );
    const tB = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_b', 'Task B', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );
    const tC = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_c', 'Task C', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );

    // 1. Direct self-dependency -> FAILS
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(planId, tA, tA, now);
    }).toThrow(/Illegal task dependency: self-dependency is prohibited|CHECK constraint failed/);

    // 2. Add valid dependencies: A depends on B, B depends on C (C -> B -> A)
    db.rawDb
      .prepare(
        "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(planId, tA, tB, now);
    db.rawDb
      .prepare(
        "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(planId, tB, tC, now);

    // 3. Attempt 2-node cycle: B depends on A (A -> B -> A) -> MUST FAIL
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(planId, tB, tA, now);
    }).toThrow(/cycle detected in task DAG/);

    // 4. Attempt 3-node cycle: C depends on A (A -> B -> C -> A) -> MUST FAIL
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(planId, tC, tA, now);
    }).toThrow(/cycle detected in task DAG/);
  });

  it("4. prevents task status transition to IN_PROGRESS or COMPLETED if prerequisite tasks are not COMPLETED", () => {
    const planRes = db.rawDb
      .prepare(
        "INSERT INTO execution_plans (repository_id, plan_key, title, status, created_at, updated_at) VALUES (?, 'plan_prereqs', 'Prereqs Plan', 'ACTIVE', ?, ?)",
      )
      .run(repoId, now, now);
    const planId = Number(planRes.lastInsertRowid);

    const tPrereq = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_prereq', 'Prerequisite Task', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );
    const tTarget = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_target', 'Target Task', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );

    // Target depends on Prereq
    db.rawDb
      .prepare(
        "INSERT INTO task_dependencies (plan_id, task_id, prerequisite_task_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(planId, tTarget, tPrereq, now);

    // Attempt to start target while prereq is PENDING -> MUST FAIL
    expect(() => {
      db.rawDb.prepare("UPDATE plan_tasks SET status = 'IN_PROGRESS' WHERE id = ?").run(tTarget);
    }).toThrow(/all prerequisite tasks must be in COMPLETED status/);

    // Attempt to complete target while prereq is PENDING -> MUST FAIL
    expect(() => {
      db.rawDb.prepare("UPDATE plan_tasks SET status = 'COMPLETED' WHERE id = ?").run(tTarget);
    }).toThrow(/all prerequisite tasks must be in COMPLETED status/);

    // Non-active transitions like BLOCKED or CANCELLED are allowed
    expect(() => {
      db.rawDb.prepare("UPDATE plan_tasks SET status = 'BLOCKED' WHERE id = ?").run(tTarget);
    }).not.toThrow();

    // Complete the prerequisite
    db.rawDb.prepare("UPDATE plan_tasks SET status = 'COMPLETED' WHERE id = ?").run(tPrereq);

    // Now target can transition to IN_PROGRESS and COMPLETED cleanly!
    expect(() => {
      db.rawDb.prepare("UPDATE plan_tasks SET status = 'IN_PROGRESS' WHERE id = ?").run(tTarget);
    }).not.toThrow();

    expect(() => {
      db.rawDb.prepare("UPDATE plan_tasks SET status = 'COMPLETED' WHERE id = ?").run(tTarget);
    }).not.toThrow();
  });

  it("5. prevents conflicting exclusive file locks", () => {
    const planRes = db.rawDb
      .prepare(
        "INSERT INTO execution_plans (repository_id, plan_key, title, status, created_at, updated_at) VALUES (?, 'plan_locks', 'Locks Plan', 'ACTIVE', ?, ?)",
      )
      .run(repoId, now, now);
    const planId = Number(planRes.lastInsertRowid);

    const t1 = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't1', 'Task 1', 'IN_PROGRESS', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );
    const t2 = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't2', 'Task 2', 'PENDING', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );

    // Task 1 acquires exclusive lock on src/auth.ts
    db.rawDb
      .prepare(
        "INSERT INTO task_file_locks (plan_id, task_id, repository_id, relative_path, lock_type, status, acquired_at) VALUES (?, ?, ?, 'src/auth.ts', 'EXCLUSIVE', 'HELD', ?)",
      )
      .run(planId, t1, repoId, now);

    // Task 2 attempts to acquire EXCLUSIVE lock on same file -> MUST FAIL
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_file_locks (plan_id, task_id, repository_id, relative_path, lock_type, status, acquired_at) VALUES (?, ?, ?, 'src/auth.ts', 'EXCLUSIVE', 'HELD', ?)",
        )
        .run(planId, t2, repoId, now);
    }).toThrow(/Lock conflict: cannot acquire EXCLUSIVE lock/);

    // Task 2 attempts to acquire SHARED lock on same file -> MUST FAIL
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_file_locks (plan_id, task_id, repository_id, relative_path, lock_type, status, acquired_at) VALUES (?, ?, ?, 'src/auth.ts', 'SHARED', 'HELD', ?)",
        )
        .run(planId, t2, repoId, now);
    }).toThrow(/Lock conflict: cannot acquire SHARED lock/);

    // Task 1 releases lock
    db.rawDb
      .prepare(
        "UPDATE task_file_locks SET status = 'RELEASED', released_at = ? WHERE task_id = ? AND relative_path = 'src/auth.ts'",
      )
      .run(now, t1);

    // Now Task 2 can acquire lock cleanly!
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO task_file_locks (plan_id, task_id, repository_id, relative_path, lock_type, status, acquired_at) VALUES (?, ?, ?, 'src/auth.ts', 'EXCLUSIVE', 'HELD', ?)",
        )
        .run(planId, t2, repoId, now);
    }).not.toThrow();
  });

  it("6. stores handoff records and verification runs with foreign key integrity", () => {
    const planRes = db.rawDb
      .prepare(
        "INSERT INTO execution_plans (repository_id, plan_key, title, status, created_at, updated_at) VALUES (?, 'plan_handoff', 'Handoff Plan', 'ACTIVE', ?, ?)",
      )
      .run(repoId, now, now);
    const planId = Number(planRes.lastInsertRowid);

    const t1 = Number(
      db.rawDb
        .prepare(
          "INSERT INTO plan_tasks (plan_id, repository_id, task_key, title, status, created_at, updated_at) VALUES (?, ?, 't_h1', 'Task H1', 'IN_PROGRESS', ?, ?)",
        )
        .run(planId, repoId, now, now).lastInsertRowid,
    );

    // Store outgoing handoff
    const handoffPayload = JSON.stringify({
      contract: "frontier-engineer/handoff",
      taskId: "t_h1",
    });
    const hRes = db.rawDb
      .prepare(
        "INSERT INTO handoff_records (plan_id, task_id, repository_id, direction, payload_json, validation_status, from_agent, to_agent, created_at) VALUES (?, ?, ?, 'OUTGOING_HANDOFF', ?, 'VALID', 'coordinator', 'implementation-engineer', ?)",
      )
      .run(planId, t1, repoId, handoffPayload, now);
    expect(Number(hRes.lastInsertRowid)).toBeGreaterThan(0);

    // Store verification run
    const vRes = db.rawDb
      .prepare(
        "INSERT INTO verification_runs (plan_id, task_id, repository_id, status, commands_json, outcomes_json, test_states_json, summary, created_at) VALUES (?, ?, ?, 'PASSED', '[\"npm test\"]', '[\"10 passed\"]', '[\"passed\"]', 'All tests passed', ?)",
      )
      .run(planId, t1, repoId, now);
    expect(Number(vRes.lastInsertRowid)).toBeGreaterThan(0);

    const fkCheck = db.rawDb.prepare("PRAGMA foreign_key_check;").all();
    expect(fkCheck).toHaveLength(0);
  });
});
