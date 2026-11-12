/**
 * Phase 7.3 — Snapshot Writer
 * Transaction-safe persistence of scanner inventory, structural extractions, and graph snapshots.
 */

import type { SqliteDatabase } from "../database.ts";
import { ScanStore } from "../repositories/scan-store.ts";
import { FileStore } from "../repositories/file-store.ts";
import { SymbolStore } from "../repositories/symbol-store.ts";
import { ImportStore } from "../repositories/import-store.ts";
import { ExportStore } from "../repositories/export-store.ts";
import { EvidenceStore } from "../repositories/evidence-store.ts";
import { GraphBuilder } from "../../graph/graph-builder.ts";
import { GraphStore } from "../../graph/graph-store.ts";
import { GraphValidator } from "../../graph/graph-validator.ts";
import type { SnapshotInput, SnapshotResult } from "../types.ts";

export class SnapshotWriter {
  public static async persist(
    db: SqliteDatabase,
    repositoryId: number,
    input: SnapshotInput,
  ): Promise<SnapshotResult> {
    const startTime = Date.now();
    const scanStore = new ScanStore(db);
    const fileStore = new FileStore(db);
    const symbolStore = new SymbolStore(db);
    const importStore = new ImportStore(db);
    const exportStore = new ExportStore(db);
    const evidenceStore = new EvidenceStore(db);
    const graphStore = new GraphStore(db);

    const diagnostics: string[] = [];

    // 1. Create Scan Record (Status: RUNNING)
    const scanRecord = scanStore.createScanRun({
      repositoryId,
      scannerVersion: input.scannerVersion,
      extractorVersion: input.extractorVersion,
    });
    const scanId = scanRecord.id;

    try {
      // 2. Persist File Inventory
      const pathToId = fileStore.insertFiles(repositoryId, scanId, input.inventory.files);
      scanStore.updateProgress({
        scanId,
        filesDiscovered: input.inventory.summary.totalFilesDiscovered,
        filesIndexed: pathToId.size,
      });

      // 3. Persist Symbols, Evidence, Imports & Exports
      const globalSymbolMap = new Map<string, number>();
      let symbolsIndexedCount = 0;
      let importsIndexedCount = 0;
      let exportsIndexedCount = 0;

      for (const [canonicalPath, extraction] of input.extractions.entries()) {
        const fileId = pathToId.get(canonicalPath);
        if (!fileId) continue;

        // Symbols
        if (extraction.symbols.length > 0) {
          const symMap = symbolStore.insertSymbols({
            repositoryId,
            scanId,
            fileId,
            symbols: extraction.symbols,
            evidenceStore,
          });
          for (const [k, v] of symMap.entries()) {
            globalSymbolMap.set(k, v);
          }
          symbolsIndexedCount += extraction.symbols.length;
        }

        // Imports
        if (extraction.imports.length > 0) {
          importStore.insertImports({
            repositoryId,
            scanId,
            sourceFileId: fileId,
            imports: extraction.imports,
            pathToId,
            evidenceStore,
          });
          importsIndexedCount += extraction.imports.length;
        }

        // Exports
        if (extraction.exports.length > 0) {
          exportStore.insertExports({
            repositoryId,
            scanId,
            fileId,
            exports: extraction.exports,
            symbolMap: globalSymbolMap,
            evidenceStore,
          });
          exportsIndexedCount += extraction.exports.length;
        }
      }

      // 4. Build Engineering Graph
      const { nodes, edges } = GraphBuilder.buildGraph({
        repositoryIdentity: input.repositoryIdentity,
        files: input.inventory.files,
        extractions: input.extractions,
        pathToId,
      });

      // 5. Persist Graph Nodes & Edges
      const { nodesCount, edgesCount } = graphStore.insertGraph({
        repositoryId,
        scanId,
        nodes,
        edges,
        pathToId,
        symbolMap: globalSymbolMap,
      });

      // 6. Validation Phase
      scanStore.updateProgress({
        scanId,
        status: "VALIDATING",
      });

      const validationIssues = GraphValidator.validate(graphStore, scanId);
      const errors = validationIssues.filter((i) => i.severity === "error");

      if (errors.length > 0) {
        throw new Error(
          `Snapshot graph validation failed with ${errors.length} error(s): ${errors[0].message}`,
        );
      }

      // 7. Complete Scan Record
      const finalStatus = input.inventory.scanStatus === "COMPLETE" ? "COMPLETE" : "PARTIAL";
      scanStore.completeScan(scanId, finalStatus);

      // 8. Atomic Promotion: Update active_scan_id
      scanStore.promoteScan(repositoryId, scanId);

      return {
        scanId,
        repositoryId,
        status: finalStatus,
        filesIndexed: pathToId.size,
        symbolsIndexed: symbolsIndexedCount,
        importsIndexed: importsIndexedCount,
        exportsIndexed: exportsIndexedCount,
        nodesCreated: nodesCount,
        edgesCreated: edgesCount,
        promoted: true,
        durationMs: Date.now() - startTime,
        diagnostics,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      diagnostics.push(errorMsg);
      // Mark scan run as FAILED; existing active_scan_id is preserved
      scanStore.failScan(scanId, errorMsg);

      return {
        scanId,
        repositoryId,
        status: "FAILED",
        filesIndexed: 0,
        symbolsIndexed: 0,
        importsIndexed: 0,
        exportsIndexed: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        promoted: false,
        durationMs: Date.now() - startTime,
        diagnostics,
      };
    }
  }
}
