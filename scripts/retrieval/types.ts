/**
 * Phase 7.6 — Agent Retrieval & Orchestration Contracts
 * Deterministic, read-only, evidence-backed repository retrieval types.
 */

import type { FreshnessAssessment, ConfidenceTier } from "../query/types.ts";
import type { MemoryCategory, MemoryLifecycleStatus, ScanRunStatus } from "../storage/types.ts";
import type { EvidenceVerificationStatus } from "../memory/types.ts";
import type { AdrVerificationStatus } from "../architecture/types.ts";

export type AgentId =
  | "frontier-engineer"
  | "architect"
  | "implementation-engineer"
  | "security-auditor"
  | "qa-engineer"
  | "design-engineer";

export type TaskType =
  | "architecture_design"
  | "feature_implementation"
  | "bug_fix"
  | "refactoring"
  | "database_change"
  | "security_audit"
  | "test_generation"
  | "ui_ux_work"
  | "documentation"
  | "evolution_review"
  | "general_inspection";

export type ContentTrustLevel =
  "deterministic_metadata" | "sanitized_untrusted_text" | "fenced_untrusted_content";

export type RetrievalDomain =
  | "overview"
  | "components"
  | "files"
  | "symbols"
  | "dependencies"
  | "tests"
  | "decisions"
  | "memories"
  | "evolution"
  | "snippets";

export type MemoryLiveStatus =
  "VERIFIED" | "STALE" | "DISPUTED" | "SUPERSEDED" | "ARCHIVED" | "MISSING" | "UNVERIFIED";

export type RetrievalWarningCode =
  | "INDEX_STALE"
  | "PARTIAL_SNAPSHOT"
  | "SNAPSHOT_VALIDATING"
  | "TARGET_NOT_FOUND"
  | "DISK_FILE_MISSING"
  | "SENSITIVE_FILE_REDACTED"
  | "INLINE_SECRET_REDACTED"
  | "PROMPT_INJECTION_SIGNAL"
  | "MEMORY_DISPUTED"
  | "MEMORY_STALE"
  | "MEMORY_EVIDENCE_UNVERIFIED"
  | "ADR_SNAPSHOT_UNVERIFIED"
  | "REPOSITORY_IDENTITY_MISMATCH"
  | "AMBIGUOUS_CLASSIFICATION"
  | "PARTIAL_DOMAIN_ERROR"
  | "WARNINGS_OVERFLOW"
  | "RETRIEVAL_CANCELLED"
  | "BUDGET_TRUNCATED"
  | "INVALID_WORKSPACE_CONFIG"
  | "UNSAFE_TARGET_IGNORED"
  | "EVOLUTION_UNAVAILABLE";

export interface RetrievalLimits {
  maxItems: number;
  maxTotalChars: number;
  maxTokens: number;
  maxDepth: number;
  maxSnippetLines: number;
}

export interface RetrievalRequest {
  agentId: AgentId;
  taskSummary: string;
  objective?: string;
  taskType?: TaskType;
  targetFiles?: string[];
  targetSymbols?: string[];
  targetComponents?: string[];
  targetAdrs?: string[];
  scanId?: number;
  baseScanId?: number;
  targetScanId?: number;
  expectedRepositoryIdentity?: string;
  verifyContentHashes?: boolean;
  includeSnippets?: boolean;
  includeHistoricalMemories?: boolean;
  allowPartialSnapshot?: boolean;
  limits?: Partial<RetrievalLimits>;
  signal?: AbortSignal;
}

export interface ExtractedTargets {
  files: string[];
  symbols: string[];
  components: string[];
  adrs: string[];
  keywords: string[];
  ignoredUnsafeTargets: string[];
  baseScanId?: number;
  targetScanId?: number;
}

export interface TaskClassification {
  primaryTaskType: TaskType;
  intents: TaskType[];
  confidenceTier?: ConfidenceTier;
  confidenceScore?: number;
  isAmbiguous?: boolean;
  extractedTargets: ExtractedTargets;
  classificationSignals: string[];
}

export interface AgentRetrievalPolicy {
  agentId: AgentId;
  policyVersion: number;
  description: string;
  priorityDomains: RetrievalDomain[];
  domainWeights: Record<RetrievalDomain, number>;
  domainQuotas: Partial<Record<RetrievalDomain, number>>;
  preferredMemoryCategories: MemoryCategory[];
  defaultLimits: RetrievalLimits;
  defaultIncludeSnippets: boolean;
  defaultIncludeHistoricalMemories: boolean;
  surfaceDisputedAndStaleWarnings: boolean;
  /** Security invariants: always enforced regardless of workspace configuration */
  excludeSensitiveContent: true;
  requireUntrustedFence: true;
}

export interface RetrievalPlanStep {
  domain: RetrievalDomain;
  priority: number;
  reason: string;
  maxItems: number;
  depth: number;
}

export interface RetrievalPlan {
  steps: RetrievalPlanStep[];
  effectiveLimits: RetrievalLimits;
  includeSnippets: boolean;
  includeHistoricalMemories: boolean;
}

export interface UnifiedEvidenceRef {
  sourceType: string;
  filePath: string;
  lineRange?: [number, number];
  symbolIdentity?: string;
  confidence?: number;
  confidenceTier: ConfidenceTier;
  verificationStatus:
    EvidenceVerificationStatus | AdrVerificationStatus | "STATIC_INDEX" | "VERIFIED_ON_DISK";
  description: string;
}

export interface RankedItemBase {
  id: string;
  domain: RetrievalDomain;
  title: string;
  rankScore: number;
  rankingReasons: string[];
  confidenceTier: ConfidenceTier;
  untrustedRepositoryContent: boolean;
  trustLevel?: ContentTrustLevel;
  evidence: UnifiedEvidenceRef[];
}

