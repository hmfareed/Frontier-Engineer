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
  commandLines: string[];
  hasConflictingCommands: boolean;
  malformedCommandReason?: string;
  filePath?: string;
  filePaths: string[];
  hasConflictingFilePaths: boolean;
  malformedFileReason?: string;
  fileContent?: string;
  mcpServerName?: string;
  mcpToolName?: string;
  mcpArguments?: Record<string, unknown>;
}

const COMMAND_ARG_KEYS = [
  "CommandLine",
  "commandLine",
  "command",
  "cmd",
  "script",
  "Script",
  "shellCommand",
  "ShellCommand",
] as const;

const SCALAR_PATH_ARG_KEYS = [
  "TargetFile",
  "AbsolutePath",
  "Path",
  "targetFile",
  "absolutePath",
  "filePath",
  "path",
  "file",
  "FilePath",
  "TargetPath",
  "targetPath",
  "dest",
  "destination",
  "Destination",
  "source",
  "Source",
] as const;

const ARRAY_PATH_ARG_KEYS = [
  "paths",
  "Paths",
  "files",
  "Files",
  "targets",
  "Targets",
  "TargetFiles",
  "targetFiles",
  "FilePaths",
  "filePaths",
  "edits",
  "Edits",
  "changes",
  "Changes",
] as const;

/** Extracts normalized command lines, file paths, and MCP tool parameters from heterogeneous tool arguments. */
export function normalizeToolCall(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
): NormalizedToolCall {
  const safeArgs =
    args && typeof args === "object" && !Array.isArray(args)
      ? args
      : ({} as Record<string, unknown>);
  const norm: NormalizedToolCall = {
    name: toolName || "",
    originalArgs: safeArgs,
    commandLines: [],
    hasConflictingCommands: false,
    filePaths: [],
    hasConflictingFilePaths: false,
  };

  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    norm.malformedCommandReason = "Tool arguments must be a non-null plain object.";
    norm.malformedFileReason = "Tool arguments must be a non-null plain object.";
    return norm;
  }

  // 1. Inspect ALL command-line candidate keys
  for (const key of COMMAND_ARG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(safeArgs, key) || safeArgs[key] === undefined) {
      continue;
    }
    const raw = safeArgs[key];
    if (typeof raw !== "string") {
      norm.malformedCommandReason ??= `Command argument '${key}' must be a string.`;
      continue;
    }
    if (raw.trim().length === 0) {
      norm.malformedCommandReason ??= `Command argument '${key}' must not be empty.`;
      continue;
    }
    norm.commandLines.push(raw);
  }
  if (norm.commandLines.length > 0) {
    norm.commandLine = norm.commandLines[0];
    const distinctCmds = new Set(norm.commandLines.map((c) => c.trim()));
    if (distinctCmds.size > 1) {
      norm.hasConflictingCommands = true;
    }
  }

  // 2. Inspect ALL scalar file-path candidate keys
  const targetScalarPaths: string[] = [];
  for (const key of SCALAR_PATH_ARG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(safeArgs, key) || safeArgs[key] === undefined) {
      continue;
    }
    const raw = safeArgs[key];
    if (typeof raw !== "string") {
      norm.malformedFileReason ??= `File path argument '${key}' must be a string.`;
      continue;
    }
    if (raw.trim().length === 0) {
      norm.malformedFileReason ??= `File path argument '${key}' must not be empty.`;
      continue;
    }
    norm.filePaths.push(raw);
    if (key !== "source" && key !== "Source") {
      targetScalarPaths.push(raw);
    }
  }
  if (targetScalarPaths.length > 0) {
    const distinctScalarPaths = new Set(targetScalarPaths.map((p) => p.replace(/\\/g, "/").trim()));
    if (distinctScalarPaths.size > 1) {
      norm.hasConflictingFilePaths = true;
    }
  }

  // 3. Inspect multi-file arrays and structured edit lists
  for (const key of ARRAY_PATH_ARG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(safeArgs, key) || safeArgs[key] === undefined) {
      continue;
    }
    const rawArr = safeArgs[key];
    if (!Array.isArray(rawArr)) {
      norm.malformedFileReason ??= `Multi-file argument '${key}' must be an array.`;
      continue;
    }
    if (rawArr.length === 0) {
      norm.malformedFileReason ??= `Multi-file argument '${key}' must not be empty.`;
      continue;
    }
    for (const item of rawArr) {
      if (typeof item === "string") {
        if (item.trim().length === 0) {
          norm.malformedFileReason ??= `Multi-file argument '${key}' contains an empty path string.`;
        } else {
          norm.filePaths.push(item);
        }
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const entry = item as Record<string, unknown>;
        let foundNestedPath = false;
        for (const pathKey of SCALAR_PATH_ARG_KEYS) {
          if (
            !Object.prototype.hasOwnProperty.call(entry, pathKey) ||
            entry[pathKey] === undefined
          ) {
            continue;
          }
          foundNestedPath = true;
          const val = entry[pathKey];
          if (typeof val !== "string" || val.trim().length === 0) {
            norm.malformedFileReason ??= `Nested '${key}.${pathKey}' must be a non-empty string.`;
          } else {
            norm.filePaths.push(val);
          }
        }
        if (!foundNestedPath) {
          norm.malformedFileReason ??= `Structured item in '${key}' is missing a recognizable file path field.`;
        }
      } else {
        norm.malformedFileReason ??= `Multi-file argument '${key}' contains an invalid entry.`;
      }
    }
  }

  // 4. Inspect path fields inside ReplacementChunks entries if an entry supplies one
  if (Array.isArray(safeArgs.ReplacementChunks)) {
    for (const chunk of safeArgs.ReplacementChunks) {
      if (chunk && typeof chunk === "object" && !Array.isArray(chunk)) {
        const entry = chunk as Record<string, unknown>;
        for (const pathKey of SCALAR_PATH_ARG_KEYS) {
          if (
            !Object.prototype.hasOwnProperty.call(entry, pathKey) ||
            entry[pathKey] === undefined
          ) {
            continue;
          }
          const val = entry[pathKey];
          if (typeof val !== "string" || val.trim().length === 0) {
            norm.malformedFileReason ??= `Chunk field '${pathKey}' must be a non-empty string.`;
          } else {
            norm.filePaths.push(val);
          }
        }
      }
    }
  }

  if (norm.filePaths.length > 0) {
    norm.filePath = norm.filePaths[0];
  }

  // 5. Normalize file content
  if (typeof safeArgs.Content === "string") {
    norm.fileContent = safeArgs.Content;
  } else if (typeof safeArgs.content === "string") {
    norm.fileContent = safeArgs.content;
  }

  // 6. Normalize MCP parameters
  if (norm.name === "call_mcp_tool") {
    if (typeof safeArgs.ServerName === "string") norm.mcpServerName = safeArgs.ServerName;
    if (typeof safeArgs.ToolName === "string") norm.mcpToolName = safeArgs.ToolName;
    if (safeArgs.Arguments && typeof safeArgs.Arguments === "object") {
      norm.mcpArguments = safeArgs.Arguments as Record<string, unknown>;
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
