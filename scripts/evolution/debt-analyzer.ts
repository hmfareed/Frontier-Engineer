/**
 * Phase 7.5 Stage 4 — Deterministic Engineering Debt Analyzer
 * Detects and tracks 6 categories of technical/architectural debt across two snapshots:
 *   INTRODUCED | WORSENED | PERSISTING | RESOLVED
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { CycleAnalyzer } from "../architecture/cycle-analyzer.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import { TestAssociationEngine } from "../architecture/test-association.ts";
import type { MemoryLifecycleSummary } from "../memory/types.ts";
import { checkLayerViolation, extractComponentBoundaryEdges } from "./drift-detector.ts";
import type { AdrCorrelationFinding, DebtFinding, EvolutionAnalyzerOptions } from "./types.ts";

const PRODUCTION_COMPONENT_CATEGORIES = new Set([
  "frontend",
  "backend",
  "api",
  "database",
  "auth",
  "shared_lib",
]);

function isSourcePathForCoverage(filePath: string, classification: string): boolean {
  return (
    classification === "source" &&
    !filePath.includes(".test.") &&
    !filePath.includes(".spec.") &&
    !filePath.startsWith("tests/") &&
    !filePath.startsWith("test/")
  );
}

export class DebtAnalyzer {
  public static analyze(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    adrCorrelations: AdrCorrelationFinding[],
    memorySummary: MemoryLifecycleSummary,
    options: EvolutionAnalyzerOptions = {},
  ): DebtFinding[] {
    const items: DebtFinding[] = [];

    // 1. Circular dependencies (INTRODUCED, WORSENED, PERSISTING, RESOLVED)
    const baseCycles = CycleAnalyzer.analyze(db, repositoryId, baseScanId);
    const targetCycles = CycleAnalyzer.analyze(db, repositoryId, targetScanId);
    const sigOf = (cycle: string[]) => cycle.slice(0, -1).join(" -> ");

    const baseCycleMap = new Map(
      baseCycles.circularCandidates.map((c) => [sigOf(c.cycle), new Set(c.cycle.slice(0, -1))]),
    );
    const targetCycleMap = new Map(
      targetCycles.circularCandidates.map((c) => [sigOf(c.cycle), new Set(c.cycle.slice(0, -1))]),
    );

    const matchedExpandedBases = new Set<string>();
    for (const [sig, nodes] of targetCycleMap.entries()) {
      const length = nodes.size;
      const severity = length >= 4 ? "HIGH" : "MEDIUM";
      const paths = Array.from(nodes).sort((a, b) => a.localeCompare(b));

      if (baseCycleMap.has(sig)) {
        items.push({
          findingId: `debt:cycle:${sig}`,
          category: "DEBT_CIRCULAR_DEPENDENCY",
          state: "PERSISTING",
          title: `Persisting dependency cycle (${length} modules)`,
          description: `Circular dependency '${sig}' remains present across snapshots ${baseScanId} and ${targetScanId}`,
          severity,
          confidence: 1.0,
          confidenceTier: "CONFIRMED",
          subjectEntity: sig,
          baseMetric: length,
          targetMetric: length,
          relevantPaths: paths,
          details: { cycle: paths, length },
        });
      } else {
        const expandedFrom = Array.from(baseCycleMap.entries()).find(
          ([baseSig, baseNodes]) =>
            !targetCycleMap.has(baseSig) &&
            baseNodes.size < nodes.size &&
            Array.from(baseNodes).every((n) => nodes.has(n)),
        );
        if (expandedFrom) {
          matchedExpandedBases.add(expandedFrom[0]);
          items.push({
            findingId: `debt:cycle:${sig}`,
            category: "DEBT_CIRCULAR_DEPENDENCY",
            state: "WORSENED",
            title: `Expanded dependency cycle (${expandedFrom[1].size} -> ${length} modules)`,
            description: `Circular dependency '${expandedFrom[0]}' expanded to '${sig}'`,
            severity: "HIGH",
            confidence: 1.0,
            confidenceTier: "CONFIRMED",
            subjectEntity: sig,
            baseMetric: expandedFrom[1].size,
            targetMetric: length,
            relevantPaths: paths,
            details: { previousCycle: expandedFrom[0], cycle: paths, length },
          });
        } else {
          items.push({
            findingId: `debt:cycle:${sig}`,
            category: "DEBT_CIRCULAR_DEPENDENCY",
            state: "INTRODUCED",
            title: `Introduced dependency cycle (${length} modules)`,
            description: `New circular dependency '${sig}' introduced in scan ${targetScanId}`,
            severity,
            confidence: 1.0,
            confidenceTier: "CONFIRMED",
            subjectEntity: sig,
            baseMetric: 0,
            targetMetric: length,
            relevantPaths: paths,
            details: { cycle: paths, length },
          });
        }
      }
    }

    for (const [baseSig, baseNodes] of baseCycleMap.entries()) {
      if (targetCycleMap.has(baseSig) || matchedExpandedBases.has(baseSig)) continue;
      const paths = Array.from(baseNodes).sort((a, b) => a.localeCompare(b));
      items.push({
        findingId: `debt:cycle:${baseSig}`,
        category: "DEBT_CIRCULAR_DEPENDENCY",
        state: "RESOLVED",
        title: `Resolved dependency cycle (${baseNodes.size} modules)`,
        description: `Circular dependency '${baseSig}' resolved in scan ${targetScanId}`,
        severity: "INFO",
        confidence: 1.0,
        confidenceTier: "CONFIRMED",
        subjectEntity: baseSig,
        baseMetric: baseNodes.size,
        targetMetric: 0,
        relevantPaths: paths,
        details: { cycle: paths, previousLength: baseNodes.size },
      });
    }

    // 2. Unresolved imports per source file
    const queryUnresolved = (scanId: number) => {
      const rows = db
        .prepare(
          `SELECT f.normalized_path AS sourcePath, COUNT(*) AS count
           FROM imports i
           JOIN files f ON f.id = i.source_file_id
           WHERE i.repository_id = ? AND i.scan_id = ? AND i.resolution_status = 'UNRESOLVED'
           GROUP BY f.normalized_path`,
        )
        .all(repositoryId, scanId) as unknown as { sourcePath: string; count: number }[];
      return new Map(rows.map((r) => [r.sourcePath, r.count]));
    };

    const baseUnresolved = queryUnresolved(baseScanId);
    const targetUnresolved = queryUnresolved(targetScanId);
    const allUnresolvedPaths = Array.from(
      new Set([...baseUnresolved.keys(), ...targetUnresolved.keys()]),
    ).sort((a, b) => a.localeCompare(b));

    for (const sourcePath of allUnresolvedPaths) {
      const bCount = baseUnresolved.get(sourcePath) ?? 0;
      const tCount = targetUnresolved.get(sourcePath) ?? 0;
      const state =
        bCount === 0 && tCount > 0
          ? "INTRODUCED"
          : tCount > bCount
            ? "WORSENED"
            : tCount === 0 && bCount > 0
              ? "RESOLVED"
              : "PERSISTING";
      items.push({
        findingId: `debt:unresolved:${sourcePath}`,
        category: "DEBT_UNRESOLVED_IMPORTS",
        state,
        title: `Unresolved imports in ${sourcePath} (${bCount} -> ${tCount})`,
        description: `Module '${sourcePath}' has ${tCount} unresolved import(s) in scan ${targetScanId} (base: ${bCount})`,
        severity: state === "RESOLVED" ? "INFO" : tCount >= 3 ? "HIGH" : "MEDIUM",
        confidence: 0.95,
        confidenceTier: "CONFIRMED",
        subjectEntity: sourcePath,
        baseMetric: bCount,
        targetMetric: tCount,
        relevantPaths: [sourcePath],
        details: { sourcePath, baseUnresolvedCount: bCount, targetUnresolvedCount: tCount },
      });
    }

    // 3. High fan-out hotspots & 4. Layer boundary violations
    const baseBoundaryData = extractComponentBoundaryEdges(db, repositoryId, baseScanId);
    const targetBoundaryData = extractComponentBoundaryEdges(db, repositoryId, targetScanId);
    const fanoutThreshold = options.fanoutHotspotThreshold ?? 10;

    const allFanoutFiles = Array.from(
      new Set([...baseBoundaryData.fileFanOut.keys(), ...targetBoundaryData.fileFanOut.keys()]),
    ).sort((a, b) => a.localeCompare(b));

    for (const filePath of allFanoutFiles) {
      const bCount = baseBoundaryData.fileFanOut.get(filePath)?.size ?? 0;
      const tCount = targetBoundaryData.fileFanOut.get(filePath)?.size ?? 0;
      if (bCount < fanoutThreshold && tCount < fanoutThreshold) continue;

      const state =
        bCount < fanoutThreshold && tCount >= fanoutThreshold
          ? "INTRODUCED"
          : tCount >= fanoutThreshold && tCount > bCount
            ? "WORSENED"
            : tCount < fanoutThreshold && bCount >= fanoutThreshold
              ? "RESOLVED"
              : "PERSISTING";

      items.push({
        findingId: `debt:fanout:${filePath}`,
        category: "DEBT_HIGH_FANOUT_HOTSPOT",
        state,
        title: `High fan-out hotspot ${filePath} (${bCount} -> ${tCount})`,
        description: `Module '${filePath}' has ${tCount} internal dependencies (threshold: ${fanoutThreshold}, base: ${bCount})`,
        severity: state === "RESOLVED" ? "INFO" : tCount >= fanoutThreshold * 2 ? "HIGH" : "MEDIUM",
        confidence: 1.0,
        confidenceTier: "CONFIRMED",
        subjectEntity: filePath,
        baseMetric: bCount,
        targetMetric: tCount,
        relevantPaths: [filePath],
        details: { filePath, baseFanOut: bCount, targetFanOut: tCount, threshold: fanoutThreshold },
      });
    }

    const baseViolations = new Map<
      string,
      typeof baseBoundaryData.edges extends Map<string, infer V> ? V : never
    >();
    for (const [key, edge] of baseBoundaryData.edges.entries()) {
      if (checkLayerViolation(edge.sourceCategory, edge.targetCategory)) {
        baseViolations.set(key, edge);
      }
    }
    const targetViolations = new Map<
      string,
      typeof targetBoundaryData.edges extends Map<string, infer V> ? V : never
    >();
    for (const [key, edge] of targetBoundaryData.edges.entries()) {
      if (checkLayerViolation(edge.sourceCategory, edge.targetCategory)) {
        targetViolations.set(key, edge);
      }
    }

    const allViolationKeys = Array.from(
      new Set([...baseViolations.keys(), ...targetViolations.keys()]),
    ).sort((a, b) => a.localeCompare(b));

    for (const edgeKey of allViolationKeys) {
      const bEdge = baseViolations.get(edgeKey);
      const tEdge = targetViolations.get(edgeKey);
      const edge = tEdge ?? bEdge!;
      const rule = checkLayerViolation(edge.sourceCategory, edge.targetCategory)!;
      const state = !bEdge && tEdge ? "INTRODUCED" : bEdge && !tEdge ? "RESOLVED" : "PERSISTING";
      const bothConfirmed = edge.sourceConfirmed && edge.targetConfirmed;
      const paths = Array.from(
        new Set(edge.fileEdges.flatMap((fe) => [fe.sourcePath, fe.targetPath])),
      ).sort((a, b) => a.localeCompare(b));

      items.push({
        findingId: `debt:layer_violation:${edgeKey}`,
        category: "DEBT_LAYER_BOUNDARY_VIOLATION",
        state,
        title: `Layer boundary violation ${edgeKey} (${state.toLowerCase()})`,
        description: rule.reason,
        severity: state === "RESOLVED" ? "INFO" : rule.severity,
        confidence: bothConfirmed ? 0.95 : 0.75,
        confidenceTier: bothConfirmed ? "CONFIRMED" : "INFERRED",
        subjectEntity: edgeKey,
        baseMetric: bEdge ? bEdge.fileEdges.length : 0,
        targetMetric: tEdge ? tEdge.fileEdges.length : 0,
        relevantPaths: paths,
        details: {
          sourceComponentId: edge.sourceComponentId,
          targetComponentId: edge.targetComponentId,
          sourceCategory: edge.sourceCategory,
          targetCategory: edge.targetCategory,
        },
      });
    }

    // 5. Untested component growth (INFERRED heuristic backed by TestAssociationEngine)
    const getUntestedByComponent = (scanId: number) => {
      const comps = ComponentDetector.detect(db, repositoryId, scanId);
      const fileClasses = new Map(
        (
          db
            .prepare(
              "SELECT normalized_path AS path, classification FROM files WHERE repository_id = ? AND scan_id = ?",
            )
            .all(repositoryId, scanId) as unknown as { path: string; classification: string }[]
        ).map((r) => [r.path, r.classification]),
      );
      const testedSources = new Set(
        TestAssociationEngine.associate(db, repositoryId, scanId).map((a) => a.sourceFilePath),
      );
      const result = new Map<string, { untestedFiles: string[]; totalSourceFiles: number }>();
      for (const comp of comps) {
        if (!PRODUCTION_COMPONENT_CATEGORIES.has(comp.category)) continue;
        const sourceFiles = comp.filePaths.filter((p) =>
          isSourcePathForCoverage(p, fileClasses.get(p) ?? "source"),
        );
        if (sourceFiles.length === 0) continue;
        const untested = sourceFiles
          .filter((p) => !testedSources.has(p))
          .sort((a, b) => a.localeCompare(b));
        result.set(comp.componentIdentity, {
          untestedFiles: untested,
          totalSourceFiles: sourceFiles.length,
        });
      }
      return result;
    };

    const baseCoverage = getUntestedByComponent(baseScanId);
    const targetCoverage = getUntestedByComponent(targetScanId);
    const allCompIds = Array.from(new Set([...baseCoverage.keys(), ...targetCoverage.keys()])).sort(
      (a, b) => a.localeCompare(b),
    );

    for (const compId of allCompIds) {
      const bCov = baseCoverage.get(compId);
      const tCov = targetCoverage.get(compId);
      const bUntested = bCov ? bCov.untestedFiles.length : 0;
      const tUntested = tCov ? tCov.untestedFiles.length : 0;

      if (bUntested === 0 && tUntested === 0) continue;
      // If component existed with 0 untested files -> now > 0: INTRODUCED
      // If component already had > 0 and grew: WORSENED
      // If component had > 0 and dropped to 0: RESOLVED
      const state =
        bUntested === 0 && tUntested > 0
          ? "INTRODUCED"
          : tUntested > bUntested
            ? "WORSENED"
            : tUntested === 0 && bUntested > 0
              ? "RESOLVED"
              : "PERSISTING";

      const paths = (tCov?.untestedFiles.length ? tCov.untestedFiles : bCov?.untestedFiles) ?? [];
      items.push({
        findingId: `debt:untested:${compId}`,
        category: "DEBT_UNTESTED_COMPONENT_GROWTH",
        state,
        title: `Untested source files in ${compId} (${bUntested} -> ${tUntested})`,
        description: `Component '${compId}' has ${tUntested} source file(s) without associated test suites in scan ${targetScanId} (heuristic association; base: ${bUntested})`,
        severity: state === "RESOLVED" ? "INFO" : tUntested >= 3 ? "MEDIUM" : "LOW",
        confidence: 0.75,
        confidenceTier: "INFERRED",
        subjectEntity: compId,
        baseMetric: bUntested,
        targetMetric: tUntested,
        relevantPaths: paths,
        details: {
          componentIdentity: compId,
          baseUntestedCount: bUntested,
          targetUntestedCount: tUntested,
          untestedFiles: tCov?.untestedFiles ?? [],
        },
      });
    }

    // 6. Stale or disputed engineering memories & orphaned Accepted ADRs
    for (const mem of memorySummary.evaluations) {
      if (mem.proposedStatus === "STALE" || mem.proposedStatus === "DISPUTED") {
        const state = mem.previousStatus === "ACTIVE" ? "INTRODUCED" : "PERSISTING";
        items.push({
          findingId: `debt:memory:${mem.memoryKey}`,
          category: "DEBT_STALE_OR_DISPUTED_MEMORY",
          state,
          title: `${mem.proposedStatus} engineering memory: ${mem.memoryKey}`,
          description: mem.reason,
          severity: mem.proposedStatus === "DISPUTED" ? "HIGH" : "MEDIUM",
          confidence: 0.95,
          confidenceTier: "CONFIRMED",
          subjectEntity: mem.memoryKey,
          baseMetric: mem.previousStatus === "ACTIVE" ? 0 : 1,
          targetMetric: 1,
          relevantPaths: Array.from(new Set(mem.evidenceEvaluations.map((e) => e.sourcePath))).sort(
            (a, b) => a.localeCompare(b),
          ),
          details: {
            memoryId: mem.memoryId,
            memoryKey: mem.memoryKey,
            previousStatus: mem.previousStatus,
            proposedStatus: mem.proposedStatus,
          },
        });
      } else if (mem.action === "RECOVER_ACTIVE") {
        items.push({
          findingId: `debt:memory:${mem.memoryKey}`,
          category: "DEBT_STALE_OR_DISPUTED_MEMORY",
          state: "RESOLVED",
          title: `Recovered engineering memory: ${mem.memoryKey}`,
          description: mem.reason,
          severity: "INFO",
          confidence: 0.95,
          confidenceTier: "CONFIRMED",
          subjectEntity: mem.memoryKey,
          baseMetric: 1,
          targetMetric: 0,
          relevantPaths: Array.from(new Set(mem.evidenceEvaluations.map((e) => e.sourcePath))).sort(
            (a, b) => a.localeCompare(b),
          ),
          details: {
            memoryId: mem.memoryId,
            memoryKey: mem.memoryKey,
            previousStatus: mem.previousStatus,
            proposedStatus: mem.proposedStatus,
          },
        });
      }
    }

    for (const corr of adrCorrelations) {
      if (corr.correlationType === "DECISION_GOVERNED_COMPONENT_REMOVED") {
        items.push({
          findingId: `debt:adr_orphan:${corr.adrId}:${corr.componentIdentity}`,
          category: "DEBT_STALE_OR_DISPUTED_MEMORY",
          state: "INTRODUCED",
          title: `Orphaned Accepted ADR: ${corr.adrId} (${corr.componentIdentity})`,
          description: corr.description,
          severity: "HIGH",
          confidence: corr.confidence,
          confidenceTier: corr.confidenceTier,
          subjectEntity: corr.adrId ?? corr.findingId,
          baseMetric: 0,
          targetMetric: 1,
          relevantPaths: [...corr.relevantPaths],
          details: { ...corr.details },
        });
      }
    }

    items.sort((a, b) => a.findingId.localeCompare(b.findingId));
    return items;
  }
}
