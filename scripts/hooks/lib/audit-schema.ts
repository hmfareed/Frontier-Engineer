import path from "node:path";
import type { NormalizedToolCall } from "./event-context.ts";
import { redactString } from "./secret-redactor.ts";

export const AUDIT_EVENT_SCHEMA_VERSION = 1 as const;

export const AUDIT_EVENT_TYPES = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "PreInvocation",
  "PostInvocation",
  "Stop",
  "SafeFallback",
  "Diagnostic",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_EVENT_SOURCES = ["production", "evaluation", "test"] as const;
export type AuditEventSource = (typeof AUDIT_EVENT_SOURCES)[number];

export const AUDIT_EVENT_STATUSES = ["success", "denied", "error", "escalated", "info"] as const;
export type AuditEventStatus = (typeof AUDIT_EVENT_STATUSES)[number];

export const AUDIT_POLICY_DECISIONS = ["allow", "deny", "force_ask", "ask"] as const;
export type AuditPolicyDecisionValue = (typeof AUDIT_POLICY_DECISIONS)[number];

export const AUDIT_SEMANTIC_CLASSES = [
  "trusted_read_only",
  "workspace_read",
  "workspace_write",
  "external_side_effect",
  "destructive",
  "unknown",
] as const;

export const AUDIT_POLICY_CATEGORIES = [
  "safe",
  "destructive_filesystem",
  "secret_exposure",
  "dangerous_permissions",
  "database_mutation",
  "high_risk_git",
  "external_side_effect",
  "ambiguous",
] as const;

export const AUDIT_TOOL_KINDS = ["command", "file", "mcp", "delegation", "unknown"] as const;
export type AuditToolKind = (typeof AUDIT_TOOL_KINDS)[number];

export const AUDIT_WORKSPACE_STATUSES = ["verified", "missing", "invalid"] as const;
export type AuditWorkspaceStatus = (typeof AUDIT_WORKSPACE_STATUSES)[number];

export const AUDIT_ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export const AUDIT_REQUIRED_FIELDS = [
  "schemaVersion",
  "eventId",
  "timestamp",
  "hookId",
  "source",
  "status",
] as const;

export const AUDIT_ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
  "schemaVersion",
  "eventId",
  "timestamp",
  "eventType",
  "event",
  "hookId",
  "source",
  "correlationId",
  "conversationId",
  "executionId",
  "parentExecutionId",
  "agentId",
  "skillId",
  "stepIdx",
  "invocationNum",
  "toolName",
  "status",
  "durationMs",
  "normalizedSummary",
  "policyDecision",
  "evalContext",
  "error",
  "metadata",
]);

const NORMALIZED_SUMMARY_KEYS = new Set<string>([
  "toolKind",
  "commandBin",
  "targetCount",
  "mcpServerName",
  "mcpToolName",
  "workspaceStatus",
  "summary",
]);

const POLICY_DECISION_KEYS = new Set<string>([
  "decision",
  "semanticClass",
  "category",
  "reason",
  "overwriteApplied",
  "fallbackUsed",
]);

const EVAL_CONTEXT_KEYS = new Set<string>(["scenarioId", "evalRunId", "stepId"]);

export interface AuditNormalizedSummary {
  toolKind?: AuditToolKind;
  commandBin?: string;
  targetCount?: number;
  mcpServerName?: string;
  mcpToolName?: string;
  workspaceStatus?: AuditWorkspaceStatus;
  summary?: string;
}

export interface AuditPolicyDecision {
  decision: AuditPolicyDecisionValue;
  semanticClass?: (typeof AUDIT_SEMANTIC_CLASSES)[number];
  category?: (typeof AUDIT_POLICY_CATEGORIES)[number];
  reason?: string;
  overwriteApplied?: boolean;
  fallbackUsed?: boolean;
}

export interface AuditEvalContext {
  scenarioId?: string;
  evalRunId?: string;
  stepId?: string;
}

export interface AuditEvent {
  schemaVersion: typeof AUDIT_EVENT_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  eventType: AuditEventType;
  event?: AuditEventType;
  hookId: string;
  source: AuditEventSource;
  correlationId: string;
  conversationId?: string;
  executionId?: string;
  parentExecutionId?: string;
  agentId?: string;
  skillId?: string;
  stepIdx?: number;
  invocationNum?: number;
  toolName?: string;
  status: AuditEventStatus;
  durationMs?: number;
  normalizedSummary?: AuditNormalizedSummary;
  policyDecision?: AuditPolicyDecision;
  evalContext?: AuditEvalContext;
  error?: string;
  metadata?: Record<string, unknown> | string;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function inSet(list: readonly string[], val: unknown): boolean {
  return typeof val === "string" && list.includes(val);
}

function validateAllowedKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  prefix: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`Unexpected property '${prefix ? `${prefix}.` : ""}${key}'`);
    }
  }
}

