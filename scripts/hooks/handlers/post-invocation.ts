import type { PostInvocationPayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PostInvocationOutput {
  injectSteps: unknown[];
  terminationBehavior?: string;
}

export function handlePostInvocation(payload: PostInvocationPayload): PostInvocationOutput {
  const correlationId = extractCorrelationId(payload);
  const workspaceRoot = payload.workspacePaths?.[0];

  writeAuditLog(
    {
      event: "PostInvocation",
      hookId: "frontier-invocation-audit",
      conversationId: correlationId,
      timestamp: new Date().toISOString(),
      status: "info",
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
