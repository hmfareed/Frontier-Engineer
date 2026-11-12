import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ArchitectureQueryEngine } from "../../scripts/query/query-engine.ts";
import { FreshnessEvaluator } from "../../scripts/query/freshness-evaluator.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("active-snapshot-resolution (Authoritative Active Snapshot Contract & Repository Isolation)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  const tempDirs: string[] = [];

  function createTempWorkspace(prefix = "frontier-snap-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

  function createMockInventory(ws: string, files: string[]): FileInventoryResult {
    for (const f of files) {
      const full = path.join(ws, f);
      if (!fs.existsSync(full)) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `export const data = "${f}";`, "utf8");
        const t = new Date(1700000000000);
        fs.utimesSync(full, t, t);
      }
    }

    return {
      workspaceRoot: ws,
      scannedAt: new Date(1700000001000).toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => {
        const full = path.join(ws, f);
        const stat = fs.existsSync(full) ? fs.statSync(full) : { size: 50, mtimeMs: 1700000000000 };
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
        totalBytesDiscovered: files.length * 50,
        totalBytesInspected: files.length * 50,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.length * 50,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("1. resolves active snapshot correctly from repositories.active_scan_id", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inv = createMockInventory(ws, ["src/a.ts"]);
    const persistRes = await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "snap-res-test",
      inventory: inv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    // Verify repositories.active_scan_id matches persisted scan ID
    const repoRow = db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(repo.id) as { active_scan_id: number };
    expect(repoRow.active_scan_id).toBe(persistRes.scanId);

    // Verify scan_runs.is_active is synchronized to 1
    const scanRow = db
      .prepare("SELECT is_active FROM scan_runs WHERE id = ?")
      .get(persistRes.scanId) as { is_active: number };
    expect(scanRow.is_active).toBe(1);

    // Verify ArchitectureQueryEngine resolves the active scan
    const engine = new ArchitectureQueryEngine(connectionManager);
    const overview = await engine.getOverview();
    expect(overview.scanId).toBe(persistRes.scanId);
    expect(overview.snapshotStatus).toBe("COMPLETE");
  });

  it("2. handles missing active snapshot gracefully without arbitrary selection", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    const repoRow = db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(repo.id) as { active_scan_id: number | null };
    expect(repoRow.active_scan_id).toBeNull();

    const engine = new ArchitectureQueryEngine(connectionManager);
    // Querying overview on unindexed repo throws clear descriptive error
    await expect(engine.getOverview()).rejects.toThrow("No active scan index available");

    // Status query succeeds and reports null activeScanId
    const status = await engine.getStatus();
    expect(status.data.activeScanId).toBeNull();
    expect(status.data.isFresh).toBe(false);
  });

  it("3. preserves an older COMPLETE active snapshot when a newer scan fails", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inv = createMockInventory(ws, ["src/stable.ts"]);
    const persist1 = await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "stable-repo",
      inventory: inv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    // Insert subsequent failed scan run
    db.prepare(
      `INSERT INTO scan_runs (
        repository_id, started_at, completed_at, status, scanner_version, extractor_version, is_active, failure_reason
      ) VALUES (?, ?, ?, 'FAILED', '0.6.3', '0.6.3', 0, 'Parser crash on malformed AST')`,
    ).run(repo.id, new Date().toISOString(), new Date().toISOString());

    // repositories.active_scan_id MUST remain the stable scan ID
    const repoRow = db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(repo.id) as { active_scan_id: number };
    expect(repoRow.active_scan_id).toBe(persist1.scanId);

    // FreshnessEvaluator detects that the active scan is superseded by a newer failed scan
    const freshness = FreshnessEvaluator.evaluate(db, repo.id, ws);
    expect(freshness.isStale).toBe(true);
    expect(freshness.status).toBe("STALE");
    expect(freshness.staleReason).toContain("Parser crash on malformed AST");
  });

  it("4. historical snapshot selection does not mutate the active snapshot pointer", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    // Scan 1
    const inv1 = createMockInventory(ws, ["src/v1.ts"]);
    const persist1 = await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "hist-repo",
      inventory: inv1,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    // Scan 2
    const inv2 = createMockInventory(ws, ["src/v1.ts", "src/v2.ts"]);
    const persist2 = await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "hist-repo",
      inventory: inv2,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();

    // Active scan is scan 2
    let repoRow = db
      .prepare("SELECT active_scan_id FROM repositories WHERE id = ?")
      .get(repo.id) as { active_scan_id: number };
    expect(repoRow.active_scan_id).toBe(persist2.scanId);

    const engine = new ArchitectureQueryEngine(connectionManager);

    // Query historical scan 1 explicitly
    const historicalOverview = await engine.getOverview({ scanId: persist1.scanId });
    expect(historicalOverview.scanId).toBe(persist1.scanId);

    // Authoritative active scan in database MUST NOT be changed
    repoRow = db.prepare("SELECT active_scan_id FROM repositories WHERE id = ?").get(repo.id) as {
      active_scan_id: number;
    };
    expect(repoRow.active_scan_id).toBe(persist2.scanId);
  });

  it("5. enforces repository isolation: active scan resolution never crosses repository boundaries", async () => {
    const wsA = createTempWorkspace("frontier-repoA-");
    const wsB = createTempWorkspace("frontier-repoB-");

    fs.writeFileSync(path.join(wsA, "package.json"), JSON.stringify({ name: "repo-a" }), "utf8");
    fs.writeFileSync(path.join(wsB, "package.json"), JSON.stringify({ name: "repo-b" }), "utf8");

    const cmA = new ConnectionManager({ workspaceRoot: wsA });
    const smA = new StorageManager(cmA);
    await smA.initialize();

    const cmB = new ConnectionManager({ workspaceRoot: wsB });
    const smB = new StorageManager(cmB);
    await smB.initialize();

    const invA = createMockInventory(wsA, ["src/moduleA.ts"]);
    const persistA = await smA.persistSnapshot({
      repositoryIdentity: cmA.getRepository().identity,
      rootPath: wsA,
      displayName: "repo-a",
      inventory: invA,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const invB = createMockInventory(wsB, ["src/moduleB.ts"]);
    const persistB = await smB.persistSnapshot({
      repositoryIdentity: cmB.getRepository().identity,
      rootPath: wsB,
      displayName: "repo-b",
      inventory: invB,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const engineA = new ArchitectureQueryEngine(cmA);
    const engineB = new ArchitectureQueryEngine(cmB);

    const overviewA = await engineA.getOverview();
    const overviewB = await engineB.getOverview();

    expect(overviewA.scanId).toBe(persistA.scanId);
    expect(overviewA.repositoryIdentity).toBe(cmA.getRepository().identity);

    expect(overviewB.scanId).toBe(persistB.scanId);
    expect(overviewB.repositoryIdentity).toBe(cmB.getRepository().identity);

    const dbA = cmA.getDatabase();
    const otherRepoRes = dbA
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_other', '/tmp/other', 'Other', ?, ?, 1)",
      )
      .run(new Date().toISOString(), new Date().toISOString());
    const otherRepoId = Number(otherRepoRes.lastInsertRowid);

    const otherScanRes = dbA
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version, is_active) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3', 1)",
      )
      .run(otherRepoId, new Date().toISOString());
    const otherScanId = Number(otherScanRes.lastInsertRowid);

    // Attempting to query another repository's scan from repo A's engine MUST fail
    await expect(engineA.getOverview({ scanId: otherScanId })).rejects.toThrow("was not found");

    await smA.close();
    await smB.close();
  });
});
