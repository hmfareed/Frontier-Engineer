import { describe, it, expect } from "vitest";
import { GraphBuilder } from "../../scripts/graph/graph-builder.ts";
import type { ScannedFileRecord } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("graph-builder (Deterministic Engineering Graph Construction)", () => {
  it("builds deterministic directory, file, and symbol hierarchies", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/components/Button.tsx",
        fileExtension: ".tsx",
        classification: "source",
        sizeBytes: 300,
        mtimeMs: 1700000000000,
        contentHash: "hash_btn",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "tests/unit/Button.test.tsx",
        fileExtension: ".tsx",
        classification: "source",
        sizeBytes: 400,
        mtimeMs: 1700000000000,
        contentHash: "hash_test",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/components/Button.tsx", {
      canonicalPath: "src/components/Button.tsx",
      symbols: [
        {
          symbolId: "sym:src/components/Button.tsx#Button",
          name: "Button",
          parentScope: null,
          kind: "react_component",
          fingerprint: "fp_btn",
          isExported: true,
          sourceEvidence: {
            lineStart: 5,
            lineEnd: 15,
            colStart: 0,
            colEnd: 1,
            evidenceHash: "ev_b",
          },
        },
      ],
      imports: [
        {
          specifier: "react",
          resolvedPath: null,
          importedSymbols: [{ name: "FC" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    extractions.set("tests/unit/Button.test.tsx", {
      canonicalPath: "tests/unit/Button.test.tsx",
      symbols: [],
      imports: [
        {
          specifier: "../../src/components/Button.tsx",
          resolvedPath: "src/components/Button.tsx",
          importedSymbols: [{ name: "Button" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    const { nodes, edges } = GraphBuilder.buildGraph({
      repositoryIdentity: "test-repo",
      files,
      extractions,
    });

    // Check Repository Node
    const repoNode = nodes.find((n) => n.category === "repository")!;
    expect(repoNode.nodeIdentity).toBe("repo:test-repo");

    // Check Directory Nodes
    const dirComponents = nodes.find((n) => n.nodeIdentity === "dir:src/components")!;
    expect(dirComponents).toBeDefined();

    // Check File and Test Nodes
    const fileBtn = nodes.find((n) => n.nodeIdentity === "file:src/components/Button.tsx")!;
    expect(fileBtn.category).toBe("file");

    const testBtn = nodes.find((n) => n.nodeIdentity === "file:tests/unit/Button.test.tsx")!;
    expect(testBtn.category).toBe("test");

    // Check Symbol Node
    const symBtn = nodes.find(
      (n) => n.nodeIdentity === "sym:sym:src/components/Button.tsx#Button",
    )!;
    expect(symBtn).toBeDefined();

    // Check External Package Node
    const pkgReact = nodes.find((n) => n.nodeIdentity === "pkg:react")!;
    expect(pkgReact).toBeDefined();

    // Check Edges
    const definesEdge = edges.find(
      (e) =>
        e.relationshipType === "DEFINES" &&
        e.sourceNodeIdentity === "file:src/components/Button.tsx",
    );
    expect(definesEdge).toBeDefined();
    expect(definesEdge?.targetNodeIdentity).toBe("sym:sym:src/components/Button.tsx#Button");

    const exportsEdge = edges.find(
      (e) =>
        e.relationshipType === "EXPORTS" &&
        e.sourceNodeIdentity === "file:src/components/Button.tsx",
    );
    expect(exportsEdge).toBeDefined();

    const dependsEdge = edges.find(
      (e) => e.relationshipType === "DEPENDS_ON" && e.targetNodeIdentity === "pkg:react",
    );
    expect(dependsEdge).toBeDefined();

    // Check Verified Test Association Edge
    const testEdge = edges.find(
      (e) =>
        e.relationshipType === "TESTS" &&
        e.sourceNodeIdentity === "file:tests/unit/Button.test.tsx",
    );
    expect(testEdge).toBeDefined();
    expect(testEdge?.targetNodeIdentity).toBe("file:src/components/Button.tsx");
    expect(testEdge?.confidence).toBe(1.0);
    expect(testEdge?.relationshipStatus).toBe("CONFIRMED");
  });

  it("marks unresolved module imports with UNRESOLVED status", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/entry.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: "hash_entry",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/entry.ts", {
      canonicalPath: "src/entry.ts",
      symbols: [],
      imports: [
        {
          specifier: "./non-existent.ts",
          resolvedPath: null,
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "external_or_missing",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    const { nodes, edges } = GraphBuilder.buildGraph({
      repositoryIdentity: "test-unresolved",
      files,
      extractions,
    });

    const modNode = nodes.find((n) => n.nodeIdentity === "mod:./non-existent.ts");
    expect(modNode).toBeDefined();
    expect(modNode?.category).toBe("module");

    const unresEdge = edges.find((e) => e.targetNodeIdentity === "mod:./non-existent.ts");
    expect(unresEdge).toBeDefined();
    expect(unresEdge?.relationshipStatus).toBe("UNRESOLVED");
  });
});
