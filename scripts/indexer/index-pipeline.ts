/**
 * Phase 8.1 — Unified Repository Indexing & Incremental Refresh Pipeline
 * Coordinates repository scanning, polyglot-safe AST extraction, transactional snapshot
 * persistence, architectural component/decision materialization, and optional memory lifecycle validation.
 */

import fs from "node:fs";
import path from "node:path";
import { ConnectionManager } from "../storage/connection-manager.ts";
import { StorageManager } from "../storage/transactions/storage-manager.ts";
import { scanRepository } from "../scanner/repository-scanner.ts";
import {
  extractFileSymbols,
  isAstExtractablePath,
  type ExtractionResult,
} from "../extractor/index.ts";
import { ArchitectureAnalyzer } from "../architecture/architecture-analyzer.ts";
import { FreshnessEvaluator } from "../query/freshness-evaluator.ts";
import type { FreshnessAssessment } from "../query/types.ts";
import { SnapshotComparator, EvolutionAnalyzer } from "../evolution/index.ts";
import { MemoryLifecycleEvaluator } from "../memory/memory-lifecycle-evaluator.ts";
import type { MemoryLifecycleSummary } from "../memory/types.ts";
import type { ScanRunStatus } from "../storage/types.ts";

export interface IndexPipelineOptions {
  workspaceRoot: string;
  incremental?: boolean;
  allowPartialPromotion?: boolean;
  applyLifecycle?: boolean;
  persistEvents?: boolean;
  scannerVersion?: string;
  extractorVersion?: string;
  signal?: AbortSignal;
}

export interface IndexExecutionReport {
  mode: "SCAN" | "REFRESH_INCREMENTAL_SKIPPED" | "REFRESH_REINDEXED";
  repositoryId: number;
  repositoryIdentity: string;
  workspaceRoot: string;
  scanId: number;
  previousActiveScanId: number | null;
  status: ScanRunStatus;
  promoted: boolean;
  skippedNoChanges: boolean;
  freshnessBefore: FreshnessAssessment;
  counts: {
    filesDiscovered: number;
    filesIndexed: number;
    filesSkipped: number;
    filesFailed: number;
    symbolsIndexed: number;
    importsIndexed: number;
    exportsIndexed: number;
    nodesCreated: number;
    edgesCreated: number;
    componentsDetected: number;
    entrypointsDetected: number;
    decisionsDetected: number;
    testAssociationsDetected: number;
    circularDependenciesDetected: number;
  };
  lifecycleEvaluation: MemoryLifecycleSummary | null;
  durationMs: number;
  diagnostics: string[];
}

const DEFAULT_PIPELINE_VERSION = "0.7.0";

export class IndexPipeline {
  public static async run(options: IndexPipelineOptions): Promise<IndexExecutionReport> {
    const startTime = Date.now();
    const resolvedRoot = path.resolve(options.workspaceRoot);

    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(`Workspace root does not exist: ${resolvedRoot}`);
    }

    const cm = new ConnectionManager({ workspaceRoot: resolvedRoot });
    const sm = new StorageManager(cm);
    await sm.initialize();

