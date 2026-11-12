import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { SnapshotInput } from "../../scripts/storage/types.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("storage-snapshot (Transactional Snapshot & Atomic Promotion)", () => {
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

  function createMockInventory(files: { path: string; size: number }[]): FileInventoryResult {
    return {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f.path,
        fileExtension: f.path.slice(f.path.lastIndexOf(".")),
        classification: "source",
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
      scanDurationMs: 15,
    };
  }

  it("persists a complete snapshot and atomically promotes it as the active scan", async () => {
    const repo = connectionManager.getRepository();
    expect(repo.activeScanId).toBeNull();

    const inventory = createMockInventory([
      { path: "src/index.ts", size: 100 },
      { path: "src/app.ts", size: 200 },
    ]);

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/index.ts", {
      canonicalPath: "src/index.ts",
      symbols: [
        {
          symbolId: "sym:src/index.ts#main",
          name: "main",
          parentScope: null,
          kind: "function",
          fingerprint: "fp_main",
          isExported: true,
          sourceEvidence: { lineStart: 1, lineEnd: 5, colStart: 0, colEnd: 1, evidenceHash: "ev1" },
        },
      ],
      imports: [
        {
          specifier: "./app.ts",
          resolvedPath: "src/app.ts",
          importedSymbols: [{ name: "App" }],
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

    const input: SnapshotInput = {
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    };

    const result = await storageManager.persistSnapshot(input);
    expect(result.status).toBe("COMPLETE");
    expect(result.promoted).toBe(true);
    expect(result.filesIndexed).toBe(2);
    expect(result.symbolsIndexed).toBe(1);
    expect(result.importsIndexed).toBe(1);

    const activeScan = await storageManager.getActiveScan(repo.id);
    expect(activeScan).not.toBeNull();
    expect(activeScan?.id).toBe(result.scanId);
    expect(activeScan?.isActive).toBe(true);
  });

  it("preserves last-known-good active snapshot when a subsequent scan fails", async () => {
    const repo = connectionManager.getRepository();

    // 1. Create first successful snapshot
    const inv1 = createMockInventory([{ path: "src/index.ts", size: 100 }]);
    const res1 = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: inv1,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });
    expect(res1.promoted).toBe(true);
    const activeScan1 = await storageManager.getActiveScan(repo.id);
    expect(activeScan1?.id).toBe(res1.scanId);

    // 2. Simulate a second scan that fails during persistence/validation
    // by injecting an inventory with an invalid null path causing DB failure
    const badInventory: any = {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: null, // Causes NOT NULL violation
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 10,
          mtimeMs: 1700000000000,
          contentHash: "hash",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
      ],
      summary: {
        totalFilesDiscovered: 1,
        totalFilesInspected: 1,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: 10,
        totalBytesInspected: 10,
      },
    };

    const res2 = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: badInventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    expect(res2.status).toBe("FAILED");
    expect(res2.promoted).toBe(false);

    // INVARIANT CHECK: Active scan remains res1.scanId!
    const activeScanAfterFailure = await storageManager.getActiveScan(repo.id);
    expect(activeScanAfterFailure?.id).toBe(res1.scanId);
    expect(activeScanAfterFailure?.status).toBe("COMPLETE");
  });

  it("recovers interrupted scans conservatively on process restart", async () => {
    const repo = connectionManager.getRepository();
    const db = connectionManager.getDatabase();

    // Manually insert an abandoned RUNNING scan to simulate a crash during indexing
    const res = db
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repo.id, new Date().toISOString());
    const interruptedScanId = Number(res.lastInsertRowid);

    // Execute crash recovery
    const recoveredCount = await storageManager.recoverInterruptedScans(repo.id);
    expect(recoveredCount).toBe(1);

    const check = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE id = ?")
      .get(interruptedScanId) as any;
    expect(check.status).toBe("FAILED");
    expect(check.failure_reason).toContain("Interrupted");
  });

  it("validates integrity and reports orphaned records or graph issues", async () => {
    const repo = connectionManager.getRepository();
    const inventory = createMockInventory([{ path: "src/main.ts", size: 100 }]);

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const report = await storageManager.validateIntegrity(repo.id);
    expect(report.isValid).toBe(true);
    expect(report.issues.length).toBe(0);
  });
});
