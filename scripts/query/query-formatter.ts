/**
 * Phase 7.4 — Architecture Query Result Formatter
 * Deterministic terminal and JSON formatters for repository intelligence outputs.
 */

import type {
  QueryResult,
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
} from "./types.ts";

export class QueryFormatter {
  public static formatJson(result: QueryResult<any>): string {
    return JSON.stringify(result, null, 2);
  }

  public static formatTerminal(result: QueryResult<any>): string {
    const lines: string[] = [];

    // Header Badge
    lines.push(
      `=== FRONTIER INTELLIGENCE: ${result.query.category.toUpperCase()}${result.query.target ? ` [${result.query.target}]` : ""} ===`,
    );
    lines.push(
      `Repository: ${result.repositoryIdentity} | Snapshot: ${result.scanId} (${result.snapshotStatus}) | Confidence: ${result.confidence}${result.isMixedConfidence ? " (Mixed)" : ""}`,
    );

    if (result.freshness.isStale && result.freshness.staleReason) {
      lines.push(`[STALE NOTICE] ${result.freshness.staleReason}`);
    }

    if (result.freshness.isPartial || result.snapshotStatus === "PARTIAL") {
      lines.push("[PARTIAL SNAPSHOT] Notice: Results are derived from a partial scan snapshot.");
    }

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        lines.push(`[WARNING] ${w}`);
      }
    }

    lines.push("");

    // Category Dispatch
    switch (result.query.category) {
      case "status":
        this.renderStatus(lines, result.data as RepositoryStatusData);
        break;
      case "overview":
        this.renderOverview(lines, result.data as RepositoryOverviewData);
        break;
      case "components":
        this.renderComponents(lines, result.data as ComponentListData);
        break;
      case "component":
        this.renderComponentDetail(lines, result.data as ComponentDetailData);
        break;
      case "entrypoints":
        this.renderEntrypoints(lines, result.data as EntrypointListData);
        break;
      case "file":
        this.renderFileDetail(lines, result.data as FileDetailData);
        break;
      case "symbol":
        this.renderSymbols(lines, result.data as SymbolSearchResult);
        break;
      case "dependencies":
      case "dependents":
        this.renderDependencies(lines, result.data as DependencyTraversalData);
        break;
      case "cycles":
        this.renderCycles(lines, result.data as CycleData);
        break;
      case "tests":
        this.renderTests(lines, result.data as TestAssociationData);
        break;
      case "decisions":
        this.renderDecisions(lines, result.data as DecisionListData);
        break;
      case "decision":
        this.renderDecisionDetail(lines, result.data as DecisionDetailData);
        break;
      case "freshness":
        this.renderFreshness(lines, result.data as FreshnessAssessment);
        break;
      default:
        lines.push(JSON.stringify(result.data, null, 2));
    }

    // Limits & Evidence summary
    if (result.limitsApplied.truncated) {
      lines.push("");
      lines.push(`[TRUNCATED] Result list reached limit. Use --limit to inspect more.`);
    }

    return lines.join("\n");
  }

  private static renderStatus(lines: string[], data: RepositoryStatusData): void {
    lines.push(`Repository Root:      ${data.rootPath}`);
    lines.push(`Database Location:    ${data.databaseLocation}`);
    lines.push(`Schema Version:       ${data.schemaVersion}`);
    lines.push(`Active Scan ID:       ${data.activeScanId ?? "None"}`);
    lines.push(`Active Scan Status:   ${data.activeScanStatus ?? "None"}`);
    lines.push(`Last Indexed Time:    ${data.lastSuccessfulIndexTime ?? "Never"}`);
    lines.push(
      `Index Fresh:          ${data.isFresh ? "YES (Up to date)" : "NO (Reindex required)"}`,
    );
    lines.push(`Total Scan Runs:      ${data.totalScansCount}`);
  }

  private static renderOverview(lines: string[], data: RepositoryOverviewData): void {
    lines.push(`Repository Name:     ${data.displayName}`);
    lines.push(`Repository Type:     ${data.repositoryType.toUpperCase()}`);
    lines.push(
      `Frameworks:          ${data.frameworks.length > 0 ? data.frameworks.join(", ") : "None detected"}`,
    );
    lines.push(
      `Package Managers:    ${data.packageManagers.length > 0 ? data.packageManagers.join(", ") : "None detected"}`,
    );
    lines.push("");

    lines.push(`Repository Totals:`);
    lines.push(
      `  Files: ${data.counts.files} | Symbols: ${data.counts.symbols} | Graph Nodes: ${data.counts.nodes} | Graph Edges: ${data.counts.edges} | Decisions: ${data.counts.decisions}`,
    );
    lines.push("");

    lines.push(`Languages:`);
    for (const l of data.languages) {
      lines.push(`  - ${l.language.padEnd(16)} : ${l.fileCount} file(s)`);
    }
    lines.push("");

    lines.push(`Component Boundaries (${data.componentsSummary.totalComponents} total):`);
    for (const [cat, cnt] of Object.entries(data.componentsSummary.byCategory)) {
      lines.push(`  - ${cat.padEnd(16)} : ${cnt} component(s)`);
    }
    lines.push("");

    lines.push(`Dependency Topology:`);
    lines.push(`  - Internal Import Edges: ${data.dependencySummary.totalInternalEdges}`);
    lines.push(`  - External Packages:     ${data.dependencySummary.totalExternalPackages}`);
    lines.push(`  - Unresolved Imports:    ${data.dependencySummary.totalUnresolvedImports}`);
    lines.push(`  - Circular Cycles:       ${data.dependencySummary.circularCyclesCount}`);
    lines.push("");

    lines.push(`Test Coverage Associations:`);
    lines.push(`  - Test Files:            ${data.testSummary.totalTestsCount}`);
    lines.push(`  - Covered Source Files:  ${data.testSummary.coveredSourceFilesCount}`);
    lines.push(`  - Confirmed Imports:     ${data.testSummary.confirmedAssociationsCount}`);
    lines.push(`  - Inferred Naming:       ${data.testSummary.inferredAssociationsCount}`);
  }

  private static renderComponents(lines: string[], data: ComponentListData): void {
    lines.push(`Discovered Architectural Components (${data.totalCount}):`);
    lines.push("");
    lines.push(`CATEGORY         STATUS     CONF   FILES  ROOT PATH`);
    lines.push(`----------------------------------------------------------------------`);
    for (const c of data.components) {
      const cat = c.category.padEnd(16);
      const st = c.status.padEnd(10);
      const conf = c.confidence.toFixed(2).padEnd(6);
      const files = String(c.filesCount).padStart(5);
      lines.push(`${cat} ${st} ${conf} ${files}  ${c.rootPath}`);
    }
  }

  private static renderComponentDetail(lines: string[], data: ComponentDetailData): void {
    const c = data.component;
    lines.push(`Component:           ${c.name} (${c.componentIdentity})`);
    lines.push(`Category:            ${c.category}`);
    lines.push(`Classification:      ${c.status} (Confidence: ${c.confidence.toFixed(2)})`);
    lines.push(`Root Path:           ${c.rootPath}`);
    lines.push(`Detection Method:    ${c.detectionMethod}`);
    lines.push(`Evidence:            ${c.evidenceDescription}`);
    lines.push(`Files:               ${data.files.length}`);
    lines.push(`Extracted Symbols:   ${data.symbolsCount}`);
    lines.push("");

    if (data.dependencies.length > 0) {
      lines.push(`Dependencies:`);
      for (const d of data.dependencies) {
        lines.push(`  -> [${d.type}] ${d.target} (${d.relationship})`);
      }
      lines.push("");
    }

    if (data.dependents.length > 0) {
      lines.push(`Dependents:`);
      for (const dep of data.dependents) {
        lines.push(`  <- ${dep.source} (${dep.relationship})`);
      }
      lines.push("");
    }

    if (data.associatedTests.length > 0) {
      lines.push(`Associated Tests:`);
      for (const t of data.associatedTests) {
        lines.push(`  - ${t}`);
      }
      lines.push("");
    }

    if (data.associatedDecisions.length > 0) {
      lines.push(`Governing Architecture Decisions:`);
      for (const d of data.associatedDecisions) {
        lines.push(`  - ${d.adrId}: ${d.title} (${d.status})`);
      }
      lines.push("");
    }

    lines.push(`Member Files (first 25):`);
    for (const f of data.files.slice(0, 25)) {
      lines.push(`  - ${f}`);
    }
    if (data.files.length > 25) {
      lines.push(`  ... and ${data.files.length - 25} more`);
    }
  }

  private static renderEntrypoints(lines: string[], data: EntrypointListData): void {
    lines.push(`Application Entrypoints (${data.totalCount}):`);
    lines.push("");
    lines.push(`TYPE       STATUS     CONF   EXPORTS  FILE PATH`);
    lines.push(`----------------------------------------------------------------------`);
    for (const e of data.entrypoints) {
      const type = e.type.toUpperCase().padEnd(10);
      const st = e.status.padEnd(10);
      const conf = e.confidence.toFixed(2).padEnd(6);
      const exp = String(e.exportCount).padStart(7);
      lines.push(`${type} ${st} ${conf} ${exp}  ${e.filePath}`);
      lines.push(`   Evidence: ${e.evidence}`);
    }
  }

  private static renderFileDetail(lines: string[], data: FileDetailData): void {
    const f = data.file;
    lines.push(`File Path:           ${f.normalizedPath}`);
    lines.push(`Classification:      ${f.classification}`);
    lines.push(`Language:            ${f.language} (${f.extension})`);
    lines.push(`Size:                ${f.sizeBytes} bytes`);
    lines.push(`Sensitivity:         ${f.sensitivityStatus}`);
    lines.push(`Component:           ${data.componentAssociation ?? "None detected"}`);
    lines.push("");

    lines.push(`Exports (${data.exports.length}):`);
    for (const exp of data.exports) {
      lines.push(`  - ${exp.exportName} (${exp.exportKind}) [line ${exp.startLine}]`);
    }
    lines.push("");

    lines.push(`Imports (${data.imports.length}):`);
    for (const imp of data.imports) {
      lines.push(
        `  - ${imp.importedSpecifier} -> ${imp.resolutionStatus} (${imp.importKind}) [line ${imp.startLine}]`,
      );
    }
    lines.push("");

    lines.push(`Symbols (${data.symbols.length}):`);
    for (const s of data.symbols.slice(0, 20)) {
      lines.push(
        `  - [${s.kind}] ${s.name} ${s.isExported ? "(exported)" : ""} [lines ${s.startLine}-${s.endLine}]`,
      );
    }
    if (data.symbols.length > 20) {
      lines.push(`  ... and ${data.symbols.length - 20} more`);
    }
    lines.push("");

    if (data.relatedTests.length > 0) {
      lines.push(`Associated Tests:`);
      for (const t of data.relatedTests) {
        lines.push(`  - ${t}`);
      }
    }
  }

  private static renderSymbols(lines: string[], data: SymbolSearchResult): void {
    lines.push(`Matching Symbols (${data.totalMatches}):`);
    lines.push("");
    lines.push(`KIND            NAME                      EXPORTED  LINE     FILE PATH`);
    lines.push(`--------------------------------------------------------------------------------`);
    for (const s of data.symbols) {
      const kind = s.kind.padEnd(15);
      const name = s.name.slice(0, 24).padEnd(25);
      const exp = (s.isExported ? "YES" : "NO").padEnd(9);
      const line = `${s.startLine}-${s.endLine}`.padStart(8);
      lines.push(`${kind} ${name} ${exp} ${line}  ${s.filePath}`);
    }
  }

  private static renderDependencies(lines: string[], data: DependencyTraversalData): void {
    lines.push(`Target Entity:       ${data.target} (${data.targetIdentity})`);
    lines.push(`Direction:           ${data.direction.toUpperCase()}`);
    lines.push(`Cycles Detected:     ${data.hasCycles ? "YES" : "NO"}`);
    lines.push(`Max Depth Reached:   ${data.depthReached}`);
    lines.push("");

    lines.push(`Direct Dependencies (Depth 1 - ${data.direct.length}):`);
    if (data.direct.length === 0) {
      lines.push(`  (None)`);
    } else {
      for (const d of data.direct) {
        lines.push(
          `  -> [${d.relationship}] ${d.pathOrName} (confidence: ${d.confidence.toFixed(2)}, status: ${d.status})`,
        );
      }
    }
    lines.push("");

    if (data.transitive.length > 0) {
      lines.push(`Transitive Dependencies (Depth > 1 - ${data.transitive.length}):`);
      for (const t of data.transitive.slice(0, 25)) {
        lines.push(`  -> (depth ${t.depth}) ${t.pathOrName} [Path: ${t.path.join(" -> ")}]`);
      }
      if (data.transitive.length > 25) {
        lines.push(`  ... and ${data.transitive.length - 25} more`);
      }
      lines.push("");
    }

    if (data.unresolvedImports.length > 0) {
      lines.push(`Unresolved Imports (${data.unresolvedImports.length}):`);
      for (const u of data.unresolvedImports) {
        lines.push(`  - ${u} [UNRESOLVED]`);
      }
    }
  }

  private static renderCycles(lines: string[], data: CycleData): void {
    lines.push(`Circular Dependency Loops (${data.totalCycles}):`);
    lines.push("");

    if (data.cycles.length === 0) {
      lines.push(`No circular dependency cycles detected in the active graph.`);
      return;
    }

    for (let i = 0; i < data.cycles.length; i++) {
      const c = data.cycles[i];
      lines.push(`Cycle #${i + 1} (Length: ${c.length}):`);
      lines.push(`  ${c.cycle.join(" -> ")}`);
    }

    lines.push("");
    lines.push(`Strongly Connected Components (${data.stronglyConnectedComponents.length}):`);
    for (const scc of data.stronglyConnectedComponents) {
      lines.push(`  [${scc.componentId}] Size: ${scc.size} modules: ${scc.nodes.join(", ")}`);
    }
  }

  private static renderTests(lines: string[], data: TestAssociationData): void {
    lines.push(`Test Associations (${data.totalAssociated}):`);
    lines.push("");
    lines.push(
      `TEST FILE                               SOURCE MODULE                     CONF  STATUS     METHOD`,
    );
    lines.push(
      `----------------------------------------------------------------------------------------------------------`,
    );
    for (const a of data.associations) {
      const test = a.testFilePath.slice(0, 39).padEnd(40);
      const src = a.sourceFilePath.slice(0, 33).padEnd(34);
      const conf = a.confidence.toFixed(2);
      const st = a.associationStatus.padEnd(10);
      lines.push(`${test} ${src} ${conf}  ${st} ${a.evidenceType}`);
    }

    if (data.modulesWithoutTestAssociation.length > 0) {
      lines.push("");
      lines.push(
        `Modules With No Detected Test Association (${data.modulesWithoutTestAssociation.length} shown):`,
      );
      for (const m of data.modulesWithoutTestAssociation.slice(0, 20)) {
        lines.push(`  - ${m}`);
      }
      if (data.modulesWithoutTestAssociation.length > 20) {
        lines.push(`  ... and ${data.modulesWithoutTestAssociation.length - 20} more`);
      }
    }
  }

  private static renderDecisions(lines: string[], data: DecisionListData): void {
    lines.push(`Architecture Decision Records (${data.totalCount}):`);
    lines.push("");
    lines.push(`ID        STATUS     PHASE  DATE        TITLE`);
    lines.push(`--------------------------------------------------------------------------------`);
    for (const d of data.decisions) {
      const id = d.adrId.padEnd(9);
      const st = d.status.padEnd(10);
      const ph = (d.phase ?? "-").padEnd(6);
      const dt = (d.date ?? "-").padEnd(11);
      lines.push(`${id} ${st} ${ph} ${dt} ${d.title}`);
      if (d.governedComponents.length > 0) {
        lines.push(`   Governs: ${d.governedComponents.join(", ")}`);
      }
    }
  }

  private static renderDecisionDetail(lines: string[], data: DecisionDetailData): void {
    const d = data.decision;
    lines.push(`Decision ID:         ${d.adrId}`);
    lines.push(`Title:               ${d.title}`);
    lines.push(`Status:              ${d.status}`);
    lines.push(`Phase:               ${d.phase ?? "N/A"}`);
    lines.push(`Date:                ${d.date ?? "N/A"}`);
    lines.push(`File Path:           ${d.filePath}`);
    lines.push(`Evidence:            ${d.evidenceDescription}`);
    lines.push("");

    if (data.governedComponents.length > 0) {
      lines.push(`Governed Components (${data.governedComponents.length}):`);
      for (const c of data.governedComponents) {
        lines.push(`  - ${c.name} (${c.category}) [${c.rootPath}]`);
      }
      lines.push("");
    }

    if (d.relatedDocuments.length > 0) {
      lines.push(`Related References:`);
      for (const r of d.relatedDocuments) {
        lines.push(`  - ${r}`);
      }
    }
  }

  private static renderFreshness(lines: string[], fresh: FreshnessAssessment): void {
    lines.push("--- Index Freshness Assessment ---");
    lines.push(`  Freshness Status : ${fresh.status}`);
    lines.push(`  Is Stale         : ${fresh.isStale ? "YES" : "NO"}`);
    lines.push(`  Is Partial       : ${fresh.isPartial ? "YES" : "NO"}`);
    lines.push(`  Active Scan ID   : ${fresh.activeScanId ?? "none"}`);
    lines.push(`  Last Indexed At  : ${fresh.lastIndexedAt ?? "never"}`);
    if (fresh.strategy) {
      lines.push(`  Strategy         : ${fresh.strategy}`);
    }
    if (fresh.checkedFilesCount !== undefined) {
      lines.push(`  Files Checked    : ${fresh.checkedFilesCount}`);
    }
    if (fresh.staleReason) {
      lines.push(`  Staleness Reason : ${fresh.staleReason}`);
    }
    if (fresh.disclosures && fresh.disclosures.length > 0) {
      lines.push("  Disclosures      :");
      for (const disc of fresh.disclosures) {
        lines.push(`    - ${disc}`);
      }
    }
    if (fresh.limitations && fresh.limitations.length > 0) {
      lines.push("  Limitations      :");
      for (const lim of fresh.limitations) {
        lines.push(`    - ${lim}`);
      }
    }
  }
}
