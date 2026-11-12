/**
 * Phase 7.3 — Engineering Graph Engine Facade
 * Implements public graph query, dependency traversal, and evidence retrieval interfaces.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { GraphStore } from "./graph-store.ts";
import { GraphTraversal } from "./graph-traversal.ts";
import type {
  GraphEngineInterface,
  RepositoryGraph,
  TraversalOptions,
  GraphTraversalResult,
  UnresolvedImportFinding,
  GraphEvidence,
} from "./types.ts";
import type { SourceEvidenceRecord } from "../storage/types.ts";

export class GraphEngine implements GraphEngineInterface {
  private db: SqliteDatabase;
  private graphStore: GraphStore;

  constructor(db: SqliteDatabase, graphStore: GraphStore) {
    this.db = db;
    this.graphStore = graphStore;
  }

  private resolveScanId(repositoryId: number, scanId?: number): number {
    if (scanId !== undefined) return scanId;

    const row = this.db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(repositoryId) as { active_scan_id: number | null } | undefined;

    if (!row || row.active_scan_id === null) {
      throw new Error(`No active scan found for repository ${repositoryId}.`);
    }

    return row.active_scan_id;
  }

  public async getRepositoryGraph(repositoryId: number, scanId?: number): Promise<RepositoryGraph> {
    const resolvedScanId = this.resolveScanId(repositoryId, scanId);
    const nodeRecords = this.graphStore.getNodes(resolvedScanId);
    const edgeRecords = this.graphStore.getEdges(resolvedScanId);

    const nodeMap = new Map<number, string>();
    for (const n of nodeRecords) {
      nodeMap.set(n.id, n.nodeIdentity);
    }

    return {
      repositoryId,
      scanId: resolvedScanId,
      nodes: nodeRecords.map((n) => ({
        id: n.id,
        nodeIdentity: n.nodeIdentity,
        category: n.category,
        name: n.name,
        fileId: n.fileId,
        symbolId: n.symbolId,
        metadata: n.metadataJson ? JSON.parse(n.metadataJson) : undefined,
      })),
      edges: edgeRecords.map((e) => ({
        id: e.id,
        edgeIdentity: e.edgeIdentity,
        sourceNodeIdentity: nodeMap.get(e.sourceNodeId) || `node:${e.sourceNodeId}`,
        targetNodeIdentity: nodeMap.get(e.targetNodeId) || `node:${e.targetNodeId}`,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        relationshipType: e.relationshipType,
        evidenceId: e.evidenceId,
        confidence: e.confidence,
        relationshipStatus: e.relationshipStatus,
        createdAt: e.createdAt,
      })),
    };
  }

  public async getDependencies(
    repositoryId: number,
    nodeIdentity: string,
    options?: TraversalOptions,
    scanId?: number,
  ): Promise<GraphTraversalResult> {
    const resolvedScanId = this.resolveScanId(repositoryId, scanId);
    return GraphTraversal.traverse(
      this.graphStore,
      resolvedScanId,
      nodeIdentity,
      "dependencies",
      options,
    );
  }

  public async getDependents(
    repositoryId: number,
    nodeIdentity: string,
    options?: TraversalOptions,
    scanId?: number,
  ): Promise<GraphTraversalResult> {
    const resolvedScanId = this.resolveScanId(repositoryId, scanId);
    return GraphTraversal.traverse(
      this.graphStore,
      resolvedScanId,
      nodeIdentity,
      "dependents",
      options,
    );
  }

  public async getUnresolvedImports(
    repositoryId: number,
    scanId?: number,
  ): Promise<UnresolvedImportFinding[]> {
    const resolvedScanId = this.resolveScanId(repositoryId, scanId);
    const rows = this.db
      .prepare(
        `SELECT
          f.normalized_path AS sourceFilePath,
          i.imported_specifier AS importedSpecifier,
          i.start_line AS startLine
        FROM imports i
        JOIN files f ON f.id = i.source_file_id
        WHERE i.scan_id = ? AND i.resolution_status = 'UNRESOLVED'
        ORDER BY f.normalized_path ASC, i.start_line ASC`,
      )
      .all(resolvedScanId) as {
      sourceFilePath: string;
      importedSpecifier: string;
      startLine: number;
    }[];

    return rows.map((r) => ({
      ...r,
      reason: "Module specifier could not be resolved to any indexed repository file.",
    }));
  }

  public async getEvidence(
    repositoryId: number,
    edgeIdentity: string,
    scanId?: number,
  ): Promise<GraphEvidence | null> {
    const resolvedScanId = this.resolveScanId(repositoryId, scanId);
    const edgeRow = this.db
      .prepare(
        `SELECT
          id, edge_identity AS edgeIdentity, source_node_id AS sourceNodeId,
          target_node_id AS targetNodeId, relationship_type AS relationshipType,
          evidence_id AS evidenceId, confidence, relationship_status AS relationshipStatus,
          created_at AS createdAt
        FROM graph_edges
        WHERE scan_id = ? AND edge_identity = ?`,
      )
      .get(resolvedScanId, edgeIdentity) as any;

    if (!edgeRow) return null;

    let evidence: SourceEvidenceRecord | null = null;
    if (edgeRow.evidenceId) {
      const evRow = this.db
        .prepare(
          `SELECT
            id, repository_id AS repositoryId, scan_id AS scanId,
            file_id AS fileId, symbol_id AS symbolId, evidence_type AS evidenceType,
            start_line AS startLine, end_line AS endLine,
            start_column AS startColumn, end_column AS endColumn,
            confidence, evidence_description AS evidenceDescription
          FROM source_evidence WHERE id = ?`,
        )
        .get(edgeRow.evidenceId) as unknown as SourceEvidenceRecord | undefined;
      evidence = evRow ?? null;
    } else if (edgeRow.relationshipType === "IMPORTS") {
      // Resolve evidence from underlying imports declaration
      const sourceNode = this.graphStore.getNodeById(edgeRow.sourceNodeId);
      const targetNode = this.graphStore.getNodeById(edgeRow.targetNodeId);
      if (sourceNode?.fileId && targetNode?.fileId) {
        const evRow = this.db
          .prepare(
            `SELECT
              se.id, se.repository_id AS repositoryId, se.scan_id AS scanId,
              se.file_id AS fileId, se.symbol_id AS symbolId, se.evidence_type AS evidenceType,
              se.start_line AS startLine, se.end_line AS endLine,
              se.start_column AS startColumn, se.end_column AS endColumn,
              se.confidence, se.evidence_description AS evidenceDescription
            FROM imports i
            JOIN source_evidence se ON se.id = i.evidence_id
            WHERE i.scan_id = ? AND i.source_file_id = ? AND i.resolved_file_id = ?
            LIMIT 1`,
          )
          .get(resolvedScanId, sourceNode.fileId, targetNode.fileId) as unknown as
          SourceEvidenceRecord | undefined;
        evidence = evRow ?? null;
      }
    }

    const sourceNode = this.graphStore.getNodeById(edgeRow.sourceNodeId);
    const targetNode = this.graphStore.getNodeById(edgeRow.targetNodeId);

    return {
      edge: {
        id: edgeRow.id,
        edgeIdentity: edgeRow.edgeIdentity,
        sourceNodeIdentity: sourceNode?.nodeIdentity ?? `node:${edgeRow.sourceNodeId}`,
        targetNodeIdentity: targetNode?.nodeIdentity ?? `node:${edgeRow.targetNodeId}`,
        sourceNodeId: edgeRow.sourceNodeId,
        targetNodeId: edgeRow.targetNodeId,
        relationshipType: edgeRow.relationshipType,
        evidenceId: edgeRow.evidenceId,
        confidence: edgeRow.confidence,
        relationshipStatus: edgeRow.relationshipStatus,
        createdAt: edgeRow.createdAt,
      },
      evidence,
    };
  }
}
