import { pathToFileURL } from "node:url";
import path from "node:path";
import { parseStdinPayload } from "./input.ts";
import { writeAuditLog } from "./logger.ts";
import { emitOutput, logDiagnostic } from "./output.ts";
import { resolveSafeFallback } from "./security.ts";
import { validateEventPayload } from "./validation.ts";
import { handleSessionStart } from "../handlers/session-start.ts";
import { handlePreToolUse, prepareAndGateSubagentToolCall } from "../handlers/pre-tool-use.ts";
import { handlePostToolUse } from "../handlers/post-tool-use.ts";
import { handlePreInvocation } from "../handlers/pre-invocation.ts";
import { handlePostInvocation } from "../handlers/post-invocation.ts";
import { handleStop } from "../handlers/stop.ts";
import type {
  AntigravityBasePayload,
  PostInvocationPayload,
  PostToolUsePayload,
  PreInvocationPayload,
  PreToolUsePayload,
  StopPayload,
} from "../lib/event-context.ts";
import {
  extractCorrelationId,
  extractExecutionContext,
  resolveExplicitWorkspaceRoot,
} from "../lib/event-context.ts";

export interface DispatcherOptions {
  hookId?: string;
  event?: string;
}

export function parseCliArgs(args: string[]): DispatcherOptions {
  let hookId: string | undefined;
  let event: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hook" && args[i + 1]) {
      hookId = args[i + 1];
      i++;
    } else if (args[i] === "--event" && args[i + 1]) {
      event = args[i + 1];
      i++;
    }
  }

  // If hookId is provided and event is not, infer event from hookId
  if (hookId && !event) {
    if (hookId.includes("session-init")) event = "SessionStart";
    else if (hookId.includes("pre-tool")) event = "PreToolUse";
    else if (hookId.includes("post-tool")) event = "PostToolUse";
    else if (hookId.includes("context") || hookId.includes("pre-invocation"))
      event = "PreInvocation";
    else if (hookId.includes("invocation") || hookId.includes("post-invocation"))
      event = "PostInvocation";
    else if (hookId.includes("stop")) event = "Stop";
  }

  return { hookId, event };
}

function recordDispatcherFallbackAudit(params: {
  event: string;
  hookId: string;
  stage: "stdin_parse" | "payload_validation" | "handler_exception";
  errorReason: string;
  rawPayload?: unknown;
  startedAt: number;
  fallbackOutput: unknown;
}): void {
  try {
    const objPayload =
      params.rawPayload !== null &&
      typeof params.rawPayload === "object" &&
      !Array.isArray(params.rawPayload)
        ? (params.rawPayload as AntigravityBasePayload)
        : undefined;
    const wsContext = resolveExplicitWorkspaceRoot(objPayload);
    const workspaceRoot = wsContext.valid ? wsContext.workspaceRoot : undefined;
    const correlationId = extractCorrelationId(objPayload);
    const execCtx = extractExecutionContext(objPayload);
    const durationMs = Math.max(0, Number((performance.now() - params.startedAt).toFixed(3)));
    const fallbackReason =
      typeof (params.fallbackOutput as { reason?: unknown })?.reason === "string"
        ? (params.fallbackOutput as { reason: string }).reason.slice(0, 500)
        : params.errorReason.slice(0, 500);

    const rawToolName = (objPayload as PreToolUsePayload | undefined)?.toolCall?.name;
    const safeToolName =
      typeof rawToolName === "string" && rawToolName.length > 0 ? rawToolName : undefined;
    const rawStepIdx = (objPayload as PreToolUsePayload | undefined)?.stepIdx;
    const safeStepIdx =
      typeof rawStepIdx === "number" && Number.isInteger(rawStepIdx) && rawStepIdx >= 0
        ? rawStepIdx
        : undefined;

    writeAuditLog(
      {
        eventType: "SafeFallback",
        event: "SafeFallback",
        hookId: params.hookId,
        correlationId,
        conversationId:
          typeof objPayload?.conversationId === "string" &&
          objPayload.conversationId.trim().length > 0
            ? objPayload.conversationId.trim()
            : undefined,
        ...execCtx,
        timestamp: new Date().toISOString(),
        ...(safeStepIdx !== undefined ? { stepIdx: safeStepIdx } : {}),
        ...(safeToolName !== undefined ? { toolName: safeToolName } : {}),
        status: params.event === "PreToolUse" ? "denied" : "error",
        durationMs,
        error: params.errorReason,
        normalizedSummary: {
          workspaceStatus: workspaceRoot ? "verified" : "missing",
          summary: `Dispatcher safe fallback (${params.stage}) for ${params.event}`.slice(0, 240),
        },
        ...(params.event === "PreToolUse"
          ? {
              policyDecision: {
                decision: "deny",
                semanticClass: "unknown",
                category: "ambiguous",
                reason: fallbackReason,
                fallbackUsed: true,
              },
            }
          : {}),
        metadata: {
          originalEvent: params.event,
          fallbackStage: params.stage,
          malformedInput: params.stage !== "handler_exception",
        },
      },
      workspaceRoot,
    );
  } catch {
    // Telemetry failure must never interfere with fail-closed fallback response
  }
}

