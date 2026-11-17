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
  executionId?: string;
  parentExecutionId?: string;
  agentId?: string;
  skillId?: string;
  evalContext?: {
    scenarioId?: string;
    evalRunId?: string;
    stepId?: string;
  };
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
  if (typeof payload?.conversationId === "string" && payload.conversationId.trim().length > 0) {
    return payload.conversationId.trim();
  }
  const envSession = process.env.FRONTIER_SESSION_ID?.trim();
  if (envSession && envSession.length > 0) {
    return envSession;
  }
  return "unknown-session";
}

export interface ExplicitWorkspaceContext {
  valid: boolean;
  workspaceRoot: string;
}

/**
 * Resolves explicit workspace context from `workspacePaths` or `cwd` without ever falling back to `process.cwd()`.
 */
export function resolveExplicitWorkspaceRoot(
  payload: Pick<AntigravityBasePayload, "workspacePaths" | "cwd"> | undefined,
): ExplicitWorkspaceContext {
  if (!payload) {
    return { valid: false, workspaceRoot: "" };
  }
  if (payload.workspacePaths !== undefined) {
    if (!Array.isArray(payload.workspacePaths)) {
      return { valid: false, workspaceRoot: "" };
    }
    const validEntries: string[] = [];
    for (const entry of payload.workspacePaths) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        return { valid: false, workspaceRoot: "" };
      }
      validEntries.push(entry.trim());
    }
    const uniqueEntries = Array.from(new Set(validEntries));
    if (uniqueEntries.length === 1) {
      return { valid: true, workspaceRoot: uniqueEntries[0] };
    }
    if (uniqueEntries.length > 1) {
      return { valid: false, workspaceRoot: "" };
    }
    // workspacePaths was explicitly [] — fall back only to explicit non-empty payload.cwd, never process.cwd()
    if (typeof payload.cwd === "string" && payload.cwd.trim().length > 0) {
      return { valid: true, workspaceRoot: payload.cwd.trim() };
    }
    return { valid: false, workspaceRoot: "" };
  }

  if (typeof payload.cwd === "string" && payload.cwd.trim().length > 0) {
    return { valid: true, workspaceRoot: payload.cwd.trim() };
  }

  return { valid: false, workspaceRoot: "" };
}

export interface ExtractedExecutionContext {
  executionId?: string;
  parentExecutionId?: string;
  agentId?: string;
  skillId?: string;
  evalContext?: {
    scenarioId?: string;
    evalRunId?: string;
    stepId?: string;
  };
}

export function cleanOptionalNonEmptyString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

export function cleanOptionalNonNegativeInteger(val: unknown): number | undefined {
  return typeof val === "number" && Number.isInteger(val) && val >= 0 ? val : undefined;
}

const cleanNonEmptyString = cleanOptionalNonEmptyString;

/**
 * Extracts optional execution, delegation, agent/skill, and eval identifiers ONLY when
 * genuinely supplied in the payload or explicit eval environment variables — never fabricates IDs.
 */
export function extractExecutionContext(
  payload: AntigravityBasePayload | undefined,
): ExtractedExecutionContext {
  const result: ExtractedExecutionContext = {};

  const executionId = cleanNonEmptyString(payload?.executionId);
  if (executionId) result.executionId = executionId;

  const parentExecutionId = cleanNonEmptyString(payload?.parentExecutionId);
  if (parentExecutionId) result.parentExecutionId = parentExecutionId;

  const agentId = cleanNonEmptyString(payload?.agentId);
  if (agentId) result.agentId = agentId;

  const skillId = cleanNonEmptyString(payload?.skillId);
  if (skillId) result.skillId = skillId;

  const scenarioId =
    cleanNonEmptyString(payload?.evalContext?.scenarioId) ??
    cleanNonEmptyString(process.env.FRONTIER_EVAL_SCENARIO_ID);
  const evalRunId =
    cleanNonEmptyString(payload?.evalContext?.evalRunId) ??
    cleanNonEmptyString(process.env.FRONTIER_EVAL_RUN_ID);
  const stepId =
    cleanNonEmptyString(payload?.evalContext?.stepId) ??
    cleanNonEmptyString(process.env.FRONTIER_EVAL_STEP_ID);

  if (scenarioId || evalRunId || stepId) {
    result.evalContext = {
      ...(scenarioId ? { scenarioId } : {}),
      ...(evalRunId ? { evalRunId } : {}),
      ...(stepId ? { stepId } : {}),
    };
  }

  return result;
}
