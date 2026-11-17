import { buildNormalizedToolSummary } from "../lib/audit-schema.ts";
import type { PostToolUsePayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  normalizeToolCall,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export type PostToolUseOutput = Record<string, never>;

export function handlePostToolUse(payload: PostToolUsePayload): PostToolUseOutput {
  const startedAt = performance.now();
  const toolName = payload.toolCall?.name ?? "";
  const correlationId = extractCorrelationId(payload);
  const wsContext = resolveExplicitWorkspaceRoot(payload);
  const workspaceRoot = wsContext.valid ? wsContext.workspaceRoot : undefined;
  const execCtx = extractExecutionContext(payload);
  const safeConversationId =
    typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
      ? payload.conversationId.trim()
      : undefined;
  const safeStepIdx =
    typeof payload.stepIdx === "number" && Number.isInteger(payload.stepIdx) && payload.stepIdx >= 0
      ? payload.stepIdx
      : undefined;
  const hasError = Boolean(payload.error && payload.error.trim().length > 0);
  const normalizedSummary = payload.toolCall
    ? buildNormalizedToolSummary(
        normalizeToolCall(toolName, payload.toolCall.args),
        workspaceRoot ? "verified" : "missing",
      )
    : undefined;
  const durationMs = Math.max(0, Number((performance.now() - startedAt).toFixed(3)));

  writeAuditLog(
    {
      eventType: "PostToolUse",
      event: "PostToolUse",
      hookId: "frontier-post-tool-audit",
      correlationId,
      ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      ...execCtx,
      timestamp: new Date().toISOString(),
      ...(safeStepIdx !== undefined ? { stepIdx: safeStepIdx } : {}),
      toolName,
      status: hasError ? "error" : "success",
      durationMs,
      normalizedSummary,
      error: hasError ? payload.error : undefined,
    },
    workspaceRoot,
  );

  return {};
}
