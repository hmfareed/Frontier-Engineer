/**
 * Phase 8.3 — Persistent Task Graph Data Access Store
 * Encapsulates transactional CRUD operations for execution plans, plan tasks,
 * DAG task dependencies, task file locks, handoff audit records, and verification runs.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { HandoffValidator } from "./handoff-validator.ts";
import type {
  ExecutionPlanRecord,
  PlanTaskRecord,
  TaskDependencyRecord,
  TaskFileLockRecord,
  HandoffRecord,
  VerificationRunRecord,
  CreatePlanInput,
  CreateTaskInput,
  PlanStatus,
  TaskStatus,
  LockType,
  HandoffDirection,
  VerificationStatus,
} from "./types.ts";

export class TaskStore {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  // ==========================================
  // Execution Plans
  // ==========================================

  public createPlan(input: CreatePlanInput): ExecutionPlanRecord {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error("Execution plan title cannot be empty");
    }

    const title = input.title.trim();
    const planKey =
      input.planKey && input.planKey.trim().length > 0
        ? input.planKey
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_")
        : `plan_${
            title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .slice(0, 48)
              .replace(/^_+|_+$/g, "") || "entry"
          }`;

    const now = new Date().toISOString();
    const status: PlanStatus = input.status ?? "DRAFT";
    const description = input.description?.trim() || null;
    const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;

    const res = this.db
      .prepare(
        `INSERT INTO execution_plans (
          repository_id, plan_key, title, description, status, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.repositoryId, planKey, title, description, status, now, now, metadataStr);

    const planId = Number(res.lastInsertRowid);
    const created = this.getPlan(input.repositoryId, planId);
    if (!created) {
      throw new Error(`Failed to retrieve created execution plan #${planId}`);
    }
    return created;
  }

  public getPlan(repositoryId: number, planId: number): ExecutionPlanRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, plan_key AS planKey, title, description,
          status, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt,
          metadata
        FROM execution_plans
        WHERE repository_id = ? AND id = ?`,
      )
      .get(repositoryId, planId) as any;

    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public getPlanByKey(repositoryId: number, planKey: string): ExecutionPlanRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, plan_key AS planKey, title, description,
          status, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt,
          metadata
        FROM execution_plans
        WHERE repository_id = ? AND plan_key = ?`,
      )
      .get(repositoryId, planKey) as any;

    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public listPlans(repositoryId: number, filter?: { status?: PlanStatus }): ExecutionPlanRecord[] {
    let sql = `SELECT
        id, repository_id AS repositoryId, plan_key AS planKey, title, description,
        status, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt,
        metadata
      FROM execution_plans
      WHERE repository_id = ?`;
    const params: any[] = [repositoryId];

    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    sql += " ORDER BY id DESC";

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }

  public updatePlanStatus(
    repositoryId: number,
    planId: number,
    status: PlanStatus,
  ): ExecutionPlanRecord {
    const current = this.getPlan(repositoryId, planId);
    if (!current) {
      throw new Error(`Execution plan #${planId} not found in repository ${repositoryId}`);
    }

    const now = new Date().toISOString();
    const completedAt =
      status === "COMPLETED" || status === "CANCELLED" || status === "FAILED" ? now : null;

    this.db
      .prepare(
        `UPDATE execution_plans SET
          status = ?,
          updated_at = ?,
          completed_at = COALESCE(?, completed_at)
        WHERE repository_id = ? AND id = ?`,
      )
      .run(status, now, completedAt, repositoryId, planId);

    const updated = this.getPlan(repositoryId, planId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated plan #${planId}`);
    }
    return updated;
  }

  public deletePlan(repositoryId: number, planId: number): boolean {
    const res = this.db
      .prepare("DELETE FROM execution_plans WHERE repository_id = ? AND id = ?")
      .run(repositoryId, planId);
    return Number(res.changes) > 0;
  }

  // ==========================================
  // Plan Tasks
  // ==========================================

  public createTask(input: CreateTaskInput): PlanTaskRecord {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error("Task title cannot be empty");
    }

    const title = input.title.trim();
    const taskKey =
      input.taskKey && input.taskKey.trim().length > 0
        ? input.taskKey
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_")
        : `task_${
            title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .slice(0, 48)
              .replace(/^_+|_+$/g, "") || "item"
          }`;

    const now = new Date().toISOString();
    const description = input.description?.trim() || null;
    const assignedAgent = input.assignedAgent?.trim() || null;
    const priority = input.priority ?? 0;
    const orderIndex = input.orderIndex ?? 0;
    const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;

    return this.db.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO plan_tasks (
            plan_id, repository_id, task_key, title, description, assigned_agent,
            status, priority, order_index, created_at, updated_at, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
        )
        .run(
          input.planId,
          input.repositoryId,
          taskKey,
          title,
          description,
          assignedAgent,
          priority,
          orderIndex,
          now,
          now,
          metadataStr,
        );

      const taskId = Number(res.lastInsertRowid);

      // Add prerequisites by ID if provided
      if (input.prerequisiteTaskIds && input.prerequisiteTaskIds.length > 0) {
        for (const prereqId of input.prerequisiteTaskIds) {
          this.addDependency(input.planId, taskId, prereqId);
        }
      }

      // Add prerequisites by key if provided
      if (input.prerequisiteTaskKeys && input.prerequisiteTaskKeys.length > 0) {
        for (const prereqKey of input.prerequisiteTaskKeys) {
          const prereqTask = this.getTaskByKey(input.planId, prereqKey);
          if (!prereqTask) {
            throw new Error(
              `Prerequisite task key '${prereqKey}' not found in plan #${input.planId}`,
            );
          }
          this.addDependency(input.planId, taskId, prereqTask.id);
        }
      }

      // Add file locks if provided
      if (input.fileLocks && input.fileLocks.length > 0) {
        for (const f of input.fileLocks) {
          this.acquireLock(input.planId, taskId, input.repositoryId, f, "EXCLUSIVE");
        }
      }

      const task = this.getTask(input.planId, taskId);
      if (!task) {
        throw new Error(`Failed to retrieve created task #${taskId}`);
      }
      return task;
    });
  }

  public getTask(planId: number, taskId: number): PlanTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, repository_id AS repositoryId, task_key AS taskKey,
          title, description, assigned_agent AS assignedAgent, status, priority,
          order_index AS orderIndex, created_at AS createdAt, updated_at AS updatedAt,
          completed_at AS completedAt, result_summary AS resultSummary,
          failure_reason AS failureReason, metadata
        FROM plan_tasks
        WHERE plan_id = ? AND id = ?`,
      )
      .get(planId, taskId) as any;

    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public getTaskById(taskId: number): PlanTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, repository_id AS repositoryId, task_key AS taskKey,
          title, description, assigned_agent AS assignedAgent, status, priority,
          order_index AS orderIndex, created_at AS createdAt, updated_at AS updatedAt,
          completed_at AS completedAt, result_summary AS resultSummary,
          failure_reason AS failureReason, metadata
        FROM plan_tasks
        WHERE id = ?`,
      )
      .get(taskId) as any;

    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public getTaskByKey(planId: number, taskKey: string): PlanTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, repository_id AS repositoryId, task_key AS taskKey,
          title, description, assigned_agent AS assignedAgent, status, priority,
          order_index AS orderIndex, created_at AS createdAt, updated_at AS updatedAt,
          completed_at AS completedAt, result_summary AS resultSummary,
          failure_reason AS failureReason, metadata
        FROM plan_tasks
        WHERE plan_id = ? AND task_key = ?`,
      )
      .get(planId, taskKey) as any;

    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public listTasks(planId: number): PlanTaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, repository_id AS repositoryId, task_key AS taskKey,
          title, description, assigned_agent AS assignedAgent, status, priority,
          order_index AS orderIndex, created_at AS createdAt, updated_at AS updatedAt,
          completed_at AS completedAt, result_summary AS resultSummary,
          failure_reason AS failureReason, metadata
        FROM plan_tasks
        WHERE plan_id = ?
        ORDER BY order_index ASC, id ASC`,
      )
      .all(planId) as any[];

    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }

  public updateTaskStatus(
    taskId: number,
    status: TaskStatus,
    options?: { resultSummary?: string; failureReason?: string },
  ): PlanTaskRecord {
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error(`Plan task #${taskId} not found`);
    }

    const now = new Date().toISOString();
    const completedAt =
      status === "COMPLETED" || status === "CANCELLED" || status === "FAILED" ? now : null;

    this.db
      .prepare(
        `UPDATE plan_tasks SET
          status = ?,
          updated_at = ?,
          completed_at = COALESCE(?, completed_at),
          result_summary = COALESCE(?, result_summary),
          failure_reason = COALESCE(?, failure_reason)
        WHERE id = ?`,
      )
      .run(
        status,
        now,
        completedAt,
        options?.resultSummary ?? null,
        options?.failureReason ?? null,
        taskId,
      );

    const updated = this.getTaskById(taskId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated task #${taskId}`);
    }
    return updated;
  }

  public deleteTask(planId: number, taskId: number): boolean {
    const res = this.db
      .prepare("DELETE FROM plan_tasks WHERE plan_id = ? AND id = ?")
      .run(planId, taskId);
    return Number(res.changes) > 0;
  }

  // ==========================================
  // Task Dependencies
  // ==========================================

  public addDependency(
    planId: number,
    taskId: number,
    prerequisiteTaskId: number,
  ): TaskDependencyRecord {
    const now = new Date().toISOString();

    const res = this.db
      .prepare(
        `INSERT INTO task_dependencies (
          plan_id, task_id, prerequisite_task_id, created_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(planId, taskId, prerequisiteTaskId, now);

    return {
      id: Number(res.lastInsertRowid),
      planId,
      taskId,
      prerequisiteTaskId,
      createdAt: now,
    };
  }

  public getDependencies(planId: number, taskId: number): TaskDependencyRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId,
          prerequisite_task_id AS prerequisiteTaskId, created_at AS createdAt
        FROM task_dependencies
        WHERE plan_id = ? AND task_id = ?
        ORDER BY id ASC`,
      )
      .all(planId, taskId) as unknown as TaskDependencyRecord[];
  }

  public getDependents(planId: number, prerequisiteTaskId: number): TaskDependencyRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId,
          prerequisite_task_id AS prerequisiteTaskId, created_at AS createdAt
        FROM task_dependencies
        WHERE plan_id = ? AND prerequisite_task_id = ?
        ORDER BY id ASC`,
      )
      .all(planId, prerequisiteTaskId) as unknown as TaskDependencyRecord[];
  }

  // ==========================================
  // File Locks
  // ==========================================

  public acquireLock(
    planId: number,
    taskId: number,
    repositoryId: number,
    relativePath: string,
    lockType: LockType = "EXCLUSIVE",
  ): TaskFileLockRecord {
    const normalized = relativePath.trim().replace(/\\/g, "/");
    const now = new Date().toISOString();

    const res = this.db
      .prepare(
        `INSERT INTO task_file_locks (
          plan_id, task_id, repository_id, relative_path, lock_type, status, acquired_at
        ) VALUES (?, ?, ?, ?, ?, 'HELD', ?)`,
      )
      .run(planId, taskId, repositoryId, normalized, lockType, now);

    return {
      id: Number(res.lastInsertRowid),
      planId,
      taskId,
      repositoryId,
      relativePath: normalized,
      lockType,
      status: "HELD",
      acquiredAt: now,
      releasedAt: null,
    };
  }

  public releaseTaskLocks(taskId: number): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE task_file_locks SET
          status = 'RELEASED',
          released_at = ?
        WHERE task_id = ? AND status = 'HELD'`,
      )
      .run(now, taskId);
    return Number(res.changes);
  }

  public getActiveLocks(repositoryId: number): TaskFileLockRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId, repository_id AS repositoryId,
          relative_path AS relativePath, lock_type AS lockType, status,
          acquired_at AS acquiredAt, released_at AS releasedAt
        FROM task_file_locks
        WHERE repository_id = ? AND status = 'HELD'
        ORDER BY id ASC`,
      )
      .all(repositoryId) as unknown as TaskFileLockRecord[];
  }

  public getTaskLocks(taskId: number): TaskFileLockRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId, repository_id AS repositoryId,
          relative_path AS relativePath, lock_type AS lockType, status,
          acquired_at AS acquiredAt, released_at AS releasedAt
        FROM task_file_locks
        WHERE task_id = ?
        ORDER BY id ASC`,
      )
      .all(taskId) as unknown as TaskFileLockRecord[];
  }

  // ==========================================
  // Handoff & Response Records
  // ==========================================

  public recordHandoff(
    planId: number,
    taskId: number,
    repositoryId: number,
    direction: HandoffDirection,
    payload: unknown,
    fromAgent?: string,
    toAgent?: string,
  ): HandoffRecord {
    const validation =
      direction === "OUTGOING_HANDOFF"
        ? HandoffValidator.validateOutgoingHandoff(payload)
        : HandoffValidator.validateIncomingResponse(payload);

    const now = new Date().toISOString();
    const payloadJson = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const errorsJson = validation.errors.length > 0 ? JSON.stringify(validation.errors) : null;

    const res = this.db
      .prepare(
        `INSERT INTO handoff_records (
          plan_id, task_id, repository_id, direction, payload_json,
          validation_status, validation_errors, from_agent, to_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        taskId,
        repositoryId,
        direction,
        payloadJson,
        validation.status,
        errorsJson,
        fromAgent ?? null,
        toAgent ?? null,
        now,
      );

    return {
      id: Number(res.lastInsertRowid),
      planId,
      taskId,
      repositoryId,
      direction,
      payloadJson,
      validationStatus: validation.status,
      validationErrors: validation.errors.length > 0 ? validation.errors : null,
      fromAgent: fromAgent ?? null,
      toAgent: toAgent ?? null,
      createdAt: now,
    };
  }

  public getTaskHandoffs(taskId: number): HandoffRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId, repository_id AS repositoryId,
          direction, payload_json AS payloadJson, validation_status AS validationStatus,
          validation_errors AS validationErrors, from_agent AS fromAgent, to_agent AS toAgent,
          created_at AS createdAt
        FROM handoff_records
        WHERE task_id = ?
        ORDER BY id ASC`,
      )
      .all(taskId) as any[];

    return rows.map((r) => ({
      ...r,
      validationErrors: r.validationErrors ? JSON.parse(r.validationErrors) : null,
    }));
  }

  // ==========================================
  // Verification Runs
  // ==========================================

  public recordVerificationRun(
    planId: number,
    taskId: number,
    repositoryId: number,
    status: VerificationStatus,
    commands: string[],
    outcomes: string[],
    testStates: string[],
    summary?: string,
  ): VerificationRunRecord {
    const now = new Date().toISOString();

    const res = this.db
      .prepare(
        `INSERT INTO verification_runs (
          plan_id, task_id, repository_id, status, commands_json, outcomes_json,
          test_states_json, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        taskId,
        repositoryId,
        status,
        JSON.stringify(commands),
        JSON.stringify(outcomes),
        JSON.stringify(testStates),
        summary ?? null,
        now,
      );

    return {
      id: Number(res.lastInsertRowid),
      planId,
      taskId,
      repositoryId,
      status,
      commands,
      outcomes,
      testStates,
      summary: summary ?? null,
      createdAt: now,
    };
  }

  public getTaskVerificationRuns(taskId: number): VerificationRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, plan_id AS planId, task_id AS taskId, repository_id AS repositoryId,
          status, commands_json AS commandsJson, outcomes_json AS outcomesJson,
          test_states_json AS testStatesJson, summary, created_at AS createdAt
        FROM verification_runs
        WHERE task_id = ?
        ORDER BY id ASC`,
      )
      .all(taskId) as any[];

    return rows.map((r) => ({
      id: r.id,
      planId: r.planId,
      taskId: r.taskId,
      repositoryId: r.repositoryId,
      status: r.status,
      commands: JSON.parse(r.commandsJson),
      outcomes: JSON.parse(r.outcomesJson),
      testStates: JSON.parse(r.testStatesJson),
      summary: r.summary,
      createdAt: r.createdAt,
    }));
  }
}
