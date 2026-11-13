/**
 * Phase 7.5 Stage 4 — Memory Lifecycle & Evidence Evaluation Contracts
 */

import type {
  MemoryCategory,
  MemoryEvidenceType,
  MemoryLifecycleStatus,
} from "../storage/types.ts";
import type { ComparisonLimitation } from "../evolution/types.ts";

export type EvidenceVerificationStatus = "VERIFIED" | "MISSING" | "CONTRADICTED" | "UNVERIFIED";

export interface EvidenceEvaluationItem {
  evidenceId: number;
  memoryId: number;
  evidenceType: MemoryEvidenceType;
  sourcePath: string;
  symbolIdentity: string | null;
  isContradictory: boolean;
  status: EvidenceVerificationStatus;
  reason: string;
  targetScanId: number;
}

export type MemoryLifecycleActionType =
  | "VERIFIED_ACTIVE"
  | "TRANSITION_STALE"
  | "TRANSITION_DISPUTED"
  | "TRANSITION_SUPERSEDED"
  | "RECOVER_ACTIVE"
  | "NO_CHANGE_TERMINAL"
  | "NO_CHANGE_NON_TERMINAL";

export interface MemoryEvaluationResult {
  memoryId: number;
  memoryKey: string;
  category: MemoryCategory;
  previousStatus: MemoryLifecycleStatus;
  proposedStatus: MemoryLifecycleStatus;
  applied: boolean;
  action: MemoryLifecycleActionType;
  previousVersion: number;
  newVersion: number;
  supersededById: number | null;
  supportingCount: number;
  verifiedCount: number;
  missingCount: number;
  contradictedCount: number;
  unverifiedCount: number;
  reason: string;
  evidenceEvaluations: EvidenceEvaluationItem[];
}

export interface MemoryLifecycleSummary {
  totalEvaluated: number;
  verifiedActive: number;
  transitionedToStale: number;
  transitionedToDisputed: number;
  transitionedToSuperseded: number;
  recoveredToActive: number;
  unchanged: number;
  evaluations: MemoryEvaluationResult[];
  limitations?: ComparisonLimitation[];
}
