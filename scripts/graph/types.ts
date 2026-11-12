/**
 * Phase 7.3 — Engineering Graph Types and Contracts
 * Deterministic graph nodes, edges, provenance, and traversal contracts.
 */

import type {
  GraphNodeCategory,
  GraphRelationshipType,
  RelationshipStatus,
  GraphNodeRecord,
  GraphEdgeRecord,
  SourceEvidenceRecord,
} from "../storage/types.ts";

export interface GraphNode {
  id?: number;
  nodeIdentity: string;
  category: GraphNodeCategory;
  name: string;
  fileId?: number | null;
  symbolId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id?: number;
  edgeIdentity: string;
  sourceNodeIdentity: string;
  targetNodeIdentity: string;
  sourceNodeId?: number;
  targetNodeId?: number;
  relationshipType: GraphRelationshipType;
  evidenceId?: number | null;
  confidence: number;
  relationshipStatus: RelationshipStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RepositoryGraph {
  repositoryId: number;
  scanId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TraversalOptions {
  maxDepth?: number; // default: 10
  relationshipTypes?: GraphRelationshipType[];
  targetCategories?: GraphNodeCategory[];
}

export interface TraversalStep {
  node: GraphNode;
  edge: GraphEdge;
  depth: number;
}

export interface GraphTraversalResult {
  rootNodeIdentity: string;
  visitedNodes: GraphNode[];
  edgesTraversed: GraphEdge[];
  paths: TraversalStep[][];
  hasCycles: boolean;
  depthReached: number;
}

export interface GraphEvidence {
  edge: GraphEdge;
  evidence: SourceEvidenceRecord | null;
}

export interface UnresolvedImportFinding {
  sourceFilePath: string;
  importedSpecifier: string;
  startLine: number;
  reason: string;
}

export interface GraphEngineInterface {
  getRepositoryGraph(repositoryId: number, scanId?: number): Promise<RepositoryGraph>;
  getDependencies(
    repositoryId: number,
    nodeIdentity: string,
    options?: TraversalOptions,
    scanId?: number,
  ): Promise<GraphTraversalResult>;
  getDependents(
    repositoryId: number,
    nodeIdentity: string,
    options?: TraversalOptions,
    scanId?: number,
  ): Promise<GraphTraversalResult>;
  getUnresolvedImports(repositoryId: number, scanId?: number): Promise<UnresolvedImportFinding[]>;
  getEvidence(
    repositoryId: number,
    edgeIdentity: string,
    scanId?: number,
  ): Promise<GraphEvidence | null>;
}
