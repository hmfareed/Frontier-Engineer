/**
 * Phase 7.5 Stage 4 — Architectural Drift Detector
 * Detects component boundary changes, layer violations, cycle/SCC evolution,
 * and coupling hotspots across two snapshots.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { EvolutionSeverity } from "../storage/types.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import { CycleAnalyzer } from "../architecture/cycle-analyzer.ts";
import type { ArchitectureComponent } from "../architecture/types.ts";
import { AdrDiffEngine, type ResolvedAdrEntry } from "./adr-diff.ts";
import type { DriftFinding, EvolutionAnalyzerOptions, SnapshotComparison } from "./types.ts";

export interface ComponentBoundaryEdge {
  edgeKey: string;
  sourceComponentId: string;
  targetComponentId: string;
  sourceCategory: string;
  targetCategory: string;
  sourceConfirmed: boolean;
  targetConfirmed: boolean;
  fileEdges: { sourcePath: string; targetPath: string; startLine: number }[];
}

export interface LayerViolationRule {
  severity: EvolutionSeverity;
  reason: string;
}

const PRODUCTION_CATEGORIES = new Set([
  "frontend",
  "backend",
  "api",
  "database",
  "auth",
  "shared_lib",
]);

export function checkLayerViolation(
  sourceCategory: string,
  targetCategory: string,
): LayerViolationRule | null {
  if (sourceCategory === "frontend" && targetCategory === "database") {
    return {
      severity: "HIGH",
      reason:
        "Frontend component directly imports database layer, bypassing API/backend boundaries",
    };
  }
  if (
    sourceCategory === "shared_lib" &&
    (targetCategory === "frontend" || targetCategory === "backend" || targetCategory === "api")
  ) {
    return {
      severity: "MEDIUM",
      reason: `Shared library depends upward on application layer (${targetCategory})`,
    };
  }
  if (PRODUCTION_CATEGORIES.has(sourceCategory) && targetCategory === "test") {
    return {
      severity: "HIGH",
      reason: `Production component (${sourceCategory}) imports test module`,
    };
  }
  if (sourceCategory === "docs" && PRODUCTION_CATEGORIES.has(targetCategory)) {
    return {
      severity: "LOW",
      reason: `Documentation module imports production component (${targetCategory})`,
    };
  }
  return null;
}

export function extractComponentBoundaryEdges(
  db: SqliteDatabase,
  repositoryId: number,
  scanId: number,
): {
  components: ArchitectureComponent[];
  edges: Map<string, ComponentBoundaryEdge>;
  fileFanOut: Map<string, Set<string>>;
} {
  const components = ComponentDetector.detect(db, repositoryId, scanId);
  const fileToComp = new Map<string, ArchitectureComponent>();
  for (const comp of components) {
    for (const fp of comp.filePaths) {
      fileToComp.set(fp, comp);
    }
  }

  const importRows = db
    .prepare(
      `SELECT
        src.normalized_path AS sourcePath,
        dst.normalized_path AS targetPath,
        i.start_line AS startLine
       FROM imports i
       JOIN files src ON src.id = i.source_file_id
       JOIN files dst ON dst.id = i.resolved_file_id
       WHERE i.repository_id = ? AND i.scan_id = ? AND i.resolution_status = 'RESOLVED'
       ORDER BY src.normalized_path ASC, dst.normalized_path ASC, i.start_line ASC`,
    )
    .all(repositoryId, scanId) as unknown as {
    sourcePath: string;
    targetPath: string;
    startLine: number;
  }[];

  const edges = new Map<string, ComponentBoundaryEdge>();
  const fileFanOut = new Map<string, Set<string>>();

  for (const row of importRows) {
    if (!fileFanOut.has(row.sourcePath)) {
      fileFanOut.set(row.sourcePath, new Set());
    }
    fileFanOut.get(row.sourcePath)!.add(row.targetPath);

    const srcComp = fileToComp.get(row.sourcePath);
    const dstComp = fileToComp.get(row.targetPath);
    if (!srcComp || !dstComp || srcComp.componentIdentity === dstComp.componentIdentity) {
      continue;
    }

    const edgeKey = `${srcComp.componentIdentity}->${dstComp.componentIdentity}`;
    if (!edges.has(edgeKey)) {
      edges.set(edgeKey, {
        edgeKey,
        sourceComponentId: srcComp.componentIdentity,
        targetComponentId: dstComp.componentIdentity,
        sourceCategory: srcComp.category,
        targetCategory: dstComp.category,
        sourceConfirmed: srcComp.status === "CONFIRMED",
        targetConfirmed: dstComp.status === "CONFIRMED",
        fileEdges: [],
      });
    }
    edges.get(edgeKey)!.fileEdges.push({
      sourcePath: row.sourcePath,
      targetPath: row.targetPath,
      startLine: row.startLine,
    });
  }

  return { components, edges, fileFanOut };
}

export function findCorroboratingAcceptedAdr(
  acceptedAdrs: ResolvedAdrEntry[],
  sourceComponentId: string,
  targetComponentId: string,
  sourceCategory: string,
  targetCategory: string,
): ResolvedAdrEntry | undefined {
  for (const adr of acceptedAdrs) {
    if (adr.isFallback) continue;
    const governsEndpoint =
      adr.governedComponents.includes(sourceComponentId) ||
      adr.governedComponents.includes(targetComponentId);
    if (!governsEndpoint) continue;
    const text = `${adr.title} ${adr.evidenceDescription} ${adr.rawContent ?? ""}`.toLowerCase();
    const mentionsBoundaryConstraint =
      /\b(layer|boundary|forbid|prohibit|disallow|must not|cannot import|bypass|no direct)\b/i.test(
        text,
      );
    const mentionsCategories =
      text.includes(sourceCategory.toLowerCase()) ||
      text.includes(targetCategory.toLowerCase()) ||
      text.includes(sourceComponentId.replace(/^comp:/, "").toLowerCase()) ||
      text.includes(targetComponentId.replace(/^comp:/, "").toLowerCase());
    if (mentionsBoundaryConstraint && mentionsCategories) {
      return adr;
    }
  }
  return undefined;
}

export class DriftDetector {
  public static detect(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    comparison: SnapshotComparison,
    options: EvolutionAnalyzerOptions = {},
  ): DriftFinding[] {
    const findings: DriftFinding[] = [];
    const baseData = extractComponentBoundaryEdges(db, repositoryId, baseScanId);
    const targetData = extractComponentBoundaryEdges(db, repositoryId, targetScanId);

    const historicalAdrs = AdrDiffEngine.resolveHistoricalAdrs(
      db,
      repositoryId,
      targetScanId,
      options.workspaceRoot,
    );
    const acceptedAdrs = historicalAdrs.adrs.filter(
      (a) => !a.isFallback && a.status && /\baccepted\b/i.test(a.status),
    );

    const baseCompById = new Map(baseData.components.map((c) => [c.componentIdentity, c]));
    const targetCompById = new Map(targetData.components.map((c) => [c.componentIdentity, c]));

    // 1. Component additions, removals, and reclassifications
    for (const compDiff of comparison.components.changes) {
      if (compDiff.changeType === "ADDED") {
        const isConfirmed = compDiff.targetStatus === "CONFIRMED";
        findings.push({
          findingId: `drift:comp_added:${compDiff.componentIdentity}`,
          driftType: "DRIFT_COMPONENT_ADDED",
          title: `Component added: ${compDiff.name} (${compDiff.category})`,
          description: `New architectural component '${compDiff.componentIdentity}' (${compDiff.category}) appeared in scan ${targetScanId}`,
          severity: "INFO",
          confidence: compDiff.targetConfidence ?? (isConfirmed ? 0.95 : 0.75),
          confidenceTier: isConfirmed
            ? "CONFIRMED"
            : compDiff.targetStatus === "CANDIDATE"
              ? "CANDIDATE"
              : "INFERRED",
          subjectEntity: compDiff.componentIdentity,
          relevantPaths: [...compDiff.addedMemberFiles],
          details: {
            componentIdentity: compDiff.componentIdentity,
            category: compDiff.category,
            status: compDiff.targetStatus,
            filesAdded: compDiff.addedMemberFiles.length,
          },
          evidenceIds: compDiff.evidenceId ? [compDiff.evidenceId] : [],
        });
      } else if (compDiff.changeType === "REMOVED") {
        const isConfirmed = compDiff.baseStatus === "CONFIRMED";
        findings.push({
          findingId: `drift:comp_removed:${compDiff.componentIdentity}`,
          driftType: "DRIFT_COMPONENT_REMOVED",
          title: `Component removed: ${compDiff.name} (${compDiff.category})`,
          description: `Architectural component '${compDiff.componentIdentity}' was removed in scan ${targetScanId}`,
          severity: isConfirmed ? "MEDIUM" : "LOW",
          confidence: compDiff.baseConfidence ?? (isConfirmed ? 0.95 : 0.75),
          confidenceTier: isConfirmed ? "CONFIRMED" : "INFERRED",
          subjectEntity: compDiff.componentIdentity,
          relevantPaths: [...compDiff.removedMemberFiles],
          details: {
            componentIdentity: compDiff.componentIdentity,
            category: compDiff.category,
            status: compDiff.baseStatus,
            filesRemoved: compDiff.removedMemberFiles.length,
          },
          evidenceIds: compDiff.evidenceId ? [compDiff.evidenceId] : [],
        });
      } else if (compDiff.changeType === "MODIFIED") {
        const baseComp = baseCompById.get(compDiff.componentIdentity);
        const targetComp = targetCompById.get(compDiff.componentIdentity);
        if (baseComp && targetComp && baseComp.category !== targetComp.category) {
          findings.push({
            findingId: `drift:comp_reclass:${compDiff.componentIdentity}`,
            driftType: "DRIFT_COMPONENT_RECLASSIFIED",
            title: `Component reclassified: ${compDiff.componentIdentity} (${baseComp.category} -> ${targetComp.category})`,
            description: `Component '${compDiff.componentIdentity}' shifted inferred category from '${baseComp.category}' to '${targetComp.category}'`,
            severity: "MEDIUM",
            confidence: Math.min(0.85, baseComp.confidence, targetComp.confidence),
            confidenceTier: "INFERRED",
            subjectEntity: compDiff.componentIdentity,
            relevantPaths: [...targetComp.filePaths],
            details: {
              componentIdentity: compDiff.componentIdentity,
              baseCategory: baseComp.category,
              targetCategory: targetComp.category,
              baseStatus: baseComp.status,
              targetStatus: targetComp.status,
              basis: "directory_classification_heuristic",
            },
            evidenceIds: compDiff.evidenceId ? [compDiff.evidenceId] : [],
          });
        }
      }
    }

    // 2. Cross-component boundary edge drift & layer violations
    const sortedTargetKeys = Array.from(targetData.edges.keys()).sort((a, b) => a.localeCompare(b));
    for (const edgeKey of sortedTargetKeys) {
      const targetEdge = targetData.edges.get(edgeKey)!;
      if (!baseData.edges.has(edgeKey)) {
        const bothExisted =
          baseCompById.has(targetEdge.sourceComponentId) &&
          baseCompById.has(targetEdge.targetComponentId);
        const bothConfirmed = targetEdge.sourceConfirmed && targetEdge.targetConfirmed;
        const paths = Array.from(
          new Set(targetEdge.fileEdges.flatMap((fe) => [fe.sourcePath, fe.targetPath])),
        ).sort((a, b) => a.localeCompare(b));

        if (bothExisted) {
          findings.push({
            findingId: `drift:boundary_created:${edgeKey}`,
            driftType: "DRIFT_COMPONENT_BOUNDARY_CREATED",
            title: `Cross-component dependency created: ${edgeKey}`,
            description: `New cross-component import dependency established from '${targetEdge.sourceComponentId}' (${targetEdge.sourceCategory}) to '${targetEdge.targetComponentId}' (${targetEdge.targetCategory})`,
            severity: "LOW",
            confidence: bothConfirmed ? 0.95 : 0.75,
            confidenceTier: bothConfirmed ? "CONFIRMED" : "INFERRED",
            subjectEntity: edgeKey,
            relevantPaths: paths,
            details: {
              sourceComponentId: targetEdge.sourceComponentId,
              targetComponentId: targetEdge.targetComponentId,
              sourceCategory: targetEdge.sourceCategory,
              targetCategory: targetEdge.targetCategory,
              fileEdges: targetEdge.fileEdges,
            },
            evidenceIds: [],
          });
        }

        const violation = checkLayerViolation(targetEdge.sourceCategory, targetEdge.targetCategory);
        if (violation) {
          const governingAdr = findCorroboratingAcceptedAdr(
            acceptedAdrs,
            targetEdge.sourceComponentId,
            targetEdge.targetComponentId,
            targetEdge.sourceCategory,
            targetEdge.targetCategory,
          );
          const isAdrConfirmed = Boolean(
            governingAdr && targetEdge.sourceConfirmed && targetEdge.targetConfirmed,
          );
          findings.push({
            findingId: `drift:layer_violation:${edgeKey}`,
            driftType: "DRIFT_LAYER_VIOLATION_INTRODUCED",
            title: `Layer violation introduced: ${edgeKey}`,
            description: isAdrConfirmed
              ? `${violation.reason} (${edgeKey}; governed by Accepted ${governingAdr!.adrId})`
              : `Heuristic layer rule: ${violation.reason} (${edgeKey}; uncorroborated by an Accepted ADR)`,
            severity: violation.severity,
            confidence: isAdrConfirmed ? 0.95 : bothConfirmed ? 0.8 : 0.65,
            confidenceTier: isAdrConfirmed ? "CONFIRMED" : "INFERRED",
            subjectEntity: edgeKey,
            relevantPaths: paths,
            details: {
              sourceComponentId: targetEdge.sourceComponentId,
              targetComponentId: targetEdge.targetComponentId,
              sourceCategory: targetEdge.sourceCategory,
              targetCategory: targetEdge.targetCategory,
              fileEdges: targetEdge.fileEdges,
              basis: isAdrConfirmed ? "accepted_adr_rule" : "heuristic_layer_rule",
              governingAdrId: governingAdr?.adrId,
            },
            evidenceIds: [],
          });
        }
      }
    }

    const sortedBaseKeys = Array.from(baseData.edges.keys()).sort((a, b) => a.localeCompare(b));
    for (const edgeKey of sortedBaseKeys) {
      if (!targetData.edges.has(edgeKey)) {
        const baseEdge = baseData.edges.get(edgeKey)!;
        if (
          targetCompById.has(baseEdge.sourceComponentId) &&
          targetCompById.has(baseEdge.targetComponentId)
        ) {
          const bothConfirmed = baseEdge.sourceConfirmed && baseEdge.targetConfirmed;
          const paths = Array.from(
            new Set(baseEdge.fileEdges.flatMap((fe) => [fe.sourcePath, fe.targetPath])),
          ).sort((a, b) => a.localeCompare(b));

          findings.push({
            findingId: `drift:boundary_removed:${edgeKey}`,
            driftType: "DRIFT_COMPONENT_BOUNDARY_REMOVED",
            title: `Cross-component dependency removed: ${edgeKey}`,
            description: `Cross-component dependency '${edgeKey}' was eliminated in scan ${targetScanId}`,
            severity: "INFO",
            confidence: bothConfirmed ? 0.95 : 0.75,
            confidenceTier: bothConfirmed ? "CONFIRMED" : "INFERRED",
            subjectEntity: edgeKey,
            relevantPaths: paths,
            details: {
              sourceComponentId: baseEdge.sourceComponentId,
              targetComponentId: baseEdge.targetComponentId,
              fileEdges: baseEdge.fileEdges,
            },
            evidenceIds: [],
          });
        }
      }
    }

    // 3. Cycle & SCC evolution
    const baseCycles = CycleAnalyzer.analyze(db, repositoryId, baseScanId);
    const targetCycles = CycleAnalyzer.analyze(db, repositoryId, targetScanId);

    const cycleSig = (cycle: string[]) => cycle.slice(0, -1).join(" -> ");
    const baseCycleNodes = baseCycles.circularCandidates.map((c) => ({
      sig: cycleSig(c.cycle),
      nodes: new Set(c.cycle.slice(0, -1)),
      cycle: c.cycle,
    }));
    const targetCycleNodes = targetCycles.circularCandidates.map((c) => ({
      sig: cycleSig(c.cycle),
      nodes: new Set(c.cycle.slice(0, -1)),
      cycle: c.cycle,
    }));

    const baseSigSet = new Set(baseCycleNodes.map((c) => c.sig));
    const targetSigSet = new Set(targetCycleNodes.map((c) => c.sig));
    const expandedFromBaseSigs = new Set<string>();

    for (const tc of targetCycleNodes) {
      if (baseSigSet.has(tc.sig)) continue;

      const expandedBase = baseCycleNodes.find(
        (bc) =>
          !targetSigSet.has(bc.sig) &&
          bc.nodes.size < tc.nodes.size &&
          Array.from(bc.nodes).every((n) => tc.nodes.has(n)),
      );

      if (expandedBase) {
        expandedFromBaseSigs.add(expandedBase.sig);
        findings.push({
          findingId: `drift:cycle_expanded:${tc.sig}`,
          driftType: "DRIFT_CYCLE_EXPANDED",
          title: `Dependency cycle expanded (${expandedBase.nodes.size} -> ${tc.nodes.size} modules)`,
          description: `Circular dependency '${expandedBase.sig}' expanded to '${tc.sig}'`,
          severity: "HIGH",
          confidence: 1.0,
          confidenceTier: "CONFIRMED",
          subjectEntity: tc.sig,
          relevantPaths: Array.from(tc.nodes).sort((a, b) => a.localeCompare(b)),
          details: {
            previousCycle: expandedBase.cycle,
            cycle: tc.cycle,
            previousLength: expandedBase.nodes.size,
            length: tc.nodes.size,
          },
          evidenceIds: [],
        });
      } else {
        findings.push({
          findingId: `drift:cycle_introduced:${tc.sig}`,
          driftType: "DRIFT_CYCLE_INTRODUCED",
          title: `Circular dependency introduced (${tc.nodes.size} modules)`,
          description: `New circular import cycle detected: ${tc.cycle.join(" -> ")}`,
          severity: "HIGH",
          confidence: 1.0,
          confidenceTier: "CONFIRMED",
          subjectEntity: tc.sig,
          relevantPaths: Array.from(tc.nodes).sort((a, b) => a.localeCompare(b)),
          details: {
            cycle: tc.cycle,
            length: tc.nodes.size,
          },
          evidenceIds: [],
        });
      }
    }

    for (const bc of baseCycleNodes) {
      if (targetSigSet.has(bc.sig) || expandedFromBaseSigs.has(bc.sig)) continue;
      findings.push({
        findingId: `drift:cycle_resolved:${bc.sig}`,
        driftType: "DRIFT_CYCLE_RESOLVED",
        title: `Circular dependency resolved (${bc.nodes.size} modules)`,
        description: `Previously existing circular import cycle was broken: ${bc.cycle.join(" -> ")}`,
        severity: "INFO",
        confidence: 1.0,
        confidenceTier: "CONFIRMED",
        subjectEntity: bc.sig,
        relevantPaths: Array.from(bc.nodes).sort((a, b) => a.localeCompare(b)),
        details: {
          cycle: bc.cycle,
          length: bc.nodes.size,
        },
        evidenceIds: [],
      });
    }

    const baseCyclicSccs = baseCycles.stronglyConnectedComponents.filter((s) => s.isCycle);
    const targetCyclicSccs = targetCycles.stronglyConnectedComponents.filter((s) => s.isCycle);
    const maxBaseSccSize = baseCyclicSccs.reduce((m, s) => Math.max(m, s.size), 0);
    const maxTargetSccSize = targetCyclicSccs.reduce((m, s) => Math.max(m, s.size), 0);
    const baseCyclicNodeCount = baseCyclicSccs.reduce((sum, s) => sum + s.size, 0);
    const targetCyclicNodeCount = targetCyclicSccs.reduce((sum, s) => sum + s.size, 0);

    if (maxTargetSccSize > maxBaseSccSize || targetCyclicNodeCount > baseCyclicNodeCount) {
      findings.push({
        findingId: `drift:scc_growth:${baseScanId}:${targetScanId}`,
        driftType: "DRIFT_SCC_GROWTH",
        title: `Cyclic SCC footprint grew (${baseCyclicNodeCount} -> ${targetCyclicNodeCount} nodes)`,
        description: `Strongly connected cyclic module count grew from ${baseCyclicNodeCount} (max SCC ${maxBaseSccSize}) to ${targetCyclicNodeCount} (max SCC ${maxTargetSccSize})`,
        severity: "MEDIUM",
        confidence: 1.0,
        confidenceTier: "CONFIRMED",
        subjectEntity: `scc:${targetScanId}`,
        relevantPaths: Array.from(new Set(targetCyclicSccs.flatMap((s) => s.nodes))).sort((a, b) =>
          a.localeCompare(b),
        ),
        details: {
          baseMaxSccSize: maxBaseSccSize,
          targetMaxSccSize: maxTargetSccSize,
          baseCyclicNodeCount,
          targetCyclicNodeCount,
        },
        evidenceIds: [],
      });
    }

    // 4. Fan-out hotspot crossings
    const fanoutThreshold = options.fanoutHotspotThreshold ?? 10;
    const minDelta = 3;
    const sortedTargetFiles = Array.from(targetData.fileFanOut.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const filePath of sortedTargetFiles) {
      const targetTargets = targetData.fileFanOut.get(filePath)!;
      const baseTargets = baseData.fileFanOut.get(filePath) ?? new Set<string>();
      const baseFanOut = baseTargets.size;
      const targetFanOut = targetTargets.size;

      if (
        (baseFanOut < fanoutThreshold && targetFanOut >= fanoutThreshold) ||
        (targetFanOut >= fanoutThreshold && targetFanOut - baseFanOut >= minDelta)
      ) {
        const addedTargets = Array.from(targetTargets)
          .filter((t) => !baseTargets.has(t))
          .sort((a, b) => a.localeCompare(b));
        findings.push({
          findingId: `drift:fanout_hotspot:${filePath}`,
          driftType: "DRIFT_COUPLING_HOTSPOT_INTRODUCED",
          title: `Coupling hotspot in ${filePath} (fan-out ${baseFanOut} -> ${targetFanOut})`,
          description: `Module '${filePath}' crossed coupling hotspot threshold (${fanoutThreshold}) with ${targetFanOut} resolved internal dependencies`,
          severity: targetFanOut >= fanoutThreshold * 2 ? "HIGH" : "MEDIUM",
          confidence: 1.0,
          confidenceTier: "CONFIRMED",
          subjectEntity: filePath,
          relevantPaths: [filePath, ...addedTargets],
          details: {
            filePath,
            baseFanOut,
            targetFanOut,
            threshold: fanoutThreshold,
            addedTargets,
          },
          evidenceIds: [],
        });
      }
    }

    // 5. Unresolved import spike (ISSUE-DRIFT-02: only emit when net unresolved imports grew in targetScanId)
    const countUnresolved = (scanId: number): number => {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count FROM imports WHERE repository_id = ? AND scan_id = ? AND resolution_status = 'UNRESOLVED'`,
        )
        .get(repositoryId, scanId) as { count: number };
      return row.count;
    };
    const baseUnresolvedTotal = countUnresolved(baseScanId);
    const targetUnresolvedTotal = countUnresolved(targetScanId);
    const unresolvedGrowth = targetUnresolvedTotal - baseUnresolvedTotal;

    if (unresolvedGrowth > 0 && comparison.summary.dependencies.unresolved > 0) {
      const unresolvedPaths = Array.from(
        new Set(
          comparison.dependencies.changes
            .filter((d) => d.changeType === "UNRESOLVED")
            .map((d) => d.sourcePath),
        ),
      ).sort((a, b) => a.localeCompare(b));

      findings.push({
        findingId: `drift:unresolved_spike:${baseScanId}:${targetScanId}`,
        driftType: "DRIFT_UNRESOLVED_IMPORT_SPIKE",
        title: `Unresolved imports spiked (${baseUnresolvedTotal} -> ${targetUnresolvedTotal}, +${unresolvedGrowth})`,
        description: `Unresolved imports grew from ${baseUnresolvedTotal} in scan ${baseScanId} to ${targetUnresolvedTotal} in scan ${targetScanId}`,
        severity: unresolvedGrowth >= 3 ? "HIGH" : "MEDIUM",
        confidence: 1.0,
        confidenceTier: "CONFIRMED",
        subjectEntity: `unresolved:${targetScanId}`,
        relevantPaths: unresolvedPaths,
        details: {
          baseUnresolvedTotal,
          targetUnresolvedTotal,
          unresolvedGrowth,
          unresolvedDiffCount: comparison.summary.dependencies.unresolved,
        },
        evidenceIds: [],
      });
    }

    findings.sort((a, b) => a.findingId.localeCompare(b.findingId));
    return findings;
  }
}
