import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

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

  it("executes every documented CLI command (15 primary + 1 alias) through child subprocesses", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({
        name: "full-coverage-repo",
        main: "./src/index.ts",
        bin: { cli: "./src/index.ts" },
      }),
      "utf8",
    );

    const indexPath = path.join(ws, "src/index.ts");
    const cardPath = path.join(ws, "src/components/Card.tsx");
    const testPath = path.join(ws, "tests/Card.test.ts");
    const adrDir = path.join(ws, "docs/adr");
    const adrPath = path.join(adrDir, "ADR-001-component-architecture.md");

    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.mkdirSync(path.dirname(cardPath), { recursive: true });
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.mkdirSync(adrDir, { recursive: true });

    fs.writeFileSync(
      indexPath,
      'import { Card } from "./components/Card"; export function run() { return Card(); }',
      "utf8",
    );
    fs.writeFileSync(cardPath, 'export function Card() { return "Card Component"; }', "utf8");
    fs.writeFileSync(testPath, 'import { Card } from "../src/components/Card";', "utf8");
    fs.writeFileSync(
      adrPath,
      `# ADR-001: Component Architecture\n\n- Status: Accepted\n- Date: 2026-11-12\n- Phase: 7.4\n\n## Context\nStandard UI components in \`src/components\`.\n`,
      "utf8",
    );

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const files = [
      { path: "src/index.ts", content: fs.readFileSync(indexPath, "utf8") },
      { path: "src/components/Card.tsx", content: fs.readFileSync(cardPath, "utf8") },
      { path: "tests/Card.test.ts", content: fs.readFileSync(testPath, "utf8") },
      {
        path: "docs/adr/ADR-001-component-architecture.md",
        content: fs.readFileSync(adrPath, "utf8"),
      },
    ];

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => {
        const full = path.join(ws, f.path);
        const stat = fs.statSync(full);
        return {
          canonicalPath: f.path,
          fileExtension: path.posix.extname(f.path),
          classification: f.path.startsWith("docs/") ? "documentation" : "source",
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: `hash_${f.path}`,
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        };
      }),
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

    const extractions = new Map<string, ExtractionResult>();

    extractions.set("src/components/Card.tsx", {
      canonicalPath: "src/components/Card.tsx",
      symbols: [
        {
          symbolId: "src/components/Card.tsx#Card",
          name: "Card",
          parentScope: null,
          kind: "function",
          isExported: true,
          fingerprint: "fp_card_1",
          sourceEvidence: {
            lineStart: 1,
            lineEnd: 1,
            colStart: 0,
            colEnd: 50,
            evidenceHash: "ev_card_1",
          },
        },
      ],
      imports: [],
      exports: [
        {
          name: "Card",
          localName: "Card",
          isReExport: false,
          sourceModule: null,
          isTypeOnly: false,
          isWildcard: false,
        },
      ],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    extractions.set("src/index.ts", {
      canonicalPath: "src/index.ts",
      symbols: [
        {
          symbolId: "src/index.ts#run",
          name: "run",
          parentScope: null,
          kind: "function",
          isExported: true,
          fingerprint: "fp_run_1",
          sourceEvidence: {
            lineStart: 1,
            lineEnd: 1,
            colStart: 40,
            colEnd: 80,
            evidenceHash: "ev_run_1",
          },
        },
      ],
      imports: [
        {
          specifier: "./components/Card",
          resolvedPath: "src/components/Card.tsx",
          importedSymbols: [{ name: "Card" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [
        {
          name: "run",
          localName: "run",
          isReExport: false,
          sourceModule: null,
          isTypeOnly: false,
          isWildcard: false,
        },
      ],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    extractions.set("tests/Card.test.ts", {
      canonicalPath: "tests/Card.test.ts",
      symbols: [],
      imports: [
        {
          specifier: "../src/components/Card",
          resolvedPath: "src/components/Card.tsx",
          importedSymbols: [{ name: "Card" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "full-coverage-repo",
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();

    // 1. status
    const statusText = runSubprocess(["--workspace", ws, "status"]);
    expect(statusText.status).toBe(0);
    expect(statusText.stdout).toContain("STATUS");
    const statusJson = runSubprocess(["--workspace", ws, "status", "--format", "json"]);
    expect(statusJson.status).toBe(0);
    expect(JSON.parse(statusJson.stdout).query.category).toBe("status");

    // 2. overview
    const overviewText = runSubprocess(["--workspace", ws, "overview"]);
    expect(overviewText.status).toBe(0);
    expect(overviewText.stdout).toContain("OVERVIEW");
    const overviewJson = runSubprocess(["--workspace", ws, "overview", "--format", "json"]);
    expect(overviewJson.status).toBe(0);
    expect(JSON.parse(overviewJson.stdout).query.category).toBe("overview");

    // 3. freshness
    const freshText = runSubprocess(["--workspace", ws, "freshness"]);
    expect(freshText.status).toBe(0);
    expect(freshText.stdout).toContain("Freshness Assessment");
    const freshContent = runSubprocess([
      "--workspace",
      ws,
      "freshness",
      "--verify-content",
      "--format",
      "json",
    ]);
    expect(freshContent.status).toBe(0);
    expect(JSON.parse(freshContent.stdout).data.strategy).toBe("CONTENT_HASH");

    // 4. components
    const compListText = runSubprocess(["--workspace", ws, "components"]);
    expect(compListText.status).toBe(0);
    expect(compListText.stdout).toContain("COMPONENTS");
    const compListJson = runSubprocess(["--workspace", ws, "components", "--format", "json"]);
    expect(compListJson.status).toBe(0);
    expect(JSON.parse(compListJson.stdout).data.components.length).toBeGreaterThan(0);

    // 5. component <name>
    const compDetailText = runSubprocess(["--workspace", ws, "component", "src/components"]);
    expect(compDetailText.status).toBe(0);
    expect(compDetailText.stdout).toContain("COMPONENT");
    const compDetailJson = runSubprocess([
      "--workspace",
      ws,
      "component",
      "src/components",
      "--format",
      "json",
    ]);
    expect(compDetailJson.status).toBe(0);
    expect(JSON.parse(compDetailJson.stdout).data.component.name).toBe("src/components");

    // 6. entrypoints
    const epText = runSubprocess(["--workspace", ws, "entrypoints"]);
    expect(epText.status).toBe(0);
    expect(epText.stdout).toContain("ENTRYPOINTS");
    const epJson = runSubprocess(["--workspace", ws, "entrypoints", "--format", "json"]);
    expect(epJson.status).toBe(0);
    expect(JSON.parse(epJson.stdout).data.entrypoints.length).toBeGreaterThan(0);

    // 7. dependencies <target>
    const depsFullText = runSubprocess(["--workspace", ws, "dependencies", "src/index.ts"]);
    expect(depsFullText.status).toBe(0);
    expect(depsFullText.stdout).toContain("DEPENDENCIES");
    const depsFullJson = runSubprocess([
      "--workspace",
      ws,
      "dependencies",
      "src/index.ts",
      "--format",
      "json",
    ]);
    expect(depsFullJson.status).toBe(0);
    expect(JSON.parse(depsFullJson.stdout).query.category).toBe("dependencies");

    // 8. deps <target> (alias)
    const depsAliasText = runSubprocess(["--workspace", ws, "deps", "src/index.ts"]);
    expect(depsAliasText.status).toBe(0);
    expect(depsAliasText.stdout).toContain("DEPENDENCIES");
    const depsAliasJson = runSubprocess([
      "--workspace",
      ws,
      "deps",
      "src/index.ts",
      "--format",
      "json",
    ]);
    expect(depsAliasJson.status).toBe(0);
    expect(JSON.parse(depsAliasJson.stdout).query.category).toBe("dependencies");

    // 9. dependents <target>
    const dependentsText = runSubprocess([
      "--workspace",
      ws,
      "dependents",
      "src/components/Card.tsx",
    ]);
    expect(dependentsText.status).toBe(0);
    expect(dependentsText.stdout).toContain("DEPENDENTS");
    const dependentsJson = runSubprocess([
      "--workspace",
      ws,
      "dependents",
      "src/components/Card.tsx",
      "--format",
      "json",
    ]);
    expect(dependentsJson.status).toBe(0);
    expect(JSON.parse(dependentsJson.stdout).query.category).toBe("dependents");

    // 10. cycles
    const cyclesText = runSubprocess(["--workspace", ws, "cycles"]);
    expect(cyclesText.status).toBe(0);
    expect(cyclesText.stdout).toContain("CYCLES");
    const cyclesJson = runSubprocess(["--workspace", ws, "cycles", "--format", "json"]);
    expect(cyclesJson.status).toBe(0);
    expect(JSON.parse(cyclesJson.stdout).query.category).toBe("cycles");

    // 11. file <path>
    const fileText = runSubprocess(["--workspace", ws, "file", "src/index.ts"]);
    expect(fileText.status).toBe(0);
    expect(fileText.stdout).toContain("FILE");
    const fileJson = runSubprocess(["--workspace", ws, "file", "src/index.ts", "--format", "json"]);
    expect(fileJson.status).toBe(0);
    expect(JSON.parse(fileJson.stdout).data.file.normalizedPath).toBe("src/index.ts");

    // 12. symbol <name>
    const symbolText = runSubprocess(["--workspace", ws, "symbol", "Card"]);
    expect(symbolText.status).toBe(0);
    expect(symbolText.stdout).toContain("SYMBOL");
    const symbolJson = runSubprocess(["--workspace", ws, "symbol", "Card", "--format", "json"]);
    expect(symbolJson.status).toBe(0);
    expect(JSON.parse(symbolJson.stdout).data.symbols.length).toBeGreaterThan(0);

    // 13. tests [target]
    const testsAllText = runSubprocess(["--workspace", ws, "tests"]);
    expect(testsAllText.status).toBe(0);
    expect(testsAllText.stdout).toContain("TESTS");
    const testsTargetJson = runSubprocess([
      "--workspace",
      ws,
      "tests",
      "src/components/Card.tsx",
      "--format",
      "json",
    ]);
    expect(testsTargetJson.status).toBe(0);
    expect(JSON.parse(testsTargetJson.stdout).data.associations.length).toBeGreaterThan(0);

    // 14. decisions
    const decisionsText = runSubprocess(["--workspace", ws, "decisions"]);
    expect(decisionsText.status).toBe(0);
    expect(decisionsText.stdout).toContain("DECISIONS");
    const decisionsJson = runSubprocess(["--workspace", ws, "decisions", "--format", "json"]);
    expect(decisionsJson.status).toBe(0);
    expect(JSON.parse(decisionsJson.stdout).data.decisions.length).toBeGreaterThan(0);

    // 15. decision <id>
    const decisionText = runSubprocess(["--workspace", ws, "decision", "ADR-001"]);
    expect(decisionText.status).toBe(0);
    expect(decisionText.stdout).toContain("DECISION");
    const decisionJson = runSubprocess([
      "--workspace",
      ws,
      "decision",
      "ADR-001",
      "--format",
      "json",
    ]);
    expect(decisionJson.status).toBe(0);
    expect(JSON.parse(decisionJson.stdout).data.decision.adrId).toBe("ADR-001");

    // 16. query "<expression>"
    const queryText = runSubprocess([
      "--workspace",
      ws,
      "query",
      "what are the architectural components?",
    ]);
    expect(queryText.status).toBe(0);
    expect(queryText.stdout).toContain("COMPONENTS");
    const queryJson = runSubprocess([
      "--workspace",
      ws,
      "query",
      "what are the architectural components?",
      "--format",
      "json",
    ]);
    expect(queryJson.status).toBe(0);
    expect(JSON.parse(queryJson.stdout).query.category).toBe("components");
  }, 60000);
});
