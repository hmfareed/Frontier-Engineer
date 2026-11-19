/**
 * Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer
 * Strongly-typed definitions for Frontier Engineer audit telemetry processing.
 */

import type {
  AuditEvent,
  AuditEventSource,
  AuditEventStatus,
  AuditEventType,
  AuditNormalizedSummary,
  AuditPolicyDecision,
} from "../hooks/lib/audit-schema.ts";

export type TelemetryGeneration = "modern-v1" | "legacy";

export type RawTelemetryRecord = Record<string, unknown>;

export interface RecordProvenance {
  filePath: string;
  fileName: string;
  lineNumber: number;
  generation: TelemetryGeneration;
}

export interface NormalizedPolicyDecision {
  decision: string;
  category?: string;
  semanticClass?: string;
  reason?: string;
  fallbackUsed?: boolean;
  overwriteApplied?: boolean;
}

export interface NormalizedSummary {
  toolKind?: string;
  commandBin?: string;
  targetCount?: number;
  workspaceStatus?: string;
  summary?: string;
  mcpServerName?: string;
  mcpToolName?: string;
}

export interface NormalizedTelemetryRecord {
  /** Record source and file coordinates */
  provenance: RecordProvenance;
  /** Unmodified original parsed record */
  raw: RawTelemetryRecord;
  /** Version number: 1 for modern Phase 8.6A, undefined for legacy pre-8.6A */
  schemaVersion?: number;
  /** Unique event UUID (present in modern-v1, undefined in legacy — never fabricated) */
  eventId?: string;
  /** ISO-8601 timestamp string */
  timestamp: string;
  /** Canonical event type (e.g. SessionStart, PreToolUse, Stop) */
  eventType: string;
  /** Legacy event alias if originally present */
  eventAlias?: string;
  /** Provenance source classification: production, evaluation, test, or legacy */
  source: string;
  /** Canonical correlation identifier (normalized from correlationId ?? conversationId) */
  correlationId: string;
  /** Legacy conversation alias if originally present */
  conversationAlias?: string;
  /** Identifier of the originating hook handler */
  hookId: string;
  /** Execution status (info, success, denied, error, escalated) */
  status: string;
  /** Tool name if tool invocation event */
  toolName?: string;
  /** Step index within invocation if known */
  stepIdx?: number;
  /** Invocation index within session if known */
  invocationNum?: number;
  /** Execution duration in milliseconds if known */
  durationMs?: number;
  /** Normalized security policy decision */
  policyDecision?: NormalizedPolicyDecision;
  /** Normalized redacted command / tool summary */
  normalizedSummary?: NormalizedSummary;
  /** Evaluation context if executed under evaluation */
  evalContext?: Record<string, string | undefined>;
  /** Error message or class if applicable */
  error?: string;
  /** Metadata payload (object or string) */
  metadata?: Record<string, unknown> | string;
  /** Distinct execution identifier if genuinely known */
  executionId?: string;
  /** Parent execution identifier for child tasks */
  parentExecutionId?: string;
  /** Acting specialist agent identifier if genuinely known */
  agentId?: string;
  /** Skill identifier if genuinely known */
  skillId?: string;
}

export interface AuditFileMetadata {
  filePath: string;
  fileName: string;
  isRotated: boolean;
  rotationIndex?: number;
  sizeBytes: number;
  mtimeMs: number;
  isoModified: string;
}

export type ParseDiagnosticCode =
  | "INVALID_JSON"
  | "EMPTY_LINE"
  | "UNSUPPORTED_VERSION"
  | "SCHEMA_VIOLATION"
  | "ALIAS_MISMATCH"
  | "IO_ERROR";

export interface ParseDiagnostic {
  severity: "warning" | "error";
  code: ParseDiagnosticCode;
  message: string;
  filePath: string;
  lineNumber: number;
  rawSnippet?: string;
}

export interface TelemetryReaderOptions {
  /** Workspace directory (defaults to process.cwd()) */
  workspaceRoot?: string;
  /** Explicit audit directory overriding workspace resolution */
  auditDir?: string;
  /** If true, reads rotated archives (.3, .2, .1) in chronological order prior to active log */
  includeRotated?: boolean;
  /** Maximum number of records to process */
  maxLines?: number;
  /** Abort signal for graceful cancellation */
  signal?: AbortSignal;
  /** Optional callback invoked for each physical line read from a file */
  onPhysicalLine?: (filePath: string, lineNumber: number) => void;
}

export interface InternalTelemetryStreamOptions extends TelemetryReaderOptions {
  /** Pre-discovered audit files and discovery diagnostics to avoid redundant filesystem traversal */
  discovered?: {
    files: AuditFileMetadata[];
    diagnostics: ParseDiagnostic[];
  };
}

