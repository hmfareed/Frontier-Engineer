/**
 * Phase 7.3 — Storage Subsystem Data Types and Contracts
 * Normalized relational and persistence contracts for Frontier Engineer intelligence.
 */

import type {
  FileClassification,
  FileInventoryResult,
  ScannedFileRecord,
} from "../scanner/types.ts";
import type {
  EvidenceClassification,
  ExtractionResult,
  ExtractedSymbol,
  ImportRecord as ExtractorImportRecord,
  ExportRecord as ExtractorExportRecord,
  SymbolKind,
} from "../extractor/types.ts";

export type ScanRunStatus =
  "RUNNING" | "VALIDATING" | "COMPLETE" | "PARTIAL" | "CANCELLED" | "FAILED";

export type RelationshipStatus = "CONFIRMED" | "INFERRED" | "UNRESOLVED";

export type GraphNodeCategory =
  | "repository"
  | "directory"
  | "file"
  | "symbol"
  | "package"
  | "module"
  | "test"
  | "database"
  | "component"
  | "adr";

export type GraphRelationshipType =
  | "CONTAINS"
  | "DEFINES"
  | "IMPORTS"
  | "EXPORTS"
  | "DEPENDS_ON"
  | "TESTS"
  | "REFERENCES"
  | "IMPLEMENTS"
  | "DOCUMENTS"
  | "MODIFIES"
  | "DECIDED_BY";

export type ComponentCategory =
  | "frontend"
  | "backend"
  | "api"
  | "database"
  | "auth"
  | "shared_lib"
  | "test"
  | "build"
  | "infrastructure"
  | "docs"
  | "unknown";

export type ComponentStatus = "CONFIRMED" | "INFERRED" | "CANDIDATE";

export interface RepositoryRecord {
  id: number;
  identity: string;
  rootPath: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  activeScanId: number | null;
}

export interface ScanRecord {
  id: number;
  repositoryId: number;
  startedAt: string;
  completedAt: string | null;
  status: ScanRunStatus;
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  filesFailed: number;
  diagnosticCount: number;
  scannerVersion: string;
  extractorVersion: string;
  isActive: boolean;
  failureReason: string | null;
}

export interface FileRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  relativePath: string;
  normalizedPath: string;
  extension: string;
  language: string;
  classification: FileClassification;
  sizeBytes: number;
  modifiedAt: number;
  contentHash: string | null;
  sensitivityStatus: string;
  indexStatus: string;
  indexedAt: string;
}

export interface SymbolRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  fileId: number;
  symbolIdentity: string;
  name: string;
  kind: SymbolKind;
  scope: string | null;
  parentSymbolId: number | null;
  isExported: boolean;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  fingerprint: string;
  confidence: number;
  extractionStatus: string;
}

export interface SourceEvidenceRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  fileId: number;
  symbolId: number | null;
  evidenceType: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  confidence: number;
  evidenceDescription: string;
}

export interface ImportRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  sourceFileId: number;
  importedSpecifier: string;
  importKind: string;
  resolvedFileId: number | null;
  resolutionStatus: "RESOLVED" | "UNRESOLVED" | "EXTERNAL" | "BUILTIN" | "DEGRADED";
  startLine: number;
  endLine: number;
  evidenceId: number | null;
}

export interface ExportRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  fileId: number;
  symbolId: number | null;
  exportName: string;
  exportKind: string;
  isDefault: boolean;
  startLine: number;
  endLine: number;
  evidenceId: number | null;
}

export interface GraphNodeRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  nodeIdentity: string;
  category: GraphNodeCategory;
  name: string;
  fileId: number | null;
  symbolId: number | null;
  metadataJson: string | null;
}

export interface GraphEdgeRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  edgeIdentity: string;
  sourceNodeId: number;
  targetNodeId: number;
  relationshipType: GraphRelationshipType;
  evidenceId: number | null;
  confidence: number;
  relationshipStatus: RelationshipStatus;
  createdAt: string;
}

export interface ArchitectureComponentRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  componentIdentity: string;
  name: string;
  category: ComponentCategory;
  rootPath: string;
  detectionMethod: string;
  confidence: number;
  status: ComponentStatus;
  evidenceId: number | null;
  metadataJson: string | null;
}

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
}

export interface SnapshotInput {
  repositoryIdentity: string;
  rootPath: string;
  displayName: string;
  inventory: FileInventoryResult;
  extractions: Map<string, ExtractionResult>;
  scannerVersion: string;
  extractorVersion: string;
  signal?: AbortSignal;
  allowPartialPromotion?: boolean;
}

