/**
 * Phase 7.4 — Architecture Query Engine
 * Reusable, evidence-backed query layer for inspecting repository intelligence.
 */

import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { ConnectionManager } from "../storage/connection-manager.ts";
import { GraphEngine } from "../graph/graph-engine.ts";
import { GraphStore } from "../graph/graph-store.ts";
import { ArchitectureAnalyzer } from "../architecture/architecture-analyzer.ts";
import { AdrDetector } from "../architecture/adr-detector.ts";
import { CycleAnalyzer } from "../architecture/cycle-analyzer.ts";
import { TestAssociationEngine } from "../architecture/test-association.ts";
import { FreshnessEvaluator } from "./freshness-evaluator.ts";
import type {
  QueryResult,
  QueryOptions,
  TraversalQueryOptions,
  RepositoryStatusData,
  RepositoryOverviewData,
  ComponentListData,
  ComponentDetailData,
  EntrypointListData,
  FileDetailData,
  SymbolSearchResult,
  DependencyTraversalData,
  CycleData,
  TestAssociationData,
  DecisionListData,
  DecisionDetailData,
  FreshnessAssessment,
  FreshnessEvaluationOptions,
  SnapshotFreshnessStatus,
  ConfidenceTier,
  QueryEvidence,
  QueryLimitsApplied,
} from "./types.ts";
import type {
  RepositoryRecord,
  FileRecord,
  SymbolRecord,
  ImportRecord,
  ExportRecord,
} from "../storage/types.ts";
import type { ArchitectureComponent } from "../architecture/types.ts";

export class ArchitectureQueryEngine {
  private db: SqliteDatabase;
  private repository: RepositoryRecord;
  private rootPath: string;
  private graphEngine: GraphEngine;
  private architectureAnalyzer: ArchitectureAnalyzer;

  constructor(connectionManager: ConnectionManager) {
    this.db = connectionManager.getDatabase();
    this.repository = connectionManager.getRepository();
    this.rootPath = this.repository.rootPath;
    const graphStore = new GraphStore(this.db);
    this.graphEngine = new GraphEngine(this.db, graphStore);
    this.architectureAnalyzer = new ArchitectureAnalyzer(this.db);
  }

  private resolveScanId(explicitScanId?: number): { scanId: number; isHistorical: boolean } {
    if (explicitScanId !== undefined) {
      const scanRow = this.db
        .prepare("SELECT id FROM scan_runs WHERE repository_id = ? AND id = ?")
        .get(this.repository.id, explicitScanId) as { id: number } | undefined;
      if (!scanRow) {
        throw new Error(
          `Scan run ID ${explicitScanId} was not found for repository '${this.repository.identity}'.`,
        );
      }
      return { scanId: explicitScanId, isHistorical: true };
    }

    // Authoritative lookup from database repositories table
    const repoRow = this.db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(this.repository.id) as { active_scan_id: number | null } | undefined;

    const activeScanId = repoRow?.active_scan_id ?? this.repository.activeScanId;

    if (!activeScanId) {
      throw new Error(
        `No active scan index available for repository '${this.repository.identity}'. Run a scan to index.`,
      );
    }
    return { scanId: activeScanId, isHistorical: false };
  }

  private buildBaseResult<T>(params: {
    category: string;
    target?: string;
    parameters?: Record<string, unknown>;
    scanId: number;
    data: T;
    evidence?: QueryEvidence[];
    confidence?: ConfidenceTier;
    isMixedConfidence?: boolean;
    warnings?: string[];
    limits?: QueryLimitsApplied;
  }): QueryResult<T> {
    const freshness = FreshnessEvaluator.evaluate(
      this.db,
      this.repository.id,
      this.rootPath,
      params.scanId,
    );

    const warnings = [...(params.warnings ?? [])];
    if (freshness.isStale && freshness.staleReason) {
      warnings.push(`Warning: Index may be stale. ${freshness.staleReason}`);
    }
    if (freshness.isPartial) {
      warnings.push("Warning: Results are derived from a PARTIAL scan snapshot.");
    }

    // Verify evidence files on disk; missing/deleted files produce an honest warning
    if (params.evidence) {
      for (const ev of params.evidence) {
        if (ev.file && !ev.file.startsWith("comp:") && !ev.file.startsWith("pkg:")) {
          const fullPath = path.join(this.rootPath, ev.file);
          if (!fs.existsSync(fullPath)) {
            warnings.push(
              `Warning: Evidence file '${ev.file}' was not found on disk (may have been deleted or moved).`,
            );
          }
        }
      }
    }

    const scanRow = this.db
      .prepare("SELECT status FROM scan_runs WHERE repository_id = ? AND id = ?")
      .get(this.repository.id, params.scanId) as { status: string } | undefined;

    return {
      repositoryId: this.repository.id,
      repositoryIdentity: this.repository.identity,
      scanId: params.scanId,
      snapshotStatus: (scanRow?.status as SnapshotFreshnessStatus) ?? freshness.status,
      freshness,
      query: {
        category: params.category,
        target: params.target,
        parameters: params.parameters,
      },
      data: params.data,
      evidence: params.evidence ?? [],
      confidence: params.confidence ?? "CONFIRMED",
      isMixedConfidence: params.isMixedConfidence ?? false,
      warnings,
      limitsApplied: params.limits ?? { truncated: false },
      generatedAt: new Date().toISOString(),
    };
  }

