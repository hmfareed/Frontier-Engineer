/**
 * Phase 7.6 — Evidence & Confidence Unifier
 * Bridges QueryEngine, MemoryLifecycleEvaluator (read-only), and Evolution evidence into one contract.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { MemoryLifecycleEvaluator } from "../memory/memory-lifecycle-evaluator.ts";
import { SnapshotComparisonError } from "../evolution/snapshot-comparator.ts";
import type { ComparisonLimitation } from "../evolution/types.ts";
import type { MemoryEvaluationResult } from "../memory/types.ts";
import type { ConfidenceTier, QueryEvidence } from "../query/types.ts";
import type {
  EngineeringMemoryRecord,
  MemoryConfidenceTier,
  MemoryEvidenceRecord,
  MemoryLifecycleStatus,
} from "../storage/types.ts";
import type { MemoryLiveStatus, RetrievalWarning, UnifiedEvidenceRef } from "./types.ts";
import { ContentSanitizer } from "./content-sanitizer.ts";

export interface UnifiedMemoryEvaluation {
  record: EngineeringMemoryRecord;
  rawEvidence: MemoryEvidenceRecord[];
  evaluation: MemoryEvaluationResult | null;
  liveStatus: MemoryLiveStatus;
  evidenceRefs: UnifiedEvidenceRef[];
}

export class EvidenceUnifier {
  public static normalizeConfidenceTier(
    tier: MemoryConfidenceTier | ConfidenceTier | string | undefined,
  ): ConfidenceTier {
    if (
      tier === "CONFIRMED" ||
      tier === "INFERRED" ||
      tier === "CANDIDATE" ||
      tier === "UNRESOLVED"
    ) {
      return tier;
    }
    return "INFERRED";
  }

  public static fromQueryEvidence(
    items: QueryEvidence[],
    defaultTier: ConfidenceTier = "CONFIRMED",
  ): UnifiedEvidenceRef[] {
    return items.map((ev) => ({
      sourceType: ev.evidenceType,
      filePath: ev.file,
      lineRange: ev.lineRange,
      symbolIdentity: ev.symbolOrEntity,
      confidence: ev.confidence,
      confidenceTier:
        ev.confidence !== undefined && ev.confidence < 0.75 && defaultTier === "CONFIRMED"
          ? "INFERRED"
          : defaultTier,
      verificationStatus: "STATIC_INDEX",
      description: ev.description,
    }));
  }

  /**
   * Loads repository memories and runs read-only lifecycle verification (applyLifecycle: false).
   * Enforces the repository-wide partial-snapshot policy (allowPartial defaults to false) and
   * propagates snapshot eligibility errors instead of swallowing them.
   */
  public static loadAndVerifyMemories(params: {
    db: SqliteDatabase;
    repositoryId: number;
    scanId: number;
    workspaceRoot: string;
    includeHistorical: boolean;
    surfaceWarnings: boolean;
    allowPartial?: boolean;
  }): {
    items: UnifiedMemoryEvaluation[];
    warnings: RetrievalWarning[];
    isPartialSnapshot: boolean;
    limitations: ComparisonLimitation[];
  } {
    const allowPartial = params.allowPartial === true;
    const store = new MemoryStore(params.db);
    const warnings: RetrievalWarning[] = [];

    const scanRow = params.db
      .prepare("SELECT id, repository_id AS repositoryId, status FROM scan_runs WHERE id = ?")
      .get(params.scanId) as { id: number; repositoryId: number; status: string } | undefined;

    if (!scanRow) {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} does not exist.`,
        "ERR_SCAN_NOT_FOUND",
      );
    }
    if (scanRow.repositoryId !== params.repositoryId) {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} belongs to repository ${scanRow.repositoryId}, expected ${params.repositoryId}.`,
        "ERR_REPOSITORY_MISMATCH",
      );
    }
    if (scanRow.status === "RUNNING" || scanRow.status === "VALIDATING") {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} is still ${scanRow.status} and cannot evaluate memory lifecycle.`,
        "ERR_SCAN_INCOMPLETE",
      );
    }
    if (scanRow.status === "FAILED" || scanRow.status === "CANCELLED") {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} ended with status ${scanRow.status} and cannot evaluate memory lifecycle.`,
        "ERR_SCAN_FAILED",
      );
    }
    if (scanRow.status === "PARTIAL" && !allowPartial) {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} has status PARTIAL and allowPartial is false; pass allowPartial: true to evaluate with incomplete coverage warnings.`,
        "ERR_PARTIAL_SCAN_NOT_ALLOWED",
      );
    }
    if (scanRow.status !== "COMPLETE" && scanRow.status !== "PARTIAL") {
      throw new SnapshotComparisonError(
        `Target scan ${params.scanId} has unsupported status ${scanRow.status}.`,
        "ERR_SCAN_INVALID_STATUS",
      );
    }

    const isPartialSnapshot = scanRow.status === "PARTIAL";
    const allMemories = store.listMemories(params.repositoryId);
    let evaluationsById = new Map<number, MemoryEvaluationResult>();
    let limitations: ComparisonLimitation[] = [];

    try {
      const summary = MemoryLifecycleEvaluator.evaluateRepository(
        params.db,
        params.repositoryId,
        params.scanId,
        undefined,
        {
          applyLifecycle: false,
          allowPartial,
          workspaceRoot: params.workspaceRoot,
        },
      );
      evaluationsById = new Map(summary.evaluations.map((e) => [e.memoryId, e]));
      limitations = summary.limitations ?? [];
    } catch (err: any) {
      if (
        err instanceof SnapshotComparisonError ||
        /ERR_PARTIAL_SCAN_NOT_ALLOWED|ERR_SCAN_INCOMPLETE|ERR_SCAN_FAILED|ERR_SCAN_NOT_FOUND|ERR_REPOSITORY_MISMATCH|ERR_SCAN_INVALID_STATUS/.test(
          err?.message ?? "",
        )
      ) {
        throw err;
      }
      warnings.push({
        code: "MEMORY_EVIDENCE_UNVERIFIED",
        severity: "warning",
        message: `Unable to run live memory verification against scan ${params.scanId}: ${err?.message ?? String(err)}`,
      });
    }

    if (isPartialSnapshot) {
      const partialLim = limitations.find((l) => l.code === "LIM_PARTIAL_SNAPSHOT_EVALUATION");
      warnings.push({
        code: "PARTIAL_SNAPSHOT",
        severity: "warning",
        message:
          partialLim?.description ??
          `Memory verification ran against PARTIAL scan ${params.scanId} with explicit allowPartial opt-in; missing files are downgraded to UNVERIFIED.`,
      });
    }

    if (allMemories.length === 0) {
      return { items: [], warnings, isPartialSnapshot, limitations };
    }

    const items: UnifiedMemoryEvaluation[] = [];

    for (const mem of allMemories) {
      const isHistorical = mem.status === "SUPERSEDED" || mem.status === "ARCHIVED";
      if (isHistorical && !params.includeHistorical) {
        continue;
      }

      const rawEvidence = store.getMemoryEvidence(params.repositoryId, mem.id);
      const evaluation = evaluationsById.get(mem.id) ?? null;
      const liveStatus = this.deriveLiveStatus(mem.status, evaluation);
      const safeReason = evaluation?.reason
        ? ContentSanitizer.sanitizeMetadataText(evaluation.reason).text
        : undefined;

      if (params.surfaceWarnings && !isHistorical) {
        if (liveStatus === "DISPUTED") {
          warnings.push({
            code: "MEMORY_DISPUTED",
            severity: "warning",
            message: `Engineering memory '${mem.memoryKey}' is DISPUTED by contradictory evidence (${safeReason ?? "contradictory repository evidence detected"}).`,
            entity: mem.memoryKey,
          });
        } else if (liveStatus === "STALE" || liveStatus === "MISSING") {
          warnings.push({
            code: "MEMORY_STALE",
            severity: "warning",
            message: `Engineering memory '${mem.memoryKey}' may be ${liveStatus} against scan ${params.scanId}: ${safeReason ?? "evidence drift detected"}.`,
            entity: mem.memoryKey,
          });
        } else if (liveStatus === "UNVERIFIED") {
          warnings.push({
            code: "MEMORY_EVIDENCE_UNVERIFIED",
            severity: "warning",
            message: `Engineering memory '${mem.memoryKey}' could not be positively verified against scan ${params.scanId} (${safeReason ?? "unverified or incomplete supporting evidence"}).`,
            entity: mem.memoryKey,
          });
        }
      }

      const evalByEvId = new Map(
        (evaluation?.evidenceEvaluations ?? []).map((ee) => [ee.evidenceId, ee]),
      );

      const evidenceRefs: UnifiedEvidenceRef[] = rawEvidence.map((ev) => {
        const evalItem = evalByEvId.get(ev.id);
        const safeDesc = ContentSanitizer.sanitizeMetadataText(
          evalItem?.reason ?? ev.description ?? "",
        ).text;
        return {
          sourceType: `memory_${ev.evidenceType}`,
          filePath: ev.sourcePath,
          lineRange: ev.lineStart && ev.lineEnd ? [ev.lineStart, ev.lineEnd] : undefined,
          symbolIdentity: ev.symbolIdentity ?? undefined,
          confidence: ev.confidence,
          confidenceTier: this.normalizeConfidenceTier(mem.confidenceTier),
          verificationStatus: evalItem?.status ?? "UNVERIFIED",
          description: safeDesc,
        };
      });

      items.push({
        record: mem,
        rawEvidence,
        evaluation,
        liveStatus,
        evidenceRefs,
      });
    }

    return { items, warnings, isPartialSnapshot, limitations };
  }

  private static deriveLiveStatus(
    storedStatus: MemoryLifecycleStatus,
    evaluation: MemoryEvaluationResult | null,
  ): MemoryLiveStatus {
    if (storedStatus === "SUPERSEDED") return "SUPERSEDED";
    if (storedStatus === "ARCHIVED") return "ARCHIVED";
    if (!evaluation) {
      if (storedStatus === "DISPUTED") return "DISPUTED";
      if (storedStatus === "STALE") return "STALE";
      return "UNVERIFIED";
    }

    if (evaluation.proposedStatus === "SUPERSEDED") return "SUPERSEDED";
    if (evaluation.contradictedCount > 0 || evaluation.proposedStatus === "DISPUTED") {
      return "DISPUTED";
    }
    if (evaluation.missingCount > 0) return "MISSING";
    if (evaluation.proposedStatus === "STALE") return "STALE";
    // Conjunctive evidence soundness: any unverified item bars VERIFIED status.
    if (evaluation.unverifiedCount > 0) return "UNVERIFIED";
    if (evaluation.verifiedCount > 0) return "VERIFIED";
    if (storedStatus === "STALE") return "STALE";
    if (storedStatus === "DISPUTED") return "DISPUTED";
    return "UNVERIFIED";
  }
}