/**
 * Validates a candidate audit telemetry record against the canonical v1 event schema
 * with zero runtime dependencies. Kept in strict structural parity with `schemas/audit-event.schema.json`.
 *
 * Design note (AUD-86A-R1-01): Cross-property equality for correlation aliases
 * (`correlationId === conversationId`) is enforced here by this dedicated runtime validator rather
 * than generic JSON Schema validation to preserve standard Draft-07 engine compatibility without
 * requiring non-standard `$data` extensions.
 */
export function validateAuditEvent(value: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(value)) {
    return ["Audit event must be a non-null plain object."];
  }

  validateAllowedKeys(value, AUDIT_ALLOWED_TOP_LEVEL_KEYS, "", errors);

  for (const reqKey of AUDIT_REQUIRED_FIELDS) {
    if (value[reqKey] === undefined) {
      errors.push(`Missing required property '${reqKey}'.`);
    }
  }

  if (value.eventType === undefined && value.event === undefined) {
    errors.push("Missing required property 'eventType'.");
  }
  if (value.correlationId === undefined && value.conversationId === undefined) {
    errors.push("Missing required property 'correlationId'.");
  }

  if (value.schemaVersion !== undefined && value.schemaVersion !== AUDIT_EVENT_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected ${AUDIT_EVENT_SCHEMA_VERSION}.`);
  }
  if (value.eventId !== undefined && !isNonEmptyString(value.eventId)) {
    errors.push("eventId must be a non-empty string.");
  }
  if (value.timestamp !== undefined) {
    if (
      typeof value.timestamp !== "string" ||
      !AUDIT_ISO_TIMESTAMP_REGEX.test(value.timestamp) ||
      !Number.isFinite(Date.parse(value.timestamp))
    ) {
      errors.push("timestamp must be a valid ISO-8601 date-time string.");
    }
  }
  if (value.eventType !== undefined && !inSet(AUDIT_EVENT_TYPES, value.eventType)) {
    errors.push(`Invalid eventType '${String(value.eventType)}'.`);
  }
  if (value.event !== undefined && !inSet(AUDIT_EVENT_TYPES, value.event)) {
    errors.push(`Invalid event '${String(value.event)}'.`);
  }
  if (
    value.eventType !== undefined &&
    value.event !== undefined &&
    value.eventType !== value.event
  ) {
    errors.push(
      `eventType '${String(value.eventType)}' and event '${String(value.event)}' must match when both are provided.`,
    );
  }
  if (value.hookId !== undefined && !isNonEmptyString(value.hookId)) {
    errors.push("hookId must be a non-empty string.");
  }
  if (value.source !== undefined && !inSet(AUDIT_EVENT_SOURCES, value.source)) {
    errors.push(`Invalid source '${String(value.source)}'.`);
  }
  if (value.correlationId !== undefined && !isNonEmptyString(value.correlationId)) {
    errors.push("correlationId must be a non-empty string.");
  }
  if (
    value.correlationId !== undefined &&
    value.conversationId !== undefined &&
    value.correlationId !== value.conversationId
  ) {
    errors.push(
      `correlationId '${String(value.correlationId)}' and conversationId '${String(value.conversationId)}' must match when both are provided.`,
    );
  }
  if (value.status !== undefined && !inSet(AUDIT_EVENT_STATUSES, value.status)) {
    errors.push(`Invalid status '${String(value.status)}'.`);
  }

  for (const optNonEmpty of [
    "conversationId",
    "executionId",
    "parentExecutionId",
    "agentId",
    "skillId",
  ] as const) {
    if (value[optNonEmpty] !== undefined && !isNonEmptyString(value[optNonEmpty])) {
      errors.push(`${optNonEmpty} must be a non-empty string when provided.`);
    }
  }

  for (const intField of ["stepIdx", "invocationNum"] as const) {
    if (value[intField] !== undefined) {
      if (
        typeof value[intField] !== "number" ||
        !Number.isInteger(value[intField]) ||
        value[intField] < 0
      ) {
        errors.push(`${intField} must be a non-negative integer.`);
      }
    }
  }

  if (value.toolName !== undefined && typeof value.toolName !== "string") {
    errors.push("toolName must be a string.");
  }

  if (value.durationMs !== undefined) {
    if (
      typeof value.durationMs !== "number" ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0
    ) {
      errors.push("durationMs must be a non-negative finite number.");
    }
  }

  if (value.normalizedSummary !== undefined) {
    if (!isPlainRecord(value.normalizedSummary)) {
      errors.push("normalizedSummary must be a plain object.");
    } else {
      const ns = value.normalizedSummary;
      validateAllowedKeys(ns, NORMALIZED_SUMMARY_KEYS, "normalizedSummary", errors);
      if (ns.toolKind !== undefined && !inSet(AUDIT_TOOL_KINDS, ns.toolKind)) {
        errors.push(`Invalid normalizedSummary.toolKind '${String(ns.toolKind)}'.`);
      }
      if (
        ns.commandBin !== undefined &&
        (typeof ns.commandBin !== "string" || ns.commandBin.length > 80)
      ) {
        errors.push("normalizedSummary.commandBin must be a string <= 80 chars.");
      }
      if (
        ns.targetCount !== undefined &&
        (typeof ns.targetCount !== "number" ||
          !Number.isInteger(ns.targetCount) ||
          ns.targetCount < 0)
      ) {
        errors.push("normalizedSummary.targetCount must be a non-negative integer.");
      }
      if (
        ns.mcpServerName !== undefined &&
        (typeof ns.mcpServerName !== "string" || ns.mcpServerName.length > 120)
      ) {
        errors.push("normalizedSummary.mcpServerName must be a string <= 120 chars.");
      }
      if (
        ns.mcpToolName !== undefined &&
        (typeof ns.mcpToolName !== "string" || ns.mcpToolName.length > 120)
      ) {
        errors.push("normalizedSummary.mcpToolName must be a string <= 120 chars.");
      }
      if (
        ns.workspaceStatus !== undefined &&
        !inSet(AUDIT_WORKSPACE_STATUSES, ns.workspaceStatus)
      ) {
        errors.push(`Invalid normalizedSummary.workspaceStatus '${String(ns.workspaceStatus)}'.`);
      }
      if (ns.summary !== undefined && (typeof ns.summary !== "string" || ns.summary.length > 240)) {
        errors.push("normalizedSummary.summary must be a string <= 240 chars.");
      }
    }
  }

  if (value.policyDecision !== undefined) {
    if (!isPlainRecord(value.policyDecision)) {
      errors.push("policyDecision must be a plain object.");
    } else {
      const pd = value.policyDecision;
      validateAllowedKeys(pd, POLICY_DECISION_KEYS, "policyDecision", errors);
      if (!inSet(AUDIT_POLICY_DECISIONS, pd.decision)) {
        errors.push(`Invalid policyDecision.decision '${String(pd.decision)}'.`);
      }
      if (pd.semanticClass !== undefined && !inSet(AUDIT_SEMANTIC_CLASSES, pd.semanticClass)) {
        errors.push(`Invalid policyDecision.semanticClass '${String(pd.semanticClass)}'.`);
      }
      if (pd.category !== undefined && !inSet(AUDIT_POLICY_CATEGORIES, pd.category)) {
        errors.push(`Invalid policyDecision.category '${String(pd.category)}'.`);
      }
      if (pd.reason !== undefined && (typeof pd.reason !== "string" || pd.reason.length > 500)) {
        errors.push("policyDecision.reason must be a string <= 500 chars.");
      }
      if (pd.overwriteApplied !== undefined && typeof pd.overwriteApplied !== "boolean") {
        errors.push("policyDecision.overwriteApplied must be a boolean.");
      }
      if (pd.fallbackUsed !== undefined && typeof pd.fallbackUsed !== "boolean") {
        errors.push("policyDecision.fallbackUsed must be a boolean.");
      }
    }
  }

  if (value.evalContext !== undefined) {
    if (!isPlainRecord(value.evalContext)) {
      errors.push("evalContext must be a plain object.");
    } else {
      const ec = value.evalContext;
      validateAllowedKeys(ec, EVAL_CONTEXT_KEYS, "evalContext", errors);
      for (const ecKey of ["scenarioId", "evalRunId", "stepId"] as const) {
        if (ec[ecKey] !== undefined && !isNonEmptyString(ec[ecKey])) {
          errors.push(`evalContext.${ecKey} must be a non-empty string.`);
        }
      }
      if (value.source === "production") {
        errors.push("evalContext cannot coexist with source 'production'.");
      }
    }
  }

  if (value.error !== undefined && typeof value.error !== "string") {
    errors.push("error must be a string.");
  }

  if (
    value.metadata !== undefined &&
    typeof value.metadata !== "string" &&
    !isPlainRecord(value.metadata)
  ) {
    errors.push("metadata must be a plain object or redacted string.");
  }

  return errors;
}

function truncateText(text: string, maxLen: number): string {
  const clean = redactString(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

export function safeExecutableBasename(rawCmd: string): string | undefined {
  if (typeof rawCmd !== "string") return undefined;
  const str = rawCmd.trim();
  if (str.length === 0) return undefined;

  // Tokenize the command string into whitespace-separated tokens, respecting quotes
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  // Iterate past leading env assignments and benign wrappers
  let idx = 0;
  while (idx < tokens.length) {
    const token = tokens[idx];

    // Leading environment assignments: NAME=value (quoted or unquoted)
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      idx++;
      continue;
    }

    // Benign wrappers: env, command, nohup
    const lower = token.toLowerCase();
    const normalized = lower.replace(/\\/g, "/");
    const base = path.posix.basename(normalized).replace(/\.(?:exe|cmd|bat|sh)$/i, "");
    if (base === "command" || base === "nohup") {
      idx++;
      continue;
    }
    if (base === "env") {
      idx++;
      // Skip env flags: -i, -0, -v, -u <var>, -S <str>, --split-string=..., etc.
      while (idx < tokens.length) {
        const flag = tokens[idx];
        if (flag === "-i" || flag === "-0" || flag === "-v" || flag === "--null") {
          idx++;
        } else if (flag === "-u" || flag === "--unset") {
          idx += 2; // skip flag and var name
        } else if (flag === "-S" || flag === "--split-string") {
          idx += 2; // skip flag and payload
        } else if (flag.startsWith("-S") || flag.startsWith("--split-string=")) {
          idx++;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(flag)) {
          idx++; // env assignment inside env
        } else {
          break; // reached command after env
        }
      }
      continue;
    }

    // Found candidate executable token
    break;
  }

  if (idx >= tokens.length) return undefined;
  const candidate = tokens[idx];
  // Ensure candidate is not itself an assignment
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate)) return undefined;

  const cleaned = path.posix
    .basename(candidate.replace(/\\/g, "/"))
    .replace(/['"`\\]/g, "")
    .trim();
  if (!cleaned || cleaned.length > 80) return undefined;
  return redactString(cleaned).slice(0, 80);
}

