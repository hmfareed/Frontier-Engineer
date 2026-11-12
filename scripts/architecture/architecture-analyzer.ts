/**
 * Phase 7.3 — Architecture Analyzer Engine
 * Orchestrates deterministic, evidence-backed architecture intelligence and persistable classifications.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { EntrypointDetector } from "./entrypoint-detector.ts";
import { ComponentDetector } from "./component-detector.ts";
import { DependencyAnalyzer } from "./dependency-analyzer.ts";
import { TestAssociationEngine } from "./test-association.ts";
import type {
  ArchitectureIntelligenceInterface,
  ArchitectureAnalysisResult,
  ArchitectureComponent,
  EntrypointFinding,
  ArchitectureDependencyReport,
  TestAssociation,
  ArchitectureFinding,
} from "./types.ts";

export class ArchitectureAnalyzer implements ArchitectureIntelligenceInterface {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  private resolveScanIdAndRoot(
    repositoryId: number,
    scanId?: number,
  ): { resolvedScanId: number; rootPath: string } {
    const repoRow = this.db
      .prepare(
        "SELECT root_path AS rootPath, active_scan_id AS activeScanId FROM repositories WHERE id = ?",
      )
      .get(repositoryId) as { rootPath: string; activeScanId: number | null } | undefined;

    if (!repoRow) {
      throw new Error(`Repository with ID ${repositoryId} not found.`);
    }

    const resolvedScanId = scanId ?? repoRow.activeScanId;
    if (!resolvedScanId) {
      throw new Error(`No active scan run available for repository ${repositoryId}.`);
    }

    return { resolvedScanId, rootPath: repoRow.rootPath };
  }

  public async analyze(repositoryId: number, scanId?: number): Promise<ArchitectureAnalysisResult> {
    const { resolvedScanId, rootPath } = this.resolveScanIdAndRoot(repositoryId, scanId);

    // 1. Detect Entrypoints
    const entrypoints = EntrypointDetector.detect(this.db, repositoryId, resolvedScanId, rootPath);

    // 2. Detect Components
    const components = ComponentDetector.detect(this.db, repositoryId, resolvedScanId);

    // Persist components to database architecture_components table if not already saved
    this.persistComponents(repositoryId, resolvedScanId, components);

    // 3. Analyze Dependencies
    const dependencyReport = DependencyAnalyzer.analyze(this.db, repositoryId, resolvedScanId);

    // 4. Associate Tests
    const testAssociations = TestAssociationEngine.associate(this.db, repositoryId, resolvedScanId);

    // 5. Build Standard Findings conforming to Section 10 contract
    const findings: ArchitectureFinding[] = [];

    for (const ep of entrypoints) {
      findings.push({
        findingId: ep.entrypointId,
        repositoryId,
        scanId: resolvedScanId,
        category: "entrypoint",
        subjectEntity: ep.filePath,
        status: ep.status,
        confidence: ep.confidence,
        detectionMethod: "entrypoint_manifest_or_convention",
        evidenceDescription: ep.evidence,
        relevantFilePaths: [ep.filePath],
      });
    }

    for (const comp of components) {
      findings.push({
        findingId: comp.componentIdentity,
        repositoryId,
        scanId: resolvedScanId,
        category: "component",
        subjectEntity: comp.name,
        status: comp.status,
        confidence: comp.confidence,
        detectionMethod: comp.detectionMethod,
        evidenceDescription: comp.evidenceDescription,
        relevantFilePaths: comp.filePaths,
      });
    }

    for (const cycle of dependencyReport.circularDependencyCandidates) {
      findings.push({
        findingId: `cycle:${cycle.cycle.join("->")}`,
        repositoryId,
        scanId: resolvedScanId,
        category: "circular_dependency",
        subjectEntity: cycle.cycle[0],
        status: "CONFIRMED",
        confidence: 1.0,
        detectionMethod: "cycle_detection_dfs",
        evidenceDescription: `Circular import cycle detected: ${cycle.cycle.join(" -> ")}`,
        relevantFilePaths: cycle.cycle,
      });
    }

    for (const ta of testAssociations) {
      findings.push({
        findingId: `test_assoc:${ta.testFilePath}->${ta.sourceFilePath}`,
        repositoryId,
        scanId: resolvedScanId,
        category: "test_association",
        subjectEntity: ta.sourceFilePath,
        status: ta.associationStatus,
        confidence: ta.confidence,
        detectionMethod: ta.evidenceType,
        evidenceDescription: ta.evidenceDescription,
        relevantFilePaths: [ta.testFilePath, ta.sourceFilePath],
      });
    }

    return {
      repositoryId,
      scanId: resolvedScanId,
      analyzedAt: new Date().toISOString(),
      components,
      entrypoints,
      dependencyReport,
      testAssociations,
      findings,
    };
  }

  private persistComponents(
    repositoryId: number,
    scanId: number,
    components: ArchitectureComponent[],
  ): void {
    const insertStmt = this.db.prepare(
      `INSERT OR REPLACE INTO architecture_components (
        repository_id, scan_id, component_identity, name, category,
        root_path, detection_method, confidence, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const comp of components) {
        insertStmt.run(
          repositoryId,
          scanId,
          comp.componentIdentity,
          comp.name,
          comp.category,
          comp.rootPath,
          comp.detectionMethod,
          comp.confidence,
          comp.status,
          JSON.stringify({ filesCount: comp.filesCount }),
        );
      }
    });
  }

  public async getComponents(
    repositoryId: number,
    scanId?: number,
  ): Promise<ArchitectureComponent[]> {
    const { resolvedScanId } = this.resolveScanIdAndRoot(repositoryId, scanId);
    return ComponentDetector.detect(this.db, repositoryId, resolvedScanId);
  }

  public async getEntrypoints(repositoryId: number, scanId?: number): Promise<EntrypointFinding[]> {
    const { resolvedScanId, rootPath } = this.resolveScanIdAndRoot(repositoryId, scanId);
    return EntrypointDetector.detect(this.db, repositoryId, resolvedScanId, rootPath);
  }

  public async getDependencies(
    repositoryId: number,
    scanId?: number,
    options?: { fanoutThreshold?: number },
  ): Promise<ArchitectureDependencyReport> {
    const { resolvedScanId } = this.resolveScanIdAndRoot(repositoryId, scanId);
    return DependencyAnalyzer.analyze(this.db, repositoryId, resolvedScanId, options);
  }

  public async getTestAssociations(
    repositoryId: number,
    scanId?: number,
  ): Promise<TestAssociation[]> {
    const { resolvedScanId } = this.resolveScanIdAndRoot(repositoryId, scanId);
    return TestAssociationEngine.associate(this.db, repositoryId, resolvedScanId);
  }
}
