/**
 * Phase 8.6B-2: Telemetry Integrity Diagnostics
 * Structural integrity diagnostics, sequence continuity inspection, and
 * anomaly detection across normalized telemetry records and parser diagnostics.
 */

import { redactString } from "../hooks/lib/secret-redactor.ts";
import type {
  DiagnosticCategory,
  DiagnosticSeverity,
  NormalizedTelemetryRecord,
  ParseDiagnostic,
  TelemetryIntegrityFinding,
  TelemetryIntegrityReport,
} from "./types.ts";

export const INTEGRITY_LIMITATIONS = [
  "Structural integrity diagnostics inspect schema compliance, sequence continuity, and internal field consistency only.",
  "Timestamp anomalies, step gaps, and clock skew may reflect multi-process concurrency, subagent execution, or system sleep/wake cycles, and are not proof of tampering.",
  "This engine does not provide cryptographic tamper-proofing or non-repudiation guarantees; cryptographic hash chains and hardware attestation are not implemented in Phase 8.6B.",
  "Specialist agent/skill metadata is evaluated as optional informational context based on current host runtime capability.",
];

/**
 * Evaluates structural integrity, correlation continuity, and potential anomalies
 * across normalized records and ingest diagnostics.
 */
export function analyzeTelemetryIntegrity(
  records: NormalizedTelemetryRecord[],
  diagnostics?: ParseDiagnostic[],
): TelemetryIntegrityReport {
  if (!Array.isArray(records)) {
    throw new TypeError("analyzeTelemetryIntegrity expects records array as first argument.");
  }

  const findings: TelemetryIntegrityFinding[] = [];

  // 1. Ingest/Parser Diagnostics Integration (Structural Errors & Ingest Warnings)
  if (Array.isArray(diagnostics)) {
    for (const d of diagnostics) {
      const isError = d.severity === "error";
      findings.push({
        code: d.code,
        severity: isError ? "error" : "warning",
        category: "structural",
        message: redactString(d.message),
        filePath: d.filePath,
        lineNumber: d.lineNumber,
        context: d.rawSnippet ? { rawSnippet: redactString(d.rawSnippet) } : undefined,
      });
    }
  }

  // 2. Empty Log Observation
  if (records.length === 0 && (!diagnostics || diagnostics.length === 0)) {
    findings.push({
      code: "EMPTY_AUDIT_LOG",
      severity: "info",
      category: "informational",
      message: "The audit log contains no records or diagnostics.",
    });
    return buildReport(records.length, findings);
  }

  // Tracking maps for continuity and duplicates
  const eventIdOccurrences = new Map<string, { count: number; lines: number[]; files: string[] }>();
  const sessionRecords = new Map<string, NormalizedTelemetryRecord[]>();

  let hasLegacy = false;
  let hasMissingSpecialist = false;

  // 3. Record Inspection Loop
  for (const rec of records) {
    // A. Timestamp structural validity
    const parsedEpoch = Date.parse(rec.timestamp);
    if (Number.isNaN(parsedEpoch)) {
      findings.push({
        code: "INVALID_TIMESTAMP_FORMAT",
        severity: "error",
        category: "structural",
        message: `Record contains an unparseable or non-ISO timestamp string: '${redactString(rec.timestamp)}'.`,
        filePath: rec.provenance.filePath,
        lineNumber: rec.provenance.lineNumber,
        eventId: rec.eventId,
        correlationId: rec.correlationId,
      });
    }

    // B. Event ID tracking for duplicate detection (modern-v1 only)
    if (rec.eventId && rec.eventId.trim().length > 0) {
      const id = rec.eventId.trim();
      const existing = eventIdOccurrences.get(id);
      if (existing) {
        existing.count++;
        existing.lines.push(rec.provenance.lineNumber);
        if (!existing.files.includes(rec.provenance.filePath)) {
          existing.files.push(rec.provenance.filePath);
        }
      } else {
        eventIdOccurrences.set(id, {
          count: 1,
          lines: [rec.provenance.lineNumber],
          files: [rec.provenance.filePath],
        });
      }
    }

    // C. Correlation grouping for sequence analysis
    const corr = rec.correlationId?.trim() || "unknown-session";
    if (corr === "unknown-session") {
      findings.push({
        code: "INCOMPLETE_CORRELATION",
        severity: "warning",
        category: "consistency",
        message: "Record has missing or unknown session correlation identifier.",
        filePath: rec.provenance.filePath,
        lineNumber: rec.provenance.lineNumber,
        eventId: rec.eventId,
      });
    } else {
      let group = sessionRecords.get(corr);
      if (!group) {
        group = [];
        sessionRecords.set(corr, group);
      }
      group.push(rec);
    }

    // D. Suspected unredacted credentials check in text fields
    const textsToCheck = [rec.policyDecision?.reason, rec.normalizedSummary?.summary, rec.error];
    for (const text of textsToCheck) {
      if (text && typeof text === "string") {
        const redacted = redactString(text);
        if (redacted !== text) {
          findings.push({
            code: "UNREDACTED_SECRET_SUSPECTED",
            severity: "warning",
            category: "consistency",
            message: "Record text contains suspected unredacted sensitive credential pattern.",
            filePath: rec.provenance.filePath,
            lineNumber: rec.provenance.lineNumber,
            eventId: rec.eventId,
            correlationId: rec.correlationId,
          });
          break;
        }
      }
    }

    // E. Informational flags
    if (rec.provenance.generation === "legacy") {
      hasLegacy = true;
    } else if (!rec.agentId || !rec.skillId) {
      hasMissingSpecialist = true;
    }
  }

  // 4. Duplicate Event ID Warnings
  for (const [id, meta] of eventIdOccurrences.entries()) {
    if (meta.count > 1) {
      findings.push({
        code: "DUPLICATE_EVENT_ID",
        severity: "warning",
        category: "consistency",
        message: `Duplicate event identifier '${redactString(id)}' observed across ${meta.count} records. Note: Duplicate identifiers are not automatically proof of malicious activity.`,
        eventId: id,
        context: {
          duplicateCount: meta.count,
          lineNumbers: meta.lines,
          filePaths: meta.files,
        },
      });
    }
  }

  // 5. Per-Session Sequence Continuity & Monotonicity
  for (const [corrId, group] of sessionRecords.entries()) {
    if (group.length <= 1) continue;

    let prevEpoch = -Infinity;
    let prevStepIdx = -1;

    for (let i = 0; i < group.length; i++) {
      const rec = group[i];
      const epoch = Date.parse(rec.timestamp);

      // Check non-monotonic timestamp within the same session
      if (!Number.isNaN(epoch)) {
        if (epoch < prevEpoch) {
          findings.push({
            code: "NON_MONOTONIC_TIMESTAMP",
            severity: "warning",
            category: "consistency",
            message: `Non-monotonic timestamp detected in session '${redactString(corrId)}': current event at ${rec.timestamp} precedes earlier record in log order. Note: Clock skew or concurrent processes do not constitute proof of tampering.`,
            correlationId: corrId,
            eventId: rec.eventId,
            filePath: rec.provenance.filePath,
            lineNumber: rec.provenance.lineNumber,
            context: {
              currentTimestamp: rec.timestamp,
              precedingEpochMs: prevEpoch,
            },
          });
        }
        prevEpoch = Math.max(prevEpoch, epoch);
      }

      // Check step index discontinuities within the same invocation
      if (typeof rec.stepIdx === "number" && rec.stepIdx >= 0) {
        if (prevStepIdx >= 0 && rec.stepIdx > prevStepIdx + 1) {
          // If invocationNum matches or is undefined, report gap
          findings.push({
            code: "STEP_INDEX_GAP",
            severity: "warning",
            category: "consistency",
            message: `Discontinuity in stepIdx detected in session '${redactString(corrId)}': step ${rec.stepIdx} follows step ${prevStepIdx} (gap of ${rec.stepIdx - prevStepIdx - 1} steps).`,
            correlationId: corrId,
            eventId: rec.eventId,
            filePath: rec.provenance.filePath,
            lineNumber: rec.provenance.lineNumber,
            context: {
              previousStepIdx: prevStepIdx,
              currentStepIdx: rec.stepIdx,
            },
          });
        }
        prevStepIdx = rec.stepIdx;
      }
    }
  }

  // 6. Informational Observations
  if (hasLegacy) {
    findings.push({
      code: "LEGACY_FORMAT_RECORDS_PRESENT",
      severity: "info",
      category: "informational",
      message:
        "The audit log contains historical legacy records normalized without modern schemaVersion or UUID identifiers.",
    });
  }

  if (hasMissingSpecialist) {
    findings.push({
      code: "MISSING_SPECIALIST_METADATA",
      severity: "info",
      category: "informational",
      message:
        "Specialist agentId, skillId, or executionId fields are not populated by the active host runtime.",
    });
  }

  return buildReport(records.length, findings);
}