/** Central dispatch handler for lifecycle hook executions. */
export async function dispatchHook(options: DispatcherOptions): Promise<void> {
  const startedAt = performance.now();
  const event = options.event ?? "PreToolUse";
  const hookId = options.hookId ?? `frontier-${event.toLowerCase()}`;
  let parsedPayload: unknown;

  try {
    const input = await parseStdinPayload(4000);

    if (!input.success || !input.payload) {
      const errorReason = input.error ?? "Failed to parse stdin payload";
      logDiagnostic(`Malformed or empty stdin received for ${hookId} (${event})`, {
        error: input.error,
      });
      const fallback = resolveSafeFallback(event, hookId, errorReason);
      recordDispatcherFallbackAudit({
        event,
        hookId,
        stage: "stdin_parse",
        errorReason,
        startedAt,
        fallbackOutput: fallback.output,
      });
      emitOutput(fallback.output, event);
      process.exitCode = fallback.exitCode;
      return;
    }

    const payload = input.payload;
    parsedPayload = payload;

    // Validate payload structure
    const validation = validateEventPayload(event, payload);
    if (!validation.valid) {
      const errorReason = validation.error ?? "Payload validation error";
      logDiagnostic(`Invalid payload structure for ${hookId} (${event})`, {
        error: validation.error,
      });
      const fallback = resolveSafeFallback(event, hookId, errorReason);
      recordDispatcherFallbackAudit({
        event,
        hookId,
        stage: "payload_validation",
        errorReason,
        rawPayload: payload,
        startedAt,
        fallbackOutput: fallback.output,
      });
      emitOutput(fallback.output, event);
      process.exitCode = fallback.exitCode;
      return;
    }

    let result: unknown;

    switch (event) {
      case "SessionStart":
        result = handleSessionStart(payload as AntigravityBasePayload);
        break;

      case "PreToolUse":
        result =
          process.env.FRONTIER_AUTO_PREPARE_HANDOFF === "1"
            ? await prepareAndGateSubagentToolCall(payload as PreToolUsePayload)
            : handlePreToolUse(payload as PreToolUsePayload);
        break;

      case "PostToolUse":
        result = handlePostToolUse(payload as PostToolUsePayload);
        break;

      case "PreInvocation":
        result = handlePreInvocation(payload as PreInvocationPayload);
        break;

      case "PostInvocation":
        result = handlePostInvocation(payload as PostInvocationPayload);
        break;

      case "Stop":
        result = handleStop(payload as StopPayload);
        break;

      default:
        logDiagnostic(`Unhandled lifecycle event '${event}'`, { hookId });
        result = {};
    }

    emitOutput(result, event);
    process.exitCode = 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logDiagnostic(`Unhandled exception in hook dispatcher for ${hookId} (${event})`, {
      error: reason,
    });
    const fallback = resolveSafeFallback(event, hookId, `Unhandled error: ${reason}`);
    recordDispatcherFallbackAudit({
      event,
      hookId,
      stage: "handler_exception",
      errorReason: `Unhandled error: ${reason}`,
      rawPayload: parsedPayload,
      startedAt,
      fallbackOutput: fallback.output,
    });
    emitOutput(fallback.output, event);
    process.exitCode = fallback.exitCode;
  }
}

function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedAsScript()) {
  const opts = parseCliArgs(process.argv.slice(2));
  void dispatchHook(opts);
}
