/**
 * Phase 8.3 — Persistent Task Graph & Execution Engine
 * Orchestrates DAG task scheduling, topological sorting, prerequisite completion guards,
 * concurrency-safe file locking, and bidirectional coordinator/specialist handoff tracking.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { TaskStore } from "./task-store.ts";
import { HandoffValidator } from "./handoff-validator.ts";
import type {
  ExecutionPlanRecord,
  PlanTaskRecord,
  CreatePlanInput,
  CreateTaskInput,
  PlanProgressSummary,
  TaskStatus,
  HandoffRecord,
  VerificationRunRecord,
} from "./types.ts";

export interface StartTaskResult {
  success: boolean;
  task: PlanTaskRecord;
  acquiredLocks: string[];
}

export interface CompleteTaskResult {
  success: boolean;
  task: PlanTaskRecord;
  releasedLocksCount: number;
  unblockedTasks: PlanTaskRecord[];
  planCompleted: boolean;
  verificationRun?: VerificationRunRecord;
}

export interface FailTaskResult {
  success: boolean;
  task: PlanTaskRecord;
  releasedLocksCount: number;
  blockedDependents: PlanTaskRecord[];
}

export interface HandoffExecutionResult {
  success: boolean;
  handoffRecord: HandoffRecord;
  validationErrors?: string[];
}

export class TaskEngine {
  private db: SqliteDatabase;
  private store: TaskStore;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.store = new TaskStore(db);
  }

  public getStore(): TaskStore {
    return this.store;
  }

  // ==========================================
  // Plan Operations
  // ==========================================

  public createPlan(input: CreatePlanInput): ExecutionPlanRecord {
    return this.store.createPlan(input);
  }

  public getPlan(repositoryId: number, planIdOrKey: number | string): ExecutionPlanRecord | null {
    if (typeof planIdOrKey === "number" || /^\d+$/.test(String(planIdOrKey).trim())) {
      const id =
        typeof planIdOrKey === "number" ? planIdOrKey : parseInt(String(planIdOrKey).trim(), 10);
      return this.store.getPlan(repositoryId, id);
    }
    return this.store.getPlanByKey(repositoryId, String(planIdOrKey).trim());
  }

  public listPlans(repositoryId: number, filter?: { status?: any }): ExecutionPlanRecord[] {
    return this.store.listPlans(repositoryId, filter);
  }

  public getPlanProgress(repositoryId: number, planIdOrKey: number | string): PlanProgressSummary {
    const plan = this.getPlan(repositoryId, planIdOrKey);
    if (!plan) {
      throw new Error(`Execution plan '${planIdOrKey}' not found in repository ${repositoryId}`);
    }

    const tasks = this.store.listTasks(plan.id);
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
    const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const pendingTasks = tasks.filter((t) => t.status === "PENDING").length;
    const blockedTasks = tasks.filter((t) => t.status === "BLOCKED").length;
    const failedTasks = tasks.filter((t) => t.status === "FAILED").length;

    const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const activeHeldLocks = this.store
      .getActiveLocks(repositoryId)
      .filter((l) => l.planId === plan.id);

    return {
      planId: plan.id,
      planKey: plan.planKey,
      title: plan.title,
      status: plan.status,
      totalTasks,
      completedTasks,
      inProgressTasks,
      pendingTasks,
      blockedTasks,
      failedTasks,
      percentComplete,
      isBlocked: blockedTasks > 0 || failedTasks > 0,
      activeHeldLocksCount: activeHeldLocks.length,
    };
  }

  // ==========================================
  // Task Operations
  // ==========================================

  public createTask(input: CreateTaskInput): PlanTaskRecord {
    return this.store.createTask(input);
  }

  public getTask(planId: number, taskIdOrKey: number | string): PlanTaskRecord | null {
    if (typeof taskIdOrKey === "number" || /^\d+$/.test(String(taskIdOrKey).trim())) {
      const id =
        typeof taskIdOrKey === "number" ? taskIdOrKey : parseInt(String(taskIdOrKey).trim(), 10);
      return this.store.getTask(planId, id);
    }
    return this.store.getTaskByKey(planId, String(taskIdOrKey).trim());
  }

  public listTasks(planId: number): PlanTaskRecord[] {
    return this.store.listTasks(planId);
  }

  public addDependency(planId: number, taskId: number, prereqTaskId: number) {
    return this.store.addDependency(planId, taskId, prereqTaskId);
  }

  /**
   * Evaluates whether a task is ready to start (all prerequisite tasks in the DAG are COMPLETED).
   */
  public isReadyToStart(planId: number, taskId: number): { ready: boolean; reason?: string } {
    const task = this.store.getTask(planId, taskId);
    if (!task) {
      return { ready: false, reason: `Task #${taskId} not found` };
    }

    if (task.status === "COMPLETED") {
      return { ready: false, reason: `Task #${taskId} is already COMPLETED` };
    }

    const dependencies = this.store.getDependencies(planId, taskId);
    for (const dep of dependencies) {
      const prereq = this.store.getTask(planId, dep.prerequisiteTaskId);
      if (!prereq || prereq.status !== "COMPLETED") {
        return {
          ready: false,
          reason: `Prerequisite task #${dep.prerequisiteTaskId} ('${prereq?.title ?? "unknown"}') is in ${prereq?.status ?? "UNKNOWN"} status (must be COMPLETED)`,
        };
      }
    }

    return { ready: true };
  }

  /**
   * Returns all tasks in a plan whose prerequisites are satisfied and can be started immediately.
   */
  public getNextExecutableTasks(planId: number): PlanTaskRecord[] {
    const allTasks = this.store.listTasks(planId);
    const candidateTasks = allTasks.filter((t) => t.status === "PENDING" || t.status === "BLOCKED");

    return candidateTasks.filter((t) => {
      const check = this.isReadyToStart(planId, t.id);
      return check.ready;
    });
  }

  /**
   * Starts a task: verifies prerequisite completion, acquires requested file locks atomically,
   * and transitions task status to IN_PROGRESS.
   */
  public startTask(
    planId: number,
    taskId: number,
    options: { agent?: string; fileLocks?: string[] } = {},
  ): StartTaskResult {
    return this.db.transaction(() => {
      const task = this.store.getTask(planId, taskId);
      if (!task) {
        throw new Error(`Task #${taskId} not found in plan #${planId}`);
      }

      const check = this.isReadyToStart(planId, taskId);
      if (!check.ready) {
        throw new Error(`Cannot start task #${taskId}: ${check.reason}`);
      }

      // If plan is in DRAFT, activate it
      const plan = this.store.getPlan(task.repositoryId, planId);
      if (plan && plan.status === "DRAFT") {
        this.store.updatePlanStatus(task.repositoryId, planId, "ACTIVE");
      }

      // Acquire file locks if requested
      const acquiredLocks: string[] = [];
      if (options.fileLocks && options.fileLocks.length > 0) {
        for (const f of options.fileLocks) {
          this.store.acquireLock(planId, taskId, task.repositoryId, f, "EXCLUSIVE");
          acquiredLocks.push(f);
        }
      }

      const updated = this.store.updateTaskStatus(taskId, "IN_PROGRESS");
      return {
        success: true,
        task: updated,
        acquiredLocks,
      };
    });
  }

  /**
   * Completes a task: releases all held file locks, sets status to COMPLETED, records verification run,
   * unblocks downstream dependents whose prerequisites are now satisfied, and completes the plan if all tasks are done.
   */
  public completeTask(
    planId: number,
    taskId: number,
    options: {
      resultSummary?: string;
      verification?: {
        commands: string[];
        outcomes: string[];
        testStates: string[];
        summary?: string;
      };
    } = {},
  ): CompleteTaskResult {
    return this.db.transaction(() => {
      const task = this.store.getTask(planId, taskId);
      if (!task) {
        throw new Error(`Task #${taskId} not found in plan #${planId}`);
      }

      // Release any held locks for this task
      const releasedLocksCount = this.store.releaseTaskLocks(taskId);

      // Record verification run if provided
      let verificationRun: VerificationRunRecord | undefined;
      if (options.verification) {
        verificationRun = this.store.recordVerificationRun(
          planId,
          taskId,
          task.repositoryId,
          "PASSED",
          options.verification.commands,
          options.verification.outcomes,
          options.verification.testStates,
          options.verification.summary,
        );
      }

      // Update task status to COMPLETED
      const updated = this.store.updateTaskStatus(taskId, "COMPLETED", {
        resultSummary: options.resultSummary,
      });

      // Find dependent tasks and unblock those whose prerequisites are now completely satisfied
      const dependents = this.store.getDependents(planId, taskId);
      const unblockedTasks: PlanTaskRecord[] = [];

      for (const dep of dependents) {
        const dependentTask = this.store.getTask(planId, dep.taskId);
        if (dependentTask && dependentTask.status === "BLOCKED") {
          const readiness = this.isReadyToStart(planId, dependentTask.id);
          if (readiness.ready) {
            const unblocked = this.store.updateTaskStatus(dependentTask.id, "PENDING");
            unblockedTasks.push(unblocked);
          }
        }
      }

      // Check if all non-cancelled tasks in the plan are completed
      const allTasks = this.store.listTasks(planId);
      const incomplete = allTasks.filter(
        (t) => t.status !== "COMPLETED" && t.status !== "CANCELLED",
      );
      const planCompleted = allTasks.length > 0 && incomplete.length === 0;

      if (planCompleted) {
        this.store.updatePlanStatus(task.repositoryId, planId, "COMPLETED");
      }

      return {
        success: true,
        task: updated,
        releasedLocksCount,
        unblockedTasks,
        planCompleted,
        verificationRun,
      };
    });
  }

  /**
   * Fails a task: releases held locks, sets status to FAILED, and transitions dependent tasks to BLOCKED.
   */
  public failTask(
    planId: number,
    taskId: number,
    options: { failureReason?: string } = {},
  ): FailTaskResult {
    return this.db.transaction(() => {
      const task = this.store.getTask(planId, taskId);
      if (!task) {
        throw new Error(`Task #${taskId} not found in plan #${planId}`);
      }

      const releasedLocksCount = this.store.releaseTaskLocks(taskId);

      const updated = this.store.updateTaskStatus(taskId, "FAILED", {
        failureReason: options.failureReason,
      });

      // Cascade failure: block all downstream dependent tasks
      const dependents = this.store.getDependents(planId, taskId);
      const blockedDependents: PlanTaskRecord[] = [];

      for (const dep of dependents) {
        const depTask = this.store.getTask(planId, dep.taskId);
        if (depTask && depTask.status !== "COMPLETED" && depTask.status !== "CANCELLED") {
          const blocked = this.store.updateTaskStatus(depTask.id, "BLOCKED", {
            failureReason: `Blocked by failure of prerequisite task #${taskId} ('${task.title}')`,
          });
          blockedDependents.push(blocked);
        }
      }

      return {
        success: true,
        task: updated,
        releasedLocksCount,
        blockedDependents,
      };
    });
  }

  // ==========================================
  // Handoff & Specialist Response Operations
  // ==========================================

  public recordOutgoingHandoff(
    planId: number,
    taskId: number,
    toAgent: string,
    payload: unknown,
    fromAgent = "coordinator",
  ): HandoffExecutionResult {
    const task = this.store.getTask(planId, taskId);
    if (!task) {
      throw new Error(`Task #${taskId} not found in plan #${planId}`);
    }

    const validation = HandoffValidator.validateOutgoingHandoff(payload);
    const handoffRecord = this.store.recordHandoff(
      planId,
      taskId,
      task.repositoryId,
      "OUTGOING_HANDOFF",
      payload,
      fromAgent,
      toAgent,
    );

    return {
      success: validation.valid,
      handoffRecord,
      validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
    };
  }

  public recordIncomingResponse(
    planId: number,
    taskId: number,
    fromAgent: string,
    payload: unknown,
    toAgent = "coordinator",
  ): HandoffExecutionResult {
    const task = this.store.getTask(planId, taskId);
    if (!task) {
      throw new Error(`Task #${taskId} not found in plan #${planId}`);
    }

    const validation = HandoffValidator.validateIncomingResponse(payload);
    const handoffRecord = this.store.recordHandoff(
      planId,
      taskId,
      task.repositoryId,
      "INCOMING_RESPONSE",
      payload,
      fromAgent,
      toAgent,
    );

    return {
      success: validation.valid,
      handoffRecord,
      validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
    };
  }
}
