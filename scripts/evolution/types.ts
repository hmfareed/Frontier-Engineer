/**
 * Phase 7.5 Stage 3 & 4 — Snapshot Comparator, Evolution Analyzer & Debt Intelligence Types
 * Strongly typed contracts for snapshot validation, multi-domain diffs, drift, ADR correlation, debt, and comparisons.
 */

import type { EvolutionSeverity } from "../storage/types.ts";
import type { MemoryLifecycleSummary } from "../memory/types.ts";

export type ComparisonStatus = "COMPLETE" | "PARTIAL";

export interface SnapshotValidationResult {
  isValid: boolean;
  repositoryId?: number;
  baseScanId?: number;
  targetScanId?: number;
  passedChecks: string[];
  failedChecks: string[];
  errorCode?: string;
  errorMessage?: string;
}

export type FileChangeType = "ADDED" | "MODIFIED" | "DELETED" | "UNCHANGED";

export interface FileDiffItem {
  path: string;
  changeType: FileChangeType;
  baseHash: string | null;
  targetHash: string | null;
  baseClassification?: string;
  targetClassification?: string;
  baseSizeBytes?: number;
  targetSizeBytes?: number;
  isInferredRename?: boolean;
  renameSourcePath?: string;
  renameConfidence?: number;
  evidenceId?: string;
}

