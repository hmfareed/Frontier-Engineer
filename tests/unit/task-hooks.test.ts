/**
 * Phase 8.3 — Session Continuity & Lock Tracking Hooks Unit Tests
 * Verifies that SessionStart surfaces active plan and next-executable tasks,
 * and Stop hook surfaces active held file locks and in-progress tasks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleSessionStart } from "../../scripts/hooks/handlers/session-start.ts";
import { handleStop } from "../../scripts/hooks/handlers/stop.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { TaskEngine } from "../../scripts/task/task-engine.ts";

describe("Phase 8.3 — Session Continuity Hooks (SessionStart & Stop)", () => {
  let ws: string;
  let cm: ConnectionManager;
  let sm: StorageManager;
  let engine: TaskEngine;

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-hooks-test-"));

    // Create a mock package.json so workspace is recognized as a Frontier project
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({ name: "frontier-engineer", version: "0.7.0" }, null, 2),
      "utf8",
    );

    cm = new ConnectionManager({ workspaceRoot: ws });
    sm = new StorageManager(cm);
    await sm.initialize();
    engine = new TaskEngine(cm.getDatabase());
  });

  afterEach(() => {
    if (cm && cm.getDatabase().isOpen()) {
      cm.getDatabase().rawDb.close();
    }
    if (ws && fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("1. handleSessionStart injects active execution plan continuity banner when plan is active", () => {
    const repo = cm.getRepository();
    const plan = engine.createPlan({
      repositoryId: repo.id,
      title: "Active Roadmap Phase",
      status: "ACTIVE",
    });

    const t1 = engine.createTask({
      planId: plan.id,
      repositoryId: repo.id,
      title: "First Executable Step",
    });

    const res = handleSessionStart({
      workspacePaths: [ws],
      conversationId: "test-conv-001",
    });

    expect(res.injectSteps).toHaveLength(1);
    const msg = res.injectSteps[0].systemMessage.systemMessage;
    expect(msg).toContain("Frontier Engineer session initialized");
    expect(msg).toContain("[PLAN CONTINUITY]");
    expect(msg).toContain("Active Plan: #1 'Active Roadmap Phase' (ACTIVE, 0% complete)");
    expect(msg).toContain("Next executable: #1 'First Executable Step'");
    expect(msg).toContain("Active held locks: 0");

    const meta = res.injectSteps[0].systemMessage.metadata;
    expect(meta?.activePlan).toBeDefined();
    expect((meta?.activePlan as any)?.planId).toBe(plan.id);
  });

  it("2. handleSessionStart functions gracefully when no plans exist", () => {
    const res = handleSessionStart({
      workspacePaths: [ws],
      conversationId: "test-conv-002",
    });

    expect(res.injectSteps).toHaveLength(1);
    const msg = res.injectSteps[0].systemMessage.systemMessage;
    expect(msg).toContain("Frontier Engineer session initialized");
    expect(msg).not.toContain("[PLAN CONTINUITY]");
    expect(res.injectSteps[0].systemMessage.metadata).toBeUndefined();
  });

  it("3. handleStop logs warning and held locks metadata when locks or in-progress tasks remain", () => {
    const repo = cm.getRepository();
    const plan = engine.createPlan({
      repositoryId: repo.id,
      title: "Locking Plan",
      status: "ACTIVE",
    });

    const t1 = engine.createTask({
      planId: plan.id,
      repositoryId: repo.id,
      title: "Worker Holding Lock",
    });

    // Start task with a lock
    engine.startTask(plan.id, t1.id, { fileLocks: ["src/critical-section.ts"] });

    // Read the log before handleStop
    const auditFile = path.join(ws, ".frontier", "audit", "execution.jsonl");

    const res = handleStop({
      workspacePaths: [ws],
      conversationId: "test-conv-003",
      terminationReason: "timeout",
      executionNum: 1,
      fullyIdle: false,
    });

    expect(res).toEqual({});

    // Read generated audit log line
    expect(fs.existsSync(auditFile)).toBe(true);
    const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
    const lastLine = JSON.parse(lines[lines.length - 1]);

    expect(lastLine.eventType).toBe("Stop");
    expect(lastLine.status).toBe("info");
    expect(lastLine.normalizedSummary.summary).toContain("1 held file locks");
    expect(lastLine.normalizedSummary.summary).toContain("1 in-progress tasks");
    expect(lastLine.metadata.taskGraph).toBeDefined();
    expect(lastLine.metadata.taskGraph.activeHeldLocksCount).toBe(1);
    expect(lastLine.metadata.taskGraph.heldLocks[0].relativePath).toBe("src/critical-section.ts");
  });

  it("4. handleStop records clean status when no held locks exist", () => {
    const auditFile = path.join(ws, ".frontier", "audit", "execution.jsonl");

    handleStop({
      workspacePaths: [ws],
      conversationId: "test-conv-004",
      terminationReason: "completed",
      executionNum: 1,
      fullyIdle: true,
    });

    expect(fs.existsSync(auditFile)).toBe(true);
    const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
    const lastLine = JSON.parse(lines[lines.length - 1]);

    expect(lastLine.eventType).toBe("Stop");
    expect(lastLine.status).toBe("info");
    expect(lastLine.normalizedSummary.summary).toBe("Session stop (completed).");
  });
});