export interface TelemetryReadResult {
  records: NormalizedTelemetryRecord[];
  diagnostics: ParseDiagnostic[];
  filesScanned: AuditFileMetadata[];
  totalLinesRead: number;
  validRecordCount: number;
  malformedLineCount: number;
}

// ============================================================================
// Phase 8.6B-2: Query, Aggregation, Integrity & Formatter Specifications
// ============================================================================

export type TelemetrySortField = "timestamp" | "eventType" | "durationMs" | "stepIdx";
export type TelemetrySortOrder = "asc" | "desc";

export interface TelemetryQuerySpec {
  /** Event types to match (case-sensitive exact match; string or array of strings) */
  eventType?: string | string[];
  /** Unique event identifier to match */
  eventId?: string;
  /** Security policy decision (e.g. "allow", "deny", "force_ask", "ask") */
  policyDecision?: string | string[];
  /** Tool name to match (e.g. "run_command", "read_file") */
  toolName?: string | string[];
  /** Execution status (e.g. "info", "success", "denied", "error", "escalated") */
  status?: string | string[];
  /** Source classification (e.g. "production", "evaluation", "test", "legacy") */
  source?: string | string[];
  /** Correlation/session identifier (matches correlationId or conversationAlias) */
  correlationId?: string;
  /** Legacy alias for correlationId */
  conversationId?: string;
  /** Distinct execution identifier if present */
  executionId?: string;
  /** Acting specialist agent identifier if present */
  agentId?: string;
  /** Specialist skill identifier if present */
  skillId?: string;
  /** Inclusive lower bound timestamp (ISO-8601 string, unix timestamp in ms, or Date object) */
  startTime?: string | number | Date;
  /** Inclusive upper bound timestamp (ISO-8601 string, unix timestamp in ms, or Date object) */
  endTime?: string | number | Date;
  /** Exact timestamp match (ISO-8601 string, unix timestamp in ms, or Date object) */
  exactTime?: string | number | Date;
  /** Case-insensitive substring match across approved searchable fields */
  textSearch?: string;
  /** Generation filter: "modern-v1" or "legacy" */
  generation?: TelemetryGeneration;
  /** Field to sort by (default: "timestamp") */
  sortBy?: TelemetrySortField;
  /** Sort direction: "asc" or "desc" (default: "asc") */
  sortOrder?: TelemetrySortOrder;
  /** 1-based page index (default: 1) */
  page?: number;
  /** Number of records per page (default: 50, maximum: 1000) */
  pageSize?: number;
}

export interface TelemetryPaginationMeta {
  totalMatched: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export interface TelemetryQueryResult {
  records: NormalizedTelemetryRecord[];
  pagination: TelemetryPaginationMeta;
  appliedQuery: TelemetryQuerySpec;
}

export interface TelemetryAggregation {
  totalValidRecords: number;
  countsByEventType: Record<string, number>;
  countsByPolicyDecision: Record<string, number>;
  countsBySource: Record<string, number>;
  countsByStatus: Record<string, number>;
  countsByTool: Record<string, number>;
  countsByGeneration: {
    modernV1: number;
    legacy: number;
  };
  firstTimestamp?: string;
  lastTimestamp?: string;
  distinctCorrelationCount: number;
  distinctToolCount: number;
  missingMetadataCounts: {
    missingPolicyDecision: number;
    missingSummary: number;
    missingToolName: number;
    missingAgentId: number;
    missingSkillId: number;
    missingExecutionId: number;
  };
  diagnosticSummary?: {
    totalDiagnostics: number;
    errorCount: number;
    warningCount: number;
    countsByCode: Record<string, number>;
  };
}

export type DiagnosticCategory = "structural" | "consistency" | "informational";
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface TelemetryIntegrityFinding {
  code: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  message: string;
  context?: Record<string, unknown>;
  filePath?: string;
  lineNumber?: number;
  eventId?: string;
  correlationId?: string;
}

export interface TelemetryIntegrityReport {
  timestamp: string;
  totalRecordsAnalyzed: number;
  totalFindings: number;
  countsByCategory: {
    structural: number;
    consistency: number;
    informational: number;
  };
  countsBySeverity: {
    error: number;
    warning: number;
    info: number;
  };
  findings: TelemetryIntegrityFinding[];
  limitations: string[];
}

export interface JsonFormatterOptions {
  pretty?: boolean;
}

export interface MarkdownFormatterOptions {
  title?: string;
  maxRows?: number;
}
