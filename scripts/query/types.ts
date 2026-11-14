/**
 * Phase 7.4 — Architecture Query Engine Types and Result Contracts
 * Stable public DTOs, query options, and evidence contracts for repository intelligence.
 */

import type { FileRecord, SymbolRecord, ImportRecord, ExportRecord } from "../storage/types.ts";
import type {
  ArchitectureComponent,
  EntrypointFinding,
  TestAssociation,
  AdrFinding,
  CircularDependencyCandidate,
  FindingStatus,
} from "../architecture/types.ts";
import type { StronglyConnectedComponent } from "../architecture/cycle-analyzer.ts";

export type SnapshotFreshnessStatus =
  "FRESH" | "COMPLETE" | "PARTIAL" | "STALE" | "FAILED" | "NONE";

export type ConfidenceTier = "CONFIRMED" | "INFERRED" | "CANDIDATE" | "UNRESOLVED";

export interface FreshnessAssessment {
  status: SnapshotFreshnessStatus;
  lastIndexedAt: string | null;
  isStale: boolean;
  staleReason?: string;
  activeScanId: number | null;
  isPartial: boolean;
  checkedFilesCount?: number;
  strategy?: "INVENTORY_METADATA" | "CONTENT_HASH";
  disclosures?: string[];
  limitations?: string[];
}

export interface FreshnessEvaluationOptions {
  explicitScanId?: number;
  verifyContentHashes?: boolean;
}

export interface QueryEvidence {
  file: string;
  lineRange?: [number, number];
  symbolOrEntity?: string;
  description: string;
  evidenceType: string;
  confidence: number;
}

export interface QueryLimitsApplied {
  depthLimit?: number;
  resultLimit?: number;
  truncated: boolean;
}

export interface QueryResult<T> {
  repositoryId: number;
  repositoryIdentity: string;
  scanId: number;
  snapshotStatus: SnapshotFreshnessStatus;
  freshness: FreshnessAssessment;
  query: {
    category: string;
    target?: string;
    parameters?: Record<string, unknown>;
  };
  data: T;
  evidence: QueryEvidence[];
  confidence: ConfidenceTier;
  isMixedConfidence?: boolean;
  warnings: string[];
  limitsApplied: QueryLimitsApplied;
  generatedAt: string;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  includeEvidence?: boolean;
  scanId?: number; // Optional historical scan inspection
  allowPartial?: boolean; // Explicit opt-in to query PARTIAL snapshots (default: false)
}

export interface TraversalQueryOptions extends QueryOptions {
  depth?: number;
  includeTransitive?: boolean;
}

export interface RepositoryStatusData {
  repositoryIdentity: string;
  rootPath: string;
  displayName: string;
  databaseLocation: string;
  schemaVersion: number;
  activeScanId: number | null;
  activeScanStatus: string | null;
  lastSuccessfulIndexTime: string | null;
  isFresh: boolean;
  isPartial: boolean;
  stalenessReason?: string;
  totalScansCount: number;
}

export interface RepositoryOverviewData {
  repositoryIdentity: string;
  displayName: string;
  rootPath: string;
  repositoryType:
    | "monorepo"
    | "frontend_app"
    | "backend_service"
    | "fullstack_app"
    | "library"
    | "cli"
    | "unknown";
  languages: { language: string; fileCount: number }[];
  frameworks: string[];
  packageManagers: string[];
  entrypoints: { path: string; type: string; status: FindingStatus }[];
  componentsSummary: {
    totalComponents: number;
    byCategory: Record<string, number>;
  };
  dependencySummary: {
    totalInternalEdges: number;
    totalExternalPackages: number;
    totalUnresolvedImports: number;
    circularCyclesCount: number;
  };
  testSummary: {
    totalTestsCount: number;
    coveredSourceFilesCount: number;
    confirmedAssociationsCount: number;
    inferredAssociationsCount: number;
  };
  counts: {
    files: number;
    symbols: number;
    nodes: number;
    edges: number;
    decisions: number;
  };
}

export interface ComponentSummaryItem {
  identity: string;
  name: string;
  category: string;
  status: FindingStatus;
  confidence: number;
  filesCount: number;
  rootPath: string;
}

export interface ComponentListData {
  components: ComponentSummaryItem[];
  totalCount: number;
}

export interface ComponentDetailData {
  component: ArchitectureComponent;
  files: string[];
  symbolsCount: number;
  dependencies: { target: string; relationship: string; type: "component" | "package" | "file" }[];
  dependents: { source: string; relationship: string }[];
  associatedTests: string[];
  associatedDecisions: AdrFinding[];
}

export interface EntrypointListData {
  entrypoints: EntrypointFinding[];
  totalCount: number;
}

export interface FileDetailData {
  file: FileRecord;
  componentAssociation?: string;
  symbols: SymbolRecord[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  relatedTests: string[];
}

export interface SymbolSearchResult {
  symbols: (SymbolRecord & { filePath: string })[];
  totalMatches: number;
}

export interface TraversalNodeItem {
  pathOrName: string;
  nodeIdentity: string;
  relationship: string;
  depth: number;
  confidence: number;
  status: string;
  path: string[];
}

export interface DependencyTraversalData {
  target: string;
  targetIdentity: string;
  direction: "dependencies" | "dependents";
  direct: TraversalNodeItem[];
  transitive: TraversalNodeItem[];
  unresolvedImports: string[];
  hasCycles: boolean;
  depthReached: number;
}

export interface CycleData {
  cycles: CircularDependencyCandidate[];
  stronglyConnectedComponents: StronglyConnectedComponent[];
  totalCycles: number;
}

export interface TestAssociationData {
  associations: TestAssociation[];
  totalAssociated: number;
  modulesWithoutTestAssociation: string[];
}

export interface DecisionListData {
  decisions: AdrFinding[];
  totalCount: number;
}

export interface DecisionDetailData {
  decision: AdrFinding;
  governedComponents: ArchitectureComponent[];
}
