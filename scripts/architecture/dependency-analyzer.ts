/**
 * Phase 7.3 & 7.4 — Dependency Topology Analyzer
 * Detects internal dependency structures, cycles, high-fanout modules, and package dependencies.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { CycleAnalyzer } from "./cycle-analyzer.ts";
import type { ArchitectureDependencyReport } from "./types.ts";

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

    // 3. Query all resolved internal edges to build adjacency list for fanout analysis
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

    const fanoutCounts = new Map<string, number>();

    for (const edge of internalEdges) {
      fanoutCounts.set(edge.sourcePath, (fanoutCounts.get(edge.sourcePath) ?? 0) + 1);
    }

    // Identify High Fan-out Modules (informational heuristic, not an architectural defect)
    const threshold = options?.fanoutThreshold ?? 5;
    const highFanoutModules = Array.from(fanoutCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([filePath, dependencyCount]) => ({ filePath, dependencyCount }))
      .sort((a, b) => b.dependencyCount - a.dependencyCount);

    // 4. Tarjan's SCC and Deterministic Cycle Analysis
    const cycleResult = CycleAnalyzer.analyze(db, repositoryId, scanId);

    return {
      totalInternalEdges: counts.internalCount ?? 0,
      totalExternalDependencies: counts.externalCount ?? 0,
      totalUnresolvedImports: counts.unresolvedCount ?? 0,
      circularDependencyCandidates: cycleResult.circularCandidates,
      stronglyConnectedComponents: cycleResult.stronglyConnectedComponents,
      highFanoutModules,
      externalPackages: extPackages.map((p) => p.pkg),
    };
  }
}