    try {
      const db = cm.getDatabase();
      const repo = cm.getRepository();

      // Recover any interrupted scans before evaluating freshness or starting a new scan
      await sm.recoverInterruptedScans(repo.id);

      const updatedRepo = cm.getRepository();
      const previousActiveScanId = updatedRepo.activeScanId;

      const freshnessBefore = FreshnessEvaluator.evaluate(db, repo.id, resolvedRoot, {
        verifyContentHashes: true,
      });

      // Fast path for incremental refresh when an active COMPLETE scan exists and is fresh
      if (
        options.incremental === true &&
        previousActiveScanId !== null &&
        !freshnessBefore.isStale &&
        !freshnessBefore.isPartial &&
        (freshnessBefore.status === "FRESH" || freshnessBefore.status === "COMPLETE")
      ) {
        const scanRow = db
          .prepare(
            `SELECT
              status,
              files_discovered AS filesDiscovered,
              files_indexed AS filesIndexed,
              files_skipped AS filesSkipped,
              files_failed AS filesFailed
            FROM scan_runs WHERE repository_id = ? AND id = ?`,
          )
          .get(repo.id, previousActiveScanId) as
          | {
              status: ScanRunStatus;
              filesDiscovered: number;
              filesIndexed: number;
              filesSkipped: number;
              filesFailed: number;
            }
          | undefined;

        const countsRow = db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM symbols WHERE scan_id = ?) AS symbolsIndexed,
              (SELECT COUNT(*) FROM imports WHERE scan_id = ?) AS importsIndexed,
              (SELECT COUNT(*) FROM exports WHERE scan_id = ?) AS exportsIndexed,
              (SELECT COUNT(*) FROM graph_nodes WHERE scan_id = ?) AS nodesCreated,
              (SELECT COUNT(*) FROM graph_edges WHERE scan_id = ?) AS edgesCreated`,
          )
          .get(
            previousActiveScanId,
            previousActiveScanId,
            previousActiveScanId,
            previousActiveScanId,
            previousActiveScanId,
          ) as {
          symbolsIndexed: number;
          importsIndexed: number;
          exportsIndexed: number;
          nodesCreated: number;
          edgesCreated: number;
        };

        const arch = await new ArchitectureAnalyzer(db).analyze(repo.id, previousActiveScanId);

        let lifecycleEvaluation: MemoryLifecycleSummary | null = null;
        if (options.applyLifecycle === true) {
          lifecycleEvaluation = MemoryLifecycleEvaluator.evaluateRepository(
            db,
            repo.id,
            previousActiveScanId,
            undefined,
            {
              applyLifecycle: true,
              allowPartial: options.allowPartialPromotion === true,
              workspaceRoot: resolvedRoot,
            },
          );
        }

        return {
          mode: "REFRESH_INCREMENTAL_SKIPPED",
          repositoryId: repo.id,
          repositoryIdentity: repo.identity,
          workspaceRoot: resolvedRoot,
          scanId: previousActiveScanId,
          previousActiveScanId,
          status: scanRow?.status ?? "COMPLETE",
          promoted: true,
          skippedNoChanges: true,
          freshnessBefore,
          counts: {
            filesDiscovered: scanRow?.filesDiscovered ?? 0,
            filesIndexed: scanRow?.filesIndexed ?? 0,
            filesSkipped: scanRow?.filesSkipped ?? 0,
            filesFailed: scanRow?.filesFailed ?? 0,
            symbolsIndexed: countsRow.symbolsIndexed,
            importsIndexed: countsRow.importsIndexed,
            exportsIndexed: countsRow.exportsIndexed,
            nodesCreated: countsRow.nodesCreated,
            edgesCreated: countsRow.edgesCreated,
            componentsDetected: arch.components.length,
            entrypointsDetected: arch.entrypoints.length,
            decisionsDetected: arch.decisions.length,
            testAssociationsDetected: arch.testAssociations.length,
            circularDependenciesDetected: arch.dependencyReport.circularDependencyCandidates.length,
          },
          lifecycleEvaluation,
          durationMs: Date.now() - startTime,
          diagnostics: [
            `Incremental refresh skipped re-indexing: active scan ${previousActiveScanId} is already FRESH.`,
          ],
        };
      }

      // Execute full repository scan
      const inventory = await scanRepository(resolvedRoot, {
        signal: options.signal,
      });

      // Extract symbols for eligible source files (polyglot-safe)
      const extractions = new Map<string, ExtractionResult>();
      for (const file of inventory.files) {
        const isEligible =
          file.exclusionStatus === "INCLUDED" &&
          (file.inspectionStatus === "INCLUDED" || file.inspectionStatus === "INSPECTED") &&
          file.classification !== "sensitive" &&
          file.hashState !== "SKIPPED_SENSITIVE";

        if (!isEligible || file.classification !== "source") {
          continue;
        }

        if (isAstExtractablePath(file.canonicalPath)) {
          const fullPath = path.join(resolvedRoot, file.canonicalPath);
          const content = fs.readFileSync(fullPath, "utf8");
          const extResult = await extractFileSymbols(file.canonicalPath, content, {
            workspaceRoot: resolvedRoot,
            cancellationToken: options.signal
              ? {
                  get isCancellationRequested() {
                    return Boolean(options.signal?.aborted);
                  },
                }
              : undefined,
          });
          extractions.set(file.canonicalPath, extResult);
        } else {
          // Non-TS/JS source file (e.g., Python, Go, Rust, Java): record clean file-level extraction
          extractions.set(file.canonicalPath, {
            canonicalPath: file.canonicalPath,
            symbols: [],
            imports: [],
            exports: [],
            callExpressions: [],
            status: "SUCCESS",
            diagnostics: [],
          });
        }
      }

      const snapResult = await sm.persistSnapshot({
        repositoryIdentity: repo.identity,
        rootPath: resolvedRoot,
        displayName: repo.displayName,
        inventory,
        extractions,
        scannerVersion: options.scannerVersion ?? DEFAULT_PIPELINE_VERSION,
        extractorVersion: options.extractorVersion ?? DEFAULT_PIPELINE_VERSION,
        allowPartialPromotion: options.allowPartialPromotion === true,
        signal: options.signal,
      });

      let componentsDetected = 0;
      let entrypointsDetected = 0;
      let decisionsDetected = 0;
      let testAssociationsDetected = 0;
      let circularDependenciesDetected = 0;
      let lifecycleEvaluation: MemoryLifecycleSummary | null = null;

      if (snapResult.status === "COMPLETE" || snapResult.status === "PARTIAL") {
        const arch = await new ArchitectureAnalyzer(db).analyze(repo.id, snapResult.scanId);
        componentsDetected = arch.components.length;
        entrypointsDetected = arch.entrypoints.length;
        decisionsDetected = arch.decisions.length;
        testAssociationsDetected = arch.testAssociations.length;
        circularDependenciesDetected = arch.dependencyReport.circularDependencyCandidates.length;

        const canComparePrevious =
          previousActiveScanId !== null &&
          previousActiveScanId !== snapResult.scanId &&
          (snapResult.status === "COMPLETE" || options.allowPartialPromotion === true);

        if (options.persistEvents === true && canComparePrevious) {
          const evoReport = new EvolutionAnalyzer(db).analyze(
            previousActiveScanId!,
            snapResult.scanId,
            {
              persistEvents: true,
              applyLifecycle: options.applyLifecycle === true,
              allowPartial: options.allowPartialPromotion === true,
              workspaceRoot: resolvedRoot,
            },
          );
          if (options.applyLifecycle === true) {
            lifecycleEvaluation = evoReport.memoryLifecycle;
          }
        } else if (options.applyLifecycle === true) {
          const comparison = canComparePrevious
            ? new SnapshotComparator(db).compare(previousActiveScanId!, snapResult.scanId, {
                allowPartial: options.allowPartialPromotion === true,
                workspaceRoot: resolvedRoot,
              })
            : undefined;
          lifecycleEvaluation = MemoryLifecycleEvaluator.evaluateRepository(
            db,
            repo.id,
            snapResult.scanId,
            comparison,
            {
              applyLifecycle: true,
              allowPartial: options.allowPartialPromotion === true,
              workspaceRoot: resolvedRoot,
            },
          );
        }
      }

      const scanCountsRow = db
        .prepare(
          `SELECT
            files_discovered AS filesDiscovered,
            files_skipped AS filesSkipped,
            files_failed AS filesFailed
          FROM scan_runs WHERE repository_id = ? AND id = ?`,
        )
        .get(repo.id, snapResult.scanId) as
        | {
            filesDiscovered: number;
            filesSkipped: number;
            filesFailed: number;
          }
        | undefined;

      return {
        mode: options.incremental === true ? "REFRESH_REINDEXED" : "SCAN",
        repositoryId: repo.id,
        repositoryIdentity: repo.identity,
        workspaceRoot: resolvedRoot,
        scanId: snapResult.scanId,
        previousActiveScanId,
        status: snapResult.status,
        promoted: snapResult.promoted,
        skippedNoChanges: false,
        freshnessBefore,
        counts: {
          filesDiscovered: scanCountsRow?.filesDiscovered ?? inventory.summary.totalFilesDiscovered,
          filesIndexed: snapResult.filesIndexed,
          filesSkipped: scanCountsRow?.filesSkipped ?? 0,
          filesFailed: scanCountsRow?.filesFailed ?? 0,
          symbolsIndexed: snapResult.symbolsIndexed,
          importsIndexed: snapResult.importsIndexed,
          exportsIndexed: snapResult.exportsIndexed,
          nodesCreated: snapResult.nodesCreated,
          edgesCreated: snapResult.edgesCreated,
          componentsDetected,
          entrypointsDetected,
          decisionsDetected,
          testAssociationsDetected,
          circularDependenciesDetected,
        },
        lifecycleEvaluation,
        durationMs: Date.now() - startTime,
        diagnostics: snapResult.diagnostics,
      };
    } finally {
      await sm.close();
    }
  }
}
