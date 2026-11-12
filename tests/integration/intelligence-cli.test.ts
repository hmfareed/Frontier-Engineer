import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("intelligence-cli (Subprocess Integration & Output Contracts)", () => {
  const cliPath = path.resolve("scripts/cli/frontier-cli.ts");
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-cli-int-"));
    tempDirs.push(dir);
    return dir;
  }

  function runSubprocess(args: string[], cwd: string = process.cwd()) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  it("prints help message and exits with code 0 on --help", () => {
    const proc = runSubprocess(["--help"]);
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("Frontier Engineer — Architecture Intelligence Query CLI");
    expect(proc.stdout).toContain("Commands:");
  });

  it("exits with code 2 on unknown command or invalid options", () => {
    const proc = runSubprocess(["unknown-cmd"]);
    expect(proc.status).toBe(2);
    expect(proc.stderr).toContain("Error (2): Unknown subcommand");
  });

  it("exits with code 2 on missing required argument for component command", () => {
    const proc = runSubprocess(["intelligence", "component"]);
    expect(proc.status).toBe(2);
    expect(proc.stderr).toContain("Missing required argument: <component_name>");
  });

  it("emits valid parseable JSON with zero debug contamination in --format json mode", () => {
    const proc = runSubprocess(["status", "--format", "json"]);
    expect(proc.status).toBe(0);
    expect(proc.stdout).not.toContain("Error");

    let parsed: any;
    expect(() => {
      parsed = JSON.parse(proc.stdout);
    }).not.toThrow();

    expect(parsed.repositoryIdentity).toBeDefined();
    expect(parsed.query.category).toBe("status");
    expect(parsed.data).toBeDefined();
  });

  it("executes intelligence overview and components queries against a live indexed repository", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({
        name: "cli-test-repo",
        main: "./src/index.ts",
      }),
      "utf8",
    );

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/index.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 150,
          mtimeMs: 1700000000000,
          contentHash: "hash_index",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
        {
          canonicalPath: "src/components/Card.tsx",
          fileExtension: ".tsx",
          classification: "source",
          sizeBytes: 250,
          mtimeMs: 1700000000000,
          contentHash: "hash_card",
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
        totalBytesDiscovered: 400,
        totalBytesInspected: 400,
      },
      totalFilesScanned: 2,
      totalBytesScanned: 400,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "cli-test-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    // Test 'overview'
    const overviewProc = runSubprocess(["--workspace", ws, "overview"]);
    expect(overviewProc.status).toBe(0);
    expect(overviewProc.stdout).toContain("FRONTIER INTELLIGENCE: OVERVIEW");
    expect(overviewProc.stdout).toContain("Repository Totals:");

    // Test 'components'
    const compProc = runSubprocess(["--workspace", ws, "components"]);
    expect(compProc.status).toBe(0);
    expect(compProc.stdout).toContain("Discovered Architectural Components");
    expect(compProc.stdout).toContain("src/components");

    // Test 'entrypoints'
    const epProc = runSubprocess(["--workspace", ws, "entrypoints"]);
    expect(epProc.status).toBe(0);
    expect(epProc.stdout).toContain("Application Entrypoints");
    expect(epProc.stdout).toContain("src/index.ts");

    // Test 'query "what does this repository contain?"'
    const queryProc = runSubprocess([
      "--workspace",
      ws,
      "query",
      "what does this repository contain?",
    ]);
    expect(queryProc.status).toBe(0);
    expect(queryProc.stdout).toContain("FRONTIER INTELLIGENCE: OVERVIEW");
  });

  it("exits with code 4 when querying non-existent target in CLI", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/main.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 100,
          mtimeMs: 1700000000000,
          contentHash: "hash_main",
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
        totalBytesDiscovered: 100,
        totalBytesInspected: 100,
      },
      totalFilesScanned: 1,
      totalBytesScanned: 100,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "missing-target-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    const proc = runSubprocess(["--workspace", ws, "component", "non-existent-subsystem"]);
    expect(proc.status).toBe(4);
    expect(proc.stderr).toContain("Error (4): Component 'non-existent-subsystem' not found");
  });

  it("executes freshness command and returns valid assessment in text and json format", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const appPath = path.join(ws, "src/app.ts");
    fs.mkdirSync(path.dirname(appPath), { recursive: true });
    fs.writeFileSync(appPath, "export const a = 1;", "utf8");
    const stat = fs.statSync(appPath);

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date(stat.mtimeMs + 1000).toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/app.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: "hash_app",
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
        totalBytesDiscovered: stat.size,
        totalBytesInspected: stat.size,
      },
      totalFilesScanned: 1,
      totalBytesScanned: stat.size,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "freshness-cli-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    // Text format
    const procText = runSubprocess(["--workspace", ws, "freshness"]);
    expect(procText.status).toBe(0);
    expect(procText.stdout).toContain("Index Freshness Assessment");
    expect(procText.stdout).toContain("Freshness Status");

    // JSON format
    const procJson = runSubprocess(["--workspace", ws, "freshness", "--format", "json"]);
    expect(procJson.status).toBe(0);
    const parsed = JSON.parse(procJson.stdout);
    expect(parsed.query.category).toBe("freshness");
    expect(parsed.data.status).toBeDefined();
    expect(parsed.data.isStale).toBe(false);
  });

  it("supports deps command alias for dependencies traversal", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/main.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 150,
          mtimeMs: 1700000000000,
          contentHash: "hash_main",
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
        totalBytesDiscovered: 150,
        totalBytesInspected: 150,
      },
      totalFilesScanned: 1,
      totalBytesScanned: 150,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/main.ts"), "export const b = 2;", "utf8");

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "deps-alias-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    const proc = runSubprocess(["--workspace", ws, "deps", "src/main.ts"]);
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("FRONTIER INTELLIGENCE: DEPENDENCIES");
  });

  it("handles repository workspaces with paths containing spaces correctly", async () => {
    const dirWithSpaces = path.join(os.tmpdir(), `frontier space test ${Date.now()}`);
    fs.mkdirSync(dirWithSpaces, { recursive: true });
    tempDirs.push(dirWithSpaces);
    fs.writeFileSync(path.join(dirWithSpaces, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: dirWithSpaces });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: dirWithSpaces,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/space.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 80,
          mtimeMs: 1700000000000,
          contentHash: "hash_space",
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
        totalBytesDiscovered: 80,
        totalBytesInspected: 80,
      },
      totalFilesScanned: 1,
      totalBytesScanned: 80,
      limitExceeded: false,
      scanDurationMs: 10,
    };

    fs.mkdirSync(path.join(dirWithSpaces, "src"), { recursive: true });
    fs.writeFileSync(path.join(dirWithSpaces, "src/space.ts"), "export const c = 3;", "utf8");

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: dirWithSpaces,
      displayName: "spaced-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    const proc = runSubprocess(["--workspace", dirWithSpaces, "overview"]);
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("FRONTIER INTELLIGENCE: OVERVIEW");
  });

  it("exits with code 3 when repository index is missing or unavailable", async () => {
    const wsEmpty = createTempWorkspace();
    fs.writeFileSync(path.join(wsEmpty, "package.json"), "{}", "utf8");

    const proc = runSubprocess(["--workspace", wsEmpty, "overview"]);
    expect(proc.status).toBe(3);
    expect(proc.stderr).toContain("Error (3): Repository index is unavailable");
  });

  it("safely rejects non-existent explicit historical scan ID", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
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
      scanDurationMs: 5,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "hist-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    // Query non-existent historical scan ID 9999
    const proc = runSubprocess(["--workspace", ws, "--scan-id", "9999", "overview"]);
    expect(proc.status).toBe(4);
    expect(proc.stderr).toContain("Scan run ID 9999 was not found");
  });
});
