import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { containsUnredactedSecrets } from "../../scanner/sensitive-filter.ts";
import {
  AUDIT_EVENT_SOURCES,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_EVENT_TYPES,
  validateAuditEvent,
  type AuditEvalContext,
  type AuditEvent,
  type AuditEventSource,
  type AuditEventStatus,
  type AuditEventType,
  type AuditNormalizedSummary,
  type AuditPolicyDecision,
} from "../lib/audit-schema.ts";
import { redactString, redactValue } from "../lib/secret-redactor.ts";
import { logDiagnostic } from "./output.ts";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BACKUP_FILES = 3;

export interface AuditRecord {
  schemaVersion?: number;
  eventId?: string;
  eventType?: AuditEventType;
  event?: string;
  hookId: string;
  source?: AuditEventSource;
  correlationId?: string;
  conversationId?: string;
  executionId?: string;
  parentExecutionId?: string;
  agentId?: string;
  skillId?: string;
  timestamp: string;
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

export { validateAuditEvent, type AuditEvent };

/** Resolves an explicit audit log directory, returning null if workspace context is missing or invalid. */
export function resolveSafeAuditDir(workspaceRoot?: string): string | null {
  if (process.env.PLUGIN_DATA && fs.existsSync(process.env.PLUGIN_DATA)) {
    return path.join(process.env.PLUGIN_DATA, "audit");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    return null;
  }
  try {
    const resolved = path.resolve(workspaceRoot);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return null;
    }
    return path.join(resolved, ".frontier", "audit");
  } catch {
    return null;
  }
}

/** Resolves the audit log directory (never falling back to an arbitrary process.cwd()). */
export function resolveAuditDir(workspaceRoot?: string): string {
  return resolveSafeAuditDir(workspaceRoot) ?? "";
}

