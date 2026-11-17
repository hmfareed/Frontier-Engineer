import type { PreInvocationPayload } from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PreInvocationOutput {
  injectSteps: Array<{
    systemMessage: {
      systemMessage: string;
      metadata?: Record<string, unknown>;
    };
  }>;
  terminationBehavior?: string;
}

export function handlePreInvocation(payload: PreInvocationPayload): PreInvocationOutput {
  const startedAt = performance.now();
  const rawInvocationNum = payload.invocationNum;
  const invocationNum =
    typeof rawInvocationNum === "number" &&
    Number.isInteger(rawInvocationNum) &&
    rawInvocationNum >= 0
      ? rawInvocationNum
      : 1;
  const shouldInject = invocationNum === 1 || invocationNum % 5 === 0;
  const correlationId = extractCorrelationId(payload);
  const safeConversationId =
    typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
      ? payload.conversationId.trim()
      : undefined;
  const wsContext = resolveExplicitWorkspaceRoot(payload);
  const workspaceRoot = wsContext.valid ? wsContext.workspaceRoot : undefined;
  const execCtx = extractExecutionContext(payload);
  const durationMs = Math.max(0, Number((performance.now() - startedAt).toFixed(3)));

  writeAuditLog(
    {
      eventType: "PreInvocation",
      event: "PreInvocation",
      hookId: "frontier-engineering-context",
      correlationId,
      ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      ...execCtx,
      timestamp: new Date().toISOString(),
      invocationNum,
      status: "info",
      durationMs,
      normalizedSummary: {
        workspaceStatus: workspaceRoot ? "verified" : "missing",
        summary: shouldInject
          ? "PreInvocation engineering reminder injected."
          : "PreInvocation check completed without reminder injection.",
      },
      metadata: {
        reminderInjected: shouldInject,
        initialNumSteps: payload.initialNumSteps,
      },
    },
    workspaceRoot,
  );

  // Reminders must remain concise (under 25 words) and not duplicate full rules
  // Injected on initial turns or periodically to preserve token economy
  if (shouldInject) {
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage:
              "Frontier Reminder: Inspect before editing; verify changes with tests before claiming completion; distinguish assumptions from verified facts.",
          },
        },
      ],
      terminationBehavior: "",
    };
  }

  return {
    injectSteps: [],
    terminationBehavior: "",
  };
}
