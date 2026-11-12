import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";

describe("storage-connection (Connection Manager & Workspace Lifecycle)", () => {
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-storage-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored on cleanup
      }
    }
    tempDirs.length = 0;
  });

  it("initializes an in-memory database cleanly without creating filesystem files", async () => {
    const manager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });

    await manager.initialize();
    const db = manager.getDatabase();
    expect(db.isOpen()).toBe(true);

    const repo = manager.getRepository();
    expect(repo.id).toBeGreaterThan(0);
    expect(repo.identity).toMatch(/^repo_/);

    manager.close();
    expect(db.isOpen()).toBe(false);
  });

  it("initializes a file-backed database and creates metadata.json and index.sqlite", async () => {
    const ws = createTempWorkspace();
    const manager = new ConnectionManager({
      workspaceRoot: ws,
    });

    await manager.initialize({
      overrideDisplayName: "TestApp",
    });

    const frontierDir = path.join(ws, ".frontier", "intelligence");
    const dbFile = path.join(frontierDir, "index.sqlite");
    const metaFile = path.join(frontierDir, "metadata.json");

    expect(fs.existsSync(dbFile)).toBe(true);
    expect(fs.existsSync(metaFile)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    expect(meta.displayName).toBe("TestApp");
    expect(meta.rootPath).toBe(path.resolve(ws));

    const repo = manager.getRepository();
    expect(repo.displayName).toBe("TestApp");
    expect(repo.identity).toBe(meta.repositoryIdentity);

    manager.close();
  });

  it("detects repository moved to a new path and updates root_path in the database", async () => {
    const ws1 = createTempWorkspace();
    const manager1 = new ConnectionManager({
      workspaceRoot: ws1,
    });
    await manager1.initialize({ overrideIdentity: "fixed_repo_id" });
    const repo1 = manager1.getRepository();
    expect(repo1.rootPath).toBe(path.resolve(ws1));
    manager1.close();

    // Now copy the database to a new workspace path
    const ws2 = createTempWorkspace();
    const frontierDir2 = path.join(ws2, ".frontier", "intelligence");
    fs.mkdirSync(frontierDir2, { recursive: true });
    fs.copyFileSync(
      path.join(ws1, ".frontier", "intelligence", "index.sqlite"),
      path.join(frontierDir2, "index.sqlite"),
    );
    fs.copyFileSync(
      path.join(ws1, ".frontier", "intelligence", "metadata.json"),
      path.join(frontierDir2, "metadata.json"),
    );

    const manager2 = new ConnectionManager({
      workspaceRoot: ws2,
    });
    await manager2.initialize();
    const repo2 = manager2.getRepository();

    expect(repo2.id).toBe(repo1.id);
    expect(repo2.identity).toBe("fixed_repo_id");
    expect(repo2.rootPath).toBe(path.resolve(ws2));

    manager2.close();
  });

  it("rejects non-existent workspace directory", () => {
    const nonExistent = path.join(os.tmpdir(), "does-not-exist-dir-12345");
    expect(() => {
      new ConnectionManager({ workspaceRoot: nonExistent });
    }).toThrow(/Workspace root does not exist/);
  });
});
