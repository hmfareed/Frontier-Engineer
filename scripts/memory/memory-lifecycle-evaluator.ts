/**
 * Phase 7.5 Stage 4 — Deterministic Memory Lifecycle Evaluator
 * Evaluates engineering memories against evidence in a target scan and applies
 * guarded lifecycle transitions and scan verifications atomically.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import type {
  EngineeringMemoryRecord,
  MemoryLifecycleStatus,
  MemoryRelationshipRecord,
} from "../storage/types.ts";
import type { SnapshotComparison } from "../evolution/types.ts";
import { EvidenceEvaluator } from "./evidence-evaluator.ts";
import { RelationshipManager } from "./relationship-manager.ts";
import type {
  EvidenceEvaluationItem,
  MemoryEvaluationResult,
  MemoryLifecycleActionType,
  MemoryLifecycleSummary,
} from "./types.ts";

export interface EvaluateRepositoryOptions {
  applyLifecycle?: boolean;
  allowPartial?: boolean;
  simulateFailure?: boolean;
  workspaceRoot?: string;
}

export class MemoryLifecycleEvaluator {
  public static evaluateRepository(
    db: SqliteDatabase,
    repositoryId: number,
    targetScanId: number,
    comparison?: SnapshotComparison,
    options: EvaluateRepositoryOptions = {},
  ): MemoryLifecycleSummary {
    const store = new MemoryStore(db);
    const relManager = new RelationshipManager(db);
    const memories = store.listMemories(repositoryId);
    const relationships = relManager.getRelationships(repositoryId);
    const ctx = EvidenceEvaluator.createContext(
      db,
      repositoryId,
      targetScanId,
      comparison,
      options.workspaceRoot,
      { allowPartial: options.allowPartial, workspaceRoot: options.workspaceRoot },
    );

    const evaluateAll = (): MemoryEvaluationResult[] => {
      const results: MemoryEvaluationResult[] = [];
      const memoryById = new Map<number, EngineeringMemoryRecord>(memories.map((m) => [m.id, m]));

      // Pass 1: Evaluate evidence for all memories and compute positively verified candidates
      const evaluatedByMemoryId = new Map<
        number,
        {
          memory: EngineeringMemoryRecord;
          evidenceEvaluations: EvidenceEvaluationItem[];
          supportingCount: number;
          verifiedCount: number;
          missingCount: number;
          contradictedCount: number;
          unverifiedCount: number;
        }
      >();
      const positivelyVerifiedIds = new Set<number>();

      for (const memory of memories) {
        const attachedEvidence = store.getMemoryEvidence(repositoryId, memory.id);
        const evidenceEvaluations: EvidenceEvaluationItem[] = attachedEvidence.map((ev) =>
          EvidenceEvaluator.evaluateEvidence(ctx, ev),
        );

        const supporting = evidenceEvaluations.filter((e) => !e.isContradictory);
        const verifiedCount = supporting.filter((e) => e.status === "VERIFIED").length;
        const missingCount = supporting.filter((e) => e.status === "MISSING").length;
        const unverifiedCount = supporting.filter((e) => e.status === "UNVERIFIED").length;
        const contradictedCount = evidenceEvaluations.filter(
          (e) => e.status === "CONTRADICTED",
        ).length;

        evaluatedByMemoryId.set(memory.id, {
          memory,
          evidenceEvaluations,
          supportingCount: supporting.length,
          verifiedCount,
          missingCount,
          contradictedCount,
          unverifiedCount,
        });

        // A memory can only act as an automatic superseder if it is ACTIVE,
        // has no contradicted, missing, or unverified evidence, and either has verified evidence
        // in targetScanId or was explicitly recorded at targetScanId with 0 supporting items.
        if (
          memory.status === "ACTIVE" &&
          contradictedCount === 0 &&
          missingCount === 0 &&
          unverifiedCount === 0 &&
          (verifiedCount > 0 || (supporting.length === 0 && memory.lastSeenScanId === targetScanId))
        ) {
          positivelyVerifiedIds.add(memory.id);
        }
      }

      // Pass 2: Compute transitions deterministically and apply inside transaction if requested
      for (const memory of memories) {
        const evalData = evaluatedByMemoryId.get(memory.id)!;
        const {
          evidenceEvaluations,
          supportingCount,
          verifiedCount,
          missingCount,
          contradictedCount,
          unverifiedCount,
        } = evalData;

        if (memory.status === "SUPERSEDED" || memory.status === "ARCHIVED") {
          results.push({
            memoryId: memory.id,
            memoryKey: memory.memoryKey,
            category: memory.category,
            previousStatus: memory.status,
            proposedStatus: memory.status,
            applied: false,
            action: "NO_CHANGE_TERMINAL",
            previousVersion: memory.version,
            newVersion: memory.version,
            supersededById: memory.supersededById,
            supportingCount,
            verifiedCount,
            missingCount,
            contradictedCount,
            unverifiedCount,
            reason: `Memory '${memory.memoryKey}' is in terminal status ${memory.status}`,
            evidenceEvaluations,
          });
          continue;
        }

        // Check incoming SUPERSEDES edge against verified ACTIVE candidates only
        const replacementId = this.findValidSuperseder(
          memory,
          memories,
          memoryById,
          relationships,
          positivelyVerifiedIds,
          relManager,
        );

        let proposedStatus: MemoryLifecycleStatus = memory.status;
        let action: MemoryLifecycleActionType = "NO_CHANGE_NON_TERMINAL";
        let reason = "";
        let supersededById: number | null = memory.supersededById;

        if (replacementId !== null) {
          proposedStatus = "SUPERSEDED";
          action = "TRANSITION_SUPERSEDED";
          supersededById = replacementId;
          reason = `Superseded by verified ACTIVE memory ID ${replacementId} via SUPERSEDES relationship in scan ${targetScanId}`;
        } else if (contradictedCount >= 1) {
          proposedStatus = "DISPUTED";
          if (memory.status !== "DISPUTED") {
            action = "TRANSITION_DISPUTED";
            reason = `Disputed by ${contradictedCount} contradictory evidence item(s) in scan ${targetScanId}`;
          } else {
            action = "NO_CHANGE_NON_TERMINAL";
            reason = `Remains DISPUTED (${contradictedCount} contradictory item(s)) in scan ${targetScanId}`;
          }
        } else if (missingCount >= 1) {
          // DEFECT-LC-01: Conjunctive evidence invariant — any missing supporting artifact makes memory STALE
          proposedStatus = "STALE";
          if (memory.status !== "STALE") {
            action = "TRANSITION_STALE";
            reason = `${missingCount}/${supportingCount} supporting evidence item(s) missing in scan ${targetScanId}`;
          } else {
            action = "NO_CHANGE_NON_TERMINAL";
            reason = `Remains STALE (${missingCount}/${supportingCount} supporting item(s) missing) in scan ${targetScanId}`;
          }
        } else if (memory.status === "STALE" || memory.status === "DISPUTED") {
          // DEFECT-LC-01 & DEFECT-LC-03: Recover ONLY when 100% of supporting evidence is VERIFIED
          if (supportingCount > 0 && verifiedCount === supportingCount && unverifiedCount === 0) {
            proposedStatus = "ACTIVE";
            action = "RECOVER_ACTIVE";
            reason = `Recovered to ACTIVE: ${verifiedCount}/${supportingCount} supporting evidence item(s) verified in scan ${targetScanId}`;
          } else {
            proposedStatus = memory.status;
            action = "NO_CHANGE_NON_TERMINAL";
            reason =
              supportingCount === 0
                ? `Remains ${memory.status} with zero supporting evidence items in scan ${targetScanId}`
                : `Remains ${memory.status} (${verifiedCount} verified, ${unverifiedCount} unverified) in scan ${targetScanId}`;
          }
        } else {
          // Currently ACTIVE with 0 missing and 0 contradictions
          proposedStatus = "ACTIVE";
          if (supportingCount > 0 && verifiedCount === supportingCount && unverifiedCount === 0) {
            action = "VERIFIED_ACTIVE";
            reason = `Verified ACTIVE (${verifiedCount}/${supportingCount} supporting items confirmed) in scan ${targetScanId}`;
          } else {
            // DEFECT-LC-02 / DEFECT-LC-03: Do not recordScanVerification on 0-evidence or UNVERIFIED memories
            action = "NO_CHANGE_NON_TERMINAL";
            reason =
              supportingCount === 0
                ? `Remains ACTIVE (0 supporting evidence items; scan verification skipped) in scan ${targetScanId}`
                : `Remains ACTIVE (${verifiedCount} verified, ${unverifiedCount} unverified; full scan verification withheld) in scan ${targetScanId}`;
          }
        }

        const expectedNewVersion =
          action === "TRANSITION_SUPERSEDED" ||
          action === "TRANSITION_DISPUTED" ||
          action === "TRANSITION_STALE" ||
          action === "RECOVER_ACTIVE"
            ? memory.version + 1
            : memory.version;

        let applied = false;
        let finalVersion = expectedNewVersion;

        if (options.applyLifecycle) {
          if (action === "VERIFIED_ACTIVE") {
            const updated = store.recordScanVerification(repositoryId, memory.id, targetScanId);
            applied = true;
            finalVersion = updated.version;
          } else if (
            action === "TRANSITION_SUPERSEDED" ||
            action === "TRANSITION_DISPUTED" ||
            action === "TRANSITION_STALE" ||
            action === "RECOVER_ACTIVE"
          ) {
            const updated = store.transitionLifecycle({
              repositoryId,
              memoryId: memory.id,
              targetStatus: proposedStatus,
              supersededById: proposedStatus === "SUPERSEDED" ? supersededById : null,
              changeReason: reason,
              sourceScanId: targetScanId,
            });
            applied = true;
            finalVersion = updated.version;
          }
        }

        results.push({
          memoryId: memory.id,
          memoryKey: memory.memoryKey,
          category: memory.category,
          previousStatus: memory.status,
          proposedStatus,
          applied,
          action,
          previousVersion: memory.version,
          newVersion: finalVersion,
          supersededById: proposedStatus === "SUPERSEDED" ? supersededById : null,
          supportingCount,
          verifiedCount,
          missingCount,
          contradictedCount,
          unverifiedCount,
          reason,
          evidenceEvaluations,
        });
      }

      if (options.applyLifecycle && options.simulateFailure) {
        throw new Error("Simulated Stage 4 lifecycle failure for atomic rollback verification");
      }

      return results;
    };

    const evaluations = options.applyLifecycle
      ? db.transaction(() => evaluateAll())
      : evaluateAll();

    return {
      totalEvaluated: evaluations.length,
      verifiedActive: evaluations.filter((e) => e.action === "VERIFIED_ACTIVE").length,
      transitionedToStale: evaluations.filter((e) => e.action === "TRANSITION_STALE").length,
      transitionedToDisputed: evaluations.filter((e) => e.action === "TRANSITION_DISPUTED").length,
      transitionedToSuperseded: evaluations.filter((e) => e.action === "TRANSITION_SUPERSEDED")
        .length,
      recoveredToActive: evaluations.filter((e) => e.action === "RECOVER_ACTIVE").length,
      unchanged: evaluations.filter(
        (e) => e.action === "NO_CHANGE_TERMINAL" || e.action === "NO_CHANGE_NON_TERMINAL",
      ).length,
      evaluations,
      limitations: ctx.limitations.length > 0 ? ctx.limitations : undefined,
    };
  }

  private static findValidSuperseder(
    target: EngineeringMemoryRecord,
    allMemories: EngineeringMemoryRecord[],
    memoryById: Map<number, EngineeringMemoryRecord>,
    relationships: MemoryRelationshipRecord[],
    positivelyVerifiedIds: Set<number>,
    relManager: RelationshipManager,
  ): number | null {
    // Cannot supersede a memory that is already an active replacement for another SUPERSEDED memory
    const isActiveReplacement = allMemories.some(
      (m) => m.status === "SUPERSEDED" && m.supersededById === target.id && m.id !== target.id,
    );
    if (isActiveReplacement) {
      return null;
    }

    for (const rel of relationships) {
      if (rel.targetMemoryId === target.id && rel.relationshipType === "SUPERSEDES") {
        const candidate = memoryById.get(rel.sourceMemoryId);
        if (relManager.canSupersede(candidate, target.id, positivelyVerifiedIds)) {
          return candidate!.id;
        }
      }
    }
    return null;
  }
}
