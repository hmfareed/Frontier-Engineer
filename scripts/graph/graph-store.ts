/**
 * Phase 7.3 — Graph Store
 * SQLite persistence and indexed query operations for engineering graph nodes and edges.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { GraphNodeRecord, GraphEdgeRecord } from "../storage/types.ts";
import type { GraphNode, GraphEdge } from "./types.ts";

export class GraphStore {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public insertGraph(params: {
    repositoryId: number;
    scanId: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
    pathToId: Map<string, number>;
    symbolMap: Map<string, number>;
  }): { nodesCount: number; edgesCount: number } {
    const nodeIdentityToId = new Map<string, number>();

    const insertNodeStmt = this.db.prepare(
      `INSERT INTO graph_nodes (
        repository_id, scan_id, node_identity, category, name,
        file_id, symbol_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertEdgeStmt = this.db.prepare(
      `INSERT INTO graph_edges (
        repository_id, scan_id, edge_identity, source_node_id, target_node_id,
        relationship_type, evidence_id, confidence, relationship_status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      // 1. Insert Nodes
      for (const node of params.nodes) {
        let fileId: number | null = null;
        let symbolId: number | null = null;

        if (node.category === "file" || node.category === "test") {
          const canonical = node.nodeIdentity.replace(/^file:/, "");
          fileId = params.pathToId.get(canonical) ?? null;
        } else if (node.category === "symbol") {
          const symIdStr = node.nodeIdentity.replace(/^sym:/, "");
          symbolId = params.symbolMap.get(symIdStr) ?? null;
        }

        const metadataJson = node.metadata ? JSON.stringify(node.metadata) : null;

        const res = insertNodeStmt.run(
          params.repositoryId,
          params.scanId,
          node.nodeIdentity,
          node.category,
          node.name,
          fileId,
          symbolId,
          metadataJson,
        );

        nodeIdentityToId.set(node.nodeIdentity, Number(res.lastInsertRowid));
      }

      // 2. Insert Edges
      for (const edge of params.edges) {
        const sourceId = nodeIdentityToId.get(edge.sourceNodeIdentity);
        const targetId = nodeIdentityToId.get(edge.targetNodeIdentity);

        // Safeguard: only insert edge if both source and target nodes exist
        if (sourceId !== undefined && targetId !== undefined) {
          insertEdgeStmt.run(
            params.repositoryId,
            params.scanId,
            edge.edgeIdentity,
            sourceId,
            targetId,
            edge.relationshipType,
            edge.evidenceId ?? null,
            edge.confidence,
            edge.relationshipStatus,
            edge.createdAt,
          );
        }
      }
    });

    return {
      nodesCount: params.nodes.length,
      edgesCount: params.edges.length,
    };
  }

  public getNodes(scanId: number): GraphNodeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          node_identity AS nodeIdentity, category, name,
          file_id AS fileId, symbol_id AS symbolId,
          metadata_json AS metadataJson
        FROM graph_nodes
        WHERE scan_id = ?
        ORDER BY node_identity ASC`,
      )
      .all(scanId) as unknown as GraphNodeRecord[];

    return rows;
  }

  public getEdges(scanId: number): GraphEdgeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          edge_identity AS edgeIdentity, source_node_id AS sourceNodeId,
          target_node_id AS targetNodeId, relationship_type AS relationshipType,
          evidence_id AS evidenceId, confidence,
          relationship_status AS relationshipStatus, created_at AS createdAt
        FROM graph_edges
        WHERE scan_id = ?
        ORDER BY edge_identity ASC`,
      )
      .all(scanId) as unknown as GraphEdgeRecord[];

    return rows;
  }

  public getNodeByIdentity(scanId: number, nodeIdentity: string): GraphNodeRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          node_identity AS nodeIdentity, category, name,
          file_id AS fileId, symbol_id AS symbolId,
          metadata_json AS metadataJson
        FROM graph_nodes
        WHERE scan_id = ? AND node_identity = ?`,
      )
      .get(scanId, nodeIdentity) as unknown as GraphNodeRecord | undefined;

    return row ?? null;
  }

  public getNodeById(nodeId: number): GraphNodeRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          node_identity AS nodeIdentity, category, name,
          file_id AS fileId, symbol_id AS symbolId,
          metadata_json AS metadataJson
        FROM graph_nodes
        WHERE id = ?`,
      )
      .get(nodeId) as unknown as GraphNodeRecord | undefined;

    return row ?? null;
  }

  public getOutgoingEdges(scanId: number, nodeId: number): GraphEdgeRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          edge_identity AS edgeIdentity, source_node_id AS sourceNodeId,
          target_node_id AS targetNodeId, relationship_type AS relationshipType,
          evidence_id AS evidenceId, confidence,
          relationship_status AS relationshipStatus, created_at AS createdAt
        FROM graph_edges
        WHERE scan_id = ? AND source_node_id = ?
        ORDER BY edge_identity ASC`,
      )
      .all(scanId, nodeId) as unknown as GraphEdgeRecord[];
  }

  public getIncomingEdges(scanId: number, nodeId: number): GraphEdgeRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          edge_identity AS edgeIdentity, source_node_id AS sourceNodeId,
          target_node_id AS targetNodeId, relationship_type AS relationshipType,
          evidence_id AS evidenceId, confidence,
          relationship_status AS relationshipStatus, created_at AS createdAt
        FROM graph_edges
        WHERE scan_id = ? AND target_node_id = ?
        ORDER BY edge_identity ASC`,
      )
      .all(scanId, nodeId) as unknown as GraphEdgeRecord[];
  }
}