/** Builds a bounded, redacted summary of a normalized tool call without exposing secrets or raw args. */
export function buildNormalizedToolSummary(
  norm: NormalizedToolCall,
  workspaceStatus?: AuditWorkspaceStatus,
): AuditNormalizedSummary {
  if (norm.mcpServerName !== undefined || norm.mcpToolName !== undefined) {
    const serverLabel = redactString(norm.mcpServerName ?? "unknown").slice(0, 120);
    const toolLabel = redactString(norm.mcpToolName ?? norm.name ?? "unknown").slice(0, 120);
    return {
      toolKind: "mcp",
      mcpServerName: serverLabel || undefined,
      mcpToolName: toolLabel || undefined,
      ...(workspaceStatus ? { workspaceStatus } : {}),
      summary: truncateText(`mcp:${serverLabel}/${toolLabel}`, 240),
    };
  }

  if (
    norm.name === "invoke_subagent" ||
    norm.name === "delegate_agent" ||
    norm.name === "spawn_subagent" ||
    norm.name === "send_message"
  ) {
    return {
      toolKind: "delegation",
      ...(workspaceStatus ? { workspaceStatus } : {}),
      summary: truncateText(`delegation:${norm.name}`, 240),
    };
  }

  if (norm.commandLines.length > 0 || norm.malformedCommandReason) {
    const bin = norm.commandLines[0] ? safeExecutableBasename(norm.commandLines[0]) : undefined;
    return {
      toolKind: "command",
      ...(bin ? { commandBin: bin } : {}),
      targetCount: norm.commandLines.length,
      ...(workspaceStatus ? { workspaceStatus } : {}),
      summary: truncateText(
        bin ? `command:${bin} (count=${norm.commandLines.length})` : `command:${norm.name}`,
        240,
      ),
    };
  }

  if (norm.filePaths.length > 0 || norm.malformedFileReason) {
    return {
      toolKind: "file",
      targetCount: norm.filePaths.length,
      ...(workspaceStatus ? { workspaceStatus } : {}),
      summary: truncateText(`file:${norm.name} (paths=${norm.filePaths.length})`, 240),
    };
  }

  return {
    toolKind: "unknown",
    ...(workspaceStatus ? { workspaceStatus } : {}),
    summary: truncateText(`tool:${norm.name || "unknown"}`, 240),
  };
}
