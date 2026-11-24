/**
 * Phase 8.3 — Task Engine & Store Unit Tests
 * Verifies execution plan CRUD, task DAG topological readiness, task lifecycle
 * (start, complete, fail, cascade unblocking), file locking concurrency,
 * bidirectional handoff validation, and verification runs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import {
  runMigrations,
  CURRENT_SCHEMA_VERSION,
} from "../../scripts/storage/schema/migration-runner.ts";
import { TaskEngine } from "../../scripts/task/task-engine.ts";
import { TaskStore } from "../../scripts/task/task-store.ts";

describe("Phase 8.3 — TaskEngine & TaskStore", () => {
  let db: SqliteDatabase;
  let engine: TaskEngine;
  let store: TaskStore;
  let repoId: number;
  const now = new Date().toISOString();

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_p83_engine', '/repo/p83', 'P83 Repo', ?, ?, ?)",
      )
      .run(now, now, CURRENT_SCHEMA_VERSION);
    repoId = Number(r.lastInsertRowid);

    engine = new TaskEngine(db);
    store = engine.getStore();
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
  });

  describe("1. Execution Plan Lifecycle", () => {
    it("creates, retrieves, and lists execution plans", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Phase 8.3 Feature Rollout",
        description: "Executing persistent task graph",
        metadata: { phase: "8.3", priority: "high" },
      });

      expect(plan.id).toBeGreaterThan(0);
      expect(plan.title).toBe("Phase 8.3 Feature Rollout");
      expect(plan.planKey).toBe("plan_phase_8_3_feature_rollout");
      expect(plan.status).toBe("DRAFT");
      expect(plan.description).toBe("Executing persistent task graph");
      expect(plan.metadata).toEqual({ phase: "8.3", priority: "high" });

      // Retrieve by ID
      const byId = engine.getPlan(repoId, plan.id);
      expect(byId).not.toBeNull();
      expect(byId?.id).toBe(plan.id);

      // Retrieve by Key
      const byKey = engine.getPlan(repoId, "plan_phase_8_3_feature_rollout");
      expect(byKey).not.toBeNull();
      expect(byKey?.planKey).toBe("plan_phase_8_3_feature_rollout");

      // Custom planKey
      const customPlan = engine.createPlan({
        repositoryId: repoId,
        title: "Custom Key Plan",
        planKey: "custom_key_123",
      });
      expect(customPlan.planKey).toBe("custom_key_123");

      // List plans
      const allPlans = engine.listPlans(repoId);
      expect(allPlans).toHaveLength(2);

      const draftPlans = engine.listPlans(repoId, { status: "DRAFT" });
      expect(draftPlans).toHaveLength(2);

      const activePlans = engine.listPlans(repoId, { status: "ACTIVE" });
      expect(activePlans).toHaveLength(0);
    });

    it("rejects empty plan title", () => {
      expect(() => {
        engine.createPlan({
          repositoryId: repoId,
          title: "   ",
        });
      }).toThrow(/title cannot be empty/i);
    });

    it("updates plan status and tracks completedAt timestamp", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Status Transition Plan",
      });

      const active = store.updatePlanStatus(repoId, plan.id, "ACTIVE");
      expect(active.status).toBe("ACTIVE");
      expect(active.completedAt).toBeNull();

      const completed = store.updatePlanStatus(repoId, plan.id, "COMPLETED");
      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).not.toBeNull();
    });

    it("deletes a plan and cascades to tasks", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Plan To Delete",
      });

      engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Task in deleted plan",
      });

      expect(engine.listTasks(plan.id)).toHaveLength(1);
      const deleted = store.deletePlan(repoId, plan.id);
      expect(deleted).toBe(true);

      expect(engine.getPlan(repoId, plan.id)).toBeNull();
      expect(engine.listTasks(plan.id)).toHaveLength(0);
    });
  });

  describe("2. Plan Tasks & DAG Dependency Creation", () => {
    it("creates tasks with keys, ordering, priorities, and assigned agents", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Task Creation Plan",
      });

      const t1 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Schema Migration",
        taskKey: "step_schema_migration",
        assignedAgent: "database-engineer",
        priority: 10,
        orderIndex: 1,
      });

      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Engine Implementation",
        assignedAgent: "implementation-engineer",
        priority: 5,
        orderIndex: 2,
        prerequisiteTaskIds: [t1.id],
      });

      expect(t1.id).toBeGreaterThan(0);
      expect(t1.taskKey).toBe("step_schema_migration");
      expect(t1.assignedAgent).toBe("database-engineer");
      expect(t1.priority).toBe(10);
      expect(t1.status).toBe("PENDING");

      expect(t2.id).toBeGreaterThan(t1.id);
      expect(t2.taskKey).toBe("task_engine_implementation");

      // Verify dependency was created
      const deps = store.getDependencies(plan.id, t2.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].prerequisiteTaskId).toBe(t1.id);

      // Verify dependents query
      const dependents = store.getDependents(plan.id, t1.id);
      expect(dependents).toHaveLength(1);
      expect(dependents[0].taskId).toBe(t2.id);
    });

    it("creates tasks with prerequisiteTaskKeys", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Prereq Keys Plan",
      });

      const t1 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Task Alpha",
        taskKey: "alpha",
      });

      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Task Beta",
        taskKey: "beta",
        prerequisiteTaskKeys: ["alpha"],
      });

      const deps = store.getDependencies(plan.id, t2.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].prerequisiteTaskId).toBe(t1.id);
    });

    it("rejects unknown prerequisiteTaskKeys", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Unknown Prereq Plan",
      });

      expect(() => {
        engine.createTask({
          planId: plan.id,
          repositoryId: repoId,
          title: "Task Invalid",
          prerequisiteTaskKeys: ["non_existent_task"],
        });
      }).toThrow(/Prerequisite task key 'non_existent_task' not found/i);
    });

    it("prevents circular dependencies via SQLite trigger", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Cycle Plan",
      });

      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T1" });
      const t2 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T2" });
      const t3 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T3" });

      // T1 -> T2 -> T3
      engine.addDependency(plan.id, t2.id, t1.id);
      engine.addDependency(plan.id, t3.id, t2.id);

      // Attempt cycle: T1 depends on T3
      expect(() => {
        engine.addDependency(plan.id, t1.id, t3.id);
      }).toThrow(/cycle detected/i);

      // Attempt self-dependency: T1 depends on T1
      expect(() => {
        engine.addDependency(plan.id, t1.id, t1.id);
      }).toThrow(/self-dependency is prohibited/i);
    });
  });

  describe("3. DAG Execution Readiness & Topological Scheduling", () => {
    it("accurately evaluates isReadyToStart and getNextExecutableTasks", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Readiness Plan",
      });

      const t1 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Initial Task",
      });
      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Dependent Task 1",
        prerequisiteTaskIds: [t1.id],
      });
      const t3 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Dependent Task 2",
        prerequisiteTaskIds: [t1.id],
      });
      const t4 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Final Integration",
        prerequisiteTaskIds: [t2.id, t3.id],
      });

      // T1 has no prereqs -> ready
      expect(engine.isReadyToStart(plan.id, t1.id).ready).toBe(true);

      // T2, T3, T4 have uncompleted prereqs -> not ready
      expect(engine.isReadyToStart(plan.id, t2.id).ready).toBe(false);
      expect(engine.isReadyToStart(plan.id, t3.id).ready).toBe(false);
      expect(engine.isReadyToStart(plan.id, t4.id).ready).toBe(false);

      // getNextExecutableTasks returns only T1
      let executable = engine.getNextExecutableTasks(plan.id);
      expect(executable.map((t) => t.id)).toEqual([t1.id]);

      // Complete T1
      engine.startTask(plan.id, t1.id);
      engine.completeTask(plan.id, t1.id, { resultSummary: "T1 complete" });

      // Now T2 and T3 should be ready, but not T4
      expect(engine.isReadyToStart(plan.id, t2.id).ready).toBe(true);
      expect(engine.isReadyToStart(plan.id, t3.id).ready).toBe(true);
      expect(engine.isReadyToStart(plan.id, t4.id).ready).toBe(false);

      executable = engine.getNextExecutableTasks(plan.id);
      expect(executable.map((t) => t.id).sort()).toEqual([t2.id, t3.id].sort());

      // Complete T2
      engine.startTask(plan.id, t2.id);
      engine.completeTask(plan.id, t2.id);

      // T4 still not ready because T3 is still pending
      expect(engine.isReadyToStart(plan.id, t4.id).ready).toBe(false);

      // Complete T3
      engine.startTask(plan.id, t3.id);
      engine.completeTask(plan.id, t3.id);

      // Now T4 is ready
      expect(engine.isReadyToStart(plan.id, t4.id).ready).toBe(true);
      executable = engine.getNextExecutableTasks(plan.id);
      expect(executable.map((t) => t.id)).toEqual([t4.id]);
    });
  });

  describe("4. Task Lifecycle Execution (Start, Complete, Fail, Cascade)", () => {
    it("starts tasks, transitions plan from DRAFT to ACTIVE, and acquires locks", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Lifecycle Plan",
      });
      expect(plan.status).toBe("DRAFT");

      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Task 1" });

      const startRes = engine.startTask(plan.id, t1.id, {
        fileLocks: ["src/index.ts", "package.json"],
      });

      expect(startRes.success).toBe(true);
      expect(startRes.task.status).toBe("IN_PROGRESS");
      expect(startRes.acquiredLocks).toEqual(["src/index.ts", "package.json"]);

      // Plan automatically transitioned to ACTIVE
      const currentPlan = engine.getPlan(repoId, plan.id);
      expect(currentPlan?.status).toBe("ACTIVE");

      // Verify locks in store
      const locks = store.getTaskLocks(t1.id);
      expect(locks).toHaveLength(2);
      expect(locks.every((l) => l.status === "HELD")).toBe(true);
    });

    it("rejects starting a task when prerequisites are not completed", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Prereq Guard Plan",
      });

      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Step 1" });
      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Step 2",
        prerequisiteTaskIds: [t1.id],
      });

      expect(() => {
        engine.startTask(plan.id, t2.id);
      }).toThrow(/Cannot start task/i);
    });

    it("completes tasks, releases locks, unblocks dependents, and completes plan", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Full Completion Plan",
      });

      const t1 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Step 1",
        fileLocks: ["src/core.ts"],
      });
      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Step 2",
        prerequisiteTaskIds: [t1.id],
      });

      // Start Step 1
      engine.startTask(plan.id, t1.id);
      expect(store.getActiveLocks(repoId)).toHaveLength(1);

      // Complete Step 1 with verification
      const comp1 = engine.completeTask(plan.id, t1.id, {
        resultSummary: "Step 1 passed all verification gates",
        verification: {
          commands: ["npm test"],
          outcomes: ["All tests passed"],
          testStates: ["passed"],
          summary: "100% test pass rate",
        },
      });

      expect(comp1.success).toBe(true);
      expect(comp1.task.status).toBe("COMPLETED");
      expect(comp1.releasedLocksCount).toBe(1);
      expect(comp1.planCompleted).toBe(false);
      expect(comp1.verificationRun?.status).toBe("PASSED");
      expect(store.getActiveLocks(repoId)).toHaveLength(0);

      // Complete Step 2
      engine.startTask(plan.id, t2.id);
      const comp2 = engine.completeTask(plan.id, t2.id, {
        resultSummary: "Step 2 done",
      });

      expect(comp2.planCompleted).toBe(true);
      const finalPlan = engine.getPlan(repoId, plan.id);
      expect(finalPlan?.status).toBe("COMPLETED");
      expect(finalPlan?.completedAt).not.toBeNull();
    });

    it("fails a task, releases locks, and cascades BLOCKED status to dependents", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Failure Cascade Plan",
      });

      const t1 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Failing Step",
        fileLocks: ["critical.ts"],
      });
      const t2 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Downstream Step 1",
        prerequisiteTaskIds: [t1.id],
      });
      const t3 = engine.createTask({
        planId: plan.id,
        repositoryId: repoId,
        title: "Downstream Step 2",
        prerequisiteTaskIds: [t2.id],
      });

      engine.startTask(plan.id, t1.id);
      expect(store.getActiveLocks(repoId)).toHaveLength(1);

      const failRes = engine.failTask(plan.id, t1.id, {
        failureReason: "Compilation failed with 5 errors",
      });

      expect(failRes.success).toBe(true);
      expect(failRes.task.status).toBe("FAILED");
      expect(failRes.releasedLocksCount).toBe(1);
      expect(store.getActiveLocks(repoId)).toHaveLength(0);

      // t2 should now be BLOCKED
      const t2Refreshed = engine.getTask(plan.id, t2.id);
      expect(t2Refreshed?.status).toBe("BLOCKED");
      expect(t2Refreshed?.failureReason).toMatch(/Blocked by failure of prerequisite task/);

      // Plan progress reflects failure
      const progress = engine.getPlanProgress(repoId, plan.id);
      expect(progress.isBlocked).toBe(true);
      expect(progress.failedTasks).toBe(1);
      expect(progress.blockedTasks).toBe(1);
    });
  });

  describe("5. File Lock Concurrency Guard", () => {
    it("prevents conflicting exclusive locks across tasks", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Lock Conflict Plan",
      });

      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Worker A" });
      const t2 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Worker B" });

      // Worker A acquires lock on config.ts
      store.acquireLock(plan.id, t1.id, repoId, "src/config.ts", "EXCLUSIVE");

      // Worker B attempts to acquire exclusive lock on same path -> rejects
      expect(() => {
        store.acquireLock(plan.id, t2.id, repoId, "src/config.ts", "EXCLUSIVE");
      }).toThrow(/Lock conflict: cannot acquire EXCLUSIVE lock/i);

      // Releasing Worker A's lock allows Worker B to acquire it
      store.releaseTaskLocks(t1.id);
      const lockB = store.acquireLock(plan.id, t2.id, repoId, "src/config.ts", "EXCLUSIVE");
      expect(lockB.status).toBe("HELD");
    });
  });

  describe("6. Bidirectional Handoffs & Schema Validation", () => {
    it("records valid outgoing coordinator handoff", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Handoff Plan",
      });
      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Audit Task" });

      const validPayload = {
        contract: "frontier-engineer/handoff",
        version: 1,
        taskId: "task-001",
        requestSummary: "Perform code review",
        objective: "Review PR #42 for security flaws",
        repositoryContext: "Frontend repo",
        scope: ["src/auth/"],
        constraints: ["No external network"],
        relevantFiles: ["src/auth/jwt.ts"],
        expectedDeliverables: ["Review report"],
        acceptanceCriteria: ["All findings categorized"],
        risks: ["Token expiration edge cases"],
        requiredVerification: ["npm test"],
      };

      const res = engine.recordOutgoingHandoff(
        plan.id,
        t1.id,
        "security-auditor",
        validPayload,
        "coordinator",
      );

      expect(res.success).toBe(true);
      expect(res.handoffRecord.validationStatus).toBe("VALID");
      expect(res.handoffRecord.validationErrors).toBeNull();
      expect(res.handoffRecord.toAgent).toBe("security-auditor");

      const handoffs = store.getTaskHandoffs(t1.id);
      expect(handoffs).toHaveLength(1);
    });

    it("records invalid outgoing handoff with validation errors in audit log", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Invalid Handoff Plan",
      });
      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Bad Task" });

      const invalidPayload = {
        contract: "frontier-engineer/handoff",
        version: 1,
        // Missing required fields: taskId, objective, requestSummary, etc.
      };

      const res = engine.recordOutgoingHandoff(
        plan.id,
        t1.id,
        "implementation-engineer",
        invalidPayload,
      );

      expect(res.success).toBe(false);
      expect(res.handoffRecord.validationStatus).toBe("INVALID");
      expect(res.handoffRecord.validationErrors).not.toBeNull();
      expect(res.validationErrors?.length).toBeGreaterThan(0);
    });

    it("records valid incoming specialist response", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Response Plan",
      });
      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "Impl Task" });

      const validResponse = {
        contract: "frontier-engineer/response",
        version: 1,
        taskId: "task-001",
        findings: ["Found 2 minor issues"],
        workCompleted: ["Refactored token verification"],
        filesAffected: ["src/auth/jwt.ts"],
        decisions: ["Use standard HS256"],
        risks: ["None identified"],
        verification: {
          commands: ["npm test"],
          outcomes: ["All tests passed"],
          testStates: ["passed"],
        },
        unresolvedQuestions: [],
        handoffStatus: "complete",
      };

      const res = engine.recordIncomingResponse(
        plan.id,
        t1.id,
        "implementation-engineer",
        validResponse,
      );

      expect(res.success).toBe(true);
      expect(res.handoffRecord.validationStatus).toBe("VALID");
      expect(res.handoffRecord.direction).toBe("INCOMING_RESPONSE");
    });
  });

  describe("7. Plan Progress Summary", () => {
    it("computes accurate progress percentages and lock metrics", () => {
      const plan = engine.createPlan({
        repositoryId: repoId,
        title: "Progress Tracking Plan",
      });

      const t1 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T1" });
      const t2 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T2" });
      const t3 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T3" });
      const t4 = engine.createTask({ planId: plan.id, repositoryId: repoId, title: "T4" });

      let progress = engine.getPlanProgress(repoId, plan.id);
      expect(progress.totalTasks).toBe(4);
      expect(progress.completedTasks).toBe(0);
      expect(progress.percentComplete).toBe(0);
      expect(progress.isBlocked).toBe(false);

      // Start T1 with a lock
      engine.startTask(plan.id, t1.id, { fileLocks: ["file1.ts"] });
      progress = engine.getPlanProgress(repoId, plan.id);
      expect(progress.inProgressTasks).toBe(1);
      expect(progress.activeHeldLocksCount).toBe(1);

      // Complete T1
      engine.completeTask(plan.id, t1.id);
      progress = engine.getPlanProgress(repoId, plan.id);
      expect(progress.completedTasks).toBe(1);
      expect(progress.percentComplete).toBe(25);
      expect(progress.activeHeldLocksCount).toBe(0);

      // Complete T2
      engine.startTask(plan.id, t2.id);
      engine.completeTask(plan.id, t2.id);
      progress = engine.getPlanProgress(repoId, plan.id);
      expect(progress.completedTasks).toBe(2);
      expect(progress.percentComplete).toBe(50);
    });
  });
});
