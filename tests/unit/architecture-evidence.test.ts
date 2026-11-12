import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ArchitectureAnalyzer } from "../../scripts/architecture/architecture-analyzer.ts";
import type { FileInventoryResult, ScannedFileRecord } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("architecture-evidence (Adversarial Fixtures & Conservative Evidence)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  let architectureAnalyzer: ArchitectureAnalyzer;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-arch-ev-"));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();
    architectureAnalyzer = new ArchitectureAnalyzer(connectionManager.getDatabase());
  });

  afterEach(async () => {
    await storageManager.close();
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  function createInventory(files: ScannedFileRecord[]): FileInventoryResult {
    return {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files,
      summary: {
        totalFilesDiscovered: files.length,
        totalFilesInspected: files.length,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: 1000,
        totalBytesInspected: 1000,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: 1000,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("does NOT classify a folder named backend containing only markdown documentation as a backend component", async () => {
    const repo = connectionManager.getRepository();

    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "backend/README.md",
        fileExtension: ".md",
        classification: "documentation",
        sizeBytes: 400,
        mtimeMs: 1700000000000,
        contentHash: "hash_doc",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "backend/ARCHITECTURE.md",
        fileExtension: ".md",
        classification: "documentation",
        sizeBytes: 600,
        mtimeMs: 1700000000000,
        contentHash: "hash_arch",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: createInventory(files),
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const components = await architectureAnalyzer.getComponents(repo.id);

    // Guard check: backend containing only documentation must NOT be classified as backend!
    const backendComp = components.find(
      (c) => c.rootPath === "backend" && c.category === "backend",
    );
    expect(backendComp).toBeUndefined();
  });

  it("marks an unused index.ts undeclared in package.json as INFERRED, not CONFIRMED", async () => {
    const repo = connectionManager.getRepository();

    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/index.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 200,
        mtimeMs: 1700000000000,
        contentHash: "hash_idx",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/index.ts", {
      canonicalPath: "src/index.ts",
      symbols: [
        {
          symbolId: "sym:src/index.ts#unusedHelper",
          name: "unusedHelper",
          parentScope: null,
          kind: "function",
          fingerprint: "fp_h",
          isExported: true,
          sourceEvidence: { lineStart: 1, lineEnd: 5, colStart: 0, colEnd: 1, evidenceHash: "ev1" },
        },
      ],
      imports: [],
      exports: [
        {
          name: "unusedHelper",
          localName: "unusedHelper",
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

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: createInventory(files),
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const entrypoints = await architectureAnalyzer.getEntrypoints(repo.id);
    const indexEntry = entrypoints.find((e) => e.filePath === "src/index.ts")!;

    expect(indexEntry).toBeDefined();
    // Invariant: Filename alone CANNOT establish confirmed entrypoint!
    expect(indexEntry.status).toBe("INFERRED");
    expect(indexEntry.confidence).toBeLessThanOrEqual(0.75);
  });

  it("ensures naming-convention test associations are visibly INFERRED, never CONFIRMED", async () => {
    const repo = connectionManager.getRepository();

    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/calculator.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 150,
        mtimeMs: 1700000000000,
        contentHash: "hash_calc",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "tests/unit/calculator.test.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 250,
        mtimeMs: 1700000000000,
        contentHash: "hash_test",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    // Notice: Test file does NOT import calculator.ts (zero imports in extraction)
    const extractions = new Map<string, ExtractionResult>();
    extractions.set("tests/unit/calculator.test.ts", {
      canonicalPath: "tests/unit/calculator.test.ts",
      symbols: [],
      imports: [], // No import evidence!
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: createInventory(files),
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const testAssociations = await architectureAnalyzer.getTestAssociations(repo.id);
    expect(testAssociations.length).toBe(1);

    const assoc = testAssociations[0];
    expect(assoc.testFilePath).toBe("tests/unit/calculator.test.ts");
    expect(assoc.sourceFilePath).toBe("src/calculator.ts");
    // Invariant: Naming convention alone MUST be INFERRED with confidence < 0.8
    expect(assoc.associationStatus).toBe("INFERRED");
    expect(assoc.confidence).toBeLessThanOrEqual(0.75);
    expect(assoc.evidenceType).toBe("naming_convention");
  });

  it("supports configurable fan-out thresholds and treats high fan-out as an informational heuristic", async () => {
    const repo = connectionManager.getRepository();

    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/hub.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: "h0",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "src/a.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: "ha",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "src/b.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: "hb",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "src/c.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: "hc",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    // hub imports a, b, c (fan-out = 3)
    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/hub.ts", {
      canonicalPath: "src/hub.ts",
      symbols: [],
      imports: [
        {
          specifier: "./a.ts",
          resolvedPath: "src/a.ts",
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
        {
          specifier: "./b.ts",
          resolvedPath: "src/b.ts",
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
        {
          specifier: "./c.ts",
          resolvedPath: "src/c.ts",
          importedSymbols: "*",
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

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: createInventory(files),
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Default threshold is 5: hub (fan-out 3) is NOT flagged
    const defaultDeps = await architectureAnalyzer.getDependencies(repo.id);
    expect(defaultDeps.highFanoutModules.length).toBe(0);

    // Custom threshold of 3: hub IS identified as a high fan-out module
    const customDeps = await architectureAnalyzer.getDependencies(repo.id, undefined, {
      fanoutThreshold: 3,
    });
    expect(customDeps.highFanoutModules.length).toBe(1);
    expect(customDeps.highFanoutModules[0].filePath).toBe("src/hub.ts");
    expect(customDeps.highFanoutModules[0].dependencyCount).toBe(3);
  });
});
