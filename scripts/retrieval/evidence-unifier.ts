/**
 * Phase 7.6 — Evidence & Confidence Unifier
 * Bridges QueryEngine, MemoryLifecycleEvaluator (read-only), and Evolution evidence into one contract.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { MemoryLifecycleEvaluator } from "../memory/memory-lifecycle-evaluator.ts";
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
   */
  public static loadAndVerifyMemories(params: {
    db: SqliteDatabase;
    repositoryId: number;
    scanId: number;
    workspaceRoot: string;
    includeHistorical: boolean;
    surfaceWarnings: boolean;
  }): {
    items: UnifiedMemoryEvaluation[];
    warnings: RetrievalWarning[];
  } {
    const store = new MemoryStore(params.db);
    const allMemories = store.listMemories(params.repositoryId);
    const warnings: RetrievalWarning[] = [];

    if (allMemories.length === 0) {
      return { items: [], warnings };
    }

    let evaluationsById = new Map<number, MemoryEvaluationResult>();
    try {
      const summary = MemoryLifecycleEvaluator.evaluateRepository(
        params.db,
        params.repositoryId,
        params.scanId,
        undefined,
        {
          applyLifecycle: false,
          allowPartial: true,
          workspaceRoot: params.workspaceRoot,
        },
      );
      evaluationsById = new Map(summary.evaluations.map((e) => [e.memoryId, e]));
    } catch (err: any) {
      warnings.push({
        code: "MEMORY_EVIDENCE_UNVERIFIED",
        severity: "warning",
        message: `Unable to run live memory verification against scan ${params.scanId}: ${err?.message ?? String(err)}`,
      });
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

    return { items, warnings };
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
