import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";
import { RetrievalEngine } from "../../scripts/retrieval/index.ts";

describe("retrieval-performance (1000+ File Bounded Latency Benchmark)", () => {
  const tempDirs: string[] = [];
  const managers: ConnectionManager[] = [];

  afterEach(() => {
    for (const cm of managers.splice(0)) {
      cm.close();
    }
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("retrieves bounded role-aware context on a 1000-file repository well under budget", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "fe-ret-perf-"));
    tempDirs.push(ws);
    fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "perf-repo" }), "utf8");

    const fileCount = 1000;
    const files: FileInventoryResult["files"] = [];
    const extractions = new Map<string, ExtractionResult>();

    for (let i = 0; i < fileCount; i++) {
      const subDir = i % 3 === 0 ? "components" : i % 3 === 1 ? "api" : "lib";
      const canonicalPath = `src/${subDir}/mod_${i}.ts`;
      files.push({
        canonicalPath,
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 300,
        mtimeMs: 1700000000000,
        contentHash: `hash_${i}`,
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      });

      const symbols = [0, 1, 2].map((s) => ({
        symbolId: `${canonicalPath}#sym_${i}_${s}`,
        name: `sym_${i}_${s}`,
        parentScope: null,
        kind: "function" as const,
        isExported: s === 0,
        fingerprint: `fp_${i}_${s}`,
        sourceEvidence: {
          lineStart: s * 8 + 1,
          lineEnd: s * 8 + 6,
          colStart: 0,
          colEnd: 1,
          evidenceHash: `ev_${i}_${s}`,
        },
      }));

      extractions.set(canonicalPath, {
        canonicalPath,
        symbols,
        imports:
          i > 0
            ? [
                {
                  specifier: `./mod_${i - 1}.ts`,
                  resolvedPath: `src/${(i - 1) % 3 === 0 ? "components" : (i - 1) % 3 === 1 ? "api" : "lib"}/mod_${i - 1}.ts`,
                  importedSymbols: [{ name: `sym_${i - 1}_0` }],
                  isTypeOnly: false,
                  isDynamic: false,
                  evidenceClassification: "syntactic_ast",
                },
              ]
            : [],
        exports: [],
        callExpressions: [],
        status: "SUCCESS",
        diagnostics: [],
      });
    }

    const targetDiskFile = path.join(ws, "src", "api", "mod_250.ts");
    fs.mkdirSync(path.dirname(targetDiskFile), { recursive: true });
    fs.writeFileSync(targetDiskFile, "export function sym_250_0() { return 250; }\n", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    managers.push(cm);
    const sm = new StorageManager(cm);
    await sm.initialize();

    const snap = await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "perf-repo",
      inventory: {
        workspaceRoot: ws,
        scannedAt: new Date().toISOString(),
        scanStatus: "COMPLETE",
        files,
        summary: {
          totalFilesDiscovered: fileCount,
          totalFilesInspected: fileCount,
          totalFilesExcluded: 0,
          totalFilesUnreadable: 0,
          totalBytesDiscovered: fileCount * 300,
          totalBytesInspected: fileCount * 300,
        },
        totalFilesScanned: fileCount,
        totalBytesScanned: fileCount * 300,
        limitExceeded: false,
        scanDurationMs: 50,
      },
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const memStore = new MemoryStore(cm.getDatabase());
    const repo = cm.getRepository();
    for (let m = 0; m < 20; m++) {
      const mem = memStore.createMemory({
        repositoryId: repo.id,
        memoryKey: `perf-mem-${m}`,
        category: "engineering_convention",
        title: `Convention ${m}`,
        content: `Follow convention ${m} for module ${m * 10}.`,
        firstSeenScanId: snap.scanId,
        lastSeenScanId: snap.scanId,
      });
      memStore.addEvidence({
        repositoryId: repo.id,
        memoryId: mem.id,
        scanId: snap.scanId,
        evidenceType: "source_file",
        sourcePath: `src/${(m * 10) % 3 === 0 ? "components" : (m * 10) % 3 === 1 ? "api" : "lib"}/mod_${m * 10}.ts`,
        description: "Module exists",
      });
    }

    const engine = new RetrievalEngine(cm);
    const start = performance.now();
    const res = await engine.retrieve({
      agentId: "implementation-engineer",
      taskSummary: "Refactor sym_250_0 in src/api/mod_250.ts and check dependents",
    });
    const elapsedMs = performance.now() - start;

    expect(res.context.files.some((f) => f.filePath === "src/api/mod_250.ts")).toBe(true);
    expect(res.budget.includedCount).toBeLessThanOrEqual(35);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
