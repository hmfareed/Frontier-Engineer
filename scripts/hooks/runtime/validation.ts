import type {
  AnyHookPayload,
  PostToolUsePayload,
  PreToolUsePayload,
} from "../lib/event-context.ts";

export interface ValidationOutcome {
  valid: boolean;
  error?: string;
}

/** Validates runtime payload structure for a specific lifecycle event. */
export function validateEventPayload(event: string, payload: unknown): ValidationOutcome {
  if (payload === null || typeof payload !== "object") {
    return { valid: false, error: "Payload must be a non-null object." };
  }

  const obj = payload as Record<string, unknown>;

  switch (event) {
    case "PreToolUse": {
      const toolCall = obj.toolCall as Record<string, unknown> | undefined;
      if (!toolCall || typeof toolCall !== "object") {
        return { valid: false, error: "PreToolUse payload missing 'toolCall' object." };
      }
      if (!toolCall.name || typeof toolCall.name !== "string") {
        return { valid: false, error: "PreToolUse 'toolCall' missing 'name' string." };
      }
      if (
        toolCall.args !== undefined &&
        (typeof toolCall.args !== "object" || toolCall.args === null)
      ) {
        return { valid: false, error: "PreToolUse 'toolCall.args' must be an object if provided." };
      }
      return { valid: true };
    }

    case "PostToolUse": {
      const toolCall = obj.toolCall as Record<string, unknown> | undefined;
      if (!toolCall || typeof toolCall !== "object") {
        return { valid: false, error: "PostToolUse payload missing 'toolCall' object." };
      }
      return { valid: true };
    }

    case "SessionStart":
      // Validates common metadata presence
      return { valid: true };

    case "PreInvocation":
    case "PostInvocation":
    case "Stop":
      return { valid: true };

    default:
      return { valid: false, error: `Unknown lifecycle event: '${event}'` };
  }
}
