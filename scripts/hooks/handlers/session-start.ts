import path from "node:path";
import fs from "node:fs";
import type { AntigravityBasePayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { validateWorkspace } from "../lib/workspace-validator.ts";
import { writeAuditLog } from "../runtime/logger.ts";
import { SqliteDatabase } from "../../storage/database.ts";
import { TaskStore } from "../../task/task-store.ts";
import { TaskEngine } from "../../task/task-engine.ts";

export interface SessionStartOutput {
  injectSteps: Array<{
    systemMessage: {
      systemMessage: string;
      metadata?: Record<string, unknown>;
    };
  }>;
}

export interface ActivePlanSummary {
  planId: number;
  planKey: string;
  title: string;
  status: string;
  percentComplete: number;
  completedTasks: number;
  totalTasks: number;
  isBlocked: boolean;
  activeHeldLocksCount: number;
  nextExecutableTasks: Array<{ id: number; key: string; title: string; agent?: string | null }>;
}

export function queryActivePlanContinuity(workspaceRoot: string): ActivePlanSummary | null {
  try {
    const dbPath = path.join(workspaceRoot, ".frontier", "intelligence", "index.sqlite");
    if (!fs.existsSync(dbPath)) return null;

    const db = new SqliteDatabase({ path: dbPath, readOnly: true, enableWal: false });
    try {
      const taskStore = new TaskStore(db);
      const repoRow = db.prepare("SELECT id FROM repositories LIMIT 1").get() as any;
      if (!repoRow) return null;

      const activePlans = taskStore.listPlans(repoRow.id, { status: "ACTIVE" });
      const candidatePlan =
        activePlans[0] ?? taskStore.listPlans(repoRow.id, { status: "DRAFT" })[0];
      if (!candidatePlan) return null;

      const taskEngine = new TaskEngine(db);
      const progress = taskEngine.getPlanProgress(repoRow.id, candidatePlan.id);
      const nextTasks = taskEngine.getNextExecutableTasks(candidatePlan.id);

      return {
        planId: candidatePlan.id,
        planKey: candidatePlan.planKey,
        title: candidatePlan.title,
        status: candidatePlan.status,
        percentComplete: progress.percentComplete,
        completedTasks: progress.completedTasks,
        totalTasks: progress.totalTasks,
        isBlocked: progress.isBlocked,
        activeHeldLocksCount: progress.activeHeldLocksCount,
        nextExecutableTasks: nextTasks.map((t) => ({
          id: t.id,
          key: t.taskKey,
          title: t.title,
          agent: t.assignedAgent,
        })),
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function handleSessionStart(payload: AntigravityBasePayload): SessionStartOutput {
  const startedAt = performance.now();
  const correlationId = extractCorrelationId(payload);
  const safeConversationId =
    typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
      ? payload.conversationId.trim()
      : undefined;
  const ws = validateWorkspace(payload.workspacePaths);
  const explicitWs = resolveExplicitWorkspaceRoot(payload);
  const auditRoot = ws.projectRoot ?? (explicitWs.valid ? explicitWs.workspaceRoot : undefined);
  const execCtx = extractExecutionContext(payload);
  const durationMs = Math.max(0, Number((performance.now() - startedAt).toFixed(3)));

  // Query active plan continuity if verified workspace is present
  const planContinuity =
    ws.available && ws.isRecognizedProject && ws.projectRoot
      ? queryActivePlanContinuity(ws.projectRoot)
      : null;

  writeAuditLog(
    {
      eventType: "SessionStart",
      event: "SessionStart",
      hookId: "frontier-session-init",
      correlationId,
      ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      ...execCtx,
      timestamp: new Date().toISOString(),
      status: "info",
      durationMs,
      normalizedSummary: {
        workspaceStatus: ws.available ? "verified" : auditRoot ? "invalid" : "missing",
        summary: ws.isRecognizedProject
          ? "Session initialized with verified Frontier workspace."
          : "Session initialized with standard workspace context.",
      },
      metadata: {
        workspaceRoot: ws.projectRoot,
        isRecognizedProject: ws.isRecognizedProject,
        ...(planContinuity ? { activePlan: planContinuity } : {}),
      },
    },
    auditRoot,
  );

  let statusSummary = "Frontier Engineer session initialized.";
  if (ws.available && ws.isRecognizedProject) {
    statusSummary += ` Verified workspace context: ${ws.projectRoot}.`;
  } else {
    statusSummary += " Standard workspace context active.";
  }
  statusSummary += " Canonical safeguards and execution audits are active.";

  if (planContinuity) {
    const nextList =
      planContinuity.nextExecutableTasks.length > 0
        ? planContinuity.nextExecutableTasks.map((t) => `#${t.id} '${t.title}'`).join(", ")
        : "none";
    statusSummary += `\n[PLAN CONTINUITY] Active Plan: #${planContinuity.planId} '${planContinuity.title}' (${planContinuity.status}, ${planContinuity.percentComplete}% complete). Next executable: ${nextList}. Active held locks: ${planContinuity.activeHeldLocksCount}.`;
  }

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: statusSummary,
          metadata: planContinuity ? { activePlan: planContinuity } : undefined,
        },
      },
    ],
  };
}
