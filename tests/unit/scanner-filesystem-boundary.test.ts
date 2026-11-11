import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepository } from "../../scripts/scanner/repository-scanner.ts";

function canCreateFileSymlinks(): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-probe-symlink-"));
  const target = path.join(tmp, "target.txt");
  fs.writeFileSync(target, "probe");
  try {
    fs.symlinkSync(target, path.join(tmp, "link.txt"), "file");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("scanner-filesystem-boundary (Internal Symlinks & Traversal Policy)", () => {
  let tmpDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-boundary-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-outside-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("1. inspects an internal file symlink pointing to a file inside the repository", async () => {
    if (!canCreateFileSymlinks()) {
      console.log("[SKIPPED: Windows EPERM on file symlinks without Developer Mode]");
      return;
    }

    const realFile = path.join(tmpDir, "original.ts");
    const linkFile = path.join(tmpDir, "alias.ts");
    fs.writeFileSync(realFile, "export const target = true;", "utf8");
    fs.symlinkSync(realFile, linkFile, "file");

    const result = await scanRepository(tmpDir);

    const originalRecord = result.files.find((f) => f.canonicalPath === "original.ts");
    const aliasRecord = result.files.find((f) => f.canonicalPath === "alias.ts");

    expect(originalRecord).toBeDefined();
    expect(originalRecord?.inspectionStatus).toBe("INSPECTED");
    expect(originalRecord?.contentHash).not.toBeNull();

    expect(aliasRecord).toBeDefined();
    expect(aliasRecord?.inspectionStatus).toBe("INSPECTED");
    expect(aliasRecord?.contentHash).toBe(originalRecord?.contentHash);
    expect(aliasRecord?.symlinkTarget).toBe("original.ts");
  });

  it("2. traverses an internal directory symlink pointing to an unvisited directory", async () => {
    const realDir = path.join(tmpDir, "real_module");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "mod.ts"), "export const mod = 1;");

    const linkDir = path.join(tmpDir, "linked_module");
    try {
      fs.symlinkSync(realDir, linkDir, "junction");
    } catch {
      return;
    }

    const result = await scanRepository(tmpDir);
    const modRecord = result.files.find((f) => f.canonicalPath.includes("mod.ts"));
    expect(modRecord).toBeDefined();
    expect(modRecord?.inspectionStatus).toBe("INSPECTED");
  });

  it("3. detects an internal directory symlink whose target has already been visited", async () => {
    // 0_canonical will be visited first (alphabetical order)
    const canonicalDir = path.join(tmpDir, "0_canonical");
    fs.mkdirSync(canonicalDir);
    fs.writeFileSync(path.join(canonicalDir, "source.ts"), "export const s = 1;");

    // z_alias points to 0_canonical
    const aliasDir = path.join(tmpDir, "z_alias");
    try {
      fs.symlinkSync(canonicalDir, aliasDir, "junction");
    } catch {
      return;
    }

    const result = await scanRepository(tmpDir);

    // Canonical directory file was inspected
    const canonicalFile = result.files.find((f) => f.canonicalPath === "0_canonical/source.ts");
    expect(canonicalFile).toBeDefined();
    expect(canonicalFile?.inspectionStatus).toBe("INSPECTED");

    // Alias directory is recorded with DUPLICATE_DIRECTORY_ALIAS and NOT re-traversed
    const duplicateFile = result.files.find((f) => f.canonicalPath === "z_alias/source.ts");
    expect(duplicateFile).toBeUndefined(); // Prevented duplicate indexing!

    const aliasRecord = result.files.find((f) => f.canonicalPath === "z_alias");
    expect(aliasRecord).toBeDefined();
    expect(aliasRecord?.exclusionReason).toBe("DUPLICATE_DIRECTORY_ALIAS");
    expect(aliasRecord?.symlinkTarget).toBe("0_canonical");
  });

  it("4. prevents internal symlinks from creating duplicate inventory entries", async () => {
    const sharedDir = path.join(tmpDir, "shared");
    fs.mkdirSync(sharedDir);
    fs.writeFileSync(path.join(sharedDir, "config.json"), '{"a": 1}');

    const alias1 = path.join(tmpDir, "z_shared_alias");
    try {
      fs.symlinkSync(sharedDir, alias1, "junction");
    } catch {
      return;
    }

    const result = await scanRepository(tmpDir);

    // Exactly one copy of config.json is indexed
    const configRecords = result.files.filter((f) => f.canonicalPath.endsWith("config.json"));
    expect(configRecords.length).toBe(1);
    expect(configRecords[0].canonicalPath).toBe("shared/config.json");
  });

  it("5. confirms a symlink pointing outside the repository remains strictly excluded", async () => {
    fs.writeFileSync(path.join(outsideDir, "secret_outside.txt"), "Secret Data");

    const outsideLink = path.join(tmpDir, "external_link");
    try {
      fs.symlinkSync(outsideDir, outsideLink, "junction");
    } catch {
      return;
    }

    const result = await scanRepository(tmpDir);

    const outsideFile = result.files.find((f) => f.canonicalPath.includes("secret_outside.txt"));
    expect(outsideFile).toBeUndefined();

    const linkRecord = result.files.find((f) => f.canonicalPath === "external_link");
    expect(linkRecord).toBeDefined();
    expect(linkRecord?.inspectionStatus).toBe("EXTERNAL_SYMLINK_EXCLUDED");
    expect(linkRecord?.exclusionReason).toBe("TARGET_OUTSIDE_WORKSPACE_ROOT");
  });

  it("6. guarantees a symlink loop terminates safely without infinite recursion", async () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, "inner.txt"), "hello");

    const loopJunction = path.join(subDir, "recursive_loop");
    try {
      fs.symlinkSync(subDir, loopJunction, "junction");
    } catch {
      return;
    }

    const result = await scanRepository(tmpDir);

    expect(result.files.length).toBeGreaterThan(0);
    const loopRecord = result.files.find((f) => f.canonicalPath === "sub/recursive_loop");
    expect(loopRecord).toBeDefined();
    expect(loopRecord?.exclusionReason).toBe("SYMLINK_LOOP_DETECTED");
  });
});
