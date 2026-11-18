/**
 * Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer
 * Public API barrel for the telemetry subsystem.
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
