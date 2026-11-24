/**
 * Phase 8.3 — CLI Task Graph Integration Tests
 * Tests plan and task CLI commands end-to-end: plan create/list/show/progress/delete,
 * task create/list/next/start/complete/fail/handoff/response, DAG topological execution,
 * file lock management, and JSON schema contract validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../scripts/cli/frontier-cli.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";

describe("Phase 8.3 — CLI Task Graph Integration", () => {
  let ws: string;
  let cm: ConnectionManager;
  let sm: StorageManager;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];
  let origStdoutWrite: typeof process.stdout.write;
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-cli-task-"));

    cm = new ConnectionManager({ workspaceRoot: ws });
    sm = new StorageManager(cm);
    await sm.initialize();

    stdoutChunks = [];
    stderrChunks = [];
    origStdoutWrite = process.stdout.write;
    origStderrWrite = process.stderr.write;

    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any;

    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;
  });

  afterEach(async () => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;

    if (cm && cm.getDatabase().isOpen()) {
      cm.getDatabase().rawDb.close();
    }
    if (ws && fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  const getStdout = () => stdoutChunks.join("");
  const getStderr = () => stderrChunks.join("");

  it("1. creates, lists, and inspects execution plans via CLI", async () => {
    const exitCode = await runCli([
      "--workspace",
      ws,
      "plan",
      "create",
      "--title",
      "Phase 8.3 Rollout",
      "--description",
      "End-to-end task graph rollout",
    ]);

    expect(exitCode).toBe(0);
    expect(getStdout()).toContain("Frontier Engineer — Execution Plan Created");
    expect(getStdout()).toContain("plan_phase_8_3_rollout");
    expect(getStdout()).toContain("DRAFT");

    stdoutChunks = [];
    const listCode = await runCli(["--workspace", ws, "plan", "list"]);
    expect(listCode).toBe(0);
    expect(getStdout()).toContain("Execution Plans (1)");
    expect(getStdout()).toContain("plan_phase_8_3_rollout");

    stdoutChunks = [];
    const showCode = await runCli([
      "--workspace",
      ws,
      "--format",
      "json",
      "plan",
      "show",
      "plan_phase_8_3_rollout",
    ]);
    expect(showCode).toBe(0);
    const parsed = JSON.parse(getStdout());
    expect(parsed.plan.title).toBe("Phase 8.3 Rollout");
    expect(parsed.progress.totalTasks).toBe(0);
  });

  it("2. creates tasks with DAG dependencies, file locks, and agents", async () => {
    await runCli([
      "--workspace",
      ws,
      "plan",
      "create",
      "--title",
      "Pipeline Plan",
      "--key",
      "pipe_plan",
    ]);

    stdoutChunks = [];
    const t1Code = await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "pipe_plan",
      "--title",
      "Step Alpha",
      "--key",
      "step_alpha",
      "--agent",
      "architect",
      "--files",
      "src/arch.ts",
    ]);
    expect(t1Code).toBe(0);
    expect(getStdout()).toContain("Task Created");
    expect(getStdout()).toContain("step_alpha");

    stdoutChunks = [];
    const t2Code = await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "pipe_plan",
      "--title",
      "Step Beta",
      "--key",
      "step_beta",
      "--agent",
      "implementation-engineer",
      "--depends-on",
      "step_alpha",
      "--files",
      "src/impl.ts",
    ]);
    expect(t2Code).toBe(0);
    expect(getStdout()).toContain("step_beta");

    stdoutChunks = [];
    const listCode = await runCli(["--workspace", ws, "task", "list", "pipe_plan"]);
    expect(listCode).toBe(0);
    expect(getStdout()).toContain("Tasks for Plan #1");
    expect(getStdout()).toContain("step_alpha");
    expect(getStdout()).toContain("step_beta");
  });

  it("3. checks next executable tasks, starts, completes, and unblocks downstream tasks", async () => {
    await runCli([
      "--workspace",
      ws,
      "plan",
      "create",
      "--title",
      "Exec Plan",
      "--key",
      "exec_plan",
    ]);
    await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "exec_plan",
      "--title",
      "Task 1",
      "--key",
      "t1",
    ]);
    await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "exec_plan",
      "--title",
      "Task 2",
      "--key",
      "t2",
      "--depends-on",
      "t1",
    ]);

    // Check next executable tasks -> only t1 should be ready
    stdoutChunks = [];
    const nextCode = await runCli(["--workspace", ws, "task", "next", "exec_plan"]);
    expect(nextCode).toBe(0);
    expect(getStdout()).toContain("Next Executable Tasks for Plan #1 (1)");
    expect(getStdout()).toContain("t1");
    expect(getStdout()).not.toContain("t2");

    // Start Task 1
    stdoutChunks = [];
    const startCode = await runCli([
      "--workspace",
      ws,
      "task",
      "start",
      "1",
      "--files",
      "src/file1.ts",
    ]);
    expect(startCode).toBe(0);
    expect(getStdout()).toContain("Task #1 Started");
    expect(getStdout()).toContain("src/file1.ts");

    // Complete Task 1
    stdoutChunks = [];
    const compCode = await runCli([
      "--workspace",
      ws,
      "task",
      "complete",
      "1",
      "--summary",
      "Task 1 completed successfully",
    ]);
    expect(compCode).toBe(0);
    expect(getStdout()).toContain("Task #1 Completed");
    expect(getStdout()).toContain("Released Locks: 1");

    // Now Task 2 should be next
    stdoutChunks = [];
    await runCli(["--workspace", ws, "task", "next", "exec_plan"]);
    expect(getStdout()).toContain("t2");

    // Start and complete Task 2 -> plan completed
    await runCli(["--workspace", ws, "task", "start", "2"]);
    stdoutChunks = [];
    const comp2Code = await runCli([
      "--workspace",
      ws,
      "task",
      "complete",
      "2",
      "--summary",
      "Task 2 done",
    ]);
    expect(comp2Code).toBe(0);
    expect(getStdout()).toContain("Plan Complete:  YES");

    // Check plan progress
    stdoutChunks = [];
    const progCode = await runCli(["--workspace", ws, "plan", "progress", "exec_plan"]);
    expect(progCode).toBe(0);
    expect(getStdout()).toContain("Completion:  100% (2/2 completed)");
    expect(getStdout()).toContain("Is Blocked:  NO");
  });

  it("4. handles task failure and cascades BLOCKED state to dependent tasks", async () => {
    await runCli([
      "--workspace",
      ws,
      "plan",
      "create",
      "--title",
      "Fail Plan",
      "--key",
      "fail_plan",
    ]);
    await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "fail_plan",
      "--title",
      "Step X",
      "--key",
      "sx",
    ]);
    await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "fail_plan",
      "--title",
      "Step Y",
      "--key",
      "sy",
      "--depends-on",
      "sx",
    ]);

    // Start Step X with a lock
    await runCli(["--workspace", ws, "task", "start", "1", "--files", "critical.ts"]);

    // Fail Step X
    stdoutChunks = [];
    const failCode = await runCli([
      "--workspace",
      ws,
      "task",
      "fail",
      "1",
      "--reason",
      "Severe dependency incompatibility",
    ]);
    expect(failCode).toBe(0);
    expect(getStdout()).toContain("Task #1 Failed");
    expect(getStdout()).toContain("Released Locks: 1");
    expect(getStdout()).toContain("Blocked:        1 downstream tasks");

    // Step Y should be BLOCKED
    stdoutChunks = [];
    await runCli(["--workspace", ws, "task", "show", "2"]);
    expect(getStdout()).toContain("BLOCKED");

    // Plan progress should show blocked
    stdoutChunks = [];
    await runCli(["--workspace", ws, "plan", "progress", "fail_plan"]);
    expect(getStdout()).toContain("Is Blocked:  YES");
    expect(getStdout()).toContain("1 blocked, 1 failed");
  });

  it("5. records valid outgoing handoff and specialist response bundles", async () => {
    await runCli([
      "--workspace",
      ws,
      "plan",
      "create",
      "--title",
      "Handoff Plan",
      "--key",
      "h_plan",
    ]);
    await runCli([
      "--workspace",
      ws,
      "task",
      "create",
      "h_plan",
      "--title",
      "Audit Module",
      "--key",
      "audit_task",
    ]);

    // Outgoing handoff
    stdoutChunks = [];
    const handoffCode = await runCli([
      "--workspace",
      ws,
      "task",
      "handoff",
      "1",
      "--to",
      "security-auditor",
      "--objective",
      "Audit JWT implementation for vulnerabilities",
      "--scope",
      "src/auth/",
      "--criteria",
      "Zero high-severity issues",
    ]);

    expect(handoffCode).toBe(0);
    expect(getStdout()).toContain("Handoff Recorded");
    expect(getStdout()).toContain("VALID");
    expect(getStdout()).toContain("security-auditor");

    // Incoming specialist response
    const responsePayload = {
      contract: "frontier-engineer/response",
      version: 1,
      taskId: "1",
      findings: ["Verified JWT signature handling"],
      workCompleted: ["Added replay attack protection"],
      filesAffected: ["src/auth/jwt.ts"],
      decisions: ["Use RS256 with rotation"],
      risks: ["None"],
      verification: {
        commands: ["npm test"],
        outcomes: ["All passed"],
        testStates: ["passed"],
      },
      unresolvedQuestions: [],
      handoffStatus: "complete",
    };

    const respFile = path.join(ws, "specialist-response.json");
    fs.writeFileSync(respFile, JSON.stringify(responsePayload, null, 2), "utf8");

    stdoutChunks = [];
    const respCode = await runCli([
      "--workspace",
      ws,
      "task",
      "validate-response",
      "1",
      "--input",
      respFile,
      "--from",
      "security-auditor",
    ]);

    expect(respCode).toBe(0);
    expect(getStdout()).toContain("Specialist Response Recorded");
    expect(getStdout()).toContain("VALID");
    expect(getStdout()).toContain("security-auditor");
  });

  it("6. rejects invalid actions and returns exit code 4 for non-existent entities", async () => {
    stderrChunks = [];
    const notFoundPlan = await runCli(["--workspace", ws, "plan", "show", "non_existent_plan"]);
    expect(notFoundPlan).toBe(4);
    expect(getStderr()).toContain("not found");

    stderrChunks = [];
    const notFoundTask = await runCli(["--workspace", ws, "task", "show", "999"]);
    expect(notFoundTask).toBe(4);
    expect(getStderr()).toContain("not found");

    stderrChunks = [];
    const invalidAction = await runCli(["--workspace", ws, "plan", "unknown_action"]);
    expect(invalidAction).toBe(2);
    expect(getStderr()).toContain("Unknown action");
  });
});
