/**
 * Phase 8.6B-3: Frontier Engineer Telemetry & Audit CLI Integration
 * Read-only command handler for querying telemetry, generating aggregate summaries,
 * and reporting structural integrity diagnostics.
 */

import fs from "node:fs";
import path from "node:path";
import {
  aggregateTelemetry,
  analyzeTelemetryIntegrity,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  queryTelemetryRecords,
  readTelemetryLog,
  resolveTargetAuditDir,
  type NormalizedTelemetryRecord,
  type TelemetryAggregation,
  type TelemetryFormatInput,
  type TelemetryGeneration,
  type TelemetryIntegrityReport,
  type TelemetryQueryResult,
  type TelemetryQuerySpec,
  type TelemetrySortField,
  type TelemetrySortOrder,
} from "../telemetry/index.ts";

export interface TelemetryCliOptions {
  workspaceRoot: string;
  auditDir?: string;
  format: "text" | "json" | "markdown";
  includeRotated?: boolean;
  maxLines?: number;

  // Modes
  aggregateMode?: boolean;
  diagnosticsMode?: boolean;

  // Filter criteria
  eventType?: string[];
  eventId?: string;
  policyDecision?: string[];
  toolName?: string[];
  status?: string[];
  source?: string[];
  correlationId?: string;
  conversationId?: string;
  executionId?: string;
  agentId?: string;
  skillId?: string;
  startTime?: string | number | Date;
  endTime?: string | number | Date;
  exactTime?: string | number | Date;
  textSearch?: string;
  generation?: TelemetryGeneration;

  // Sorting & pagination
  sortBy?: TelemetrySortField;
  sortOrder?: TelemetrySortOrder;
  page?: number;
  pageSize?: number;
}

export interface TelemetryCommandResult {
  exitCode: number;
  output: string;
  error?: string;
}

const VALID_SORT_FIELDS = new Set<TelemetrySortField>([
  "timestamp",
  "eventType",
  "durationMs",
  "stepIdx",
]);
const VALID_SORT_ORDERS = new Set<TelemetrySortOrder>(["asc", "desc"]);
const VALID_GENERATIONS = new Set<TelemetryGeneration>(["modern-v1", "legacy"]);

/**
 * Validates telemetry options strictly. Returns an error message if invalid, or null if valid.
 */
export function validateTelemetryCliOptions(options: TelemetryCliOptions): string | null {
  if (options.sortBy && !VALID_SORT_FIELDS.has(options.sortBy)) {
    return `Invalid --sort-by option: must be one of ${Array.from(VALID_SORT_FIELDS).join(", ")}.`;
  }

  if (options.sortOrder && !VALID_SORT_ORDERS.has(options.sortOrder)) {
    return `Invalid --sort-order option: must be 'asc' or 'desc'.`;
  }

  if (options.generation && !VALID_GENERATIONS.has(options.generation)) {
    return `Invalid --generation option: must be 'modern-v1' or 'legacy'.`;
  }

  if (options.page !== undefined) {
    if (!Number.isSafeInteger(options.page) || options.page < 1) {
      return "Invalid --page option: must be a positive integer >= 1.";
    }
  }

  if (options.pageSize !== undefined) {
    if (
      !Number.isSafeInteger(options.pageSize) ||
      options.pageSize < 1 ||
      options.pageSize > 1000
    ) {
      return "Invalid --page-size / --limit option: must be a positive integer between 1 and 1000.";
    }
  }

  // Validate date inputs
  const validateDateParam = (
    val: string | number | Date | undefined,
    name: string,
  ): string | null => {
    if (val === undefined) return null;
    const ms =
      val instanceof Date ? val.getTime() : typeof val === "number" ? val : Date.parse(val);
    if (Number.isNaN(ms)) {
      return `Invalid ${name} option: unable to parse valid date string or timestamp.`;
    }
    return null;
  };

  const startErr = validateDateParam(options.startTime, "--start-time");
  if (startErr) return startErr;

  const endErr = validateDateParam(options.endTime, "--end-time");
  if (endErr) return endErr;

  const exactErr = validateDateParam(options.exactTime, "--exact-time");
  if (exactErr) return exactErr;

  if (options.startTime && options.endTime) {
    const s =
      options.startTime instanceof Date
        ? options.startTime.getTime()
        : typeof options.startTime === "number"
          ? options.startTime
          : Date.parse(options.startTime);
    const e =
      options.endTime instanceof Date
        ? options.endTime.getTime()
        : typeof options.endTime === "number"
          ? options.endTime
          : Date.parse(options.endTime);
    if (s > e) {
      return "Invalid time range: --start-time must be earlier than or equal to --end-time.";
    }
  }

  return null;
}

