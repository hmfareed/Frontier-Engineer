import { describe, it, expect } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { SnapshotComparator } from "../../scripts/evolution/snapshot-comparator.ts";
import { ComparisonSerializer } from "../../scripts/evolution/comparison-serializer.ts";
import { SnapshotValidator } from "../../scripts/evolution/snapshot-validator.ts";
import { FileDiffEngine } from "../../scripts/evolution/file-diff.ts";
import { SymbolDiffEngine } from "../../scripts/evolution/symbol-diff.ts";
import { DependencyDiffEngine } from "../../scripts/evolution/dependency-diff.ts";
import { ComponentDiffEngine } from "../../scripts/evolution/component-diff.ts";
import { AdrDiffEngine } from "../../scripts/evolution/adr-diff.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("comparator-performance (Snapshot Diff Scaling Benchmarks)", () => {
  function generateSyntheticRepo(fileCount: number, symbolsPerFile: number, variationSeed: number) {
    const files: FileInventoryResult["files"] = [];
    const extractions = new Map<string, ExtractionResult>();

    for (let i = 0; i < fileCount; i++) {
      const subDir = i % 3 === 0 ? "components" : i % 3 === 1 ? "api" : "lib";
      const ext = subDir === "components" ? ".tsx" : ".ts";
      const canonicalPath = `src/${subDir}/module_${i}${ext}`;
      // In variationSeed > 0, vary hash for 5% of files
      const isModified = variationSeed > 0 && i % 20 === 0;
      const contentHash = isModified ? `hash_v${variationSeed}_${i}` : `hash_base_${i}`;

      files.push({
        canonicalPath,
        fileExtension: ext,
        classification: "source",
        sizeBytes: 250,
        mtimeMs: 1700000000000 + i,
        contentHash,
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      });

      const symbols = [];
      for (let s = 0; s < symbolsPerFile; s++) {
        const symFp = isModified && s === 0 ? `fp_mod_${variationSeed}_${i}_${s}` : `fp_${i}_${s}`;
        symbols.push({
          symbolId: `${canonicalPath}#symbol_${s}`,
          name: `symbol_${s}`,
          parentScope: null,
          kind: "function" as const,
          isExported: s === 0,
          fingerprint: symFp,
          sourceEvidence: {
            lineStart: s * 10 + 1,
            lineEnd: s * 10 + 9,
            colStart: 0,
            colEnd: 1,
            evidenceHash: `ev_${i}_${s}`,
          },
        });
      }

      const imports = [];
      if (i > 0) {
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
            name: "symbol_0",
            localName: "symbol_0",
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

  it("benchmarks small (100 files), medium (1,000 files), and large (5,000 files) snapshot comparisons", async () => {
    const scales = [
      { name: "Small Synthetic Repo", fileCount: 100, symbolsPerFile: 3 },
      { name: "Medium Synthetic Repo", fileCount: 1000, symbolsPerFile: 3 },
      { name: "Large Synthetic Repo", fileCount: 5000, symbolsPerFile: 3 },
    ];

    for (const scale of scales) {
      const cm = new ConnectionManager({
        workspaceRoot: process.cwd(),
        inMemory: true,
      });
      const sm = new StorageManager(cm);
      await sm.initialize();
      const db = cm.getDatabase();
      const repo = cm.getRepository();

      // 1. Ingest Base Snapshot
      const baseData = generateSyntheticRepo(scale.fileCount, scale.symbolsPerFile, 0);
      const baseSnap = await sm.persistSnapshot({
        repositoryIdentity: repo.identity,
        rootPath: process.cwd(),
        displayName: `${scale.name} - Base`,
        inventory: baseData.inventory,
        extractions: baseData.extractions,
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      });

      // 2. Ingest Target Snapshot (with 5% variations)
      const targetData = generateSyntheticRepo(scale.fileCount, scale.symbolsPerFile, 1);
      const targetSnap = await sm.persistSnapshot({
        repositoryIdentity: repo.identity,
        rootPath: process.cwd(),
        displayName: `${scale.name} - Target`,
        inventory: targetData.inventory,
        extractions: targetData.extractions,
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      });

      const baseScanId = baseSnap.scanId;
      const targetScanId = targetSnap.scanId;
      const repositoryId = repo.id;

      // 3. Measure Individual Phases
      const valStart = performance.now();
      const validation = SnapshotValidator.validate(db, baseScanId, targetScanId);
      const validationMs = performance.now() - valStart;
      expect(validation.isValid).toBe(true);

      const fileStart = performance.now();
      const fileDiff = FileDiffEngine.diff(db, repositoryId, baseScanId, targetScanId);
      const fileDiffMs = performance.now() - fileStart;

      const symStart = performance.now();
      const symDiff = SymbolDiffEngine.diff(db, repositoryId, baseScanId, targetScanId);
      const symDiffMs = performance.now() - symStart;

      const depStart = performance.now();
      const depDiff = DependencyDiffEngine.diff(db, repositoryId, baseScanId, targetScanId);
      const depDiffMs = performance.now() - depStart;

      const compStart = performance.now();
      const compDiff = ComponentDiffEngine.diff(db, repositoryId, baseScanId, targetScanId);
      const compDiffMs = performance.now() - compStart;

      const adrStart = performance.now();
      const adrDiff = AdrDiffEngine.diff(db, repositoryId, baseScanId, targetScanId);
      const adrDiffMs = performance.now() - adrStart;

      // 4. Measure End-to-End Comparison
      const comparator = new SnapshotComparator(db);
      const compStartTotal = performance.now();
      const comparison = comparator.compare(baseScanId, targetScanId, { persistEvents: true });
      const totalComparisonMs = performance.now() - compStartTotal;

      // 5. Measure Serialization
      const serStart = performance.now();
      const serializedJson = ComparisonSerializer.serialize(comparison);
      const serializationMs = performance.now() - serStart;

      console.log(`[COMPARATOR BENCHMARK - ${scale.name}]`);
      console.log(`  - Files Discovered:      ${scale.fileCount}`);
      console.log(`  - Symbols Extracted:     ${scale.fileCount * scale.symbolsPerFile}`);
      console.log(`  - Validation Time:       ${validationMs.toFixed(2)} ms`);
      console.log(`  - File Diff Time:        ${fileDiffMs.toFixed(2)} ms`);
      console.log(`  - Symbol Diff Time:      ${symDiffMs.toFixed(2)} ms`);
      console.log(`  - Dependency Diff Time:  ${depDiffMs.toFixed(2)} ms`);
      console.log(`  - Component Diff Time:   ${compDiffMs.toFixed(2)} ms`);
      console.log(`  - ADR Diff Time:         ${adrDiffMs.toFixed(2)} ms`);
      console.log(
        `  - Serialization Time:    ${serializationMs.toFixed(2)} ms (payload: ${serializedJson.length} bytes)`,
      );
      console.log(`  - Total Comparison Time: ${totalComparisonMs.toFixed(2)} ms`);
      console.log(
        `  - Memory Allocated:      ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      );

      // Performance Assertions
      expect(totalComparisonMs).toBeLessThan(10000); // Must be under 10 seconds even for 5,000 files
      expect(fileDiff.result.modifiedCount).toBeGreaterThan(0);
      expect(symDiff.result.modifiedCount).toBeGreaterThan(0);

      await sm.close();
    }
  }, 60000); // 60s timeout for large scale synthetic run
});
