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

export class MemoryLifecycleEvaluator {
  public static evaluateRepository(
    db: SqliteDatabase,
    repositoryId: number,
    targetScanId: number,
    comparison?: SnapshotComparison,
    options: { applyLifecycle?: boolean; simulateFailure?: boolean; workspaceRoot?: string } = {},
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
    );

    const evaluateAll = (): MemoryEvaluationResult[] => {
      const results: MemoryEvaluationResult[] = [];
      const memoryById = new Map<number, EngineeringMemoryRecord>(memories.map((m) => [m.id, m]));

      for (const memory of memories) {
        const attachedEvidence = store.getMemoryEvidence(repositoryId, memory.id);
        const evidenceEvaluations: EvidenceEvaluationItem[] = attachedEvidence.map((ev) =>
          EvidenceEvaluator.evaluateEvidence(ctx, ev),
        );

        const supporting = evidenceEvaluations.filter((e) => !e.isContradictory);
        const verifiedCount = supporting.filter((e) => e.status === "VERIFIED").length;
        const missingCount = supporting.filter((e) => e.status === "MISSING").length;
        const contradictedCount = evidenceEvaluations.filter(
          (e) => e.status === "CONTRADICTED",
        ).length;

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
            supportingCount: supporting.length,
            verifiedCount,
            missingCount,
            contradictedCount,
            reason: `Memory '${memory.memoryKey}' is in terminal status ${memory.status}`,
            evidenceEvaluations,
          });
          continue;
        }

        // Check incoming SUPERSEDES edge
        const replacementId = this.findValidSuperseder(memory, memories, memoryById, relationships);

        let proposedStatus: MemoryLifecycleStatus = memory.status;
        let action: MemoryLifecycleActionType = "NO_CHANGE_NON_TERMINAL";
        let reason = "";
        let supersededById: number | null = memory.supersededById;

        if (replacementId !== null) {
          proposedStatus = "SUPERSEDED";
          action = "TRANSITION_SUPERSEDED";
          supersededById = replacementId;
          reason = `Superseded by memory ID ${replacementId} via SUPERSEDES relationship in scan ${targetScanId}`;
        } else if (contradictedCount >= 1) {
          proposedStatus = "DISPUTED";
          if (memory.status !== "DISPUTED") {
            action = "TRANSITION_DISPUTED";
            reason = `Disputed by ${contradictedCount} contradictory evidence item(s) in scan ${targetScanId}`;
          } else {
            action = "NO_CHANGE_NON_TERMINAL";
            reason = `Remains DISPUTED (${contradictedCount} contradictory item(s)) in scan ${targetScanId}`;
          }
        } else if (supporting.length > 0 && verifiedCount === 0) {
          proposedStatus = "STALE";
          if (memory.status !== "STALE") {
            action = "TRANSITION_STALE";
            reason = `All ${supporting.length} supporting evidence item(s) missing in scan ${targetScanId}`;
          } else {
            action = "NO_CHANGE_NON_TERMINAL";
            reason = `Remains STALE (${supporting.length} supporting item(s) missing) in scan ${targetScanId}`;
          }
        } else if (memory.status === "STALE" || memory.status === "DISPUTED") {
          if (verifiedCount > 0) {
            proposedStatus = "ACTIVE";
            action = "RECOVER_ACTIVE";
            reason = `Recovered to ACTIVE: ${verifiedCount}/${supporting.length} supporting evidence item(s) verified in scan ${targetScanId}`;
          } else {
            proposedStatus = memory.status;
            action = "NO_CHANGE_NON_TERMINAL";
            reason = `Remains ${memory.status} with zero supporting evidence items in scan ${targetScanId}`;
          }
        } else {
          // Currently ACTIVE with verifiedCount > 0 or 0 supporting items, and 0 contradictions
          proposedStatus = "ACTIVE";
          action = "VERIFIED_ACTIVE";
          reason =
            supporting.length > 0
              ? `Verified ACTIVE (${verifiedCount}/${supporting.length} supporting items confirmed) in scan ${targetScanId}`
              : `Remains ACTIVE (uncontradicted manual/context memory) in scan ${targetScanId}`;
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
          supportingCount: supporting.length,
          verifiedCount,
          missingCount,
          contradictedCount,
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
    };
  }

  private static findValidSuperseder(
    target: EngineeringMemoryRecord,
    allMemories: EngineeringMemoryRecord[],
    memoryById: Map<number, EngineeringMemoryRecord>,
    relationships: MemoryRelationshipRecord[],
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
        if (
          candidate &&
          candidate.id !== target.id &&
          candidate.status !== "SUPERSEDED" &&
          candidate.status !== "ARCHIVED"
        ) {
          return candidate.id;
        }
      }
    }
    return null;
  }
}
