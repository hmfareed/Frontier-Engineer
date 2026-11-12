import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { SnapshotInput } from "../../scripts/storage/types.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("storage-recovery (Crash Recovery & Staging Invariants)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-rec-test-"));
    tempDirs.push(dir);
    return dir;
  }

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
    files: { path: string; size: number }[],
    scanStatus: "COMPLETE" | "PARTIAL_WITH_ERRORS" = "COMPLETE",
  ): FileInventoryResult {
    return {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: scanStatus === "COMPLETE" ? "COMPLETE" : "PARTIAL_WITH_ERRORS",
      files: files.map((f) => ({
        canonicalPath: f.path,
        fileExtension: path.posix.extname(f.path),
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
        totalBytesDiscovered: 500,
        totalBytesInspected: 500,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: 500,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("recovers RUNNING and VALIDATING scans without damaging active index", async () => {
    const repo = connectionManager.getRepository();
    const db = connectionManager.getDatabase();

    // 1. Establish initial valid active scan
    const inv1 = createMockInventory([{ path: "src/initial.ts", size: 100 }]);
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

    // 2. Insert orphaned RUNNING and VALIDATING scans simulating multiple interrupted processes
    const now = new Date().toISOString();
    const s1 = db
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repo.id, now);
    const s2 = db
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'VALIDATING', '0.6.3', '0.6.3')",
      )
      .run(repo.id, now);

    // 3. First recovery execution
    const recoveredCount1 = await storageManager.recoverInterruptedScans(repo.id);
    expect(recoveredCount1).toBe(2);

    const s1Record = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE id = ?")
      .get(s1.lastInsertRowid) as any;
    expect(s1Record.status).toBe("FAILED");
    expect(s1Record.failure_reason).toContain("Interrupted");

    const s2Record = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE id = ?")
      .get(s2.lastInsertRowid) as any;
    expect(s2Record.status).toBe("FAILED");

    // Invariant: active scan remains initial valid scan!
    const activeScan = await storageManager.getActiveScan(repo.id);
    expect(activeScan?.id).toBe(res1.scanId);

    // 4. Repeated recovery execution is idempotent and safe
    const recoveredCount2 = await storageManager.recoverInterruptedScans(repo.id);
    expect(recoveredCount2).toBe(0);
    const activeScan2 = await storageManager.getActiveScan(repo.id);
    expect(activeScan2?.id).toBe(res1.scanId);
  });

  it("handles cancellation cleanly via AbortSignal", async () => {
    const repo = connectionManager.getRepository();
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const inv = createMockInventory([{ path: "src/cancel.ts", size: 100 }]);
    const res = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: inv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
      signal: controller.signal,
    });

    expect(res.status).toBe("CANCELLED");
    expect(res.promoted).toBe(false);

    const db = connectionManager.getDatabase();
    const scanRow = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE id = ?")
      .get(res.scanId) as any;
    expect(scanRow.status).toBe("CANCELLED");
    expect(scanRow.failure_reason).toContain("cancelled");
  });

  it("rolls back staging writes when persistence throws an error", async () => {
    const repo = connectionManager.getRepository();
    const db = connectionManager.getDatabase();

    // Create a mock inventory that triggers a SQLite constraint error (e.g. invalid size)
    const badInventory: any = {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/valid.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 100,
          mtimeMs: 1700000000000,
          contentHash: "h1",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
        {
          canonicalPath: "src/invalid.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: -999, // Fails CHECK(size_bytes >= 0)
          mtimeMs: 1700000000000,
          contentHash: "h2",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
      ],
      summary: {
        totalFilesDiscovered: 2,
        totalFilesInspected: 2,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: 100,
        totalBytesInspected: 100,
      },
      totalFilesScanned: 2,
      totalBytesScanned: 100,
      limitExceeded: false,
      scanDurationMs: 5,
    };

    const res = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: badInventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    expect(res.status).toBe("FAILED");
    expect(res.promoted).toBe(false);

    // Staging rollback check: zero files under this scanId should exist
    const filesUnderScan = db
      .prepare("SELECT COUNT(*) AS count FROM files WHERE scan_id = ?")
      .get(res.scanId) as { count: number };
    expect(filesUnderScan.count).toBe(0);

    // Scan record itself is preserved with FAILED status and diagnostic
    const scanRow = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE id = ?")
      .get(res.scanId) as any;
    expect(scanRow.status).toBe("FAILED");
    expect(scanRow.failure_reason).toMatch(/CHECK constraint failed/);
  });

  it("enforces explicit partial scan promotion rules", async () => {
    const repo = connectionManager.getRepository();

    const partialInv = createMockInventory(
      [{ path: "src/part.ts", size: 100 }],
      "PARTIAL_WITH_ERRORS",
    );

    // 1. First-ever partial scan without opt-in: MUST NOT be promoted
    const resPartialFirstNoOptIn = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: partialInv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
      allowPartialPromotion: false,
    });
    expect(resPartialFirstNoOptIn.status).toBe("PARTIAL");
    expect(resPartialFirstNoOptIn.promoted).toBe(false);
    expect(await storageManager.getActiveScan(repo.id)).toBeNull();

    // 2. First-ever partial scan WITH explicit opt-in: Promoted to active scan
    const resPartialFirstWithOptIn = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: partialInv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
      allowPartialPromotion: true,
    });
    expect(resPartialFirstWithOptIn.status).toBe("PARTIAL");
    expect(resPartialFirstWithOptIn.promoted).toBe(true);
    const activeFirst = await storageManager.getActiveScan(repo.id);
    expect(activeFirst?.id).toBe(resPartialFirstWithOptIn.scanId);
    expect(activeFirst?.status).toBe("PARTIAL");

    // 3. COMPLETE scan succeeds and replaces the partial scan
    const completeInv = createMockInventory([{ path: "src/comp.ts", size: 100 }], "COMPLETE");
    const resComplete = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: completeInv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });
    expect(resComplete.promoted).toBe(true);
    const activeComplete = await storageManager.getActiveScan(repo.id);
    expect(activeComplete?.id).toBe(resComplete.scanId);
    expect(activeComplete?.status).toBe("COMPLETE");

    // 4. Ingest a PARTIAL scan when a COMPLETE scan already exists:
    // Even if allowPartialPromotion=true, it MUST NOT replace the existing COMPLETE active scan!
    const resPartialAfterComplete = await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory: partialInv,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
      allowPartialPromotion: true,
    });
    expect(resPartialAfterComplete.status).toBe("PARTIAL");
    expect(resPartialAfterComplete.promoted).toBe(false); // COMPLETE scan is preserved!
    const activePreserved = await storageManager.getActiveScan(repo.id);
    expect(activePreserved?.id).toBe(resComplete.scanId);
  });

  it("simulates real child process crash during indexing and verifies recovery", async () => {
    const ws = createTempWorkspace();

    // Script run by child process that opens the DB, starts a scan run, and crashes via process.exit(42)
    const crashScript = `
      import { ConnectionManager } from './scripts/storage/connection-manager.ts';
      import { ScanStore } from './scripts/storage/repositories/scan-store.ts';

      async function main() {
        const cm = new ConnectionManager({ workspaceRoot: ${JSON.stringify(ws)} });
        await cm.initialize();
        const repo = cm.getRepository();
        const scanStore = new ScanStore(cm.getDatabase());

        // Create scan run in RUNNING state
        scanStore.createScanRun({
          repositoryId: repo.id,
          scannerVersion: '0.6.3',
          extractorVersion: '0.6.3',
        });

        // Simulate sudden process crash / termination
        process.exit(42);
      }
      main();
    `;

    // Execute in child process using Node ESM
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", crashScript], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    if (child.status !== 42) {
      console.error("Child error:", child.stderr.toString());
    }
    expect(child.status).toBe(42);

    // Now parent process reopens the database
    const cm = new ConnectionManager({ workspaceRoot: ws });
    await cm.initialize();
    const sm = new StorageManager(cm);
    await sm.initialize();
    const repo = cm.getRepository();

    const db = cm.getDatabase();
    // Verify scan was left in RUNNING status by the crashed child process
    const unrecovered = db
      .prepare("SELECT status FROM scan_runs WHERE repository_id = ? AND status = 'RUNNING'")
      .all(repo.id);
    expect(unrecovered.length).toBe(1);

    // Execute recovery via StorageManager
    const recovered = await sm.recoverInterruptedScans(repo.id);
    expect(recovered).toBe(1);

    const after = db
      .prepare("SELECT status, failure_reason FROM scan_runs WHERE repository_id = ?")
      .all(repo.id) as any[];
    expect(after[0].status).toBe("FAILED");
    expect(after[0].failure_reason).toContain("Interrupted");

    cm.close();
  });

  function scanStore_recover(cm: ConnectionManager, repoId: number): number {
    const sm = new StorageManager(cm);
    return cm
      .getDatabase()
      .prepare(
        "UPDATE scan_runs SET status = 'FAILED', failure_reason = 'Interrupted by process termination or crash' WHERE repository_id = ? AND status IN ('RUNNING', 'VALIDATING')",
      )
      .run(repoId).changes as number;
  }
});
