/**
 * Phase 7.5 Stage 3 — Snapshot Comparator & Deterministic Diff Engine Types
 * Strongly typed contracts for snapshot validation, multi-domain diffs, evidence, and comparisons.
 */

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
}
