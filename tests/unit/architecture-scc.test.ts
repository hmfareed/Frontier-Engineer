import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { CycleAnalyzer } from "../../scripts/architecture/cycle-analyzer.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("architecture-scc (Tarjan SCC & Deterministic Cycle Isolation)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();
  });

  afterEach(async () => {
    await storageManager.close();
  });

  function createMockInventory(files: string[]): FileInventoryResult {
    return {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f,
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 100,
        mtimeMs: 1700000000000,
        contentHash: `hash_${f}`,
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
        totalBytesDiscovered: files.length * 100,
        totalBytesInspected: files.length * 100,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.length * 100,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("detects elementary 2-node cycle A -> B -> A", async () => {
    const repo = connectionManager.getRepository();
    const inventory = createMockInventory(["src/a.ts", "src/b.ts"]);

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/a.ts", {
      canonicalPath: "src/a.ts",
      symbols: [],
      imports: [
        {
          specifier: "./b.ts",
          resolvedPath: "src/b.ts",
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

    extractions.set("src/b.ts", {
      canonicalPath: "src/b.ts",
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
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    const snapResult = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const result = CycleAnalyzer.analyze(db, snapResult.repositoryId, snapResult.scanId);

    expect(result.totalCycles).toBe(1);
    expect(result.circularCandidates.length).toBe(1);
    const candidate = result.circularCandidates[0];
    expect(candidate.length).toBe(2);
    expect(candidate.cycle[0]).toBe("src/a.ts");
    expect(candidate.cycle[1]).toBe("src/b.ts");
    expect(candidate.cycle[2]).toBe("src/a.ts");

    expect(result.stronglyConnectedComponents.length).toBe(1);
    expect(result.stronglyConnectedComponents[0].size).toBe(2);
    expect(result.stronglyConnectedComponents[0].isCycle).toBe(true);
  });

  it("returns zero cycles for a directed acyclic graph A -> B -> C", async () => {
    const repo = connectionManager.getRepository();
    const inventory = createMockInventory(["src/a.ts", "src/b.ts", "src/c.ts"]);

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/a.ts", {
      canonicalPath: "src/a.ts",
      symbols: [],
      imports: [
        {
          specifier: "./b.ts",
          resolvedPath: "src/b.ts",
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

    extractions.set("src/b.ts", {
      canonicalPath: "src/b.ts",
      symbols: [],
      imports: [
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

    extractions.set("src/c.ts", {
      canonicalPath: "src/c.ts",
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    const snapResult = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const result = CycleAnalyzer.analyze(db, snapResult.repositoryId, snapResult.scanId);

    expect(result.totalCycles).toBe(0);
    expect(result.circularCandidates.length).toBe(0);
    // All SCCs must be singletons of size 1 with isCycle = false
    expect(result.stronglyConnectedComponents.every((s) => !s.isCycle)).toBe(true);
  });
});
