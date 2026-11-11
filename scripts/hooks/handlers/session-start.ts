import type { AntigravityBasePayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
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
  const correlationId = extractCorrelationId(payload);
  const ws = validateWorkspace(payload.workspacePaths);

  writeAuditLog(
    {
      event: "SessionStart",
      hookId: "frontier-session-init",
      conversationId: correlationId,
      timestamp: new Date().toISOString(),
      status: "info",
      metadata: {
        workspaceRoot: ws.projectRoot,
        isRecognizedProject: ws.isRecognizedProject,
      },
    },
    ws.projectRoot,
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
