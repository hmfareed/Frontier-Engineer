/**
 * Phase 7.3 — Graph Traversal Engine
 * Cycle-safe, bounded dependency and dependent traversals with depth limits.
 */

import type { GraphStore } from "./graph-store.ts";
import type {
  GraphNode,
  GraphEdge,
  GraphTraversalResult,
  TraversalOptions,
  TraversalStep,
} from "./types.ts";
import type { GraphNodeRecord, GraphEdgeRecord } from "../storage/types.ts";

export class GraphTraversal {
  public static traverse(
    graphStore: GraphStore,
    scanId: number,
    startNodeIdentity: string,
    direction: "dependencies" | "dependents",
    options: TraversalOptions = {},
  ): GraphTraversalResult {
    const maxDepth = options.maxDepth ?? 10;
    const startNode = graphStore.getNodeByIdentity(scanId, startNodeIdentity);

    if (!startNode) {
      return {
        rootNodeIdentity: startNodeIdentity,
        visitedNodes: [],
        edgesTraversed: [],
        paths: [],
        hasCycles: false,
        depthReached: 0,
      };
    }

    const visitedNodesMap = new Map<number, GraphNode>();
    const edgesTraversedMap = new Map<string, GraphEdge>();
    const paths: TraversalStep[][] = [];
    let hasCycles = false;
    let maxDepthReached = 0;

    // Queue for BFS traversal: [currentNode, currentDepth, currentPath, pathVisitedSet]
    interface QueueItem {
      node: GraphNodeRecord;
      depth: number;
      path: TraversalStep[];
      pathVisited: Set<number>;
    }

    const queue: QueueItem[] = [
      {
        node: startNode,
        depth: 0,
        path: [],
        pathVisited: new Set([startNode.id]),
      },
    ];

    visitedNodesMap.set(startNode.id, this.recordToNode(startNode));

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.depth > maxDepthReached) {
        maxDepthReached = item.depth;
      }

      if (item.depth >= maxDepth) {
        continue;
      }

      // Fetch edges depending on traversal direction
      const edges =
        direction === "dependencies"
          ? graphStore.getOutgoingEdges(scanId, item.node.id)
          : graphStore.getIncomingEdges(scanId, item.node.id);

      for (const edgeRec of edges) {
        // Optional relationship filter
        if (
          options.relationshipTypes &&
          !options.relationshipTypes.includes(edgeRec.relationshipType)
        ) {
          continue;
        }

        const nextNodeId =
          direction === "dependencies" ? edgeRec.targetNodeId : edgeRec.sourceNodeId;

        // Cycle detection along current active path
        if (item.pathVisited.has(nextNodeId)) {
          hasCycles = true;
          continue;
        }

        const nextNode = graphStore.getNodeById(nextNodeId);
        if (!nextNode) continue;

        // Optional category filter
        if (options.targetCategories && !options.targetCategories.includes(nextNode.category)) {
          continue;
        }

        const nextNodeDTO = this.recordToNode(nextNode);
        const edgeDTO = this.recordToEdge(edgeRec, item.node, nextNode, direction);

        visitedNodesMap.set(nextNode.id, nextNodeDTO);
        edgesTraversedMap.set(edgeRec.edgeIdentity, edgeDTO);

        const step: TraversalStep = {
          node: nextNodeDTO,
          edge: edgeDTO,
          depth: item.depth + 1,
        };

        const newPath = [...item.path, step];
        paths.push(newPath);

        const newPathVisited = new Set(item.pathVisited);
        newPathVisited.add(nextNodeId);

        queue.push({
          node: nextNode,
          depth: item.depth + 1,
          path: newPath,
          pathVisited: newPathVisited,
        });
      }
    }

    return {
      rootNodeIdentity: startNodeIdentity,
      visitedNodes: Array.from(visitedNodesMap.values()),
      edgesTraversed: Array.from(edgesTraversedMap.values()),
      paths,
      hasCycles,
      depthReached: maxDepthReached,
    };
  }

  private static recordToNode(rec: GraphNodeRecord): GraphNode {
    return {
      id: rec.id,
      nodeIdentity: rec.nodeIdentity,
      category: rec.category,
      name: rec.name,
      fileId: rec.fileId,
      symbolId: rec.symbolId,
      metadata: rec.metadataJson ? JSON.parse(rec.metadataJson) : undefined,
    };
  }

  private static recordToEdge(
    rec: GraphEdgeRecord,
    source: GraphNodeRecord,
    target: GraphNodeRecord,
    direction: "dependencies" | "dependents",
  ): GraphEdge {
    return {
      id: rec.id,
      edgeIdentity: rec.edgeIdentity,
      sourceNodeIdentity: direction === "dependencies" ? source.nodeIdentity : target.nodeIdentity,
      targetNodeIdentity: direction === "dependencies" ? target.nodeIdentity : source.nodeIdentity,
      sourceNodeId: rec.sourceNodeId,
      targetNodeId: rec.targetNodeId,
      relationshipType: rec.relationshipType,
      evidenceId: rec.evidenceId,
      confidence: rec.confidence,
      relationshipStatus: rec.relationshipStatus,
      createdAt: rec.createdAt,
    };
  }
}
