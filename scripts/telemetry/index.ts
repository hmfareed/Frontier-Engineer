/**
 * Phase 8.6B: Audit Telemetry Subsystem
 * Public API barrel for telemetry reading, normalization, querying,
 * aggregation, integrity diagnostics, and formatted reporting.
 */

export * from "./types.ts";
export {
  discoverAuditFiles,
  readTelemetryLog,
  readTelemetryStream,
  resolveTargetAuditDir,
  type TelemetryStreamItem,
} from "./telemetry-reader.ts";
export {
  normalizeTelemetryRecord,
  parseTelemetryLine,
  type ParsedLineResult,
} from "./telemetry-parser.ts";
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, queryTelemetryRecords } from "./telemetry-query.ts";
export { aggregateTelemetry } from "./telemetry-aggregator.ts";
export { INTEGRITY_LIMITATIONS, analyzeTelemetryIntegrity } from "./telemetry-diagnostics.ts";
export {
  escapeMarkdownCell,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  type TelemetryFormatInput,
} from "./telemetry-formatter.ts";
export {
  executeTelemetryCommand,
  validateTelemetryCliOptions,
  type TelemetryCliOptions,
  type TelemetryCommandResult,
} from "../cli/telemetry-command.ts";
