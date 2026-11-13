/**
 * Phase 7.5 Stage 4 — Evolution Analyzer Engine
 * Orchestrates snapshot comparison, architectural drift detection, ADR correlation,
 * memory lifecycle intelligence, engineering debt detection, and transactional persistence.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryLifecycleEvaluator } from "../memory/memory-lifecycle-evaluator.ts";
import { SnapshotComparator } from "./snapshot-comparator.ts";
import { EventPersistenceBoundary } from "./event-persistence.ts";
import { DriftDetector } from "./drift-detector.ts";
import { AdrCorrelator } from "./adr-correlator.ts";
import { DebtAnalyzer } from "./debt-analyzer.ts";
import { EvolutionEventWriter } from "./evolution-event-writer.ts";
import type { EvolutionAnalysisResult, EvolutionAnalyzerOptions } from "./types.ts";

export class EvolutionAnalyzer {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public analyze(
    baseScanId: number,
    targetScanId: number,
    options: EvolutionAnalyzerOptions = {},
  ): EvolutionAnalysisResult {
    const comparator = new SnapshotComparator(this.db);
    // Run pure read-only comparison first; persistence happens inside outer transaction if enabled
    const comparison = comparator.compare(baseScanId, targetScanId, {
      ...options,
      persistEvents: false,
    });

    const repositoryId = comparison.repositoryId;
    const driftFindings = DriftDetector.detect(
      this.db,
      repositoryId,
      baseScanId,
      targetScanId,
      comparison,
      options,
    );

    const adrCorrelations = AdrCorrelator.correlate(
      this.db,
      repositoryId,
      baseScanId,
      targetScanId,
      comparison,
      driftFindings,
      options,
    );

    const buildResult = (
      lifecycleSummary: ReturnType<typeof MemoryLifecycleEvaluator.evaluateRepository>,
    ): EvolutionAnalysisResult => {
      const debtItems = DebtAnalyzer.analyze(
        this.db,
        repositoryId,
        baseScanId,
        targetScanId,
        adrCorrelations,
        lifecycleSummary,
        options,
      );

      const maxRecords = options.maxRecordsPerDomain ?? 5000;
      const boundedDrift = driftFindings.slice(0, maxRecords);
      const boundedDecisions = adrCorrelations.slice(0, maxRecords);
      const boundedDebt = debtItems.slice(0, maxRecords);

      return {
        analysisId: `evo:${repositoryId}:${baseScanId}:${targetScanId}`,
        repositoryId,
        repositoryIdentity: comparison.repositoryIdentity,
        baseSnapshot: comparison.baseSnapshot,
        targetSnapshot: comparison.targetSnapshot,
        analyzedAt: new Date().toISOString(),
        status: comparison.status,
        comparison,
        drift: {
          totalFindings: driftFindings.length,
          findings: boundedDrift,
        },
        decisions: {
          totalCorrelations: adrCorrelations.length,
          correlations: boundedDecisions,
        },
        debt: {
          introducedCount: debtItems.filter((d) => d.state === "INTRODUCED").length,
          worsenedCount: debtItems.filter((d) => d.state === "WORSENED").length,
          persistingCount: debtItems.filter((d) => d.state === "PERSISTING").length,
          resolvedCount: debtItems.filter((d) => d.state === "RESOLVED").length,
          items: boundedDebt,
        },
        memoryLifecycle: lifecycleSummary,
      };
    };

    if (options.persistEvents || options.applyLifecycle) {
      return this.db.transaction(() => {
        const memoryLifecycle = MemoryLifecycleEvaluator.evaluateRepository(
          this.db,
          repositoryId,
          targetScanId,
          comparison,
          {
            applyLifecycle: Boolean(options.applyLifecycle),
            allowPartial: Boolean(options.allowPartial),
            simulateFailure: Boolean(options.simulateFailure),
            workspaceRoot: options.workspaceRoot,
          },
        );

        const result = buildResult(memoryLifecycle);

        if (options.persistEvents) {
          EventPersistenceBoundary.persist(this.db, comparison);
          EvolutionEventWriter.persist(this.db, result);
        }

        return result;
      });
    }

    const dryRunLifecycle = MemoryLifecycleEvaluator.evaluateRepository(
      this.db,
      repositoryId,
      targetScanId,
      comparison,
      {
        applyLifecycle: false,
        allowPartial: Boolean(options.allowPartial),
        workspaceRoot: options.workspaceRoot,
      },
    );

    return buildResult(dryRunLifecycle);
  }
}