  // 1. Status
  public async getStatus(): Promise<QueryResult<RepositoryStatusData>> {
    const scanId = this.repository.activeScanId ?? 0;
    const freshness = FreshnessEvaluator.evaluate(
      this.db,
      this.repository.id,
      this.rootPath,
      scanId || undefined,
    );

    let activeScanRow: { status: string; completedAt: string | null } | undefined;
    if (scanId > 0) {
      activeScanRow = this.db
        .prepare("SELECT status, completed_at AS completedAt FROM scan_runs WHERE id = ?")
        .get(scanId) as any;
    }

    const totalScans = this.db
      .prepare("SELECT COUNT(*) AS count FROM scan_runs WHERE repository_id = ?")
      .get(this.repository.id) as { count: number };

    const frontierDbPath = path.join(this.rootPath, ".frontier", "intelligence", "index.sqlite");

    const data: RepositoryStatusData = {
      repositoryIdentity: this.repository.identity,
      rootPath: this.rootPath,
      displayName: this.repository.displayName,
      databaseLocation: fs.existsSync(frontierDbPath)
        ? ".frontier/intelligence/index.sqlite"
        : ":memory:",
      schemaVersion: this.repository.schemaVersion,
      activeScanId: this.repository.activeScanId,
      activeScanStatus: activeScanRow?.status ?? null,
      lastSuccessfulIndexTime: activeScanRow?.completedAt ?? null,
      isFresh:
        !freshness.isStale && (freshness.status === "FRESH" || freshness.status === "COMPLETE"),
      isPartial: freshness.isPartial,
      stalenessReason: freshness.staleReason,
      totalScansCount: totalScans.count,
    };

    return this.buildBaseResult({
      category: "status",
      scanId,
      data,
    });
  }