export interface FileDiffResult {
  changes: FileDiffItem[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  unchangedCount: number;
}

export type SymbolChangeType = "ADDED" | "REMOVED" | "MODIFIED" | "RELOCATED" | "UNCHANGED";

export interface SymbolDiffItem {
  symbolIdentity: string;
  name: string;
  kind: string;
  changeType: SymbolChangeType;
  basePath?: string;
  targetPath?: string;
  baseFingerprint?: string;
  targetFingerprint?: string;
  baseLines?: { startLine: number; endLine: number };
  targetLines?: { startLine: number; endLine: number };
  baseConfidence?: number;
  targetConfidence?: number;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
  evidenceId?: string;
}

export interface SymbolDiffResult {
  changes: SymbolDiffItem[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  relocatedCount: number;
  unchangedCount: number;
}

export type DependencyChangeType = "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED" | "UNRESOLVED";

export interface DependencyDiffItem {
  sourcePath: string;
  specifier: string;
  importKind: string;
  changeType: DependencyChangeType;
  baseResolvedPath?: string | null;
  targetResolvedPath?: string | null;
  baseResolutionStatus?: string;
  targetResolutionStatus?: string;
  baseLines?: { startLine: number; endLine: number };
  targetLines?: { startLine: number; endLine: number };
  confidence: number;
  evidenceId?: string;
}

export interface DependencyDiffResult {
  changes: DependencyDiffItem[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unresolvedCount: number;
  unchangedCount: number;
}

export type ComponentChangeType = "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";

export interface ComponentDiffItem {
  componentIdentity: string;
  name: string;
  category: string;
  rootPath: string;
  changeType: ComponentChangeType;
  baseConfidence?: number;
  targetConfidence?: number;
  baseStatus?: string;
  targetStatus?: string;
  addedMemberFiles: string[];
  removedMemberFiles: string[];
  unchangedMemberFiles: string[];
  evidenceDescription?: string;
  evidenceId?: string;
}

export interface ComponentDiffResult {
  changes: ComponentDiffItem[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}

export type AdrChangeType = "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";

export interface AdrDiffItem {
  adrId: string;
  number: number;
  title: string;
  changeType: AdrChangeType;
  basePath?: string;
  targetPath?: string;
  baseStatus?: string;
  targetStatus?: string;
  baseContentHash?: string | null;
  targetContentHash?: string | null;
  date?: string;
  governedComponents?: string[];
  evidenceDescription?: string;
  evidenceId?: string;
  confidence?: number;
  isFallback?: boolean;
}

export interface AdrDiffResult {
  changes: AdrDiffItem[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}

export interface ComparisonSummary {
  files: {
    added: number;
    modified: number;
    deleted: number;
    unchanged: number;
    renamed: number;
  };
  symbols: {
    added: number;
    removed: number;
    modified: number;
    relocated: number;
    unchanged: number;
  };
  dependencies: {
    added: number;
    removed: number;
    modified: number;
    unresolved: number;
    unchanged: number;
  };
  components: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  adrs: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export interface ComparisonEvidence {
  evidenceId: string;
  repositoryId: number;
  snapshotId: number;
  sourcePath: string;
  sourceHash: string | null;
  entityIdentity: string;
  evidenceType: string;
  lineRange?: [number, number];
  confidence: number;
  supportedClassification: string;
  isInferred?: boolean;
}

export interface ComparisonLimitation {
  code: string;
  description: string;
  domain: "file" | "symbol" | "dependency" | "component" | "adr" | "snapshot";
  affectedEntityCount?: number;
}

export interface SnapshotHeader {
  scanId: number;
  startedAt: string;
  completedAt: string | null;
  scannerVersion: string;
  extractorVersion: string;
  status?: ComparisonStatus;
}

export interface SnapshotComparison {
  comparisonId: string;
  repositoryId: number;
  repositoryIdentity: string;
  baseSnapshot: SnapshotHeader;
  targetSnapshot: SnapshotHeader;
  comparedAt: string;
  status: ComparisonStatus;
  summary: ComparisonSummary;
  files: FileDiffResult;
  symbols: SymbolDiffResult;
  dependencies: DependencyDiffResult;
  components: ComponentDiffResult;
  adrs: AdrDiffResult;
  evidence: ComparisonEvidence[];
  limitations: ComparisonLimitation[];
}

export interface ComparatorOptions {
  allowPartial?: boolean;
  detectRenames?: boolean;
  detectRelocations?: boolean;
  includeUnchanged?: boolean;
  maxRecordsPerDomain?: number;
  persistEvents?: boolean;
  workspaceRoot?: string;
  expectedRepositoryId?: number;
}

// --- Phase 7.5 Stage 4: Evolution Analyzer, Drift, ADR Correlation & Debt Types ---

export type DriftFindingType =
  | "DRIFT_COMPONENT_ADDED"
  | "DRIFT_COMPONENT_REMOVED"
  | "DRIFT_COMPONENT_RECLASSIFIED"
  | "DRIFT_COMPONENT_BOUNDARY_CREATED"
  | "DRIFT_COMPONENT_BOUNDARY_REMOVED"
  | "DRIFT_LAYER_VIOLATION_INTRODUCED"
  | "DRIFT_CYCLE_INTRODUCED"
  | "DRIFT_CYCLE_EXPANDED"
  | "DRIFT_CYCLE_RESOLVED"
  | "DRIFT_SCC_GROWTH"
  | "DRIFT_COUPLING_HOTSPOT_INTRODUCED"
  | "DRIFT_UNRESOLVED_IMPORT_SPIKE";

export interface DriftFinding {
  findingId: string;
  driftType: DriftFindingType;
  title: string;
  description: string;
  severity: EvolutionSeverity;
  confidence: number;
  confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE";
  subjectEntity: string;
  relevantPaths: string[];
  details: Record<string, unknown>;
  evidenceIds: string[];
}

export type AdrCorrelationType =
  | "DECISION_GOVERNED_COMPONENT_REMOVED"
  | "DECISION_GOVERNED_BOUNDARY_DRIFT"
  | "DECISION_STATUS_SUPERSEDED_OR_DEPRECATED"
  | "DECISION_CONFLICTING_GOVERNANCE"
  | "DECISION_UNLINKED_ARCHITECTURAL_CHANGE";

export interface AdrCorrelationFinding {
  findingId: string;
  correlationType: AdrCorrelationType;
  adrId?: string;
  componentIdentity?: string;
  title: string;
  description: string;
  severity: EvolutionSeverity;
  confidence: number;
  confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE";
  relevantPaths: string[];
  details: Record<string, unknown>;
  evidenceIds: string[];
}

export type DebtCategory =
  | "DEBT_CIRCULAR_DEPENDENCY"
  | "DEBT_UNRESOLVED_IMPORTS"
  | "DEBT_HIGH_FANOUT_HOTSPOT"
  | "DEBT_LAYER_BOUNDARY_VIOLATION"
  | "DEBT_UNTESTED_COMPONENT_GROWTH"
  | "DEBT_STALE_OR_DISPUTED_MEMORY";

export type DebtLifecycleState = "INTRODUCED" | "WORSENED" | "PERSISTING" | "RESOLVED";

export interface DebtFinding {
  findingId: string;
  category: DebtCategory;
  state: DebtLifecycleState;
  title: string;
  description: string;
  severity: EvolutionSeverity;
  confidence: number;
  confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE";
  subjectEntity: string;
  baseMetric?: number;
  targetMetric?: number;
  relevantPaths: string[];
  details: Record<string, unknown>;
}

export interface EvolutionAnalyzerOptions extends ComparatorOptions {
  applyLifecycle?: boolean;
  fanoutHotspotThreshold?: number;
  simulateFailure?: boolean;
}

export interface EvolutionAnalysisResult {
  analysisId: string;
  repositoryId: number;
  repositoryIdentity: string;
  baseSnapshot: SnapshotHeader;
  targetSnapshot: SnapshotHeader;
  analyzedAt: string;
  status: ComparisonStatus;
  comparison: SnapshotComparison;
  drift: {
    totalFindings: number;
    findings: DriftFinding[];
  };
  decisions: {
    totalCorrelations: number;
    correlations: AdrCorrelationFinding[];
  };
  debt: {
    introducedCount: number;
    worsenedCount: number;
    persistingCount: number;
    resolvedCount: number;
    items: DebtFinding[];
  };
  memoryLifecycle: MemoryLifecycleSummary;
}