function buildReport(
  totalRecordsAnalyzed: number,
  findings: TelemetryIntegrityFinding[],
): TelemetryIntegrityReport {
  let structuralCount = 0;
  let consistencyCount = 0;
  let informationalCount = 0;

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const f of findings) {
    if (f.category === "structural") structuralCount++;
    else if (f.category === "consistency") consistencyCount++;
    else if (f.category === "informational") informationalCount++;

    if (f.severity === "error") errorCount++;
    else if (f.severity === "warning") warningCount++;
    else if (f.severity === "info") infoCount++;
  }

  // Sort findings deterministically: error -> warning -> info, then category, then code
  const severityRank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sDiff = severityRank[a.severity] - severityRank[b.severity];
    if (sDiff !== 0) return sDiff;
    const catDiff = a.category.localeCompare(b.category);
    if (catDiff !== 0) return catDiff;
    const codeDiff = a.code.localeCompare(b.code);
    if (codeDiff !== 0) return codeDiff;
    const lineA = a.lineNumber ?? 0;
    const lineB = b.lineNumber ?? 0;
    return lineA - lineB;
  });

  return {
    timestamp: new Date().toISOString(),
    totalRecordsAnalyzed,
    totalFindings: findings.length,
    countsByCategory: {
      structural: structuralCount,
      consistency: consistencyCount,
      informational: informationalCount,
    },
    countsBySeverity: {
      error: errorCount,
      warning: warningCount,
      info: infoCount,
    },
    findings,
    limitations: [...INTEGRITY_LIMITATIONS],
  };
}
