/**
 * Phase 7.5 Stage 3 — Snapshot Comparator Engine
 * Canonical orchestrator for deterministic repository diffing, evidence collection, and evolution events.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { ScanRecord } from "../storage/types.ts";
import { SnapshotValidator } from "./snapshot-validator.ts";
import { FileDiffEngine } from "./file-diff.ts";
import { SymbolDiffEngine } from "./symbol-diff.ts";
import { DependencyDiffEngine } from "./dependency-diff.ts";
import { ComponentDiffEngine } from "./component-diff.ts";
import { AdrDiffEngine } from "./adr-diff.ts";
import { ComparisonSummaryDeriver } from "./comparison-summary.ts";
import { EventPersistenceBoundary } from "./event-persistence.ts";
import type {
  SnapshotComparison,
  SnapshotValidationResult,
  ComparatorOptions,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparisonStatus,
  SnapshotHeader,
} from "./types.ts";

export class SnapshotComparisonError extends Error {
  public readonly code: string;
  public readonly validationResult?: SnapshotValidationResult;

  constructor(message: string, code: string, validationResult?: SnapshotValidationResult) {
    super(message);
    this.name = "SnapshotComparisonError";
    this.code = code;
    this.validationResult = validationResult;
  }
}

export class SnapshotComparator {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public validate(
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): SnapshotValidationResult {
    return SnapshotValidator.validate(this.db, baseScanId, targetScanId, options);
  }

  public compare(
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): SnapshotComparison {
    // 1. Strict Validation
    const validation = this.validate(baseScanId, targetScanId, options);
    if (!validation.isValid) {
      throw new SnapshotComparisonError(
        validation.errorMessage || "Snapshot validation failed.",
        validation.errorCode || "ERR_VALIDATION_FAILED",
        validation,
      );
    }

    const repositoryId = validation.repositoryId!;

    // 2. Fetch Repository Identity
    const repoRow = this.db
      .prepare("SELECT identity FROM repositories WHERE id = ?")
      .get(repositoryId) as { identity: string } | undefined;

    const repositoryIdentity = repoRow?.identity || `repo_${repositoryId}`;

    // 3. Fetch Base and Target Snapshot Headers
    const baseScan = this.getScanHeader(repositoryId, baseScanId);
    const targetScan = this.getScanHeader(repositoryId, targetScanId);
    const basePartial = baseScan.status === "PARTIAL";
    const targetPartial = targetScan.status === "PARTIAL";
    const comparisonStatus: ComparisonStatus =
      basePartial || targetPartial ? "PARTIAL" : "COMPLETE";

    // 4. Execute Domain Diff Engines
    const fileDiff = FileDiffEngine.diff(this.db, repositoryId, baseScanId, targetScanId, options);
    const symbolDiff = SymbolDiffEngine.diff(
      this.db,
      repositoryId,
      baseScanId,
      targetScanId,
      options,
    );
    const dependencyDiff = DependencyDiffEngine.diff(
      this.db,
      repositoryId,
      baseScanId,
      targetScanId,
      options,
    );
    const componentDiff = ComponentDiffEngine.diff(
      this.db,
      repositoryId,
      baseScanId,
      targetScanId,
      options,
    );
    const adrDiff = AdrDiffEngine.diff(this.db, repositoryId, baseScanId, targetScanId, options);

    // 5. Aggregate and Deterministically Sort Evidence
    const allEvidence: ComparisonEvidence[] = [
      ...fileDiff.evidence,
      ...symbolDiff.evidence,
      ...dependencyDiff.evidence,
      ...componentDiff.evidence,
      ...adrDiff.evidence,
    ];

    const evidenceMap = new Map<string, ComparisonEvidence>();
    for (const ev of allEvidence) {
      evidenceMap.set(ev.evidenceId, ev);
    }
    const sortedEvidence = Array.from(evidenceMap.values()).sort((a, b) =>
      a.evidenceId.localeCompare(b.evidenceId),
    );

    // 6. Aggregate Limitations
    const allLimitations: ComparisonLimitation[] = [
      ...fileDiff.limitations,
      ...symbolDiff.limitations,
      ...dependencyDiff.limitations,
      ...componentDiff.limitations,
      ...adrDiff.limitations,
    ];

    if (basePartial || targetPartial) {
      const partialIds: number[] = [];
      if (basePartial) partialIds.push(baseScanId);
      if (targetPartial) partialIds.push(targetScanId);
      allLimitations.push({
        code: "LIM_PARTIAL_SNAPSHOT_COMPARISON",
        description: `Comparison involves PARTIAL snapshot(s) (${partialIds.join(", ")}); completeness cannot be guaranteed for incomplete scans.`,
        domain: "snapshot",
        affectedEntityCount: partialIds.length,
      });
    }

    const limitationMap = new Map<string, ComparisonLimitation>();
    for (const lim of allLimitations) {
      const key = `${lim.code}:${lim.domain}`;
      const existing = limitationMap.get(key);
      if (!existing) {
        limitationMap.set(key, { ...lim });
      } else {
        existing.affectedEntityCount =
          (existing.affectedEntityCount ?? 0) + (lim.affectedEntityCount ?? 1);
      }
    }
    const sortedLimitations = Array.from(limitationMap.values()).sort(
      (a, b) => a.code.localeCompare(b.code) || a.domain.localeCompare(b.domain),
    );

    // 7. Derive Summary Metrics directly from detail collections
    const summary = ComparisonSummaryDeriver.derive(
      fileDiff.result,
      symbolDiff.result,
      dependencyDiff.result,
      componentDiff.result,
      adrDiff.result,
    );

    const comparisonId = `cmp:${repositoryId}:${baseScanId}:${targetScanId}`;
    const comparedAt = new Date().toISOString();

    const comparison: SnapshotComparison = {
      comparisonId,
      repositoryId,
      repositoryIdentity,
      baseSnapshot: baseScan,
      targetSnapshot: targetScan,
      comparedAt,
      status: comparisonStatus,
      summary,
      files: fileDiff.result,
      symbols: symbolDiff.result,
      dependencies: dependencyDiff.result,
      components: componentDiff.result,
      adrs: adrDiff.result,
      evidence: sortedEvidence,
      limitations: sortedLimitations,
    };

    // 8. Event Persistence Boundary (Optional, Transactional & Idempotent)
    if (options.persistEvents) {
      EventPersistenceBoundary.persist(this.db, comparison);
    }

    return comparison;
  }

  private getScanHeader(repositoryId: number, scanId: number): SnapshotHeader {
    const row = this.db
      .prepare(
        `SELECT
          id AS scanId, started_at AS startedAt, completed_at AS completedAt,
          scanner_version AS scannerVersion, extractor_version AS extractorVersion,
          status
        FROM scan_runs WHERE repository_id = ? AND id = ?`,
      )
      .get(repositoryId, scanId) as
      (Omit<SnapshotHeader, "status"> & { status: string }) | undefined;

    if (!row) {
      throw new SnapshotComparisonError(
        `Scan record ${scanId} not found`,
        "ERR_SNAPSHOT_NOT_FOUND",
      );
    }

    return {
      scanId: row.scanId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      scannerVersion: row.scannerVersion,
      extractorVersion: row.extractorVersion,
      status: row.status === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    };
  }
}
