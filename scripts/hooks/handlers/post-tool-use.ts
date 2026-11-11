import type { PostToolUsePayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export type PostToolUseOutput = Record<string, never>;

export function handlePostToolUse(payload: PostToolUsePayload): PostToolUseOutput {
  const toolName = payload.toolCall?.name ?? "";
  const correlationId = extractCorrelationId(payload);
  const workspaceRoot = payload.workspacePaths?.[0];
  const hasError = Boolean(payload.error && payload.error.trim().length > 0);

  writeAuditLog(
    {
      event: "PostToolUse",
      hookId: "frontier-post-tool-audit",
      conversationId: correlationId,
      timestamp: new Date().toISOString(),
      stepIdx: payload.stepIdx,
      toolName,
      status: hasError ? "error" : "success",
      error: hasError ? payload.error : undefined,
    },
    workspaceRoot,
  );

  return {};
}
