/**
 * Phase 7.3 — Architecture Intelligence Types and Contracts
 * Deterministic, evidence-backed architectural classifications and dependency reports.
 */

import type {
  ComponentCategory,
  ComponentStatus,
  ArchitectureComponentRecord,
} from "../storage/types.ts";

export type FindingStatus = "CONFIRMED" | "INFERRED" | "CANDIDATE" | "UNRESOLVED";

export interface ArchitectureFinding {
  findingId: string;
  repositoryId: number;
  scanId: number;
  category: string;
  subjectEntity: string;
  status: FindingStatus;
  confidence: number;
  detectionMethod: string;
  evidenceDescription: string;
  relevantFilePaths: string[];
  relevantLineRanges?: [number, number][];
}

export interface EntrypointFinding {
  entrypointId: string;
  filePath: string;
  type: "cli" | "server" | "browser" | "library" | "script" | "unknown";
  status: FindingStatus;
  confidence: number;
  evidence: string;
  exportCount: number;
}

export interface ArchitectureComponent {
  componentIdentity: string;
  name: string;
  category: ComponentCategory;
  rootPath: string;
  status: ComponentStatus;
  confidence: number;
  detectionMethod: string;
  evidenceDescription: string;
  filesCount: number;
  filePaths: string[];
}

export interface CircularDependencyCandidate {
  cycle: string[]; // file paths forming the cycle
  length: number;
}

export interface ArchitectureDependencyReport {
  totalInternalEdges: number;
  totalExternalDependencies: number;
  totalUnresolvedImports: number;
  circularDependencyCandidates: CircularDependencyCandidate[];
  highFanoutModules: { filePath: string; dependencyCount: number }[];
  externalPackages: string[];
}

export interface TestAssociation {
  testFilePath: string;
  sourceFilePath: string;
  associationStatus: "CONFIRMED" | "INFERRED";
  confidence: number;
  evidenceType: "import_evidence" | "naming_convention" | "directory_convention";
  evidenceDescription: string;
}

export interface ArchitectureAnalysisResult {
  repositoryId: number;
  scanId: number;
  analyzedAt: string;
  components: ArchitectureComponent[];
  entrypoints: EntrypointFinding[];
  dependencyReport: ArchitectureDependencyReport;
  testAssociations: TestAssociation[];
  findings: ArchitectureFinding[];
}

export interface ArchitectureIntelligenceInterface {
  analyze(repositoryId: number, scanId?: number): Promise<ArchitectureAnalysisResult>;
  getComponents(repositoryId: number, scanId?: number): Promise<ArchitectureComponent[]>;
  getEntrypoints(repositoryId: number, scanId?: number): Promise<EntrypointFinding[]>;
  getDependencies(repositoryId: number, scanId?: number): Promise<ArchitectureDependencyReport>;
  getTestAssociations(repositoryId: number, scanId?: number): Promise<TestAssociation[]>;
}
