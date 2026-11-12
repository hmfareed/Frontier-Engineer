import { describe, it, expect } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ArchitectureQueryEngine } from "../../scripts/query/query-engine.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("query-performance (Architecture Query Scaling Benchmarks)", () => {
  function generateSyntheticRepo(
    fileCount: number,
    symbolsPerFile: number,
    edgeDensityRatio: number,
  ) {
    const files: FileInventoryResult["files"] = [];
    const extractions = new Map<string, ExtractionResult>();

    for (let i = 0; i < fileCount; i++) {
      const subDir = i % 3 === 0 ? "components" : i % 3 === 1 ? "api" : "lib";
      const ext = subDir === "components" ? ".tsx" : ".ts";
      const canonicalPath = `src/${subDir}/module_${i}${ext}`;
      files.push({
        canonicalPath,
        fileExtension: ext,
        classification: "source",
        sizeBytes: 250,
        mtimeMs: 1700000000000 + i,
        contentHash: `hash_${i}`,
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      });

      const symbols = [];
      for (let s = 0; s < symbolsPerFile; s++) {
        symbols.push({
          symbolId: `${canonicalPath}#symbol_${s}`,
          name: `symbol_${s}`,
          parentScope: null,
          kind: "function" as const,
          isExported: s === 0,
          fingerprint: `fp_${i}_${s}`,
          sourceEvidence: {
            lineStart: s * 10 + 1,
            lineEnd: s * 10 + 9,
            colStart: 0,
            colEnd: 1,
            evidenceHash: `ev_${i}_${s}`,
          },
        });
      }

      // Add imports to subsequent files based on density
      const imports = [];
      const edgeCount = Math.floor(i * edgeDensityRatio);
      if (edgeCount > 0 && i > 0) {
        const targetIdx = (i - 1) % fileCount;
        const targetSubDir =
          targetIdx % 3 === 0 ? "components" : targetIdx % 3 === 1 ? "api" : "lib";
        const targetExt = targetSubDir === "components" ? ".tsx" : ".ts";
        const targetPath = `src/${targetSubDir}/module_${targetIdx}${targetExt}`;
        imports.push({
          specifier: `./module_${targetIdx}${targetExt}`,
          resolvedPath: targetPath,
          importedSymbols: [{ name: "symbol_0" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast" as const,
        });
      }

      extractions.set(canonicalPath, {
        canonicalPath,
        symbols,
        imports,
        exports: [
          {
            name: `symbol_0`,
            localName: `symbol_0`,
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
    }

    const inventory: FileInventoryResult = {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files,
      summary: {
        totalFilesDiscovered: fileCount,
        totalFilesInspected: fileCount,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: fileCount * 250,
        totalBytesInspected: fileCount * 250,
      },
      totalFilesScanned: fileCount,
      totalBytesScanned: fileCount * 250,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    return { inventory, extractions };
  }

  it("benchmarks small (50 files), medium (200 files), and large (600 files) query execution latencies", async () => {
    const scales = [
      { name: "Small Synthetic Repo", fileCount: 50, symbolsPerFile: 3, density: 0.5 },
      { name: "Medium Synthetic Repo", fileCount: 200, symbolsPerFile: 3, density: 0.5 },
      { name: "Large Synthetic Repo", fileCount: 600, symbolsPerFile: 3, density: 0.5 },
    ];

    for (const scale of scales) {
      const cm = new ConnectionManager({
        workspaceRoot: process.cwd(),
        inMemory: true,
      });
      const sm = new StorageManager(cm);
      await sm.initialize();

      const { inventory, extractions } = generateSyntheticRepo(
        scale.fileCount,
        scale.symbolsPerFile,
        scale.density,
      );

      const ingestStart = Date.now();
      const snapResult = await sm.persistSnapshot({
        repositoryIdentity: cm.getRepository().identity,
        rootPath: process.cwd(),
        displayName: scale.name,
        inventory,
        extractions,
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      });
      const ingestLatencyMs = Date.now() - ingestStart;

      const qe = new ArchitectureQueryEngine(cm);

      // Benchmark 1: Overview Query
      const overviewStart = Date.now();
      const overviewRes = await qe.getOverview();
      const overviewLatencyMs = Date.now() - overviewStart;

      // Benchmark 2: Components List Query
      const compStart = Date.now();
      const compRes = await qe.listComponents({ limit: 50 });
      const compLatencyMs = Date.now() - compStart;

      // Benchmark 3: Dependency Traversal Query (depth: 3)
      const depStart = Date.now();
      const depRes = await qe.getDependencies("src/api/module_1.ts", { depth: 3 });
      const depLatencyMs = Date.now() - depStart;

      // Benchmark 4: Cycle Detection Query
      const cycleStart = Date.now();
      const cycleRes = await qe.getCycles();
      const cycleLatencyMs = Date.now() - cycleStart;

      // Benchmark 5: Symbol Search Query
      const symStart = Date.now();
      const symRes = await qe.getSymbol("symbol_0");
      const symLatencyMs = Date.now() - symStart;

      console.log(`[QUERY BENCHMARK - ${scale.name}]`);
      console.log(`  - Files: ${scale.fileCount}`);
      console.log(`  - Total Extracted Symbols: ${scale.fileCount * scale.symbolsPerFile}`);
      console.log(`  - Graph Nodes Created: ${snapResult.nodesCreated}`);
      console.log(`  - Graph Edges Created: ${snapResult.edgesCreated}`);
      console.log(`  - Ingestion Latency: ${ingestLatencyMs}ms`);
      console.log(`  - Overview Query Latency: ${overviewLatencyMs}ms`);
      console.log(`  - Components Query Latency: ${compLatencyMs}ms`);
      console.log(`  - Dependencies Query Latency (depth 3): ${depLatencyMs}ms`);
      console.log(`  - Cycle Detection Query Latency: ${cycleLatencyMs}ms`);
      console.log(`  - Symbol Search Latency: ${symLatencyMs}ms`);

      expect(overviewRes.data.counts.files).toBe(scale.fileCount);
      expect(compRes.data.components.length).toBeGreaterThan(0);
      expect(depRes.data.direction).toBe("dependencies");
      expect(cycleRes.data.totalCycles).toBeDefined();
      expect(symRes.data.symbols.length).toBeGreaterThan(0);

      // Strict latency budgets: individual queries must finish under 250ms even under parallel worker load
      expect(overviewLatencyMs).toBeLessThan(250);
      expect(compLatencyMs).toBeLessThan(250);
      expect(depLatencyMs).toBeLessThan(250);
      expect(cycleLatencyMs).toBeLessThan(250);
      expect(symLatencyMs).toBeLessThan(250);

      await sm.close();
    }
  });
});