/**
 * Executes the telemetry / audit query command.
 */
export async function executeTelemetryCommand(
  options: TelemetryCliOptions,
): Promise<TelemetryCommandResult> {
  // 1. Validation
  const validationError = validateTelemetryCliOptions(options);
  if (validationError) {
    return {
      exitCode: 2,
      output: "",
      error: validationError,
    };
  }

  // 2. Resolve audit directory
  const targetAuditDir = resolveTargetAuditDir({
    workspaceRoot: options.workspaceRoot,
    auditDir: options.auditDir,
  });

  if (!targetAuditDir || !fs.existsSync(targetAuditDir)) {
    return {
      exitCode: 3,
      output: "",
      error: `Audit directory does not exist or is unavailable: '${targetAuditDir ?? options.auditDir ?? options.workspaceRoot}'.`,
    };
  }

  try {
    const stat = fs.statSync(targetAuditDir);
    if (!stat.isDirectory()) {
      return {
        exitCode: 3,
        output: "",
        error: `Specified audit path '${targetAuditDir}' is not a directory.`,
      };
    }
  } catch (err) {
    return {
      exitCode: 3,
      output: "",
      error: `Failed to inspect audit directory '${targetAuditDir}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Read audit telemetry logs
  let readResult;
  try {
    readResult = await readTelemetryLog({
      workspaceRoot: options.workspaceRoot,
      auditDir: options.auditDir,
      includeRotated: options.includeRotated,
      maxLines: options.maxLines,
    });
  } catch (err) {
    return {
      exitCode: 1,
      output: "",
      error: `Failed to read telemetry log: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { records, diagnostics, filesScanned } = readResult;

  if (filesScanned.length === 0) {
    return {
      exitCode: 3,
      output: "",
      error: `No audit log files found in '${targetAuditDir}'.`,
    };
  }

  // 4. If a specific eventId was requested, verify existence
  if (options.eventId) {
    const found = records.some((r) => r.eventId === options.eventId);
    if (!found) {
      return {
        exitCode: 4,
        output: "",
        error: `Telemetry event with ID '${options.eventId}' was not found.`,
      };
    }
  }

  // 5. Build results based on requested modes
  let queryResult: TelemetryQueryResult | undefined;
  let aggregation: TelemetryAggregation | undefined;
  let integrityReport: TelemetryIntegrityReport | undefined;

  const isDiagnostics = Boolean(options.diagnosticsMode);
  const isAggregate = Boolean(options.aggregateMode);
  const isQuery = !isDiagnostics && !isAggregate; // default mode

  if (isDiagnostics) {
    integrityReport = analyzeTelemetryIntegrity(records, diagnostics);
  }

  if (isAggregate) {
    aggregation = aggregateTelemetry(records, diagnostics);
  }

  if (isQuery || (!isDiagnostics && !isAggregate) || options.eventId) {
    const querySpec: TelemetryQuerySpec = {
      eventType: options.eventType,
      eventId: options.eventId,
      policyDecision: options.policyDecision,
      toolName: options.toolName,
      status: options.status,
      source: options.source,
      correlationId: options.correlationId,
      conversationId: options.conversationId,
      executionId: options.executionId,
      agentId: options.agentId,
      skillId: options.skillId,
      startTime: options.startTime,
      endTime: options.endTime,
      exactTime: options.exactTime,
      textSearch: options.textSearch,
      generation: options.generation,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      page: options.page,
      pageSize: options.pageSize,
    };

    queryResult = queryTelemetryRecords(records, querySpec);
  }

  // 6. Format output
  const formatInput: TelemetryFormatInput = {
    title:
      options.diagnosticsMode && options.aggregateMode
        ? "Frontier Engineer Telemetry Aggregation & Diagnostics"
        : options.diagnosticsMode
          ? "Frontier Engineer Telemetry Integrity Diagnostics"
          : options.aggregateMode
            ? "Frontier Engineer Telemetry Aggregation Summary"
            : "Frontier Engineer Telemetry Query Report",
    queryResult,
    aggregation,
    integrityReport,
  };

  let formattedOutput: string;
  if (options.format === "json") {
    formattedOutput = formatTelemetryJson(formatInput, { pretty: true }) + "\n";
  } else {
    formattedOutput = formatTelemetryMarkdown(formatInput);
    if (!formattedOutput.endsWith("\n")) {
      formattedOutput += "\n";
    }
  }

  return {
    exitCode: 0,
    output: formattedOutput,
  };
}
