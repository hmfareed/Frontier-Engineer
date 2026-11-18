/**
 * Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer
 * Parser and normalizer for modern Phase 8.6A and historical pre-8.6A audit events.
 */

import { validateAuditEvent } from "../hooks/lib/audit-schema.ts";
import { redactString } from "../hooks/lib/secret-redactor.ts";
import type {
  NormalizedPolicyDecision,
  NormalizedSummary,
  NormalizedTelemetryRecord,
  ParseDiagnostic,
  RecordProvenance,
  TelemetryGeneration,
} from "./types.ts";

export interface ParsedLineResult {
  record?: NormalizedTelemetryRecord;
  diagnostics: ParseDiagnostic[];
  isBlank?: boolean;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Normalizes a policy decision from either modern structured fields or legacy metadata.
 */
function extractPolicyDecision(raw: Record<string, unknown>): NormalizedPolicyDecision | undefined {
  if (isPlainObject(raw.policyDecision)) {
    const pd = raw.policyDecision;
    if (typeof pd.decision === "string") {
      return {
        decision: pd.decision,
        category: typeof pd.category === "string" ? pd.category : undefined,
        semanticClass: typeof pd.semanticClass === "string" ? pd.semanticClass : undefined,
        reason: typeof pd.reason === "string" ? pd.reason : undefined,
        fallbackUsed: typeof pd.fallbackUsed === "boolean" ? pd.fallbackUsed : undefined,
        overwriteApplied:
          typeof pd.overwriteApplied === "boolean" ? pd.overwriteApplied : undefined,
      };
    }
  }

  // Legacy fallback: metadata.decision
  if (isPlainObject(raw.metadata) && typeof raw.metadata.decision === "string") {
    return {
      decision: raw.metadata.decision,
      category: typeof raw.metadata.category === "string" ? raw.metadata.category : undefined,
      reason: typeof raw.metadata.reason === "string" ? raw.metadata.reason : undefined,
      semanticClass:
        typeof raw.metadata.semanticClass === "string" ? raw.metadata.semanticClass : undefined,
    };
  }

  return undefined;
}

/**
 * Normalizes a summary from modern structured summary fields.
 */
function extractNormalizedSummary(raw: Record<string, unknown>): NormalizedSummary | undefined {
  if (isPlainObject(raw.normalizedSummary)) {
    const ns = raw.normalizedSummary;
    return {
      toolKind: typeof ns.toolKind === "string" ? ns.toolKind : undefined,
      commandBin: typeof ns.commandBin === "string" ? ns.commandBin : undefined,
      targetCount: typeof ns.targetCount === "number" ? ns.targetCount : undefined,
      workspaceStatus: typeof ns.workspaceStatus === "string" ? ns.workspaceStatus : undefined,
      summary: typeof ns.summary === "string" ? ns.summary : undefined,
      mcpServerName: typeof ns.mcpServerName === "string" ? ns.mcpServerName : undefined,
      mcpToolName: typeof ns.mcpToolName === "string" ? ns.mcpToolName : undefined,
    };
  }
  return undefined;
}

/**
 * Normalizes an evaluation context if present.
 */
function extractEvalContext(
  raw: Record<string, unknown>,
): Record<string, string | undefined> | undefined {
  if (isPlainObject(raw.evalContext)) {
    const ec = raw.evalContext;
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(ec)) {
      if (typeof v === "string") {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * Normalizes a parsed JSON record into the canonical NormalizedTelemetryRecord representation.
 * Explicitly distinguishes modern-v1 from legacy records and never fabricates identifiers.
 */
export function normalizeTelemetryRecord(
  raw: Record<string, unknown>,
  baseProvenance: Omit<RecordProvenance, "generation">,
): { record?: NormalizedTelemetryRecord; diagnostics: ParseDiagnostic[] } {
  const diagnostics: ParseDiagnostic[] = [];

  // 1. Generation detection
  let generation: TelemetryGeneration;
  if (raw.schemaVersion !== undefined) {
    if (raw.schemaVersion !== 1) {
      diagnostics.push({
        severity: "error",
        code: "UNSUPPORTED_VERSION",
        message: `Unsupported schemaVersion '${String(raw.schemaVersion)}': expected 1.`,
        filePath: baseProvenance.filePath,
        lineNumber: baseProvenance.lineNumber,
      });
      // Invariant: Never convert unsupported modern versions into legacy records
      return { diagnostics };
    }
    generation = "modern-v1";
  } else {
    generation = "legacy";
  }

  const provenance: RecordProvenance = {
    ...baseProvenance,
    generation,
  };

  // 2. Generation-specific validation
  if (generation === "modern-v1") {
    const schemaErrors = validateAuditEvent(raw);
    if (schemaErrors.length > 0) {
      for (const err of schemaErrors) {
        diagnostics.push({
          severity: "error",
          code: "SCHEMA_VIOLATION",
          message: redactString(err),
          filePath: provenance.filePath,
          lineNumber: provenance.lineNumber,
        });
      }
      // Strict contract: Schema-invalid modern records are quarantined.
      // Retain structured diagnostics with file and line context, but return no normalized record.
      // Never fall back to legacy classification.
      return { diagnostics };
    }
  } else {
    // Legacy structural checks
    if (typeof raw.timestamp !== "string" || raw.timestamp.trim().length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "SCHEMA_VIOLATION",
        message: "Legacy record missing timestamp string.",
        filePath: provenance.filePath,
        lineNumber: provenance.lineNumber,
      });
    }
    if (typeof raw.event !== "string" && typeof raw.eventType !== "string") {
      diagnostics.push({
        severity: "error",
        code: "SCHEMA_VIOLATION",
        message: "Legacy record missing event type identifier.",
        filePath: provenance.filePath,
        lineNumber: provenance.lineNumber,
      });
      return { diagnostics };
    }
  }

  // 3. Normalization without fabrication
  const eventType =
    typeof raw.eventType === "string"
      ? raw.eventType
      : typeof raw.event === "string"
        ? raw.event
        : "UnknownEvent";

  const eventAlias = typeof raw.event === "string" ? raw.event : undefined;

  const correlationId =
    typeof raw.correlationId === "string" && raw.correlationId.trim().length > 0
      ? raw.correlationId.trim()
      : typeof raw.conversationId === "string" && raw.conversationId.trim().length > 0
        ? raw.conversationId.trim()
        : "unknown-session";

  const conversationAlias = typeof raw.conversationId === "string" ? raw.conversationId : undefined;

  const source =
    generation === "modern-v1" && typeof raw.source === "string" ? raw.source : "legacy";

  const record: NormalizedTelemetryRecord = {
    provenance,
    raw,
    schemaVersion: generation === "modern-v1" ? 1 : undefined,
    eventId:
      generation === "modern-v1" && typeof raw.eventId === "string" ? raw.eventId : undefined,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date(0).toISOString(),
    eventType,
    eventAlias,
    source,
    correlationId,
    conversationAlias,
    hookId: typeof raw.hookId === "string" ? raw.hookId : "unknown-hook",
    status: typeof raw.status === "string" ? raw.status : "info",
    toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
    stepIdx:
      typeof raw.stepIdx === "number" && Number.isInteger(raw.stepIdx) ? raw.stepIdx : undefined,
    invocationNum:
      typeof raw.invocationNum === "number" && Number.isInteger(raw.invocationNum)
        ? raw.invocationNum
        : undefined,
    durationMs:
      typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)
        ? raw.durationMs
        : undefined,
    policyDecision: extractPolicyDecision(raw),
    normalizedSummary: extractNormalizedSummary(raw),
    evalContext: extractEvalContext(raw),
    error: typeof raw.error === "string" ? raw.error : undefined,
    metadata:
      isPlainObject(raw.metadata) || typeof raw.metadata === "string" ? raw.metadata : undefined,
    executionId:
      typeof raw.executionId === "string" && raw.executionId.trim().length > 0
        ? raw.executionId
        : undefined,
    parentExecutionId:
      typeof raw.parentExecutionId === "string" && raw.parentExecutionId.trim().length > 0
        ? raw.parentExecutionId
        : undefined,
    agentId:
      typeof raw.agentId === "string" && raw.agentId.trim().length > 0 ? raw.agentId : undefined,
    skillId:
      typeof raw.skillId === "string" && raw.skillId.trim().length > 0 ? raw.skillId : undefined,
  };

  return { record, diagnostics };
}

/**
 * Parses a single raw string line from a JSONL audit log.
 */
export function parseTelemetryLine(
  line: string,
  baseProvenance: Omit<RecordProvenance, "generation">,
): ParsedLineResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, diagnostics: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (jsonErr) {
    const safeSnippet = redactString(trimmed.slice(0, 80));
    return {
      diagnostics: [
        {
          severity: "error",
          code: "INVALID_JSON",
          message: `Malformed JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`,
          filePath: baseProvenance.filePath,
          lineNumber: baseProvenance.lineNumber,
          rawSnippet: safeSnippet,
        },
      ],
    };
  }

  if (!isPlainObject(raw)) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "SCHEMA_VIOLATION",
          message: "Line does not parse to a JSON object.",
          filePath: baseProvenance.filePath,
          lineNumber: baseProvenance.lineNumber,
          rawSnippet: redactString(trimmed.slice(0, 80)),
        },
      ],
    };
  }

  return normalizeTelemetryRecord(raw, baseProvenance);
}