export interface SnapshotResult {
  scanId: number;
  repositoryId: number;
  status: ScanRunStatus;
  filesIndexed: number;
  symbolsIndexed: number;
  importsIndexed: number;
  exportsIndexed: number;
  nodesCreated: number;
  edgesCreated: number;
  promoted: boolean;
  durationMs: number;
  diagnostics: string[];
}

export interface IntegrityIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: number | string;
  entityType?: string;
}

export interface IntegrityReport {
  isValid: boolean;
  scanId: number;
  repositoryId: number;
  checkedAt: string;
  issues: IntegrityIssue[];
}

export interface IntelligenceStorage {
  initialize(): Promise<void>;
  getRepository(repositoryIdentity: string): Promise<RepositoryRecord | null>;
  getActiveScan(repositoryId: number): Promise<ScanRecord | null>;
  persistSnapshot(input: SnapshotInput): Promise<SnapshotResult>;
  validateIntegrity(repositoryId: number, scanId?: number): Promise<IntegrityReport>;
  recoverInterruptedScans(repositoryId: number): Promise<number>;
  close(): Promise<void>;
}

// --- Phase 7.5: Engineering Memory & Evolution Persistence Types ---

export type MemoryCategory =
  | "architectural_knowledge"
  | "engineering_convention"
  | "architectural_decision"
  | "technical_debt"
  | "project_context"
  | "evolution_record";

export type MemoryLifecycleStatus = "ACTIVE" | "STALE" | "SUPERSEDED" | "DISPUTED" | "ARCHIVED";

export type MemoryConfidenceTier = "CONFIRMED" | "INFERRED" | "CANDIDATE" | "UNRESOLVED";

export type MemoryEvidenceType =
  | "source_file"
  | "symbol"
  | "import"
  | "component"
  | "adr"
  | "graph_edge"
  | "test"
  | "diff"
  | "manual";

export type EvolutionCategory =
  "file" | "symbol" | "dependency" | "architecture" | "decision" | "debt";

export type EvolutionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MemoryRelationshipType =
  "IMPLEMENTS" | "SUPERSEDES" | "CONTRADICTS" | "RELATES_TO" | "DOCUMENTS" | "DEPENDS_ON";

export interface EngineeringMemoryRecord {
  id: number;
  repositoryId: number;
  memoryKey: string;
  category: MemoryCategory;
  title: string;
  content: string;
  confidence: number;
  confidenceTier: MemoryConfidenceTier;
  status: MemoryLifecycleStatus;
  firstSeenScanId: number | null;
  lastSeenScanId: number | null;
  supersededById: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
}

export interface MemoryEvidenceRecord {
  id: number;
  repositoryId: number;
  memoryId: number;
  scanId: number;
  evidenceType: MemoryEvidenceType;
  sourcePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  sourceHash: string | null;
  symbolIdentity: string | null;
  graphNodeId: number | null;
  graphEdgeId: number | null;
  description: string;
  confidence: number;
  isContradictory: boolean;
  createdAt: string;
}

export interface EvolutionEventRecord {
  id: number;
  repositoryId: number;
  baseScanId: number;
  targetScanId: number;
  eventType: string;
  category: EvolutionCategory;
  title: string;
  description: string;
  severity: EvolutionSeverity;
  confidence: number;
  confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE";
  detailsJson: string | null;
  createdAt: string;
}

export interface MemoryRelationshipRecord {
  id: number;
  repositoryId: number;
  sourceMemoryId: number;
  targetMemoryId: number;
  relationshipType: MemoryRelationshipType;
  createdAt: string;
}

export interface MemoryVersionRecord {
  id: number;
  repositoryId: number;
  memoryId: number;
  version: number;
  title: string;
  content: string;
  status: MemoryLifecycleStatus;
  previousContentHash: string | null;
  newContentHash: string;
  changeReason: string;
  sourceScanId: number | null;
  createdAt: string;
}

export interface CreateMemoryInput {
  repositoryId: number;
  memoryKey: string;
  category: MemoryCategory;
  title: string;
  content: string;
  confidence?: number;
  confidenceTier?: MemoryConfidenceTier;
  firstSeenScanId?: number | null;
  lastSeenScanId?: number | null;
}

export interface TransitionLifecycleInput {
  repositoryId: number;
  memoryId: number;
  targetStatus: MemoryLifecycleStatus;
  supersededById?: number | null;
  changeReason: string;
  sourceScanId?: number | null;
  newTitle?: string;
  newContent?: string;
  newConfidence?: number;
  newConfidenceTier?: MemoryConfidenceTier;
}

export interface MemoryFilterOptions {
  category?: MemoryCategory;
  status?: MemoryLifecycleStatus;
  confidenceTier?: MemoryConfidenceTier;
}
