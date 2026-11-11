import { classifyToolCall } from "../lib/command-classifier.ts";
import type { PreToolUsePayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PreToolUseOutput {
  decision: "allow" | "deny" | "force_ask" | "ask";
  reason?: string;
  permissionOverrides?: string[];
}

export function handlePreToolUse(payload: PreToolUsePayload): PreToolUseOutput {
  const toolName = payload.toolCall?.name ?? "";
  const toolArgs = payload.toolCall?.args ?? {};
  const correlationId = extractCorrelationId(payload);
  const workspaceRoot = payload.workspacePaths?.[0];

  const classification = classifyToolCall(toolName, toolArgs);

  writeAuditLog(
    {
      event: "PreToolUse",
      hookId: "frontier-pre-tool-safety",
      conversationId: correlationId,
      timestamp: new Date().toISOString(),
      stepIdx: payload.stepIdx,
      toolName,
      status:
        classification.decision === "deny"
          ? "denied"
          : classification.decision === "force_ask" || classification.decision === "ask"
            ? "escalated"
            : "info",
      metadata: {
        decision: classification.decision,
        category: classification.category,
        reason: classification.reason,
      },
    },
    workspaceRoot,
  );

  if (classification.decision === "allow") {
    return { decision: "allow" };
  }

  return {
    decision: classification.decision,
    reason: classification.reason,
  };
}
