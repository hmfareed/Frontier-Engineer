/**
 * Phase 7.5 Stage 4 — Evolution Analysis Event Writer
 * Transaction-safe, idempotent persistence of Stage 4 analytical events
 * (DRIFT_*, DECISION_*, DEBT_*, MEMORY_*) without interfering with Stage 3 factual events.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { EvolutionEventRecord } from "../storage/types.ts";
import { SnapshotComparisonError } from "./snapshot-comparator.ts";
import { SnapshotValidator } from "./snapshot-validator.ts";
import type { EvolutionAnalysisResult } from "./types.ts";

export class EvolutionEventWriter {
  public static persist(
    db: SqliteDatabase,
    analysis: EvolutionAnalysisResult,
  ): EvolutionEventRecord[] {
    const repositoryId = analysis.repositoryId;
    const baseScanId = analysis.baseSnapshot.scanId;
    const targetScanId = analysis.targetSnapshot.scanId;

    // ISSUE-PERSIST-01: Validate snapshot existence, status, and repository ownership before mutating evolution_events
    if (
      analysis.comparison.repositoryId !== repositoryId ||
      analysis.comparison.baseSnapshot.scanId !== baseScanId ||
      analysis.comparison.targetSnapshot.scanId !== targetScanId
    ) {
      throw new SnapshotComparisonError(
        "Evolution analysis metadata is inconsistent with its underlying snapshot comparison.",
        "ERR_EVOLUTION_OWNERSHIP_MISMATCH",
      );
    }

    const validation = SnapshotValidator.validate(db, baseScanId, targetScanId, {
      allowPartial: analysis.status === "PARTIAL",
      expectedRepositoryId: repositoryId,
    });
    if (!validation.isValid) {
      throw new SnapshotComparisonError(
        validation.errorMessage ?? "Evolution analysis persistence validation failed.",
        validation.errorCode ?? "ERR_SNAPSHOT_VALIDATION_FAILED",
        validation,
      );
    }

    const now = new Date().toISOString();

    const deleteStmt = db.prepare(
      `DELETE FROM evolution_events
       WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?
         AND (
           event_type LIKE 'DRIFT_%'
           OR event_type LIKE 'DECISION_%'
           OR event_type LIKE 'DEBT_%'
           OR event_type LIKE 'MEMORY_%'
         )`,
    );

    const insertStmt = db.prepare(
      `INSERT INTO evolution_events (
        repository_id, base_scan_id, target_scan_id, event_type,
        category, title, description, severity, confidence,
        confidence_tier, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const persisted: EvolutionEventRecord[] = [];

    const insertEvent = (params: {
      eventType: string;
      category: "architecture" | "decision" | "debt";
      title: string;
      description: string;
      severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      confidence: number;
      confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE";
      details: Record<string, unknown>;
    }) => {
      const detailsJson = JSON.stringify(params.details);
      const res = insertStmt.run(
        repositoryId,
        baseScanId,
        targetScanId,
        params.eventType,
        params.category,
        params.title,
        params.description,
        params.severity,
        params.confidence,
        params.confidenceTier,
        detailsJson,
        now,
      );
      persisted.push({
        id: Number(res.lastInsertRowid),
        repositoryId,
        baseScanId,
        targetScanId,
        eventType: params.eventType,
        category: params.category,
        title: params.title,
        description: params.description,
        severity: params.severity,
        confidence: params.confidence,
        confidenceTier: params.confidenceTier,
        detailsJson,
        createdAt: now,
      });
    };

    db.transaction(() => {
      // Remove only prior Stage 4 analytical events for this comparison pair
      deleteStmt.run(repositoryId, baseScanId, targetScanId);

      for (const f of analysis.drift.findings) {
        insertEvent({
          eventType: f.driftType,
          category: "architecture",
          title: f.title,
          description: f.description,
          severity: f.severity,
          confidence: f.confidence,
          confidenceTier: f.confidenceTier,
          details: { findingId: f.findingId, subjectEntity: f.subjectEntity, ...f.details },
        });
      }

      for (const c of analysis.decisions.correlations) {
        insertEvent({
          eventType: c.correlationType,
          category: "decision",
          title: c.title,
          description: c.description,
          severity: c.severity,
          confidence: c.confidence,
          confidenceTier: c.confidenceTier,
          details: { findingId: c.findingId, adrId: c.adrId, ...c.details },
        });
      }

      for (const d of analysis.debt.items) {
        insertEvent({
          eventType: `${d.category}_${d.state}`,
          category: "debt",
          title: d.title,
          description: d.description,
          severity: d.severity,
          confidence: d.confidence,
          confidenceTier: d.confidenceTier,
          details: {
            findingId: d.findingId,
            category: d.category,
            state: d.state,
            subjectEntity: d.subjectEntity,
            ...d.details,
          },
        });
      }

      for (const e of analysis.memoryLifecycle.evaluations) {
        if (
          e.action === "VERIFIED_ACTIVE" ||
          e.action === "NO_CHANGE_TERMINAL" ||
          e.action === "NO_CHANGE_NON_TERMINAL"
        ) {
          continue;
        }
        insertEvent({
          eventType: `MEMORY_${e.action}`,
          category: "decision",
          title: `Memory ${e.memoryKey}: ${e.previousStatus} -> ${e.proposedStatus}`,
          description: e.reason,
          severity:
            e.proposedStatus === "DISPUTED"
              ? "HIGH"
              : e.proposedStatus === "STALE"
                ? "MEDIUM"
                : "INFO",
          confidence: 0.95,
          confidenceTier: "CONFIRMED",
          details: {
            memoryId: e.memoryId,
            memoryKey: e.memoryKey,
            previousStatus: e.previousStatus,
            proposedStatus: e.proposedStatus,
            previousVersion: e.previousVersion,
            newVersion: e.newVersion,
            supersededById: e.supersededById,
          },
        });
      }
    });

    return persisted;
  }
}
