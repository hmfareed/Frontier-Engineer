import type { StopPayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export type StopOutput = Record<string, never>;

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
        summary: `Session stop (${payload.terminationReason ?? "unspecified"}).`,
      },
      error: hasError ? payload.error : undefined,
      metadata: {
        executionNum: payload.executionNum,
        terminationReason: payload.terminationReason,
        fullyIdle: payload.fullyIdle,
        error: payload.error,
      },
    },
    workspaceRoot,
  );

  // An empty object permits standard agent termination
  return {};
}