/** Rotates audit log file if it exceeds MAX_LOG_SIZE_BYTES. */
function rotateLogsIfNeeded(logFilePath: string): void {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const stats = fs.statSync(logFilePath);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Shift backups: .2 -> .3, .1 -> .2, log -> .1
    for (let i = MAX_BACKUP_FILES - 1; i >= 1; i--) {
      const src = `${logFilePath}.${i}`;
      const dest = `${logFilePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dest);
        } catch {
          // Ignore rotation rename collisions
        }
      }
    }

    const firstBackup = `${logFilePath}.1`;
    try {
      fs.renameSync(logFilePath, firstBackup);
    } catch {
      // If rename fails, truncate existing file
      fs.writeFileSync(logFilePath, "", "utf8");
    }
  } catch {
    // Rotation is best effort
  }
}

const AUDIT_JSON_REPLACER = (_key: string, val: unknown): unknown => {
  if (typeof val === "bigint") {
    return val.toString();
  }
  if (typeof val === "string") {
    return redactString(val);
  }
  return val;
};

function hasEvalContext(evalContext: unknown): boolean {
  if (evalContext !== null && typeof evalContext === "object" && !Array.isArray(evalContext)) {
    const keys = Object.keys(evalContext as Record<string, unknown>);
    if (keys.length > 0) return true;
  }
  const runId = process.env.FRONTIER_EVAL_RUN_ID?.trim();
  const scenarioId = process.env.FRONTIER_EVAL_SCENARIO_ID?.trim();
  return Boolean((runId && runId.length > 0) || (scenarioId && scenarioId.length > 0));
}

function resolveDefaultAuditSource(evalContext: unknown): AuditEventSource {
  const envSource = process.env.FRONTIER_AUDIT_SOURCE?.trim();
  if (envSource && envSource.length > 0) {
    if ((AUDIT_EVENT_SOURCES as readonly string[]).includes(envSource)) {
      return envSource as AuditEventSource;
    }
    logDiagnostic("Ignored invalid FRONTIER_AUDIT_SOURCE environment variable", {
      source: redactString(envSource),
    });
  }
  if (hasEvalContext(evalContext)) {
    return "evaluation";
  }
  if (process.env.VITEST === "true" || process.env.NODE_TEST_CONTEXT !== undefined) {
    return "test";
  }
  return "production";
}

function stripUndefinedFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      out[key] = val;
    }
  }
  return out;
}

function enrichAuditEventDefaults(redactedObj: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...redactedObj };

  if (enriched.schemaVersion === undefined) {
    enriched.schemaVersion = AUDIT_EVENT_SCHEMA_VERSION;
  }
  if (enriched.eventId === undefined) {
    enriched.eventId = randomUUID();
  }

  // 1. Normalize and check event / eventType aliases
  if (enriched.eventType === undefined && enriched.event !== undefined) {
    enriched.eventType = enriched.event;
  }
  if (enriched.event === undefined && typeof enriched.eventType === "string") {
    enriched.event = enriched.eventType;
  }

  // 2. Sanitize and normalize conversationId / correlationId
  if (enriched.conversationId !== undefined) {
    if (typeof enriched.conversationId === "string" && enriched.conversationId.trim().length > 0) {
      enriched.conversationId = enriched.conversationId.trim();
    } else {
      delete enriched.conversationId;
    }
  }
  if (enriched.correlationId !== undefined) {
    if (typeof enriched.correlationId === "string" && enriched.correlationId.trim().length > 0) {
      enriched.correlationId = enriched.correlationId.trim();
    } else {
      delete enriched.correlationId;
    }
  }

  if (enriched.correlationId === undefined) {
    if (enriched.conversationId !== undefined) {
      enriched.correlationId = enriched.conversationId;
    } else {
      const envSession = process.env.FRONTIER_SESSION_ID?.trim();
      enriched.correlationId = envSession && envSession.length > 0 ? envSession : "unknown-session";
    }
  }
  if (enriched.conversationId === undefined && typeof enriched.correlationId === "string") {
    enriched.conversationId = enriched.correlationId;
  }

  // 3. Sanitize stepIdx and invocationNum (omit if invalid rather than causing event drop)
  if (enriched.stepIdx !== undefined) {
    if (
      typeof enriched.stepIdx !== "number" ||
      !Number.isInteger(enriched.stepIdx) ||
      enriched.stepIdx < 0
    ) {
      delete enriched.stepIdx;
    }
  }
  if (enriched.invocationNum !== undefined) {
    if (
      typeof enriched.invocationNum !== "number" ||
      !Number.isInteger(enriched.invocationNum) ||
      enriched.invocationNum < 0
    ) {
      delete enriched.invocationNum;
    }
  }

  // 4. Resolve source
  if (enriched.source === undefined) {
    enriched.source = resolveDefaultAuditSource(enriched.evalContext);
  }

  // 5. Post-redaction bounding of length-sensitive fields
  if (
    enriched.policyDecision !== null &&
    typeof enriched.policyDecision === "object" &&
    !Array.isArray(enriched.policyDecision)
  ) {
    const pd = { ...(enriched.policyDecision as Record<string, unknown>) };
    if (typeof pd.reason === "string" && pd.reason.length > 500) {
      pd.reason = pd.reason.slice(0, 500);
    }
    enriched.policyDecision = pd;
  }

  if (
    enriched.normalizedSummary !== null &&
    typeof enriched.normalizedSummary === "object" &&
    !Array.isArray(enriched.normalizedSummary)
  ) {
    const ns = { ...(enriched.normalizedSummary as Record<string, unknown>) };
    if (typeof ns.commandBin === "string" && ns.commandBin.length > 80) {
      ns.commandBin = ns.commandBin.slice(0, 80);
    }
    if (typeof ns.summary === "string" && ns.summary.length > 240) {
      ns.summary = ns.summary.slice(0, 240);
    }
    if (typeof ns.mcpServerName === "string" && ns.mcpServerName.length > 120) {
      ns.mcpServerName = ns.mcpServerName.slice(0, 120);
    }
    if (typeof ns.mcpToolName === "string" && ns.mcpToolName.length > 120) {
      ns.mcpToolName = ns.mcpToolName.slice(0, 120);
    }
    enriched.normalizedSummary = ns;
  }

  // 6. Round durationMs cleanly if caller provided a non-negative finite number
  if (typeof enriched.durationMs === "number" && Number.isFinite(enriched.durationMs)) {
    enriched.durationMs = Math.max(0, Number(enriched.durationMs.toFixed(3)));
  }

  return stripUndefinedFields(enriched);
}

function serializeAuditLine(record: AuditRecord): string | null {
  let enriched: Record<string, unknown>;
  try {
    const sanitized = redactValue(record);
    if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
      logDiagnostic("Rejected audit log entry: payload is not a plain object");
      return null;
    }
    enriched = enrichAuditEventDefaults(sanitized as Record<string, unknown>);
  } catch (redactErr) {
    const errMsg = redactErr instanceof Error ? redactErr.message : String(redactErr);
    logDiagnostic("Rejected audit log entry due to normalization failure", {
      error: redactString(errMsg),
    });
    return null;
  }

  const schemaErrors = validateAuditEvent(enriched);
  if (schemaErrors.length > 0) {
    logDiagnostic("Rejected invalid audit telemetry event before persistence", {
      eventType: typeof enriched.eventType === "string" ? enriched.eventType : undefined,
      hookId: typeof enriched.hookId === "string" ? enriched.hookId : undefined,
      errors: schemaErrors,
    });
    return null;
  }

  try {
    const serialized = JSON.stringify(enriched, AUDIT_JSON_REPLACER);
    if (typeof serialized !== "string") {
      throw new Error("Audit record serialization produced undefined output.");
    }
    if (containsUnredactedSecrets(serialized)) {
      throw new Error("Post-serialization secret check detected unredacted content.");
    }
    return serialized;
  } catch (serializeErr) {
    const errMsg = serializeErr instanceof Error ? serializeErr.message : String(serializeErr);
    const safeErrMsg = redactString(errMsg);
    logDiagnostic("Audit record serialization degraded; writing redacted fallback entry", {
      error: safeErrMsg,
    });

    const fallbackEventType: AuditEventType =
      typeof enriched.eventType === "string" &&
      (AUDIT_EVENT_TYPES as readonly string[]).includes(enriched.eventType)
        ? (enriched.eventType as AuditEventType)
        : "Diagnostic";

    const fallbackRecord: AuditEvent = {
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      eventId:
        typeof enriched.eventId === "string" && enriched.eventId.length > 0
          ? enriched.eventId
          : randomUUID(),
      timestamp:
        typeof enriched.timestamp === "string" ? enriched.timestamp : new Date().toISOString(),
      eventType: fallbackEventType,
      event: fallbackEventType,
      hookId:
        typeof enriched.hookId === "string" && enriched.hookId.length > 0
          ? redactString(enriched.hookId)
          : "unknown-hook",
      source: resolveDefaultAuditSource(undefined),
      correlationId:
        typeof enriched.correlationId === "string" && enriched.correlationId.length > 0
          ? redactString(enriched.correlationId)
          : "unknown-session",
      status: typeof enriched.status === "string" ? (enriched.status as AuditEventStatus) : "error",
      metadata: { serializationError: safeErrMsg },
    };

    if (validateAuditEvent(fallbackRecord).length === 0) {
      const fallbackLine = JSON.stringify(fallbackRecord, AUDIT_JSON_REPLACER);
      if (!containsUnredactedSecrets(fallbackLine)) {
        return fallbackLine;
      }
    }
    return null;
  }
}

/** Writes a schema-validated, sanitized audit record to local JSONL log when explicit audit target exists. */
export function writeAuditLog(record: AuditRecord, workspaceRoot?: string): void {
  try {
    const auditDir = resolveSafeAuditDir(workspaceRoot);
    if (!auditDir) {
      logDiagnostic("Skipping audit log write: missing or invalid workspace context", {
        eventType: record.eventType ?? record.event ?? "UnknownEvent",
        hookId: record.hookId,
      });
      return;
    }

    const line = serializeAuditLine(record);
    if (!line) {
      return;
    }

    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }

    const logFilePath = path.join(auditDir, "execution.jsonl");
    rotateLogsIfNeeded(logFilePath);

    fs.appendFileSync(logFilePath, line + "\n", "utf8");
  } catch (error) {
    logDiagnostic("Failed to write audit log entry (failing open)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
