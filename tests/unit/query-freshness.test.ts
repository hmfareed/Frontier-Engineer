import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    for (const f of files) {
      const full = path.join(ws, f);
      if (!fs.existsSync(full)) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `content of ${f}`, "utf8");
        const t = new Date(1700000000000);
        fs.utimesSync(full, t, t);
      }
    }

    return {
      workspaceRoot: ws,
      scannedAt: new Date(1700000001000).toISOString(),
      scanStatus: isPartial ? "PARTIAL_WITH_ERRORS" : "COMPLETE",
      files: files.map((f) => {
        const full = path.join(ws, f);
        const stat = fs.existsSync(full)
          ? fs.statSync(full)
          : { size: 100, mtimeMs: 1700000000000 };
        return {
          canonicalPath: f,
          fileExtension: path.posix.extname(f),
          classification: "source" as const,
          sizeBytes: stat.size,
          mtimeMs: 1700000000000,
          contentHash: `hash_${f}`,
          hashState: "COMPUTED" as const,
          inspectionStatus: "INCLUDED" as const,
          exclusionStatus: "INCLUDED" as const,
          exclusionReason: null,
        };
      }),
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

  it("reports FAILED when workspace root does not exist", async () => {
    const ws = path.join(os.tmpdir(), "non-existent-workspace-path-12345");
    const memCm = new ConnectionManager({ workspaceRoot: process.cwd(), inMemory: true });
    await memCm.initialize();
    const db = memCm.getDatabase();

    const freshness = FreshnessEvaluator.evaluate(db, 1, ws);
    expect(freshness.status).toBe("FAILED");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("does not exist");
  });

  it("distinguishes an inaccessible workspace root from a missing root", async () => {
    const ws = createTempWorkspace();
    const memCm = new ConnectionManager({ workspaceRoot: process.cwd(), inMemory: true });
    await memCm.initialize();
    const db = memCm.getDatabase();

    const accessSpy = vi.spyOn(fs, "accessSync").mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });

    const freshness = FreshnessEvaluator.evaluate(db, 1, ws);
    accessSpy.mockRestore();

    expect(freshness.status).toBe("FAILED");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("is inaccessible");
    expect(freshness.staleReason).toContain("EACCES");
  });

  it("reports FRESH when scan succeeded without drift", async () => {
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
    expect(["FRESH", "COMPLETE"]).toContain(freshness.status);
    expect(freshness.isStale).toBe(false);
    expect(freshness.isPartial).toBe(false);
    expect(freshness.activeScanId).toBeDefined();
    expect(freshness.checkedFilesCount).toBe(1);
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
    expect(freshness.isStale).toBe(false);
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

  it("detects staleness when an indexed source file is modified after indexing", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/service.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "src-mod-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Touch src/service.ts with a later modification time
    const srcPath = path.join(ws, "src/service.ts");
    const futureTime = new Date(Date.now() + 15000);
    fs.utimesSync(srcPath, futureTime, futureTime);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("src/service.ts");
  });

  it("detects staleness when an indexed source file is deleted after indexing", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/deleted.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "src-del-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Delete the file on disk
    fs.unlinkSync(path.join(ws, "src/deleted.ts"));

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("deleted after indexing");
  });

  it("detects staleness when a new source file is added after indexing", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/original.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "src-add-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Add a new source file to src
    fs.writeFileSync(path.join(ws, "src/new-feature.ts"), "export const x = 1;", "utf8");

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("src/new-feature.ts");
  });

  it("detects staleness when file content changes with preserved timestamp via size difference", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/tampered.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "tamper-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Overwrite with larger content while resetting modification time to the indexed timestamp
    const fullPath = path.join(ws, "src/tampered.ts");
    fs.writeFileSync(fullPath, "vastly larger content appended to file to change size", "utf8");
    const t = new Date(1700000000000);
    fs.utimesSync(fullPath, t, t);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("preserved");
  });

  it("detects staleness when latest scan failed superseding older active snapshot", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/ok.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "failed-latest-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    // Insert a subsequent failed scan run in scan_runs
    db.prepare(
      `INSERT INTO scan_runs (
        repository_id, started_at, completed_at, status, scanner_version, extractor_version, is_active, failure_reason
      ) VALUES (?, ?, ?, 'FAILED', '0.6.3', '0.6.3', 0, 'OutOfMemory during extraction')`,
    ).run(repo.id, new Date().toISOString(), new Date().toISOString());

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleReason).toContain("OutOfMemory during extraction");
  });

  it("discloses metadata limitations when same-size content is modified with preserved timestamp under INVENTORY_METADATA", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/data.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "metadata-disclosure-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const fullPath = path.join(ws, "src/data.ts");
    const originalContent = fs.readFileSync(fullPath, "utf8");
    const modifiedContent = "C" + originalContent.slice(1);
    expect(Buffer.byteLength(modifiedContent)).toBe(Buffer.byteLength(originalContent));
    fs.writeFileSync(fullPath, modifiedContent, "utf8");

    const t = new Date(1700000000000);
    fs.utimesSync(fullPath, t, t);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.isStale).toBe(false);
    expect(freshness.strategy).toBe("INVENTORY_METADATA");
    expect(freshness.disclosures).toBeDefined();
    expect(freshness.disclosures![0]).toContain("Metadata-only evaluation");
    expect(freshness.disclosures![0]).toContain(
      "preserve file size and modification timestamps within tolerance cannot be detected without content hash verification",
    );
  });

  it("detects staleness when same-size content is modified with preserved timestamp under CONTENT_HASH strategy", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/data.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "content-hash-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const fullPath = path.join(ws, "src/data.ts");
    const originalContent = fs.readFileSync(fullPath, "utf8");
    const modifiedContent = "X" + originalContent.slice(1);
    expect(Buffer.byteLength(modifiedContent)).toBe(Buffer.byteLength(originalContent));
    fs.writeFileSync(fullPath, modifiedContent, "utf8");

    const t = new Date(1700000000000);
    fs.utimesSync(fullPath, t, t);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws, { verifyContentHashes: true });
    expect(freshness.status).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.strategy).toBe("CONTENT_HASH");
    expect(freshness.staleReason).toContain("content hash mismatch");
  });

  it("evaluates source modification inside 1000ms timestamp tolerance window", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, ["src/service.ts"]);
    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "tolerance-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const fullPath = path.join(ws, "src/service.ts");
    const toleranceTime = new Date(1700000000500);
    fs.utimesSync(fullPath, toleranceTime, toleranceTime);

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const freshnessMeta = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshnessMeta.isStale).toBe(false);
    expect(freshnessMeta.strategy).toBe("INVENTORY_METADATA");
    expect(freshnessMeta.disclosures![0]).toContain(
      "preserve file size and modification timestamps within tolerance cannot be detected",
    );

    const beyondToleranceTime = new Date(1700000002000);
    fs.utimesSync(fullPath, beyondToleranceTime, beyondToleranceTime);

    const freshnessBeyond = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshnessBeyond.status).toBe("STALE");
    expect(freshnessBeyond.isStale).toBe(true);
    expect(freshnessBeyond.staleReason).toContain("modified after indexing");
  });
});
