/**
 * Context normalization and extraction for Antigravity lifecycle event payloads.
 */

export interface AntigravityBasePayload {
  conversationId?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  lastUserInput?: string;
}

export interface PreToolUsePayload extends AntigravityBasePayload {
  toolCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  stepIdx?: number;
}

export interface PostToolUsePayload extends AntigravityBasePayload {
  toolCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  stepIdx?: number;
  error?: string;
}

export interface PreInvocationPayload extends AntigravityBasePayload {
  invocationNum?: number;
  initialNumSteps?: number;
}

export interface PostInvocationPayload extends AntigravityBasePayload {
  invocationNum?: number;
  initialNumSteps?: number;
}

export interface StopPayload extends AntigravityBasePayload {
  executionNum?: number;
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
}

export type AnyHookPayload =
  | PreToolUsePayload
  | PostToolUsePayload
  | PreInvocationPayload
  | PostInvocationPayload
  | StopPayload;

/** Extracts a normalized correlation ID from payload or environment. */
export function extractCorrelationId(payload: AntigravityBasePayload | undefined): string {
  if (payload?.conversationId && typeof payload.conversationId === "string") {
    return payload.conversationId;
  }
  return process.env.FRONTIER_SESSION_ID || "unknown-session";
}
