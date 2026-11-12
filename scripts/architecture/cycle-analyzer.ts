/**
 * Phase 7.4 — Deterministic Cycle & Strongly Connected Component (SCC) Analyzer
 * Implements Tarjan's SCC algorithm and deterministic elementary cycle extraction for dependency graphs.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { CircularDependencyCandidate } from "./types.ts";

export interface StronglyConnectedComponent {
  componentId: string;
  nodes: string[];
  size: number;
  isCycle: boolean;
}

export interface CycleAnalysisResult {
  stronglyConnectedComponents: StronglyConnectedComponent[];
  circularCandidates: CircularDependencyCandidate[];
  totalCycles: number;
}

export class CycleAnalyzer {
  public static analyze(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
  ): CycleAnalysisResult {
    // 1. Fetch all resolved internal import edges
    const edges = db
      .prepare(
        `SELECT
          src.normalized_path AS sourcePath,
          dst.normalized_path AS targetPath
         FROM imports i
         JOIN files src ON src.id = i.source_file_id
         JOIN files dst ON dst.id = i.resolved_file_id
         WHERE i.scan_id = ? AND i.resolution_status = 'RESOLVED'
         ORDER BY src.normalized_path ASC, dst.normalized_path ASC`,
      )
      .all(scanId) as { sourcePath: string; targetPath: string }[];

    const adj = new Map<string, Set<string>>();
    const allNodes = new Set<string>();

    for (const edge of edges) {
      allNodes.add(edge.sourcePath);
      allNodes.add(edge.targetPath);

      if (!adj.has(edge.sourcePath)) {
        adj.set(edge.sourcePath, new Set());
      }
      adj.get(edge.sourcePath)!.add(edge.targetPath);
    }

    // 2. Tarjan's Strongly Connected Components Algorithm
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const sortedAllNodes = Array.from(allNodes).sort();

    function strongConnect(v: string) {
      indices.set(v, index);
      lowlink.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const neighbors = adj.get(v);
      if (neighbors) {
        const sortedNeighbors = Array.from(neighbors).sort();
        for (const w of sortedNeighbors) {
          if (!indices.has(w)) {
            strongConnect(w);
            lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
          } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
          }
        }
      }

      if (lowlink.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let node: string;
        do {
          node = stack.pop()!;
          onStack.delete(node);
          scc.push(node);
        } while (node !== v);

        sccs.push(scc.sort());
      }
    }

    for (const node of sortedAllNodes) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }

    // 3. Process SCCs into structured output
    const structuredSccs: StronglyConnectedComponent[] = [];
    const circularCandidates: CircularDependencyCandidate[] = [];
    const seenCycleSignatures = new Set<string>();

    let sccCounter = 1;
    for (const scc of sccs.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))) {
      const isMultiNode = scc.length > 1;
      const isSelfLoop = scc.length === 1 && (adj.get(scc[0])?.has(scc[0]) ?? false);
      const isCycle = isMultiNode || isSelfLoop;

      structuredSccs.push({
        componentId: `scc:${sccCounter++}`,
        nodes: scc,
        size: scc.length,
        isCycle,
      });

      if (isCycle) {
        // Extract deterministic elementary cycles within this SCC
        const sccSet = new Set(scc);
        const sccAdj = new Map<string, string[]>();
        for (const node of scc) {
          const validNeighbors = Array.from(adj.get(node) ?? [])
            .filter((n) => sccSet.has(n))
            .sort();
          sccAdj.set(node, validNeighbors);
        }

        // Trace cycles using DFS within the SCC
        const visitedInScc = new Set<string>();
        const path: string[] = [];
        const inPath = new Set<string>();

        function findCyclesDFS(curr: string) {
          visitedInScc.add(curr);
          path.push(curr);
          inPath.add(curr);

          const nextNodes = sccAdj.get(curr) ?? [];
          for (const next of nextNodes) {
            if (inPath.has(next)) {
              // Cycle found
              const cycleStartIdx = path.indexOf(next);
              if (cycleStartIdx !== -1) {
                const cycle = path.slice(cycleStartIdx);
                cycle.push(next); // Close loop
                // Normalize cycle representation (rotate to start at lexicographically smallest node)
                const baseCycle = cycle.slice(0, -1);
                const minNode = baseCycle.reduce(
                  (min, val) => (val < min ? val : min),
                  baseCycle[0],
                );
                const minIdx = baseCycle.indexOf(minNode);
                const normalized = [...baseCycle.slice(minIdx), ...baseCycle.slice(0, minIdx)];
                const signature = normalized.join(" -> ");

                if (!seenCycleSignatures.has(signature)) {
                  seenCycleSignatures.add(signature);
                  circularCandidates.push({
                    cycle: [...normalized, normalized[0]],
                    length: normalized.length,
                  });
                }
              }
            } else if (!visitedInScc.has(next)) {
              findCyclesDFS(next);
            }
          }

          inPath.delete(curr);
          path.pop();
        }

        for (const start of scc) {
          if (!visitedInScc.has(start)) {
            findCyclesDFS(start);
          }
        }
      }
    }

    // Sort circular candidates deterministically by length ASC, then path signature ASC
    circularCandidates.sort((a, b) => a.length - b.length || a.cycle[0].localeCompare(b.cycle[0]));

    return {
      stronglyConnectedComponents: structuredSccs,
      circularCandidates,
      totalCycles: circularCandidates.length,
    };
  }
}
