import type { PostInvocationPayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PostInvocationOutput {
  injectSteps: unknown[];
  terminationBehavior?: string;
}

export function handlePostInvocation(payload: PostInvocationPayload): PostInvocationOutput {
  const startedAt = performance.now();
  const correlationId = extractCorrelationId(payload);
  const safeConversationId =
    typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
      ? payload.conversationId.trim()
      : undefined;
  const safeInvocationNum =
    typeof payload.invocationNum === "number" &&
    Number.isInteger(payload.invocationNum) &&
    payload.invocationNum >= 0
      ? payload.invocationNum
      : undefined;
  const wsContext = resolveExplicitWorkspaceRoot(payload);
  const workspaceRoot = wsContext.valid ? wsContext.workspaceRoot : undefined;
  const execCtx = extractExecutionContext(payload);
  const durationMs = Math.max(0, Number((performance.now() - startedAt).toFixed(3)));

  writeAuditLog(
    {
      eventType: "PostInvocation",
      event: "PostInvocation",
      hookId: "frontier-invocation-audit",
      correlationId,
      ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      ...execCtx,
      timestamp: new Date().toISOString(),
      ...(safeInvocationNum !== undefined ? { invocationNum: safeInvocationNum } : {}),
      status: "info",
      durationMs,
      normalizedSummary: {
        workspaceStatus: workspaceRoot ? "verified" : "missing",
        summary: "PostInvocation lifecycle telemetry recorded.",
      },
      metadata: {
        invocationNum: payload.invocationNum,
        initialNumSteps: payload.initialNumSteps,
      },
    },
    workspaceRoot,
  );

  return {
    injectSteps: [],
    terminationBehavior: "",
  };
}
