/**
 * Phase 7.3 — Dependency Topology Analyzer
 * Detects internal dependency structures, cycles, high-fanout modules, and package dependencies.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { ArchitectureDependencyReport, CircularDependencyCandidate } from "./types.ts";

export class DependencyAnalyzer {
  public static analyze(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
    options?: { fanoutThreshold?: number },
  ): ArchitectureDependencyReport {
    // 1. Query import counts
    const counts = db
      .prepare(
        `SELECT
          SUM(CASE WHEN resolution_status = 'RESOLVED' THEN 1 ELSE 0 END) AS internalCount,
          SUM(CASE WHEN resolution_status IN ('EXTERNAL', 'BUILTIN') THEN 1 ELSE 0 END) AS externalCount,
          SUM(CASE WHEN resolution_status = 'UNRESOLVED' THEN 1 ELSE 0 END) AS unresolvedCount
         FROM imports WHERE scan_id = ?`,
      )
      .get(scanId) as {
      internalCount: number | null;
      externalCount: number | null;
      unresolvedCount: number | null;
    };

    // 2. Query distinct external package specifiers
    const extPackages = db
      .prepare(
        `SELECT DISTINCT imported_specifier AS pkg
         FROM imports
         WHERE scan_id = ? AND resolution_status IN ('EXTERNAL', 'BUILTIN')
         ORDER BY imported_specifier ASC`,
      )
      .all(scanId) as { pkg: string }[];

    // 3. Query all resolved internal edges to build adjacency list for cycle & fanout analysis
    const internalEdges = db
      .prepare(
        `SELECT
          src.normalized_path AS sourcePath,
          dst.normalized_path AS targetPath
         FROM imports i
         JOIN files src ON src.id = i.source_file_id
         JOIN files dst ON dst.id = i.resolved_file_id
         WHERE i.scan_id = ? AND i.resolution_status = 'RESOLVED'`,
      )
      .all(scanId) as { sourcePath: string; targetPath: string }[];

    const adj = new Map<string, Set<string>>();
    const fanoutCounts = new Map<string, number>();

    for (const edge of internalEdges) {
      if (!adj.has(edge.sourcePath)) {
        adj.set(edge.sourcePath, new Set());
      }
      adj.get(edge.sourcePath)!.add(edge.targetPath);

      fanoutCounts.set(edge.sourcePath, (fanoutCounts.get(edge.sourcePath) ?? 0) + 1);
    }

    // Identify High Fan-out Modules (informational heuristic, not an architectural defect)
    const threshold = options?.fanoutThreshold ?? 5;
    const highFanoutModules = Array.from(fanoutCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([filePath, dependencyCount]) => ({ filePath, dependencyCount }))
      .sort((a, b) => b.dependencyCount - a.dependencyCount);

    // 4. Cycle Detection using DFS
    const circularCandidates: CircularDependencyCandidate[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const currentPath: string[] = [];
    const seenCycles = new Set<string>();

    function dfs(node: string) {
      visited.add(node);
      recStack.add(node);
      currentPath.push(node);

      const neighbors = adj.get(node);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          } else if (recStack.has(neighbor)) {
            // Cycle detected from neighbor to current node
            const cycleStartIdx = currentPath.indexOf(neighbor);
            if (cycleStartIdx !== -1) {
              const cycleNodes = currentPath.slice(cycleStartIdx);
              cycleNodes.push(neighbor); // Close cycle loop
              const cycleSignature = [...cycleNodes].sort().join("|");
              if (!seenCycles.has(cycleSignature)) {
                seenCycles.add(cycleSignature);
                circularCandidates.push({
                  cycle: cycleNodes,
                  length: cycleNodes.length - 1,
                });
              }
            }
          }
        }
      }

      recStack.delete(node);
      currentPath.pop();
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return {
      totalInternalEdges: counts.internalCount ?? 0,
      totalExternalDependencies: counts.externalCount ?? 0,
      totalUnresolvedImports: counts.unresolvedCount ?? 0,
      circularDependencyCandidates: circularCandidates,
      highFanoutModules,
      externalPackages: extPackages.map((p) => p.pkg),
    };
  }
}
