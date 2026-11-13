import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("cli-evolution (Phase 7.5 Stage 4 CLI Integration)", () => {
  const cliPath = path.resolve("scripts/cli/frontier-cli.ts");
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-cli-evo4-"));
    tempDirs.push(dir);
    return dir;
  }

  function runSubprocess(args: string[], cwd: string) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  function makeInventory(ws: string, files: string[]): FileInventoryResult {
    return {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f,
        fileExtension: path.posix.extname(f) || ".ts",
        classification: "source",
        sizeBytes: 120,
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
        totalBytesDiscovered: files.length * 120,
        totalBytesInspected: files.length * 120,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.length * 120,
      limitExceeded: false,
      scanDurationMs: 5,
    };
  }

  it("EVO-CLI-01: executes evolution, drift, debt, memories, memory commands cleanly with read-only defaults and explicit persistence flags", async () => {
    const ws = createWorkspace();
    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const s1 = await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "cli-evo4",
      inventory: makeInventory(ws, ["src/ui/App.tsx", "src/db/schema.sql", "src/legacy.ts"]),
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const s2 = await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "cli-evo4",
      inventory: makeInventory(ws, ["src/ui/App.tsx", "src/db/schema.sql", "src/new_api/route.ts"]),
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = cm.getDatabase();
    const repoId = cm.getRepository().id;
    const memStore = new MemoryStore(db);
    const mem = memStore.createMemory({
      repositoryId: repoId,
      memoryKey: "legacy_hint",
      category: "project_context",
      title: "Legacy Hint",
      content: "Depends on src/legacy.ts",
      firstSeenScanId: s1.scanId,
      lastSeenScanId: s1.scanId,
    });
    memStore.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: s1.scanId,
      evidenceType: "source_file",
      sourcePath: "src/legacy.ts",
      description: "src/legacy.ts",
    });
    await sm.close();

    // 1. Read-only default evolution --format json
    const evoRo = runSubprocess(
      ["--workspace", ws, "evolution", String(s1.scanId), String(s2.scanId), "--format", "json"],
      ws,
    );
    expect(evoRo.status).toBe(0);
    const parsedEvo = JSON.parse(evoRo.stdout);
    expect(parsedEvo.analysisId).toBe(`evo:${repoId}:${s1.scanId}:${s2.scanId}`);
    expect(parsedEvo.memoryLifecycle.transitionedToStale).toBe(1);

    // 2. drift & debt subcommands
    const driftProc = runSubprocess(
      ["--workspace", ws, "drift", String(s1.scanId), String(s2.scanId), "--format", "json"],
      ws,
    );
    expect(driftProc.status).toBe(0);
    expect(JSON.parse(driftProc.stdout).drift).toBeDefined();

    const debtProc = runSubprocess(
      ["--workspace", ws, "debt", String(s1.scanId), String(s2.scanId), "--format", "json"],
      ws,
    );
    expect(debtProc.status).toBe(0);
    expect(JSON.parse(debtProc.stdout).debt).toBeDefined();

    // 3. memories & memory read-only verification (memory still ACTIVE before --apply-lifecycle)
    const memoriesProc = runSubprocess(["--workspace", ws, "memories", "--format", "json"], ws);
    expect(memoriesProc.status).toBe(0);
    const parsedMemories = JSON.parse(memoriesProc.stdout);
    expect(parsedMemories.totalCount).toBe(1);
    expect(parsedMemories.memories[0].status).toBe("ACTIVE");

    const memProc = runSubprocess(
      ["--workspace", ws, "memory", "legacy_hint", "--format", "json"],
      ws,
    );
    expect(memProc.status).toBe(0);
    expect(JSON.parse(memProc.stdout).memory.memoryKey).toBe("legacy_hint");

    // 4. Explicit --persist-events & --apply-lifecycle mutates DB cleanly
    const evoMutate = runSubprocess(
      [
        "--workspace",
        ws,
        "evolution",
        String(s1.scanId),
        String(s2.scanId),
        "--persist-events",
        "--apply-lifecycle",
        "--format",
        "json",
      ],
      ws,
    );
    expect(evoMutate.status).toBe(0);

    const memAfter = runSubprocess(
      ["--workspace", ws, "memory", "legacy_hint", "--format", "json"],
      ws,
    );
    expect(memAfter.status).toBe(0);
    const parsedAfter = JSON.parse(memAfter.stdout);
    expect(parsedAfter.memory.status).toBe("STALE");
    expect(parsedAfter.versions).toHaveLength(1);

    // 5. Invalid args (2) and missing targets (4)
    const missingArg = runSubprocess(["--workspace", ws, "evolution", "1"], ws);
    expect(missingArg.status).toBe(2);

    const missingScan = runSubprocess(["--workspace", ws, "evolution", "1", "999"], ws);
    expect(missingScan.status).toBe(4);

    const missingMem = runSubprocess(["--workspace", ws, "memory", "nonexistent_key"], ws);
    expect(missingMem.status).toBe(4);
  });

  it("EVO-CLI-02: rejects misplaced mutation flags (ISSUE-CLI-02) and cross-repository scan IDs (DEFECT-CLI-01)", async () => {
    const ws = createWorkspace();
    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    let s1ScanId: number;
    let s2ScanId: number;
    try {
      await sm.initialize();

      const s1 = await sm.persistSnapshot({
        repositoryIdentity: cm.getRepository().identity,
        rootPath: ws,
        displayName: "cli-evo4-flags",
        inventory: makeInventory(ws, ["src/a.ts"]),
        extractions: new Map(),
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      });
      const s2 = await sm.persistSnapshot({
        repositoryIdentity: cm.getRepository().identity,
        rootPath: ws,
        displayName: "cli-evo4-flags",
        inventory: makeInventory(ws, ["src/b.ts"]),
        extractions: new Map(),
        scannerVersion: "0.6.3",
        extractorVersion: "0.6.3",
      });
      s1ScanId = s1.scanId;
      s2ScanId = s2.scanId;
    } finally {
      cm.close();
    }

    // ISSUE-CLI-02: Mutation flags must fail closed with exit 2 on unsupported subcommands
    const badApplyDrift = runSubprocess(
      ["--workspace", ws, "drift", String(s1ScanId), String(s2ScanId), "--apply-lifecycle"],
      ws,
    );
    expect(badApplyDrift.status).toBe(2);

    const badApplyDebt = runSubprocess(
      ["--workspace", ws, "debt", String(s1ScanId), String(s2ScanId), "--apply-lifecycle"],
      ws,
    );
    expect(badApplyDebt.status).toBe(2);

    const badApplyMemoriesNoScan = runSubprocess(
      ["--workspace", ws, "memories", "--apply-lifecycle"],
      ws,
    );
    expect(badApplyMemoriesNoScan.status).toBe(2);

    const badPersistDrift = runSubprocess(
      ["--workspace", ws, "drift", String(s1ScanId), String(s2ScanId), "--persist-events"],
      ws,
    );
    expect(badPersistDrift.status).toBe(2);

    const badPersistMemories = runSubprocess(
      ["--workspace", ws, "memories", "--persist-events"],
      ws,
    );
    expect(badPersistMemories.status).toBe(2);

    // DEFECT-CLI-01: Reject scans and memories belonging to a different repository across all Stage 3/4 commands
    const dbPath = path.join(ws, ".frontier", "intelligence", "index.sqlite");
    const { SqliteDatabase } = await import("../../scripts/storage/database.ts");
    const { MemoryStore } = await import("../../scripts/storage/repositories/memory-store.ts");
    const rawDb = new SqliteDatabase({ path: dbPath });
    let foreignS1: number;
    let foreignS2: number;
    let foreignMemoryId: number;
    let snapshotBefore: {
      memories: unknown[];
      versions: unknown[];
      events: unknown[];
    };
    try {
      const otherRepoId = Number(
        rawDb
          .prepare(
            "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('foreign_cli_repo', '/foreign', 'Foreign', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 3)",
          )
          .run().lastInsertRowid,
      );
      foreignS1 = Number(
        rawDb
          .prepare(
            "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active) VALUES (?, '2026-11-01T10:00:00Z', '2026-11-01T10:01:00Z', 'COMPLETE', 0, 0, 0, 0, 0, '0.6.3', '0.6.3', 0)",
          )
          .run(otherRepoId).lastInsertRowid,
      );
      foreignS2 = Number(
        rawDb
          .prepare(
            "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active) VALUES (?, '2026-11-02T10:00:00Z', '2026-11-02T10:01:00Z', 'COMPLETE', 0, 0, 0, 0, 0, '0.6.3', '0.6.3', 0)",
          )
          .run(otherRepoId).lastInsertRowid,
      );
      const memStore = new MemoryStore(rawDb);
      const foreignMem = memStore.createMemory({
        repositoryId: otherRepoId,
        memoryKey: "foreign_secret_memory",
        category: "project_context",
        title: "Foreign Secret Memory Title",
        content: "Foreign secret content must never leak across workspace isolation",
        firstSeenScanId: foreignS1,
        lastSeenScanId: foreignS2,
      });
      foreignMemoryId = foreignMem.id;

      // Seed an existing workspace memory & event to verify cross-repo commands cannot overwrite or mutate them
      const ownRepo = rawDb
        .prepare("SELECT id FROM repositories WHERE identity != 'foreign_cli_repo' LIMIT 1")
        .get() as { id: number };
      memStore.createMemory({
        repositoryId: ownRepo.id,
        memoryKey: "own_ws_memory",
        category: "project_context",
        title: "Workspace Memory",
        content: "Must remain intact on rejected cross-repo commands",
        firstSeenScanId: s1ScanId,
        lastSeenScanId: s2ScanId,
      });

      snapshotBefore = {
        memories: rawDb.prepare("SELECT * FROM engineering_memories ORDER BY id").all(),
        versions: rawDb.prepare("SELECT * FROM memory_versions ORDER BY id").all(),
        events: rawDb.prepare("SELECT * FROM evolution_events ORDER BY id").all(),
      };
    } finally {
      rawDb.close();
    }

    const crossRepoCompare = runSubprocess(
      [
        "--workspace",
        ws,
        "compare",
        String(foreignS1),
        String(foreignS2),
        "--persist-events",
        "--format",
        "json",
      ],
      ws,
    );
    expect(crossRepoCompare.status).toBe(2);

    const crossRepoEvo = runSubprocess(
      [
        "--workspace",
        ws,
        "evolution",
        String(foreignS1),
        String(foreignS2),
        "--persist-events",
        "--apply-lifecycle",
        "--format",
        "json",
      ],
      ws,
    );
    expect(crossRepoEvo.status).toBe(2);

    const crossRepoDrift = runSubprocess(
      ["--workspace", ws, "drift", String(foreignS1), String(foreignS2), "--format", "json"],
      ws,
    );
    expect(crossRepoDrift.status).toBe(2);

    const crossRepoDebt = runSubprocess(
      ["--workspace", ws, "debt", String(foreignS1), String(foreignS2), "--format", "json"],
      ws,
    );
    expect(crossRepoDebt.status).toBe(2);

    const crossRepoMemories = runSubprocess(
      [
        "--workspace",
        ws,
        "memories",
        "--scan-id",
        String(foreignS2),
        "--apply-lifecycle",
        "--format",
        "json",
      ],
      ws,
    );
    expect(crossRepoMemories.status).toBe(2);

    const crossRepoSingleMemory = runSubprocess(
      ["--workspace", ws, "memory", String(foreignMemoryId), "--format", "json"],
      ws,
    );
    expect(crossRepoSingleMemory.status).toBe(4);
    expect(`${crossRepoSingleMemory.stdout}\n${crossRepoSingleMemory.stderr}`).not.toContain(
      "Foreign Secret Memory Title",
    );

    const verifyDb = new SqliteDatabase({ path: dbPath, readOnly: true });
    try {
      const snapshotAfter = {
        memories: verifyDb.prepare("SELECT * FROM engineering_memories ORDER BY id").all(),
        versions: verifyDb.prepare("SELECT * FROM memory_versions ORDER BY id").all(),
        events: verifyDb.prepare("SELECT * FROM evolution_events ORDER BY id").all(),
      };
      expect(snapshotAfter).toEqual(snapshotBefore);
    } finally {
      verifyDb.close();
    }

    // Valid memories --scan-id --apply-lifecycle on workspace's own scan exits 0
    const ownMemoriesApply = runSubprocess(
      [
        "--workspace",
        ws,
        "memories",
        "--scan-id",
        String(s2ScanId),
        "--apply-lifecycle",
        "--format",
        "json",
      ],
      ws,
    );
    expect(ownMemoriesApply.status).toBe(0);
    const parsedOwn = JSON.parse(ownMemoriesApply.stdout);
    expect(parsedOwn.totalCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsedOwn.memories)).toBe(true);
  });
});
