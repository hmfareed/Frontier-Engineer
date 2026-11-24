import path from "node:path";
import fs from "node:fs";
import type { StopPayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";
import { SqliteDatabase } from "../../storage/database.ts";
import { TaskStore } from "../../task/task-store.ts";

export type StopOutput = Record<string, never>;

export interface StopTaskGraphSummary {
  activeHeldLocksCount: number;
  inProgressTasksCount: number;
  heldLocks: Array<{ taskId: number; relativePath: string; lockType: string }>;
  inProgressTasks: Array<{ id: number; planId: number; title: string }>;
}

export function queryStopTaskGraphSummary(workspaceRoot: string): StopTaskGraphSummary | null {
  try {
    const dbPath = path.join(workspaceRoot, ".frontier", "intelligence", "index.sqlite");
    if (!fs.existsSync(dbPath)) return null;

    const db = new SqliteDatabase({ path: dbPath, readOnly: true, enableWal: false });
    try {
      const taskStore = new TaskStore(db);
      const repoRow = db.prepare("SELECT id FROM repositories LIMIT 1").get() as any;
      if (!repoRow) return null;

      const activeLocks = taskStore.getActiveLocks(repoRow.id);
      const inProgressTasks = db
        .prepare(
          "SELECT id, plan_id AS planId, title FROM plan_tasks WHERE repository_id = ? AND status = 'IN_PROGRESS'",
        )
        .all(repoRow.id) as Array<{ id: number; planId: number; title: string }>;

      return {
        activeHeldLocksCount: activeLocks.length,
        inProgressTasksCount: inProgressTasks.length,
        heldLocks: activeLocks.map((l) => ({
          taskId: l.taskId,
          relativePath: l.relativePath,
          lockType: l.lockType,
        })),
        inProgressTasks,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function handleStop(payload: StopPayload): StopOutput {
  const startedAt = performance.now();
  const correlationId = extractCorrelationId(payload);
  const safeConversationId =
    typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
      ? payload.conversationId.trim()
      : undefined;
  const wsContext = resolveExplicitWorkspaceRoot(payload);
  const workspaceRoot = wsContext.valid ? wsContext.workspaceRoot : undefined;
  const execCtx = extractExecutionContext(payload);
  const hasError = Boolean(payload.error && payload.error.trim().length > 0);
  const durationMs = Math.max(0, Number((performance.now() - startedAt).toFixed(3)));

  const taskGraphSummary = workspaceRoot ? queryStopTaskGraphSummary(workspaceRoot) : null;
  const hasHeldLocks = Boolean(
    taskGraphSummary &&
    (taskGraphSummary.activeHeldLocksCount > 0 || taskGraphSummary.inProgressTasksCount > 0),
  );

  let summaryText = `Session stop (${payload.terminationReason ?? "unspecified"}).`;
  if (hasHeldLocks && taskGraphSummary) {
    summaryText = `Session stop (${payload.terminationReason ?? "unspecified"}) with ${taskGraphSummary.activeHeldLocksCount} held file locks and ${taskGraphSummary.inProgressTasksCount} in-progress tasks.`;
  }

  writeAuditLog(
    {
      eventType: "Stop",
      event: "Stop",
      hookId: "frontier-session-stop",
      correlationId,
      ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      ...execCtx,
      timestamp: new Date().toISOString(),
      status: hasError ? "error" : "info",
      durationMs,
      normalizedSummary: {
        workspaceStatus: workspaceRoot ? "verified" : "missing",
        summary: summaryText,
      },
      error: hasError ? payload.error : undefined,
      metadata: {
        executionNum: payload.executionNum,
        terminationReason: payload.terminationReason,
        fullyIdle: payload.fullyIdle,
        error: payload.error,
        ...(taskGraphSummary ? { taskGraph: taskGraphSummary } : {}),
      },
    },
    workspaceRoot,
  );

  // An empty object permits standard agent termination
  return {};
}