  // 2. Overview
  public async getOverview(
    options: QueryOptions = {},
  ): Promise<QueryResult<RepositoryOverviewData>> {
    const { scanId } = this.resolveScanId(options.scanId);

    // Languages distribution
    const langRows = this.db
      .prepare(
        `SELECT language, COUNT(*) AS fileCount
         FROM files WHERE scan_id = ?
         GROUP BY language ORDER BY fileCount DESC`,
      )
      .all(scanId) as { language: string; fileCount: number }[];

    // Architecture analysis
    const analysis = await this.architectureAnalyzer.analyze(this.repository.id, scanId);

    // Detect package managers
    const packageManagers: string[] = [];
    if (fs.existsSync(path.join(this.rootPath, "package-lock.json"))) packageManagers.push("npm");
    if (fs.existsSync(path.join(this.rootPath, "pnpm-lock.yaml"))) packageManagers.push("pnpm");
    if (fs.existsSync(path.join(this.rootPath, "yarn.lock"))) packageManagers.push("yarn");
    if (
      fs.existsSync(path.join(this.rootPath, "bun.lockb")) ||
      fs.existsSync(path.join(this.rootPath, "bun.lock"))
    ) {
      packageManagers.push("bun");
    }
    if (fs.existsSync(path.join(this.rootPath, "Cargo.lock"))) packageManagers.push("cargo");
    if (fs.existsSync(path.join(this.rootPath, "poetry.lock"))) packageManagers.push("poetry");

    // Detect frameworks
    const frameworks = new Set<string>();
    for (const pkg of analysis.dependencyReport.externalPackages) {
      if (pkg === "react" || pkg === "react-dom") frameworks.add("React");
      if (pkg === "next") frameworks.add("Next.js");
      if (pkg === "vue") frameworks.add("Vue");
      if (pkg === "svelte") frameworks.add("Svelte");
      if (pkg === "express") frameworks.add("Express");
      if (pkg === "fastify") frameworks.add("Fastify");
      if (pkg === "hono") frameworks.add("Hono");
      if (pkg === "@nestjs/core") frameworks.add("NestJS");
      if (pkg === "vitest") frameworks.add("Vitest");
      if (pkg === "jest") frameworks.add("Jest");
      if (pkg === "tailwindcss") frameworks.add("TailwindCSS");
    }

    // Repository classification
    const hasMonorepoPackages = analysis.components.some(
      (c) => c.category === "shared_lib" && c.rootPath.startsWith("packages/"),
    );
    const hasFrontend = analysis.components.some((c) => c.category === "frontend");
    const hasBackend = analysis.components.some((c) => c.category === "backend");
    const hasCliEntry = analysis.entrypoints.some((e) => e.type === "cli");
    const hasLibEntry = analysis.entrypoints.some((e) => e.type === "library");

    let repoType: RepositoryOverviewData["repositoryType"] = "unknown";
    if (hasMonorepoPackages) repoType = "monorepo";
    else if (hasFrontend && hasBackend) repoType = "fullstack_app";
    else if (hasFrontend) repoType = "frontend_app";
    else if (hasBackend) repoType = "backend_service";
    else if (hasCliEntry) repoType = "cli";
    else if (hasLibEntry) repoType = "library";

    // Component counts by category
    const byCategory: Record<string, number> = {};
    for (const c of analysis.components) {
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    }

    // Counts
    const countsRow = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM files WHERE scan_id = ?) AS files,
          (SELECT COUNT(*) FROM symbols WHERE scan_id = ?) AS symbols,
          (SELECT COUNT(*) FROM graph_nodes WHERE scan_id = ?) AS nodes,
          (SELECT COUNT(*) FROM graph_edges WHERE scan_id = ?) AS edges`,
      )
      .get(scanId, scanId, scanId, scanId) as {
      files: number;
      symbols: number;
      nodes: number;
      edges: number;
    };

    // Test coverage summary
    const testSet = new Set(analysis.testAssociations.map((t) => t.testFilePath));
    const coveredSources = new Set(analysis.testAssociations.map((t) => t.sourceFilePath));
    const confirmedAssocs = analysis.testAssociations.filter(
      (t) => t.associationStatus === "CONFIRMED",
    ).length;

    const data: RepositoryOverviewData = {
      repositoryIdentity: this.repository.identity,
      displayName: this.repository.displayName,
      rootPath: this.rootPath,
      repositoryType: repoType,
      languages: langRows,
      frameworks: Array.from(frameworks).sort(),
      packageManagers,
      entrypoints: analysis.entrypoints.map((e) => ({
        path: e.filePath,
        type: e.type,
        status: e.status,
      })),
      componentsSummary: {
        totalComponents: analysis.components.length,
        byCategory,
      },
      dependencySummary: {
        totalInternalEdges: analysis.dependencyReport.totalInternalEdges,
        totalExternalPackages: analysis.dependencyReport.externalPackages.length,
        totalUnresolvedImports: analysis.dependencyReport.totalUnresolvedImports,
        circularCyclesCount: analysis.dependencyReport.circularDependencyCandidates.length,
      },
      testSummary: {
        totalTestsCount: testSet.size,
        coveredSourceFilesCount: coveredSources.size,
        confirmedAssociationsCount: confirmedAssocs,
        inferredAssociationsCount: analysis.testAssociations.length - confirmedAssocs,
      },
      counts: {
        files: countsRow.files,
        symbols: countsRow.symbols,
        nodes: countsRow.nodes,
        edges: countsRow.edges,
        decisions: analysis.decisions.length,
      },
    };

    const evidence: QueryEvidence[] = [
      ...analysis.entrypoints.map((e) => ({
        file: e.filePath,
        description: e.evidence,
        evidenceType: "entrypoint_declaration",
        confidence: e.confidence,
      })),
    ];

    return this.buildBaseResult({
      category: "overview",
      scanId,
      data,
      evidence,
      confidence: "CONFIRMED",
    });
  }

  // 3. Components List
  public async listComponents(options: QueryOptions = {}): Promise<QueryResult<ComponentListData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const components = await this.architectureAnalyzer.getComponents(this.repository.id, scanId);
    const totalCount = components.length;

    const paged = components.slice(offset, offset + limit);
    const truncated = offset + limit < totalCount;

    const items = paged.map((c) => ({
      identity: c.componentIdentity,
      name: c.name,
      category: c.category,
      status: c.status,
      confidence: c.confidence,
      filesCount: c.filesCount,
      rootPath: c.rootPath,
    }));

    const evidence: QueryEvidence[] = paged.map((c) => ({
      file: c.rootPath,
      description: c.evidenceDescription,
      evidenceType: c.detectionMethod,
      confidence: c.confidence,
    }));

    return this.buildBaseResult({
      category: "components",
      scanId,
      data: {
        components: items,
        totalCount,
      },
      evidence,
      confidence: items.every((i) => i.status === "CONFIRMED") ? "CONFIRMED" : "INFERRED",
      isMixedConfidence: !items.every((i) => i.status === "CONFIRMED"),
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 4. Component Detail
  public async getComponent(
    nameOrIdentity: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<ComponentDetailData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const components = await this.architectureAnalyzer.getComponents(this.repository.id, scanId);

    const norm = nameOrIdentity.trim().toLowerCase();
    const comp = components.find(
      (c) =>
        c.componentIdentity.toLowerCase() === norm ||
        c.name.toLowerCase() === norm ||
        c.rootPath.toLowerCase() === norm ||
        c.componentIdentity.toLowerCase() === `comp:${norm}` ||
        c.rootPath.toLowerCase() === norm.replace(/^\.\//, ""),
    );

    if (!comp) {
      throw new Error(`Component '${nameOrIdentity}' not found in active architecture index.`);
    }

    // Query symbols count across component files
    const fileIdRows = this.db
      .prepare(
        `SELECT id FROM files WHERE scan_id = ? AND (${comp.filePaths.map(() => "normalized_path = ?").join(" OR ")})`,
      )
      .all(scanId, ...comp.filePaths) as { id: number }[];

    let symbolsCount = 0;
    if (fileIdRows.length > 0) {
      const symRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM symbols
           WHERE scan_id = ? AND file_id IN (${fileIdRows.map(() => "?").join(",")})`,
        )
        .get(scanId, ...fileIdRows.map((f) => f.id)) as { count: number };
      symbolsCount = symRow.count;
    }

    // Dependencies of component: internal files imported outside this component, or packages
    const depRows = this.db
      .prepare(
        `SELECT DISTINCT
          i.imported_specifier AS specifier,
          i.resolution_status AS resolutionStatus,
          dst.normalized_path AS targetFile
         FROM imports i
         JOIN files src ON src.id = i.source_file_id
         LEFT JOIN files dst ON dst.id = i.resolved_file_id
         WHERE i.scan_id = ?
           AND src.id IN (${fileIdRows.map(() => "?").join(",")})
         ORDER BY i.imported_specifier ASC`,
      )
      .all(scanId, ...fileIdRows.map((f) => f.id)) as {
      specifier: string;
      resolutionStatus: string;
      targetFile: string | null;
    }[];

    const dependencies: ComponentDetailData["dependencies"] = [];
    const seenDeps = new Set<string>();

    for (const row of depRows) {
      if (row.resolutionStatus === "RESOLVED" && row.targetFile) {
        // Find which component owns targetFile
        const owningComp = components.find((other) => other.filePaths.includes(row.targetFile!));
        if (owningComp && owningComp.componentIdentity !== comp.componentIdentity) {
          if (!seenDeps.has(owningComp.componentIdentity)) {
            seenDeps.add(owningComp.componentIdentity);
            dependencies.push({
              target: owningComp.name,
              relationship: "IMPORTS_FROM",
              type: "component",
            });
          }
        } else if (!owningComp) {
          if (!seenDeps.has(row.targetFile)) {
            seenDeps.add(row.targetFile);
            dependencies.push({
              target: row.targetFile,
              relationship: "IMPORTS_FILE",
              type: "file",
            });
          }
        }
      } else if (row.resolutionStatus === "EXTERNAL" || row.resolutionStatus === "BUILTIN") {
        if (!seenDeps.has(row.specifier)) {
          seenDeps.add(row.specifier);
          dependencies.push({
            target: row.specifier,
            relationship: "DEPENDS_ON_PACKAGE",
            type: "package",
          });
        }
      }
    }

    // Dependents of component: files outside this component importing files in this component
    const dependentRows = this.db
      .prepare(
        `SELECT DISTINCT src.normalized_path AS sourceFile
         FROM imports i
         JOIN files src ON src.id = i.source_file_id
         WHERE i.scan_id = ?
           AND i.resolved_file_id IN (${fileIdRows.map(() => "?").join(",")})
           AND src.id NOT IN (${fileIdRows.map(() => "?").join(",")})
         ORDER BY src.normalized_path ASC`,
      )
      .all(scanId, ...fileIdRows.map((f) => f.id), ...fileIdRows.map((f) => f.id)) as {
      sourceFile: string;
    }[];

    const dependents: ComponentDetailData["dependents"] = [];
    const seenDependents = new Set<string>();
    for (const row of dependentRows) {
      const owningComp = components.find((other) => other.filePaths.includes(row.sourceFile));
      const depName = owningComp ? owningComp.name : row.sourceFile;
      if (!seenDependents.has(depName)) {
        seenDependents.add(depName);
        dependents.push({
          source: depName,
          relationship: "IMPORTED_BY",
        });
      }
    }

    // Associated tests
    const allAssocs = await this.architectureAnalyzer.getTestAssociations(
      this.repository.id,
      scanId,
    );
    const associatedTests = Array.from(
      new Set(
        allAssocs
          .filter((a) => comp.filePaths.includes(a.sourceFilePath))
          .map((a) => a.testFilePath),
      ),
    ).sort();

    // Associated ADRs
    const allAdrs = await this.architectureAnalyzer.getDecisions(this.repository.id, scanId);
    const associatedDecisions = allAdrs.filter(
      (adr) =>
        adr.governedComponents.includes(comp.componentIdentity) ||
        adr.governedComponents.includes(comp.name),
    );

    const data: ComponentDetailData = {
      component: comp,
      files: comp.filePaths,
      symbolsCount,
      dependencies,
      dependents,
      associatedTests,
      associatedDecisions,
    };

    const evidence: QueryEvidence[] = [
      {
        file: comp.rootPath,
        description: comp.evidenceDescription,
        evidenceType: comp.detectionMethod,
        confidence: comp.confidence,
      },
    ];

    return this.buildBaseResult({
      category: "component",
      target: comp.name,
      scanId,
      data,
      evidence,
      confidence: comp.status === "CONFIRMED" ? "CONFIRMED" : "INFERRED",
    });
  }

  // 5. Entrypoints
  public async getEntrypoints(
    options: QueryOptions = {},
  ): Promise<QueryResult<EntrypointListData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const entrypoints = await this.architectureAnalyzer.getEntrypoints(this.repository.id, scanId);

    const limit = options.limit ?? 100;
    const paged = entrypoints.slice(0, limit);
    const truncated = entrypoints.length > limit;

    const evidence: QueryEvidence[] = paged.map((e) => ({
      file: e.filePath,
      description: e.evidence,
      evidenceType: "entrypoint_manifest_or_convention",
      confidence: e.confidence,
    }));

    return this.buildBaseResult({
      category: "entrypoints",
      scanId,
      data: {
        entrypoints: paged,
        totalCount: entrypoints.length,
      },
      evidence,
      confidence: paged.every((e) => e.status === "CONFIRMED") ? "CONFIRMED" : "INFERRED",
      isMixedConfidence: !paged.every((e) => e.status === "CONFIRMED"),
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 6. File Detail
  public async getFile(
    filePath: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<FileDetailData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");

    const fileRow = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          relative_path AS relativePath, normalized_path AS normalizedPath,
          extension, language, classification, size_bytes AS sizeBytes,
          modified_at AS modifiedAt, content_hash AS contentHash,
          sensitivity_status AS sensitivityStatus, index_status AS indexStatus,
          indexed_at AS indexedAt
        FROM files
        WHERE scan_id = ? AND (normalized_path = ? OR relative_path = ?)`,
      )
      .get(scanId, normalized, normalized) as FileRecord | undefined;

    if (!fileRow) {
      throw new Error(`File '${filePath}' not found in active scan index.`);
    }

    const warnings: string[] = [];
    if (fileRow.sensitivityStatus === "SENSITIVE") {
      fileRow.contentHash = null;
      warnings.push(
        `Notice: Target file '${fileRow.normalizedPath}' is marked sensitive; content hash and symbol extraction are redacted.`,
      );
    }

    // Symbols
    const symbols = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_identity AS symbolIdentity,
          name, kind, scope, parent_symbol_id AS parentSymbolId,
          is_exported AS isExported, start_line AS startLine,
          end_line AS endLine, start_column AS startColumn,
          end_column AS endColumn, fingerprint, confidence,
          extraction_status AS extractionStatus
        FROM symbols
        WHERE scan_id = ? AND file_id = ?
        ORDER BY start_line ASC`,
      )
      .all(scanId, fileRow.id) as any[];

    // Imports
    const imports = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          source_file_id AS sourceFileId, imported_specifier AS importedSpecifier,
          import_kind AS importKind, resolved_file_id AS resolvedFileId,
          resolution_status AS resolutionStatus, start_line AS startLine,
          end_line AS endLine, evidence_id AS evidenceId
        FROM imports
        WHERE scan_id = ? AND source_file_id = ?
        ORDER BY start_line ASC`,
      )
      .all(scanId, fileRow.id) as unknown as ImportRecord[];

    // Exports
    const exports = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_id AS symbolId, export_name AS exportName,
          export_kind AS exportKind, is_default AS isDefault,
          start_line AS startLine, end_line AS endLine, evidence_id AS evidenceId
        FROM exports
        WHERE scan_id = ? AND file_id = ?
        ORDER BY start_line ASC`,
      )
      .all(scanId, fileRow.id) as any[];

    // Component association
    const components = await this.architectureAnalyzer.getComponents(this.repository.id, scanId);
    const owningComp = components.find((c) => c.filePaths.includes(fileRow.normalizedPath));

    // Related tests
    const allAssocs = await this.architectureAnalyzer.getTestAssociations(
      this.repository.id,
      scanId,
    );
    const relatedTests = allAssocs
      .filter((a) => a.sourceFilePath === fileRow.normalizedPath)
      .map((a) => a.testFilePath);

    const data: FileDetailData = {
      file: fileRow,
      componentAssociation: owningComp?.name,
      symbols: symbols.map((s) => ({ ...s, isExported: Boolean(s.isExported) })),
      imports,
      exports: exports.map((e) => ({ ...e, isDefault: Boolean(e.isDefault) })),
      relatedTests,
    };

    const evidence: QueryEvidence[] = [
      {
        file: fileRow.normalizedPath,
        description: `Source file indexed (Size: ${fileRow.sizeBytes} bytes, Language: ${fileRow.language})`,
        evidenceType: "file_inventory",
        confidence: 1.0,
      },
    ];

    return this.buildBaseResult({
      category: "file",
      target: fileRow.normalizedPath,
      scanId,
      data,
      evidence,
      confidence: "CONFIRMED",
      warnings,
    });
  }

  // 7. Symbol Search
  public async getSymbol(
    name: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<SymbolSearchResult>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const limit = options.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT
          s.id, s.repository_id AS repositoryId, s.scan_id AS scanId,
          s.file_id AS fileId, s.symbol_identity AS symbolIdentity,
          s.name, s.kind, s.scope, s.parent_symbol_id AS parentSymbolId,
          s.is_exported AS isExported, s.start_line AS startLine,
          s.end_line AS endLine, s.start_column AS startColumn,
          s.end_column AS endColumn, s.fingerprint, s.confidence,
          s.extraction_status AS extractionStatus,
          f.normalized_path AS filePath
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.scan_id = ? AND f.sensitivity_status = 'SAFE' AND (s.name = ? OR s.symbol_identity LIKE ?)
        ORDER BY s.is_exported DESC, s.name ASC
        LIMIT ?`,
      )
      .all(scanId, name, `%#${name}`, limit + 1) as any[];

    const truncated = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      ...r,
      isExported: Boolean(r.isExported),
    }));

    if (items.length === 0) {
      throw new Error(`Symbol '${name}' not found in active architecture index.`);
    }

    const evidence: QueryEvidence[] = items.map((s) => ({
      file: s.filePath,
      lineRange: [s.startLine, s.endLine],
      symbolOrEntity: s.symbolIdentity,
      description: `Declaration of ${s.kind} '${s.name}' (fingerprint: ${s.fingerprint.slice(0, 8)}...)`,
      evidenceType: "symbol_declaration",
      confidence: s.confidence,
    }));

    return this.buildBaseResult({
      category: "symbol",
      target: name,
      scanId,
      data: {
        symbols: items,
        totalMatches: items.length,
      },
      evidence,
      confidence: "CONFIRMED",
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 8. Dependencies
  public async getDependencies(
    target: string,
    options: TraversalQueryOptions = {},
  ): Promise<QueryResult<DependencyTraversalData>> {
    return this.traverseGraph(target, "dependencies", options);
  }

  // 9. Dependents
  public async getDependents(
    target: string,
    options: TraversalQueryOptions = {},
  ): Promise<QueryResult<DependencyTraversalData>> {
    return this.traverseGraph(target, "dependents", options);
  }

  private async traverseGraph(
    target: string,
    direction: "dependencies" | "dependents",
    options: TraversalQueryOptions = {},
  ): Promise<QueryResult<DependencyTraversalData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const depth = Math.min(Math.max(options.depth ?? 3, 1), 10);
    const limit = options.limit ?? 50;

    // Resolve target to node identity
    const cleanTarget = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    let nodeIdentity = cleanTarget;

    if (!cleanTarget.includes(":")) {
      // Check if it's a file
      const fileNode = this.db
        .prepare("SELECT node_identity FROM graph_nodes WHERE scan_id = ? AND node_identity = ?")
        .get(scanId, `file:${cleanTarget}`) as { node_identity: string } | undefined;

      if (fileNode) {
        nodeIdentity = fileNode.node_identity;
      } else {
        // Check component
        const compNode = this.db
          .prepare(
            "SELECT node_identity FROM graph_nodes WHERE scan_id = ? AND (node_identity = ? OR name = ?)",
          )
          .get(scanId, `comp:${cleanTarget}`, cleanTarget) as { node_identity: string } | undefined;
        if (compNode) {
          nodeIdentity = compNode.node_identity;
        } else {
          // Check package
          const pkgNode = this.db
            .prepare(
              "SELECT node_identity FROM graph_nodes WHERE scan_id = ? AND node_identity = ?",
            )
            .get(scanId, `pkg:${cleanTarget}`) as { node_identity: string } | undefined;
          if (pkgNode) {
            nodeIdentity = pkgNode.node_identity;
          } else {
            // Assume file:cleanTarget
            nodeIdentity = `file:${cleanTarget}`;
          }
        }
      }
    }

    const traversal =
      direction === "dependencies"
        ? await this.graphEngine.getDependencies(
            this.repository.id,
            nodeIdentity,
            { maxDepth: depth },
            scanId,
          )
        : await this.graphEngine.getDependents(
            this.repository.id,
            nodeIdentity,
            { maxDepth: depth },
            scanId,
          );

    // Split into direct (depth 1) and transitive (depth > 1)
    const direct: DependencyTraversalData["direct"] = [];
    const transitive: DependencyTraversalData["transitive"] = [];
    const seenDirect = new Set<string>();
    const seenTransitive = new Set<string>();

    for (const p of traversal.paths) {
      if (p.length === 0) continue;
      const step = p[p.length - 1];
      const itemNode = step.node;
      const edge = step.edge;
      const pathNodes = p.map((s) => s.node.name);

      if (step.depth === 1) {
        if (!seenDirect.has(itemNode.nodeIdentity)) {
          seenDirect.add(itemNode.nodeIdentity);
          direct.push({
            pathOrName: itemNode.name,
            nodeIdentity: itemNode.nodeIdentity,
            relationship: edge.relationshipType,
            depth: 1,
            confidence: edge.confidence,
            status: edge.relationshipStatus,
            path: [nodeIdentity, itemNode.nodeIdentity],
          });
        }
      } else {
        if (!seenTransitive.has(itemNode.nodeIdentity)) {
          seenTransitive.add(itemNode.nodeIdentity);
          transitive.push({
            pathOrName: itemNode.name,
            nodeIdentity: itemNode.nodeIdentity,
            relationship: edge.relationshipType,
            depth: step.depth,
            confidence: edge.confidence,
            status: edge.relationshipStatus,
            path: [nodeIdentity, ...pathNodes],
          });
        }
      }
    }

    // Unresolved imports related to target
    const unresolvedImports: string[] = [];
    if (direction === "dependencies" && nodeIdentity.startsWith("file:")) {
      const filePath = nodeIdentity.replace(/^file:/, "");
      const unres = await this.graphEngine.getUnresolvedImports(this.repository.id, scanId);
      for (const u of unres) {
        if (u.sourceFilePath === filePath) {
          unresolvedImports.push(u.importedSpecifier);
        }
      }
    }

    // Limit results if requested
    const totalFound = direct.length + transitive.length;
    const truncated = totalFound > limit;
    const boundedDirect = direct.slice(0, limit);
    const boundedTransitive = transitive.slice(0, Math.max(0, limit - boundedDirect.length));

    const data: DependencyTraversalData = {
      target: cleanTarget,
      targetIdentity: nodeIdentity,
      direction,
      direct: boundedDirect,
      transitive: boundedTransitive,
      unresolvedImports,
      hasCycles: traversal.hasCycles,
      depthReached: traversal.depthReached,
    };

    const evidence: QueryEvidence[] = boundedDirect.map((d) => ({
      file: d.nodeIdentity.replace(/^(file|comp|sym|pkg):/, ""),
      description: `${direction === "dependencies" ? "Depends on" : "Imported by"} ${d.pathOrName} via ${d.relationship}`,
      evidenceType: "graph_edge",
      confidence: d.confidence,
    }));

    return this.buildBaseResult({
      category: direction,
      target: cleanTarget,
      scanId,
      data,
      evidence,
      confidence: direct.every((d) => d.status === "CONFIRMED") ? "CONFIRMED" : "INFERRED",
      isMixedConfidence: !direct.every((d) => d.status === "CONFIRMED"),
      limits: {
        depthLimit: depth,
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 10. Cycles
  public async getCycles(options: QueryOptions = {}): Promise<QueryResult<CycleData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const cycleResult = CycleAnalyzer.analyze(this.db, this.repository.id, scanId);

    const limit = options.limit ?? 50;
    const pagedCycles = cycleResult.circularCandidates.slice(0, limit);
    const truncated = cycleResult.totalCycles > limit;

    const data: CycleData = {
      cycles: pagedCycles,
      stronglyConnectedComponents: cycleResult.stronglyConnectedComponents.filter((s) => s.isCycle),
      totalCycles: cycleResult.totalCycles,
    };

    const evidence: QueryEvidence[] = pagedCycles.map((c) => ({
      file: c.cycle[0],
      description: `Circular dependency loop: ${c.cycle.join(" -> ")}`,
      evidenceType: "tarjan_scc_elementary_cycle",
      confidence: 1.0,
    }));

    return this.buildBaseResult({
      category: "cycles",
      scanId,
      data,
      evidence,
      confidence: "CONFIRMED",
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 11. Tests
  public async getTests(
    target?: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<TestAssociationData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const allAssocs = await this.architectureAnalyzer.getTestAssociations(
      this.repository.id,
      scanId,
    );

    let filtered = allAssocs;
    if (target) {
      const clean = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
      filtered = allAssocs.filter(
        (a) =>
          a.sourceFilePath === clean ||
          a.testFilePath === clean ||
          a.sourceFilePath.includes(clean) ||
          a.testFilePath.includes(clean),
      );
    }

    // Find modules without test associations
    const sourceFiles = this.db
      .prepare(
        `SELECT normalized_path AS path FROM files
         WHERE scan_id = ?
           AND classification = 'source'
           AND NOT (normalized_path LIKE '%.test.%' OR normalized_path LIKE '%.spec.%' OR normalized_path LIKE 'tests/%')
         ORDER BY normalized_path ASC`,
      )
      .all(scanId) as { path: string }[];

    const testedSources = new Set(allAssocs.map((a) => a.sourceFilePath));
    const modulesWithoutTests = sourceFiles
      .filter((s) => !testedSources.has(s.path))
      .map((s) => s.path);

    const limit = options.limit ?? 100;
    const paged = filtered.slice(0, limit);
    const truncated = filtered.length > limit;

    const data: TestAssociationData = {
      associations: paged,
      totalAssociated: filtered.length,
      modulesWithoutTestAssociation: target ? [] : modulesWithoutTests.slice(0, 50),
    };

    const evidence: QueryEvidence[] = paged.map((a) => ({
      file: a.testFilePath,
      description: `${a.evidenceDescription} (exercises ${a.sourceFilePath})`,
      evidenceType: a.evidenceType,
      confidence: a.confidence,
    }));

    return this.buildBaseResult({
      category: "tests",
      target,
      scanId,
      data,
      evidence,
      confidence: paged.every((a) => a.associationStatus === "CONFIRMED")
        ? "CONFIRMED"
        : "INFERRED",
      isMixedConfidence: !paged.every((a) => a.associationStatus === "CONFIRMED"),
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 12. Decisions (ADRs)
  public async getDecisions(
    options: QueryOptions & { requireSha256?: boolean } = {},
  ): Promise<QueryResult<DecisionListData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const decisions = await this.architectureAnalyzer.getDecisions(this.repository.id, scanId, {
      requireSha256: options.requireSha256,
    });

    const limit = options.limit ?? 50;
    const paged = decisions.slice(0, limit);
    const truncated = decisions.length > limit;

    const data: DecisionListData = {
      decisions: paged,
      totalCount: decisions.length,
    };

    const unverifiedAdrs = paged.filter(
      (d) =>
        d.isFallback ||
        (d.verificationStatus !== undefined &&
          d.verificationStatus !== "CONFIRMED" &&
          d.verificationStatus !== "SNAPSHOT_METADATA" &&
          d.verificationStatus !== "LEGACY_ACTIVE_MOCK"),
    );

    const warnings: string[] = [];
    if (unverifiedAdrs.length > 0) {
      warnings.push(
        `Warning: ${unverifiedAdrs.length} ADR(s) in scan ${scanId} could not be SHA-256 verified against disk (fallback metadata returned).`,
      );
    }

    const evidence: QueryEvidence[] = paged.map((d) => ({
      file: d.filePath,
      description: d.evidenceDescription,
      evidenceType: d.isFallback ? "adr_snapshot_fallback" : "adr_document",
      confidence: d.confidence,
    }));

    return this.buildBaseResult({
      category: "decisions",
      scanId,
      data,
      evidence,
      confidence: unverifiedAdrs.length > 0 ? "INFERRED" : "CONFIRMED",
      isMixedConfidence: unverifiedAdrs.length > 0 && unverifiedAdrs.length < paged.length,
      warnings,
      limits: {
        resultLimit: limit,
        truncated,
      },
    });
  }

  // 13. Decision Detail
  public async getDecision(
    id: string,
    options: QueryOptions & { requireSha256?: boolean } = {},
  ): Promise<QueryResult<DecisionDetailData>> {
    const { scanId } = this.resolveScanId(options.scanId);
    const decisions = await this.architectureAnalyzer.getDecisions(this.repository.id, scanId, {
      requireSha256: options.requireSha256,
    });

    const norm = id.trim().toLowerCase().replace(/^adr:/, "");
    const match = decisions.find(
      (d) =>
        d.adrId.toLowerCase() === norm ||
        String(d.number) === norm ||
        d.adrId.toLowerCase() === `adr-${norm.padStart(3, "0")}` ||
        d.title.toLowerCase().includes(norm),
    );

    if (!match) {
      throw new Error(
        `Architecture Decision Record '${id}' not found in active architecture index.`,
      );
    }

    const allComponents = await this.architectureAnalyzer.getComponents(this.repository.id, scanId);
    const governed = allComponents.filter(
      (c) =>
        match.governedComponents.includes(c.componentIdentity) ||
        match.governedComponents.includes(c.name),
    );

    const data: DecisionDetailData = {
      decision: match,
      governedComponents: governed,
    };

    const isUnverified =
      match.isFallback ||
      (match.verificationStatus !== undefined &&
        match.verificationStatus !== "CONFIRMED" &&
        match.verificationStatus !== "SNAPSHOT_METADATA" &&
        match.verificationStatus !== "LEGACY_ACTIVE_MOCK");

    const warnings: string[] = [];
    if (isUnverified) {
      warnings.push(
        `Warning: ADR '${match.adrId}' in scan ${scanId} could not be SHA-256 verified against disk (fallback metadata returned).`,
      );
    }

    const evidence: QueryEvidence[] = [
      {
        file: match.filePath,
        description: match.evidenceDescription,
        evidenceType: match.isFallback ? "adr_snapshot_fallback" : "adr_document",
        confidence: match.confidence,
      },
    ];

    return this.buildBaseResult({
      category: "decision",
      target: match.adrId,
      scanId,
      data,
      evidence,
      confidence: isUnverified ? "INFERRED" : "CONFIRMED",
      warnings,
    });
  }

  // 14. Freshness Assessment
  public async getFreshness(
    options: QueryOptions & FreshnessEvaluationOptions = {},
  ): Promise<QueryResult<FreshnessAssessment>> {
    const { scanId } = this.resolveScanId(options.scanId ?? options.explicitScanId);
    const freshness = FreshnessEvaluator.evaluate(this.db, this.repository.id, this.rootPath, {
      explicitScanId: scanId,
      verifyContentHashes: options.verifyContentHashes,
    });

    return this.buildBaseResult({
      category: "freshness",
      scanId,
      data: freshness,
      confidence: "CONFIRMED",
    });
  }
}
