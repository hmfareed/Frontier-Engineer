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
  hookEventName?: string;
  cwd?: string;
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

/** Normalized representation of a tool call across different host conventions and argument shapes. */
export interface NormalizedToolCall {
  name: string;
  originalArgs: Record<string, unknown>;
  commandLine?: string;
  filePath?: string;
  fileContent?: string;
  mcpServerName?: string;
  mcpToolName?: string;
  mcpArguments?: Record<string, unknown>;
}

/** Extracts normalized command lines, file paths, and MCP tool parameters from heterogeneous tool arguments. */
export function normalizeToolCall(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
): NormalizedToolCall {
  const norm: NormalizedToolCall = {
    name: toolName || "",
    originalArgs: args || {},
  };

  const a = args || {};

  // 1. Normalize command line
  if (typeof a.CommandLine === "string") {
    norm.commandLine = a.CommandLine;
  } else if (typeof a.commandLine === "string") {
    norm.commandLine = a.commandLine;
  } else if (typeof a.command === "string") {
    norm.commandLine = a.command;
  } else if (typeof a.cmd === "string") {
    norm.commandLine = a.cmd;
  }

  // 2. Normalize file path (supports AbsolutePath, TargetFile, Path, and lowercase variants)
  const pathCandidate =
    a.TargetFile ??
    a.AbsolutePath ??
    a.Path ??
    a.targetFile ??
    a.absolutePath ??
    a.filePath ??
    a.path ??
    a.file;

  if (typeof pathCandidate === "string") {
    norm.filePath = pathCandidate;
  }

  // 3. Normalize file content
  if (typeof a.Content === "string") {
    norm.fileContent = a.Content;
  } else if (typeof a.content === "string") {
    norm.fileContent = a.content;
  }

  // 4. Normalize MCP parameters
  if (norm.name === "call_mcp_tool") {
    if (typeof a.ServerName === "string") norm.mcpServerName = a.ServerName;
    if (typeof a.ToolName === "string") norm.mcpToolName = a.ToolName;
    if (a.Arguments && typeof a.Arguments === "object") {
      norm.mcpArguments = a.Arguments as Record<string, unknown>;
    }
  }

  return norm;
}

/** Extracts a normalized correlation ID from payload or environment. */
export function extractCorrelationId(payload: AntigravityBasePayload | undefined): string {
  if (payload?.conversationId && typeof payload.conversationId === "string") {
    return payload.conversationId;
  }
  return process.env.FRONTIER_SESSION_ID || "unknown-session";
}
