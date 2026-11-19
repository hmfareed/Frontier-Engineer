/**
 * Phase 8.6B-2: Telemetry Aggregator
 * Deterministic aggregation and summary statistics over normalized telemetry records.
 */

import type { NormalizedTelemetryRecord, ParseDiagnostic, TelemetryAggregation } from "./types.ts";

function sortRecordKeys<V>(record: Record<string, V>): Record<string, V> {
  const sorted: Record<string, V> = {};
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * Computes deterministic aggregate statistics across a set of normalized telemetry records.
 * Ensures missing fields are reported as missing rather than fabricated.
 */
export function aggregateTelemetry(
  records: NormalizedTelemetryRecord[],
  diagnostics?: ParseDiagnostic[],
): TelemetryAggregation {
  if (!Array.isArray(records)) {
    throw new TypeError("aggregateTelemetry expects records array as first argument.");
  }

  const rawEventTypeCounts: Record<string, number> = {};
  const rawDecisionCounts: Record<string, number> = {};
  const rawSourceCounts: Record<string, number> = {};
  const rawStatusCounts: Record<string, number> = {};
  const rawToolCounts: Record<string, number> = {};

  let modernV1Count = 0;
  let legacyCount = 0;

  const distinctCorrelations = new Set<string>();
  const distinctTools = new Set<string>();

  let earliestMs = Infinity;
  let latestMs = -Infinity;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  let missingPolicyDecision = 0;
  let missingSummary = 0;
  let missingToolName = 0;
  let missingAgentId = 0;
  let missingSkillId = 0;
  let missingExecutionId = 0;

  for (const rec of records) {
    // 1. Generation classification
    if (rec.provenance.generation === "modern-v1") {
      modernV1Count++;
    } else {
      legacyCount++;
    }

    // 2. Event type
    const et = rec.eventType || "UnknownEvent";
    rawEventTypeCounts[et] = (rawEventTypeCounts[et] ?? 0) + 1;

    // 3. Policy decision
    const decision = rec.policyDecision?.decision?.toLowerCase() ?? "none";
    rawDecisionCounts[decision] = (rawDecisionCounts[decision] ?? 0) + 1;

    // 4. Source classification
    const src = rec.source || "unknown";
    rawSourceCounts[src] = (rawSourceCounts[src] ?? 0) + 1;

    // 5. Status
    const status = rec.status || "unknown";
    rawStatusCounts[status] = (rawStatusCounts[status] ?? 0) + 1;

    // 6. Tool name
    if (rec.toolName && rec.toolName.trim().length > 0) {
      const tool = rec.toolName.trim();
      rawToolCounts[tool] = (rawToolCounts[tool] ?? 0) + 1;
      distinctTools.add(tool);
    } else {
      missingToolName++;
    }

    // 7. Correlation session tracking
    if (rec.correlationId && rec.correlationId.trim().length > 0) {
      distinctCorrelations.add(rec.correlationId.trim());
    }

    // 8. Timestamps
    const ms = Date.parse(rec.timestamp);
    if (!Number.isNaN(ms)) {
      if (ms < earliestMs) {
        earliestMs = ms;
        firstTimestamp = rec.timestamp;
      }
      if (ms > latestMs) {
        latestMs = ms;
        lastTimestamp = rec.timestamp;
      }
    }

    // 9. Missing optional metadata metrics
    if (!rec.policyDecision) {
      missingPolicyDecision++;
    }
    if (!rec.normalizedSummary) {
      missingSummary++;
    }
    if (!rec.agentId) {
      missingAgentId++;
    }
    if (!rec.skillId) {
      missingSkillId++;
    }
    if (!rec.executionId) {
      missingExecutionId++;
    }
  }

  // 10. Diagnostics breakdown if diagnostics are provided
  let diagnosticSummary: TelemetryAggregation["diagnosticSummary"];
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    let errorCount = 0;
    let warningCount = 0;
    const rawCodeCounts: Record<string, number> = {};

    for (const d of diagnostics) {
      if (d.severity === "error") {
        errorCount++;
      } else if (d.severity === "warning") {
        warningCount++;
      }
      const code = d.code || "UNKNOWN";
      rawCodeCounts[code] = (rawCodeCounts[code] ?? 0) + 1;
    }

    diagnosticSummary = {
      totalDiagnostics: diagnostics.length,
      errorCount,
      warningCount,
      countsByCode: sortRecordKeys(rawCodeCounts),
    };
  }

  return {
    totalValidRecords: records.length,
    countsByEventType: sortRecordKeys(rawEventTypeCounts),
    countsByPolicyDecision: sortRecordKeys(rawDecisionCounts),
    countsBySource: sortRecordKeys(rawSourceCounts),
    countsByStatus: sortRecordKeys(rawStatusCounts),
    countsByTool: sortRecordKeys(rawToolCounts),
    countsByGeneration: {
      modernV1: modernV1Count,
      legacy: legacyCount,
    },
    firstTimestamp,
    lastTimestamp,
    distinctCorrelationCount: distinctCorrelations.size,
    distinctToolCount: distinctTools.size,
    missingMetadataCounts: {
      missingPolicyDecision,
      missingSummary,
      missingToolName,
      missingAgentId,
      missingSkillId,
      missingExecutionId,
    },
    ...(diagnosticSummary ? { diagnosticSummary } : {}),
  };
}
