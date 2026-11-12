import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ArchitectureQueryEngine } from "../../scripts/query/query-engine.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("query-engine (Architecture Query Engine APIs & DTO Contract)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  let queryEngine: ArchitectureQueryEngine;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-qe-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    if (storageManager) await storageManager.close();
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  function createMockInventory(
    ws: string,
    files: { path: string; size: number }[],
  ): FileInventoryResult {
    return {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f.path,
        fileExtension: path.posix.extname(f.path),
        classification: f.path.endsWith(".md") ? "documentation" : "source",
        sizeBytes: f.size,
        mtimeMs: 1700000000000,
        contentHash: `hash_${f.path}`,
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      })),
      summary: {
        totalFilesDiscovered: files.length,
        totalFilesInspected: files.length,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: files.reduce((acc, f) => acc + f.size, 0),
        totalBytesInspected: files.reduce((acc, f) => acc + f.size, 0),
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.reduce((acc, f) => acc + f.size, 0),
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  async function setupFixtureWorkspace(): Promise<{ ws: string; scanId: number }> {
    const ws = createTempWorkspace();

    // Package.json
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({
        name: "test-query-app",
        main: "./src/index.ts",
        bin: { "test-cli": "./bin/cli.js" },
        scripts: { start: "node src/server.js" },
      }),
      "utf8",
    );

    // ADR
    const adrDir = path.join(ws, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(
      path.join(adrDir, "ADR-001-initial-architecture.md"),
      `# ADR-001: Initial Architecture\n\n- **Status:** Accepted\n- **Date:** 2026-11-12\n\nGoverns src/components.`,
      "utf8",
    );

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, [
      { path: "src/index.ts", size: 300 },
      { path: "src/server.js", size: 500 },
      { path: "bin/cli.js", size: 200 },
      { path: "src/components/Button.tsx", size: 400 },
      { path: "src/utils/math.ts", size: 250 },
      { path: "tests/unit/button.test.tsx", size: 350 },
      { path: "docs/adr/ADR-001-initial-architecture.md", size: 200 },
    ]);

    const extractions = new Map<string, ExtractionResult>();

    // Symbol & imports in Button.tsx
    extractions.set("src/components/Button.tsx", {
      canonicalPath: "src/components/Button.tsx",
      symbols: [
        {
          symbolId: "src/components/Button.tsx#Button",
          name: "Button",
          parentScope: null,
          kind: "react_component",
          isExported: true,
          fingerprint: "fp_button_123",
          sourceEvidence: {
            lineStart: 5,
            lineEnd: 20,
            colStart: 0,
            colEnd: 1,
            evidenceHash: "ev_btn",
          },
        },
      ],
      imports: [
        {
          specifier: "../utils/math.ts",
          resolvedPath: "src/utils/math.ts",
          importedSymbols: [{ name: "add" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [
        {
          name: "Button",
          localName: "Button",
          isReExport: false,
          sourceModule: null,
          isTypeOnly: false,
          isWildcard: false,
        },
      ],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    // Tests imports Button
    extractions.set("tests/unit/button.test.tsx", {
      canonicalPath: "tests/unit/button.test.tsx",
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

    const snapResult = await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "test-query-app",
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    queryEngine = new ArchitectureQueryEngine(connectionManager);
    return { ws, scanId: snapResult.scanId };
  }

  it("satisfies the base query result contract across all endpoints", async () => {
    const { scanId } = await setupFixtureWorkspace();

    const statusRes = await queryEngine.getStatus();
    expect(statusRes.repositoryId).toBeDefined();
    expect(statusRes.repositoryIdentity).toBeDefined();
    expect(statusRes.scanId).toBe(scanId);
    expect(statusRes.snapshotStatus).toBe("COMPLETE");
    expect(statusRes.freshness).toBeDefined();
    expect(statusRes.query.category).toBe("status");
    expect(statusRes.generatedAt).toBeDefined();
    expect(statusRes.limitsApplied).toBeDefined();
  });

  it("executes getOverview with counts, languages, and component summaries", async () => {
    await setupFixtureWorkspace();

    const overview = await queryEngine.getOverview();
    expect(overview.data.repositoryIdentity).toBeDefined();
    expect(overview.data.counts.files).toBe(7);
    expect(overview.data.counts.symbols).toBeGreaterThanOrEqual(1);
    expect(overview.data.languages.length).toBeGreaterThan(0);
    expect(overview.data.componentsSummary.totalComponents).toBeGreaterThan(0);
    expect(overview.evidence.length).toBeGreaterThan(0);
  });

  it("lists components and allows inspecting a specific component", async () => {
    await setupFixtureWorkspace();

    const listRes = await queryEngine.listComponents();
    expect(listRes.data.components.length).toBeGreaterThan(0);
    const compItem = listRes.data.components.find((c) => c.category === "frontend")!;
    expect(compItem).toBeDefined();

    const detailRes = await queryEngine.getComponent(compItem.name);
    expect(detailRes.data.component.category).toBe("frontend");
    expect(detailRes.data.files).toContain("src/components/Button.tsx");
    expect(detailRes.data.symbolsCount).toBeGreaterThan(0);
    expect(detailRes.data.associatedTests).toContain("tests/unit/button.test.tsx");
  });

  it("throws not found when querying non-existent component", async () => {
    await setupFixtureWorkspace();
    await expect(queryEngine.getComponent("non-existent-comp")).rejects.toThrowError(/not found/i);
  });

  it("inspects file details with extracted symbols, imports, and exports", async () => {
    await setupFixtureWorkspace();

    const fileRes = await queryEngine.getFile("src/components/Button.tsx");
    expect(fileRes.data.file.normalizedPath).toBe("src/components/Button.tsx");
    expect(fileRes.data.symbols.length).toBe(1);
    expect(fileRes.data.symbols[0].name).toBe("Button");
    expect(fileRes.data.exports.length).toBe(1);
    expect(fileRes.data.imports.length).toBe(1);
    expect(fileRes.data.relatedTests).toContain("tests/unit/button.test.tsx");
  });

  it("searches symbols by name with line ranges and export flags", async () => {
    await setupFixtureWorkspace();

    const symRes = await queryEngine.getSymbol("Button");
    expect(symRes.data.symbols.length).toBe(1);
    expect(symRes.data.symbols[0].name).toBe("Button");
    expect(symRes.data.symbols[0].isExported).toBe(true);
    expect(symRes.data.symbols[0].filePath).toBe("src/components/Button.tsx");
  });

  it("traverses dependencies and dependents with depth and limits applied", async () => {
    await setupFixtureWorkspace();

    const depRes = await queryEngine.getDependencies("src/components/Button.tsx", { depth: 2 });
    expect(depRes.data.direction).toBe("dependencies");
    expect(depRes.data.direct.length).toBeGreaterThanOrEqual(1);
    expect(depRes.data.direct.some((d) => d.pathOrName.includes("math.ts"))).toBe(true);

    const dependentsRes = await queryEngine.getDependents("src/components/Button.tsx", {
      depth: 2,
    });
    expect(dependentsRes.data.direction).toBe("dependents");
    expect(dependentsRes.data.direct.some((d) => d.pathOrName.includes("button.test.tsx"))).toBe(
      true,
    );
  });

  it("queries test associations and detects untested modules", async () => {
    await setupFixtureWorkspace();

    const testRes = await queryEngine.getTests();
    expect(testRes.data.totalAssociated).toBeGreaterThan(0);
    expect(
      testRes.data.associations.some(
        (a) =>
          a.testFilePath === "tests/unit/button.test.tsx" &&
          a.sourceFilePath === "src/components/Button.tsx",
      ),
    ).toBe(true);
    expect(testRes.data.modulesWithoutTestAssociation).toContain("src/utils/math.ts");
  });

  it("lists ADRs and inspects single ADR details", async () => {
    await setupFixtureWorkspace();

    const adrsRes = await queryEngine.getDecisions();
    expect(adrsRes.data.totalCount).toBe(1);
    expect(adrsRes.data.decisions[0].adrId).toBe("ADR-001");

    const singleAdr = await queryEngine.getDecision("ADR-001");
    expect(singleAdr.data.decision.adrId).toBe("ADR-001");
    expect(singleAdr.data.decision.title).toBe("Initial Architecture");
    expect(singleAdr.data.decision.status).toBe("Accepted");
  });

  it("applies result limits and reports truncation indicator cleanly", async () => {
    await setupFixtureWorkspace();

    const listRes = await queryEngine.listComponents({ limit: 1 });
    expect(listRes.data.components.length).toBe(1);
    expect(listRes.limitsApplied.truncated).toBe(true);
  });
});
