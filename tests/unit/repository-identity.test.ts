import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ConnectionManager,
  RepositoryIdentityConflictError,
} from "../../scripts/storage/connection-manager.ts";
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

  it("Scenario A — Relocation: preserves scan history and updates root_path when a repository is moved to a new path", async () => {
    const wsOld = createTempWorkspace("ws-old-");
    fs.writeFileSync(
      path.join(wsOld, "package.json"),
      JSON.stringify({ name: "my-relocated-app" }),
    );

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

    // Move repository directory: create new workspace, copy everything, and delete old workspace
    const wsNew = createTempWorkspace("ws-new-");
    fs.cpSync(wsOld, wsNew, { recursive: true });
    // Simulate real move by wiping old directory so it no longer exists
    fs.rmSync(wsOld, { recursive: true, force: true });

    // Open at new location
    const cmNew = new ConnectionManager({ workspaceRoot: wsNew });
    const smNew = new StorageManager(cmNew);
    await smNew.initialize();
    const repoNew = cmNew.getRepository();

    // Identity is preserved because original path no longer exists (genuine relocation)
    expect(repoNew.identity).toBe(repoOld.identity);
    expect(repoNew.rootPath).toBe(path.resolve(wsNew));

    // Previous scan history remains active
    const activeScan = await smNew.getActiveScan(repoNew.id);
    expect(activeScan?.id).toBe(res.scanId);

    await smNew.close();
  });

  it("Scenario B — Fresh clone without .frontier: receives distinct repository identity", async () => {
    const ws1 = createTempWorkspace("ws-fresh-1-");
    const ws2 = createTempWorkspace("ws-fresh-2-");

    fs.writeFileSync(path.join(ws1, "app.ts"), "export const x = 1;");
    fs.writeFileSync(path.join(ws2, "app.ts"), "export const x = 1;");

    const cm1 = new ConnectionManager({ workspaceRoot: ws1 });
    await cm1.initialize();
    const repo1 = cm1.getRepository();

    const cm2 = new ConnectionManager({ workspaceRoot: ws2 });
    await cm2.initialize();
    const repo2 = cm2.getRepository();

    expect(repo1.identity).not.toBe(repo2.identity);

    cm1.close();
    cm2.close();
  });

  it("Scenario C — Copied .frontier: cannot silently share identity or mutate original repository", async () => {
    const wsOriginal = createTempWorkspace("ws-orig-");
    fs.writeFileSync(
      path.join(wsOriginal, "package.json"),
      JSON.stringify({ name: "core-service" }),
    );

    const cmOrig = new ConnectionManager({ workspaceRoot: wsOriginal });
    await cmOrig.initialize();
    const repoOrig = cmOrig.getRepository();
    const origId = repoOrig.identity;
    cmOrig.close();

    // Copy repository, including .frontier, to another directory while wsOriginal remains intact
    const wsCopy = createTempWorkspace("ws-copy-");
    fs.cpSync(wsOriginal, wsCopy, { recursive: true });

    // Open the copied workspace
    const cmCopy = new ConnectionManager({ workspaceRoot: wsCopy });
    await cmCopy.initialize();
    const repoCopy = cmCopy.getRepository();

    // Policy verification: Copied workspace must NOT inherit identical identity when original still exists
    expect(repoCopy.identity).not.toBe(origId);
    expect(repoCopy.identity).toContain("repo_copy_");

    // Original repository reopens with its own identity unchanged
    const cmOrigVerify = new ConnectionManager({ workspaceRoot: wsOriginal });
    await cmOrigVerify.initialize();
    expect(cmOrigVerify.getRepository().identity).toBe(origId);

    cmCopy.close();
    cmOrigVerify.close();
  });

  it("Scenario D — Unrelated workspace replacement: detects project replacement and prevents silent adoption", async () => {
    const ws = createTempWorkspace("ws-replace-");
    fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "original-service" }));

    const cm = new ConnectionManager({ workspaceRoot: ws });
    await cm.initialize();
    const origId = cm.getRepository().identity;
    cm.close();

    // Replace source contents with completely different project, keeping .frontier
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({ name: "completely-unrelated-calculator" }),
    );

    // Reopening workspace without override must throw RepositoryIdentityConflictError
    const cmConflict = new ConnectionManager({ workspaceRoot: ws });
    await expect(cmConflict.initialize()).rejects.toThrow(RepositoryIdentityConflictError);

    // Allowing project replacement with explicit option succeeds
    const cmAllowed = new ConnectionManager({ workspaceRoot: ws, allowProjectReplacement: true });
    await cmAllowed.initialize();
    expect(cmAllowed.getRepository().identity).toBe(origId);
    cmAllowed.close();
  });

  it("Scenario E — Two simultaneous copies: isolated identities prevent cross-project contamination", async () => {
    const wsBase = createTempWorkspace("ws-base-");
    fs.writeFileSync(path.join(wsBase, "package.json"), JSON.stringify({ name: "app-base" }));

    const cmBase = new ConnectionManager({ workspaceRoot: wsBase });
    await cmBase.initialize();
    const baseId = cmBase.getRepository().identity;
    cmBase.close();

    // Create two copies with .frontier
    const wsCopy1 = createTempWorkspace("ws-copy-1-");
    const wsCopy2 = createTempWorkspace("ws-copy-2-");
    fs.cpSync(wsBase, wsCopy1, { recursive: true });
    fs.cpSync(wsBase, wsCopy2, { recursive: true });

    // Open both copies simultaneously
    const cm1 = new ConnectionManager({ workspaceRoot: wsCopy1 });
    const cm2 = new ConnectionManager({ workspaceRoot: wsCopy2 });
    await cm1.initialize();
    await cm2.initialize();

    const id1 = cm1.getRepository().identity;
    const id2 = cm2.getRepository().identity;

    // Both copies have distinct identities and neither collides with baseId or each other
    expect(id1).not.toBe(baseId);
    expect(id2).not.toBe(baseId);
    expect(id1).not.toBe(id2);

    cm1.close();
    cm2.close();
  });
});
