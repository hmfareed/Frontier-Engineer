import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { GraphStore } from "../../scripts/graph/graph-store.ts";
import { GraphEngine } from "../../scripts/graph/graph-engine.ts";
import { ArchitectureAnalyzer } from "../../scripts/architecture/architecture-analyzer.ts";
import type { SnapshotInput } from "../../scripts/storage/types.ts";
import type { ScannedFileRecord, FileInventoryResult } from "../../scripts/scanner/types.ts";
import type {
  ExtractionResult,
  ExtractedSymbol,
  ImportRecord,
} from "../../scripts/extractor/types.ts";

describe("storage-performance (Scale Benchmark & Ingestion Latencies)", () => {
  it("benchmarks synthetic repository scaling (500 files, 1500 symbols, 1000 edges)", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-perf-test-"));
    const FILE_COUNT = 500;
    const SYMBOLS_PER_FILE = 3;

    try {
      // 1. Benchmark Connection & Database Initialization
      const initStart = Date.now();
      const cm = new ConnectionManager({ workspaceRoot: tempDir });
      const sm = new StorageManager(cm);
      await sm.initialize();
      const initDurationMs = Date.now() - initStart;

      // 2. Generate Synthetic Fixture
      const files: ScannedFileRecord[] = [];
      const extractions = new Map<string, ExtractionResult>();

      for (let i = 0; i < FILE_COUNT; i++) {
        const filePath =
          i === 0 ? "src/components/Header.tsx" : `src/module_${Math.floor(i / 10)}/file_${i}.ts`;
        const ext = i === 0 ? ".tsx" : ".ts";
        files.push({
          canonicalPath: filePath,
          fileExtension: ext,
          classification: "source",
          sizeBytes: 1200,
          mtimeMs: 1700000000000,
          contentHash: `hash_${i}`,
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        });

        const symbols: ExtractedSymbol[] = [];
        for (let s = 0; s < SYMBOLS_PER_FILE; s++) {
          symbols.push({
            symbolId: `sym:${filePath}#func_${s}`,
            name: `func_${s}`,
            parentScope: null,
            kind: "function",
            fingerprint: `fp_${i}_${s}`,
            isExported: s === 0,
            sourceEvidence: {
              lineStart: s * 10 + 1,
              lineEnd: s * 10 + 8,
              colStart: 0,
              colEnd: 1,
              evidenceHash: `ev_${i}_${s}`,
            },
          });
        }

        const imports: ImportRecord[] = [];
        if (i > 0) {
          const targetPath = `src/module_${Math.floor((i - 1) / 10)}/file_${i - 1}.ts`;
          imports.push({
            specifier: `./file_${i - 1}.ts`,
            resolvedPath: targetPath,
            importedSymbols: [{ name: "func_0" }],
            isTypeOnly: false,
            isDynamic: false,
            evidenceClassification: "syntactic_ast",
          });
        }

        extractions.set(filePath, {
          canonicalPath: filePath,
          symbols,
          imports,
          exports: [],
          callExpressions: [],
          status: "SUCCESS",
          diagnostics: [],
        });
      }

      const inventory: FileInventoryResult = {
        workspaceRoot: tempDir,
        scannedAt: new Date().toISOString(),
        scanStatus: "COMPLETE",
        files,
        summary: {
          totalFilesDiscovered: FILE_COUNT,
          totalFilesInspected: FILE_COUNT,
          totalFilesExcluded: 0,
          totalFilesUnreadable: 0,
          totalBytesDiscovered: FILE_COUNT * 1200,
          totalBytesInspected: FILE_COUNT * 1200,
        },
        totalFilesScanned: FILE_COUNT,
        totalBytesScanned: FILE_COUNT * 1200,
        limitExceeded: false,
        scanDurationMs: 50,
      };

      const repo = cm.getRepository();
      const input: SnapshotInput = {
        repositoryIdentity: repo.identity,
        rootPath: tempDir,
        displayName: "perf-test-repo",
        inventory,
        extractions,
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      };

      // 3. Benchmark Snapshot Ingestion (files, symbols, imports, graph construction & validation)
      const persistStart = Date.now();
      const result = await sm.persistSnapshot(input);
      const persistDurationMs = Date.now() - persistStart;

      expect(result.status).toBe("COMPLETE");
      expect(result.promoted).toBe(true);
      expect(result.filesIndexed).toBe(FILE_COUNT);
      expect(result.symbolsIndexed).toBe(FILE_COUNT * SYMBOLS_PER_FILE);

      // 4. Benchmark Graph Traversal
      const db = cm.getDatabase();
      const graphStore = new GraphStore(db);
      const graphEngine = new GraphEngine(db, graphStore);

      const traversalStart = Date.now();
      const traversalResult = await graphEngine.getDependencies(
        repo.id,
        `file:src/module_0/file_0.ts`,
        { maxDepth: 5 },
      );
      const traversalDurationMs = Date.now() - traversalStart;

      // 5. Benchmark Architecture Analysis
      const analyzer = new ArchitectureAnalyzer(db);
      const archStart = Date.now();
      const archResult = await analyzer.analyze(repo.id);
      const archDurationMs = Date.now() - archStart;

      expect(archResult.components.length).toBeGreaterThan(0);

      // 6. Benchmark Database Reopen
      await sm.close();
      const reopenStart = Date.now();
      const cm2 = new ConnectionManager({ workspaceRoot: tempDir });
      const sm2 = new StorageManager(cm2);
      await sm2.initialize();
      const reopenDurationMs = Date.now() - reopenStart;

      const activeScan = await sm2.getActiveScan(repo.id);
      expect(activeScan?.id).toBe(result.scanId);
      await sm2.close();

      console.log(`[PERFORMANCE BENCHMARK]
  - File Count: ${FILE_COUNT}
  - Symbol Count: ${FILE_COUNT * SYMBOLS_PER_FILE}
  - Node Count: ${result.nodesCreated}
  - Edge Count: ${result.edgesCreated}
  - DB Init Latency: ${initDurationMs}ms
  - Full Snapshot Ingestion: ${persistDurationMs}ms
  - Graph Traversal (depth 5): ${traversalDurationMs}ms
  - Architecture Analysis: ${archDurationMs}ms
  - DB Reopen & Mount: ${reopenDurationMs}ms`);

      // Performance Assertions (generous boundaries for varied CI/dev environments)
      expect(initDurationMs).toBeLessThan(1000);
      expect(persistDurationMs).toBeLessThan(5000); // 500 files + 1500 symbols ingested in < 5s
      expect(traversalDurationMs).toBeLessThan(100);
      expect(archDurationMs).toBeLessThan(1000);
      expect(reopenDurationMs).toBeLessThan(500);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });
});
