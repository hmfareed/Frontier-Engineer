import type { StopPayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export type StopOutput = Record<string, never>;

export function handleStop(payload: StopPayload): StopOutput {
  const correlationId = extractCorrelationId(payload);
  const workspaceRoot = payload.workspacePaths?.[0];

  writeAuditLog(
    {
      event: "Stop",
      hookId: "frontier-session-stop",
      conversationId: correlationId,
      timestamp: new Date().toISOString(),
      status: "info",
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
