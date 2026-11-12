import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { GraphBuilder } from "../../scripts/graph/graph-builder.ts";
import type { ScannedFileRecord } from "../../scripts/scanner/types.ts";

describe("repository-identity (Workspace Continuity, Path Invariance & Clone Separation)", () => {
  const tempDirs: string[] = [];

  function createTempWorkspace(prefix = "frontier-repo-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  it("ensures file:<canonical_path> node identity uses repository-relative paths, not absolute paths", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/core/index.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 150,
        mtimeMs: 1700000000000,
        contentHash: "hash_core",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    const { nodes } = GraphBuilder.buildGraph({
      repositoryIdentity: "test-rel-path",
      files,
      extractions: new Map(),
    });

    const fileNode = nodes.find((n) => n.category === "file")!;
    expect(fileNode.nodeIdentity).toBe("file:src/core/index.ts");
    expect(fileNode.nodeIdentity).not.toContain("C:");
    expect(fileNode.nodeIdentity).not.toContain("/Users/");
    expect(path.isAbsolute(fileNode.nodeIdentity.replace(/^file:/, ""))).toBe(false);
  });

  it("maintains stable identity across repeated scans and persists it in metadata.json", async () => {
    const ws = createTempWorkspace();
    const cm1 = new ConnectionManager({ workspaceRoot: ws });
    await cm1.initialize({ overrideDisplayName: "StableProject" });
    const repo1 = cm1.getRepository();
    const id1 = repo1.identity;
    cm1.close();

    // Verify metadata.json was written
    const metaPath = path.join(ws, ".frontier", "intelligence", "metadata.json");
    expect(fs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta.repositoryIdentity).toBe(id1);

    // Reopen workspace
    const cm2 = new ConnectionManager({ workspaceRoot: ws });
    await cm2.initialize();
    const repo2 = cm2.getRepository();
    expect(repo2.identity).toBe(id1);
    expect(repo2.id).toBe(repo1.id);
    cm2.close();
  });

  it("preserves scan history and updates root_path when a repository is moved to a new path", async () => {
    const wsOld = createTempWorkspace("ws-old-");
    const cmOld = new ConnectionManager({ workspaceRoot: wsOld });
    const smOld = new StorageManager(cmOld);
    await smOld.initialize();
    const repoOld = cmOld.getRepository();

    // Ingest a dummy scan
    const res = await smOld.persistSnapshot({
      repositoryIdentity: repoOld.identity,
      rootPath: repoOld.rootPath,
      displayName: repoOld.displayName,
      inventory: {
        workspaceRoot: wsOld,
        scannedAt: new Date().toISOString(),
        scanStatus: "COMPLETE",
        files: [],
        summary: {
          totalFilesDiscovered: 0,
          totalFilesInspected: 0,
          totalFilesExcluded: 0,
          totalFilesUnreadable: 0,
          totalBytesDiscovered: 0,
          totalBytesInspected: 0,
        },
        totalFilesScanned: 0,
        totalBytesScanned: 0,
        limitExceeded: false,
        scanDurationMs: 1,
      },
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });
    expect(res.promoted).toBe(true);
    await smOld.close();

    // Move repository directory: create new workspace and copy .frontier directory into it
    const wsNew = createTempWorkspace("ws-new-");
    const oldFrontier = path.join(wsOld, ".frontier");
    const newFrontier = path.join(wsNew, ".frontier");
    fs.cpSync(oldFrontier, newFrontier, { recursive: true });

    // Open at new location
    const cmNew = new ConnectionManager({ workspaceRoot: wsNew });
    const smNew = new StorageManager(cmNew);
    await smNew.initialize();
    const repoNew = cmNew.getRepository();

    // Identity is preserved
    expect(repoNew.identity).toBe(repoOld.identity);
    // Root path is updated to new location
    expect(repoNew.rootPath).toBe(path.resolve(wsNew));
    // Previous scan history remains active!
    const activeScan = await smNew.getActiveScan(repoNew.id);
    expect(activeScan?.id).toBe(res.scanId);

    await smNew.close();
  });

  it("enforces isolation between independent repository workspaces", async () => {
    const ws1 = createTempWorkspace("ws-separate-1-");
    const ws2 = createTempWorkspace("ws-separate-2-");

    const cm1 = new ConnectionManager({ workspaceRoot: ws1 });
    await cm1.initialize({ overrideDisplayName: "ProjectOne" });
    const repo1 = cm1.getRepository();

    const cm2 = new ConnectionManager({ workspaceRoot: ws2 });
    await cm2.initialize({ overrideDisplayName: "ProjectTwo" });
    const repo2 = cm2.getRepository();

    expect(repo1.identity).not.toBe(repo2.identity);

    cm1.close();
    cm2.close();
  });
});
