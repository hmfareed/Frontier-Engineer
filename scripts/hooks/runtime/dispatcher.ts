import { pathToFileURL } from "node:url";
import path from "node:path";
import { parseStdinPayload } from "./input.ts";
import { emitOutput, logDiagnostic } from "./output.ts";
import { resolveSafeFallback } from "./security.ts";
import { validateEventPayload } from "./validation.ts";
import { handleSessionStart } from "../handlers/session-start.ts";
import { handlePreToolUse } from "../handlers/pre-tool-use.ts";
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

/** Central dispatch handler for lifecycle hook executions. */
export async function dispatchHook(options: DispatcherOptions): Promise<void> {
  const event = options.event ?? "PreToolUse";
  const hookId = options.hookId ?? `frontier-${event.toLowerCase()}`;

  try {
    const input = await parseStdinPayload(4000);

    if (!input.success || !input.payload) {
      logDiagnostic(`Malformed or empty stdin received for ${hookId} (${event})`, {
        error: input.error,
      });
      const fallback = resolveSafeFallback(
        event,
        hookId,
        input.error ?? "Failed to parse stdin payload",
      );
      emitOutput(fallback.output, event);
      process.exitCode = fallback.exitCode;
      return;
    }

    const payload = input.payload;

    // Validate payload structure
    const validation = validateEventPayload(event, payload);
    if (!validation.valid) {
      logDiagnostic(`Invalid payload structure for ${hookId} (${event})`, {
        error: validation.error,
      });
      const fallback = resolveSafeFallback(
        event,
        hookId,
        validation.error ?? "Payload validation error",
      );
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
        result = handlePreToolUse(payload as PreToolUsePayload);
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
