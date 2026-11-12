import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { ScanStore } from "../../scripts/storage/repositories/scan-store.ts";
import { FileStore } from "../../scripts/storage/repositories/file-store.ts";
import { ImportStore } from "../../scripts/storage/repositories/import-store.ts";
import { EvidenceStore } from "../../scripts/storage/repositories/evidence-store.ts";
import { GraphBuilder } from "../../scripts/graph/graph-builder.ts";
import { GraphStore } from "../../scripts/graph/graph-store.ts";
import { GraphEngine } from "../../scripts/graph/graph-engine.ts";
import type { ScannedFileRecord } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("graph-provenance (Edge Aggregation, Evidence Tracing & Unresolved Imports)", () => {
  let db: SqliteDatabase;
  let scanStore: ScanStore;
  let fileStore: FileStore;
  let importStore: ImportStore;
  let evidenceStore: EvidenceStore;
  let graphStore: GraphStore;
  let graphEngine: GraphEngine;
  let repoId: number;
  let scanId: number;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    scanStore = new ScanStore(db);
    fileStore = new FileStore(db);
    importStore = new ImportStore(db);
    evidenceStore = new EvidenceStore(db);
    graphStore = new GraphStore(db);
    graphEngine = new GraphEngine(db, graphStore);

    const now = new Date().toISOString();
    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_prov_test", "/repo", "ProvTest", now, now, 1);
    repoId = Number(repoRes.lastInsertRowid);

    const scan = scanStore.createScanRun({
      repositoryId: repoId,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });
    scanId = scan.id;

    db.rawDb.prepare("UPDATE repositories SET active_scan_id = ? WHERE id = ?").run(scanId, repoId);
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("aggregates multiple imports between same files into one graph edge while preserving all declarations", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/app.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 300,
        mtimeMs: 1700000000000,
        contentHash: "hash_app",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "src/utils.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 200,
        mtimeMs: 1700000000000,
        contentHash: "hash_utils",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    const pathToId = fileStore.insertFiles(repoId, scanId, files);

    // Extraction with 2 separate imports of the same target file
    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/app.ts", {
      canonicalPath: "src/app.ts",
      symbols: [],
      imports: [
        {
          specifier: "./utils.ts",
          resolvedPath: "src/utils.ts",
          importedSymbols: [{ name: "formatDate" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
          sourceEvidence: {
            lineStart: 1,
            lineEnd: 1,
            colStart: 0,
            colEnd: 30,
            evidenceHash: "ev_1",
          },
        },
        {
          specifier: "./utils.ts",
          resolvedPath: "src/utils.ts",
          importedSymbols: [{ name: "DateFormatOptions" }],
          isTypeOnly: true,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
          sourceEvidence: {
            lineStart: 10,
            lineEnd: 10,
            colStart: 0,
            colEnd: 40,
            evidenceHash: "ev_2",
          },
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    // 1. Insert imports into relational imports table
    importStore.insertImports({
      repositoryId: repoId,
      scanId,
      sourceFileId: pathToId.get("src/app.ts")!,
      imports: extractions.get("src/app.ts")!.imports,
      pathToId,
      evidenceStore,
    });

    // In imports table: exactly 2 distinct rows are preserved
    const importRows = importStore.getImports(scanId, pathToId.get("src/app.ts")!);
    expect(importRows.length).toBe(2);
    expect(importRows[0].startLine).toBe(1);
    expect(importRows[1].startLine).toBe(10);

    // 2. Build and persist Graph
    const { nodes, edges } = GraphBuilder.buildGraph({
      repositoryIdentity: "repo_prov_test",
      files,
      extractions,
      pathToId,
    });

    // In graph topology: exactly 1 directed IMPORTS edge exists between app.ts and utils.ts
    const importEdges = edges.filter(
      (e) => e.relationshipType === "IMPORTS" && e.sourceNodeIdentity === "file:src/app.ts",
    );
    expect(importEdges.length).toBe(1);
    expect(importEdges[0].edgeIdentity).toBe("file:src/app.ts->IMPORTS->file:src/utils.ts");

    // Aggregation check: metadata captures both declarations
    const meta = importEdges[0].metadata as any;
    expect(meta.declarationCount).toBe(2);
    expect(meta.declarations.length).toBe(2);
    expect(meta.declarations[0].lineStart).toBe(1);
    expect(meta.declarations[1].lineStart).toBe(10);

    // 3. Persist in graphStore and verify query engine
    graphStore.insertGraph({
      repositoryId: repoId,
      scanId,
      nodes,
      edges,
      pathToId,
      symbolMap: new Map(),
    });

    // Query evidence via GraphEngine
    const graphEvidence = graphEngine.getEvidence(
      repoId,
      "file:src/app.ts->IMPORTS->file:src/utils.ts",
    );
    expect(graphEvidence).not.toBeNull();
  });

  it("persists unresolved imports with UNRESOLVED status and provides explicit query", async () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/main.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 150,
        mtimeMs: 1700000000000,
        contentHash: "hash_main",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];
    const pathToId = fileStore.insertFiles(repoId, scanId, files);

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/main.ts", {
      canonicalPath: "src/main.ts",
      symbols: [],
      imports: [
        {
          specifier: "./missing-dep.ts",
          resolvedPath: null,
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "external_or_missing",
          sourceEvidence: {
            lineStart: 3,
            lineEnd: 3,
            colStart: 0,
            colEnd: 25,
            evidenceHash: "ev_miss",
          },
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    importStore.insertImports({
      repositoryId: repoId,
      scanId,
      sourceFileId: pathToId.get("src/main.ts")!,
      imports: extractions.get("src/main.ts")!.imports,
      pathToId,
      evidenceStore,
    });

    const { nodes, edges } = GraphBuilder.buildGraph({
      repositoryIdentity: "repo_prov_test",
      files,
      extractions,
      pathToId,
    });

    graphStore.insertGraph({
      repositoryId: repoId,
      scanId,
      nodes,
      edges,
      pathToId,
      symbolMap: new Map(),
    });

    // Verify unresolved query
    const unresolvedFindings = await graphEngine.getUnresolvedImports(repoId);
    expect(unresolvedFindings.length).toBe(1);
    expect(unresolvedFindings[0].sourceFilePath).toBe("src/main.ts");
    expect(unresolvedFindings[0].importedSpecifier).toBe("./missing-dep.ts");
    expect(unresolvedFindings[0].startLine).toBe(3);

    // Verify edge has UNRESOLVED status
    const unresEdge = edges.find(
      (e) => e.relationshipType === "IMPORTS" && e.targetNodeIdentity.startsWith("mod:"),
    );
    expect(unresEdge?.relationshipStatus).toBe("UNRESOLVED");
  });
});