export interface RankedComponentItem extends RankedItemBase {
  domain: "components";
  componentIdentity: string;
  name: string;
  category: string;
  rootPath: string;
  filesCount: number;
  sampleFiles: string[];
}

export interface RankedFileItem extends RankedItemBase {
  domain: "files";
  filePath: string;
  language: string;
  classification: string;
  sensitivityStatus: string;
  componentAssociation?: string;
  exportedSymbolsCount: number;
  importsCount: number;
}

export interface RankedSymbolItem extends RankedItemBase {
  domain: "symbols";
  symbolIdentity: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface RankedDependencyItem extends RankedItemBase {
  domain: "dependencies";
  direction: "dependency" | "dependent" | "cycle";
  sourceTarget: string;
  targetNodeIdentity: string;
  targetName: string;
  relationship: string;
  depth: number;
  unresolvedSpecifiers: string[];
}

export interface RankedTestAssociationItem extends RankedItemBase {
  domain: "tests";
  testFilePath: string;
  sourceFilePath: string;
  associationStatus: ConfidenceTier;
  evidenceType: string;
}

export interface RankedAdrItem extends RankedItemBase {
  domain: "decisions";
  adrId: string;
  adrNumber: number;
  adrStatus: string;
  filePath: string;
  governedComponents: string[];
  summaryText: string;
  verificationStatus?: AdrVerificationStatus;
  isFallback?: boolean;
}

export interface RankedMemoryItem extends RankedItemBase {
  domain: "memories";
  memoryId: number;
  memoryKey: string;
  category: MemoryCategory;
  lifecycleStatus: MemoryLifecycleStatus;
  liveVerificationStatus: MemoryLiveStatus;
  supersededById: number | null;
  version: number;
  content: string;
  promptInjectionDetected: boolean;
}

export interface SafeCodeSnippet extends RankedItemBase {
  domain: "snippets";
  filePath: string;
  lineRange: [number, number];
  content: string;
  redacted: boolean;
  redactionCount: number;
  promptInjectionDetected: boolean;
}

export type AnyRankedItem =
  | RankedComponentItem
  | RankedFileItem
  | RankedSymbolItem
  | RankedDependencyItem
  | RankedTestAssociationItem
  | RankedAdrItem
  | RankedMemoryItem
  | SafeCodeSnippet;

export interface RetrievalOverviewSummary {
  languages: Array<{ language: string; fileCount: number }>;
  packageManagers: string[];
  frameworks: string[];
  componentCount: number;
  entrypointPaths: string[];
  cycleCount: number;
  decisionCount: number;
}

export interface RetrievalEvolutionSummary {
  baseScanId: number;
  targetScanId: number;
  status: string;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  driftFindingsCount: number;
  adrCorrelationsCount: number;
  debtItemsCount: number;
  highlights: Array<{
    kind: "drift" | "decision_correlation" | "debt" | "file_change";
    severity: string;
    title: string;
    confidenceTier: ConfidenceTier;
    relevantPaths: string[];
    untrustedRepositoryContent?: boolean;
  }>;
}

export interface RetrievalWarning {
  code: RetrievalWarningCode;
  severity: "info" | "warning" | "error";
  message: string;
  entity?: string;
}

export interface ConfidenceSummary {
  confirmedCount: number;
  inferredCount: number;
  candidateCount: number;
  unresolvedCount: number;
  isMixedConfidence: boolean;
}

export interface BudgetReport {
  limitsConfigured: RetrievalLimits;
  usedChars: number;
  serializedChars?: number;
  estimatedTokens: number;
  totalCandidatesFound: number;
  includedCount: number;
  truncatedCount: number;
  truncatedDomains: RetrievalDomain[];
  omittedItemIds: string[];
  budgetOverflowed?: boolean;
}

export interface RetrievalResponse {
  contract: "frontier-engineer/retrieval";
  version: 1;
  retrievalId: string;
  repository: {
    repositoryId: number;
    repositoryIdentity: string;
    rootPath: string;
    displayName: string;
    schemaVersion: number;
  };
  snapshot: {
    scanId: number;
    status: ScanRunStatus | string;
    freshness: FreshnessAssessment;
    baseScanId?: number;
    targetScanId?: number;
  };
  agentId: AgentId;
  policyVersion: number;
  classification: TaskClassification;
  plan: RetrievalPlan;
  context: {
    overview: RetrievalOverviewSummary | null;
    components: RankedComponentItem[];
    files: RankedFileItem[];
    symbols: RankedSymbolItem[];
    dependencies: RankedDependencyItem[];
    tests: RankedTestAssociationItem[];
    decisions: RankedAdrItem[];
    memories: RankedMemoryItem[];
    evolution: RetrievalEvolutionSummary | null;
    snippets: SafeCodeSnippet[];
  };
  confidenceSummary: ConfidenceSummary;
  warnings: RetrievalWarning[];
  budget: BudgetReport;
  limitations: string[];
}

export interface HandoffContextHighlight {
  domain: RetrievalDomain;
  idOrPath: string;
  summary: string;
  confidenceTier: ConfidenceTier;
  evidenceFile?: string;
  untrustedRepositoryContent?: boolean;
}

export interface HandoffRetrievalContext {
  contract: "frontier-engineer/retrieval-attachment";
  version: 1;
  retrievalId: string;
  repositoryIdentity: string;
  scanId: number;
  snapshotStatus: string;
  freshnessStatus: string;
  isStale: boolean;
  taskType: TaskType;
  confidenceSummary: ConfidenceSummary;
  highlights: HandoffContextHighlight[];
  warnings: string[];
  budget: {
    includedCount: number;
    truncatedCount: number;
    estimatedTokens: number;
  };
}
