import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { FreshnessEvaluator } from "../../scripts/query/freshness-evaluator.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("query-freshness (Index Freshness & Staleness Assessment)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-fresh-test-"));
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
    files: string[],
    isPartial: boolean = false,
  ): FileInventoryResult {
    return {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: isPartial ? "PARTIAL_WITH_ERRORS" : "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f,
        fileExtension: path.posix.extname(f),
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

  it("reports NONE when no scan has been performed", async () => {
    const ws = createTempWorkspace();
    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("NONE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.activeScanId).toBeNull();
  });

  it("reports COMPLETE and fresh when scan succeeded without drift", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/index.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "fresh-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("COMPLETE");
    expect(freshness.isStale).toBe(false);
    expect(freshness.isPartial).toBe(false);
    expect(freshness.activeScanId).toBeDefined();
  });

  it("reports PARTIAL when active scan was promoted with partial opt-in", async () => {
    const ws = createTempWorkspace();
    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/partial.ts"], true);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "partial-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
      allowPartialPromotion: true,
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("PARTIAL");
    expect(freshness.isPartial).toBe(true);
  });

  it("detects staleness when configuration file is modified after scan", async () => {
    const ws = createTempWorkspace();
    const pkgPath = path.join(ws, "package.json");
    fs.writeFileSync(pkgPath, "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/index.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "stale-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Touch package.json with future timestamp to simulate post-index modification
    const futureTime = new Date(Date.now() + 10000);
    fs.utimesSync(pkgPath, futureTime, futureTime);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("package.json");
  });
});
