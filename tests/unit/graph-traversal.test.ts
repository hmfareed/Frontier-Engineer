import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { GraphStore } from "../../scripts/graph/graph-store.ts";
import { GraphTraversal } from "../../scripts/graph/graph-traversal.ts";
import { GraphEngine } from "../../scripts/graph/graph-engine.ts";
import type { GraphNode, GraphEdge } from "../../scripts/graph/types.ts";

describe("graph-traversal (Cycle Safety, Traversal Bounds & Query Engine)", () => {
  let db: SqliteDatabase;
  let graphStore: GraphStore;
  let graphEngine: GraphEngine;
  let repoId: number;
  let scanId: number;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    graphStore = new GraphStore(db);
    graphEngine = new GraphEngine(db, graphStore);

    const now = new Date().toISOString();
    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_graph_traversal", "/repo", "TestRepo", now, now, 1);
    repoId = Number(repoRes.lastInsertRowid);

    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version, is_active) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3', 1)",
      )
      .run(repoId, now);
    scanId = Number(scanRes.lastInsertRowid);

    db.rawDb.prepare("UPDATE repositories SET active_scan_id = ? WHERE id = ?").run(scanId, repoId);
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("traverses forward dependencies and reverse dependents correctly", async () => {
    // Linear chain: file:A -> IMPORTS -> file:B -> IMPORTS -> file:C
    const nodes: GraphNode[] = [
      { nodeIdentity: "file:A.ts", category: "file", name: "A.ts" },
      { nodeIdentity: "file:B.ts", category: "file", name: "B.ts" },
      { nodeIdentity: "file:C.ts", category: "file", name: "C.ts" },
    ];

    const edges: GraphEdge[] = [
      {
        edgeIdentity: "file:A.ts->IMPORTS->file:B.ts",
        sourceNodeIdentity: "file:A.ts",
        targetNodeIdentity: "file:B.ts",
        relationshipType: "IMPORTS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: new Date().toISOString(),
      },
      {
        edgeIdentity: "file:B.ts->IMPORTS->file:C.ts",
        sourceNodeIdentity: "file:B.ts",
        targetNodeIdentity: "file:C.ts",
        relationshipType: "IMPORTS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: new Date().toISOString(),
      },
    ];

    graphStore.insertGraph({
      repositoryId: repoId,
      scanId,
      nodes,
      edges,
      pathToId: new Map(),
      symbolMap: new Map(),
    });

    // 1. Forward dependencies from A
    const depsFromA = await graphEngine.getDependencies(repoId, "file:A.ts");
    expect(depsFromA.visitedNodes.length).toBe(3); // A, B, C
    expect(depsFromA.edgesTraversed.length).toBe(2);
    expect(depsFromA.hasCycles).toBe(false);
    expect(depsFromA.depthReached).toBe(2);

    // 2. Reverse dependents from C
    const dependentsOfC = await graphEngine.getDependents(repoId, "file:C.ts");
    expect(dependentsOfC.visitedNodes.length).toBe(3); // C, B, A
    expect(dependentsOfC.edgesTraversed.length).toBe(2);
    expect(dependentsOfC.hasCycles).toBe(false);
  });

  it("safely detects circular dependencies without infinite loops", async () => {
    // Cycle: X -> Y -> Z -> X
    const nodes: GraphNode[] = [
      { nodeIdentity: "file:X.ts", category: "file", name: "X.ts" },
      { nodeIdentity: "file:Y.ts", category: "file", name: "Y.ts" },
      { nodeIdentity: "file:Z.ts", category: "file", name: "Z.ts" },
    ];

    const edges: GraphEdge[] = [
      {
        edgeIdentity: "file:X.ts->IMPORTS->file:Y.ts",
        sourceNodeIdentity: "file:X.ts",
        targetNodeIdentity: "file:Y.ts",
        relationshipType: "IMPORTS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: new Date().toISOString(),
      },
      {
        edgeIdentity: "file:Y.ts->IMPORTS->file:Z.ts",
        sourceNodeIdentity: "file:Y.ts",
        targetNodeIdentity: "file:Z.ts",
        relationshipType: "IMPORTS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: new Date().toISOString(),
      },
      {
        edgeIdentity: "file:Z.ts->IMPORTS->file:X.ts",
        sourceNodeIdentity: "file:Z.ts",
        targetNodeIdentity: "file:X.ts",
        relationshipType: "IMPORTS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: new Date().toISOString(),
      },
    ];

    graphStore.insertGraph({
      repositoryId: repoId,
      scanId,
      nodes,
      edges,
      pathToId: new Map(),
      symbolMap: new Map(),
    });

    const res = await graphEngine.getDependencies(repoId, "file:X.ts");
    expect(res.hasCycles).toBe(true);
    expect(res.visitedNodes.length).toBe(3);
  });

  it("respects maxDepth limits", async () => {
    // Chain of 5 nodes: 1 -> 2 -> 3 -> 4 -> 5
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 1; i <= 5; i++) {
      nodes.push({ nodeIdentity: `file:N${i}.ts`, category: "file", name: `N${i}.ts` });
      if (i > 1) {
        edges.push({
          edgeIdentity: `file:N${i - 1}.ts->IMPORTS->file:N${i}.ts`,
          sourceNodeIdentity: `file:N${i - 1}.ts`,
          targetNodeIdentity: `file:N${i}.ts`,
          relationshipType: "IMPORTS",
          confidence: 1.0,
          relationshipStatus: "CONFIRMED",
          createdAt: new Date().toISOString(),
        });
      }
    }

    graphStore.insertGraph({
      repositoryId: repoId,
      scanId,
      nodes,
      edges,
      pathToId: new Map(),
      symbolMap: new Map(),
    });

    const res = await graphEngine.getDependencies(repoId, "file:N1.ts", { maxDepth: 2 });
    expect(res.depthReached).toBe(2);
    expect(res.visitedNodes.length).toBe(3); // N1, N2, N3
    expect(res.visitedNodes.some((n) => n.nodeIdentity === "file:N4.ts")).toBe(false);
  });
});
