/**
 * Phase 8.3 — Persistent Task Graph, Execution Plans & Bidirectional Handoff Lifecycle
 * TypeScript type definitions for execution plans, plan tasks, DAG dependencies,
 * file locks, handoff audit records, and verification runs.
 */

export type PlanStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "FAILED";

export type TaskStatus =
  "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "FAILED" | "CANCELLED";

export type LockType = "EXCLUSIVE" | "SHARED";

export type LockStatus = "HELD" | "RELEASED";

export type HandoffDirection = "OUTGOING_HANDOFF" | "INCOMING_RESPONSE";

export type ValidationStatus = "VALID" | "INVALID";

export type VerificationStatus = "PASSED" | "FAILED" | "BLOCKED";

export interface ExecutionPlanRecord {
  id: number;
  repositoryId: number;
  planKey: string;
  title: string;
  description: string | null;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PlanTaskRecord {
  id: number;
  planId: number;
  repositoryId: number;
  taskKey: string;
  title: string;
  description: string | null;
  assignedAgent: string | null;
  status: TaskStatus;
  priority: number;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resultSummary: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
}

export interface TaskDependencyRecord {
  id: number;
  planId: number;
  taskId: number;
  prerequisiteTaskId: number;
  createdAt: string;
}

export interface TaskFileLockRecord {
  id: number;
  planId: number;
  taskId: number;
  repositoryId: number;
  relativePath: string;
  lockType: LockType;
  status: LockStatus;
  acquiredAt: string;
  releasedAt: string | null;
}

export interface HandoffRecord {
  id: number;
  planId: number;
  taskId: number;
  repositoryId: number;
  direction: HandoffDirection;
  payloadJson: string;
  validationStatus: ValidationStatus;
  validationErrors: string[] | null;
  fromAgent: string | null;
  toAgent: string | null;
  createdAt: string;
}

export interface VerificationRunRecord {
  id: number;
  planId: number;
  taskId: number;
  repositoryId: number;
  status: VerificationStatus;
  commands: string[];
  outcomes: string[];
  testStates: string[];
  summary: string | null;
  createdAt: string;
}

export interface CreatePlanInput {
  repositoryId: number;
  title: string;
  planKey?: string;
  description?: string;
  status?: PlanStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskInput {
  planId: number;
  repositoryId: number;
  title: string;
  taskKey?: string;
  description?: string;
  assignedAgent?: string;
  priority?: number;
  orderIndex?: number;
  prerequisiteTaskIds?: number[];
  prerequisiteTaskKeys?: string[];
  fileLocks?: string[];
  metadata?: Record<string, unknown>;
}

export interface PlanProgressSummary {
  planId: number;
  planKey: string;
  title: string;
  status: PlanStatus;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  blockedTasks: number;
  failedTasks: number;
  percentComplete: number;
  isBlocked: boolean;
  activeHeldLocksCount: number;
}
