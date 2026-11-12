/**
 * Phase 7.3 — Graph Validator
 * Integrity verification for engineering graph nodes, edges, and provenance.
 */

import type { GraphStore } from "./graph-store.ts";
import type { IntegrityIssue } from "../storage/types.ts";

export class GraphValidator {
  public static validate(graphStore: GraphStore, scanId: number): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const nodes = graphStore.getNodes(scanId);
    const edges = graphStore.getEdges(scanId);

    const nodeIds = new Set<number>();
    const nodeIdentities = new Set<string>();

    for (const node of nodes) {
      nodeIds.add(node.id);
      if (nodeIdentities.has(node.nodeIdentity)) {
        issues.push({
          severity: "error",
          code: "DUPLICATE_NODE_IDENTITY",
          message: `Duplicate graph node identity detected: ${node.nodeIdentity}`,
          entityId: node.id,
          entityType: "graph_node",
        });
      }
      nodeIdentities.add(node.nodeIdentity);
    }

    const edgeIdentities = new Set<string>();

    for (const edge of edges) {
      if (edgeIdentities.has(edge.edgeIdentity)) {
        issues.push({
          severity: "error",
          code: "DUPLICATE_EDGE_IDENTITY",
          message: `Duplicate graph edge identity detected: ${edge.edgeIdentity}`,
          entityId: edge.id,
          entityType: "graph_edge",
        });
      }
      edgeIdentities.add(edge.edgeIdentity);

      // Check dangling source node
      if (!nodeIds.has(edge.sourceNodeId)) {
        issues.push({
          severity: "error",
          code: "DANGLING_EDGE_SOURCE",
          message: `Graph edge ${edge.edgeIdentity} references non-existent source node ${edge.sourceNodeId}`,
          entityId: edge.id,
          entityType: "graph_edge",
        });
      }

      // Check dangling target node
      if (!nodeIds.has(edge.targetNodeId)) {
        issues.push({
          severity: "error",
          code: "DANGLING_EDGE_TARGET",
          message: `Graph edge ${edge.edgeIdentity} references non-existent target node ${edge.targetNodeId}`,
          entityId: edge.id,
          entityType: "graph_edge",
        });
      }

      // Check confidence range
      if (edge.confidence < 0.0 || edge.confidence > 1.0) {
        issues.push({
          severity: "error",
          code: "INVALID_CONFIDENCE",
          message: `Graph edge ${edge.edgeIdentity} has invalid confidence ${edge.confidence}`,
          entityId: edge.id,
          entityType: "graph_edge",
        });
      }
    }

    return issues;
  }
}
