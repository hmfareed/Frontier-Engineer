import type { AntigravityBasePayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { validateWorkspace } from "../lib/workspace-validator.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface SessionStartOutput {
  injectSteps: Array<{
    systemMessage: {
      systemMessage: string;
      metadata?: Record<string, unknown>;
    };
  }>;
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

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: statusSummary,
        },
      },
    ],
  };
}
