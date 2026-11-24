import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { IndexPipeline } from "../../scripts/indexer/index-pipeline.ts";

describe("Phase 8.1-R1 End-to-End Pipeline & CLI Integration", () => {
  const cliPath = path.resolve("scripts/cli/frontier-cli.ts");
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-e2e-81r1-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeFiles(workspace: string, files: Record<string, string>) {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(workspace, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
  }

  function runCli(args: string[], cwd: string) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors on temp dirs
      }
    }
    tempDirs.length = 0;
  });

  describe("E2E: Scanner, Indexer & CLI with .mts / .cts files", () => {
    it("scans workspace with .mts and .cts files, stores symbols and queries them via CLI", async () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "mts-cts-e2e-app" }),
        "src/config.cts": [
          "export interface CtsAppConfig {",
          "  port: number;",
          "}",
          "export function loadCtsConfig(): CtsAppConfig {",
          "  return { port: 3000 };",
          "}",
        ].join("\n"),
        "src/server.mts": [
          "import { loadCtsConfig } from './config.cjs';",
          "export function startMtsServer(): void {",
          "  const cfg = loadCtsConfig();",
          "  console.log(cfg.port);",
          "}",
        ].join("\n"),
      });

      const scanRes = runCli(["scan", "--format", "json"], ws);
      expect(scanRes.status).toBe(0);
      const scanOutput = JSON.parse(scanRes.stdout);
      expect(scanOutput.status).toBe("COMPLETE");
      expect(scanOutput.counts.filesIndexed).toBeGreaterThanOrEqual(2);

      const statusRes = runCli(["status", "--format", "json"], ws);
      expect(statusRes.status).toBe(0);
      const statusOutput = JSON.parse(statusRes.stdout);
      expect(statusOutput.data).toBeDefined();
      expect(statusOutput.data.activeScanStatus).toBe("COMPLETE");

      const queryRes = runCli(["symbol", "startMtsServer", "--format", "json"], ws);
      expect(queryRes.status).toBe(0);
      const queryOutput = JSON.parse(queryRes.stdout);
      expect(queryOutput.data.symbols.length).toBeGreaterThanOrEqual(1);
      expect(queryOutput.data.symbols[0].filePath).toBe("src/server.mts");
    });
  });

  describe("E2E: Incremental Refresh with Delta Re-extraction", () => {
    it("accurately tracks reused vs re-extracted files across scans", async () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "incremental-e2e-app" }),
        "src/stable1.ts": "export function s1(): string { return 's1'; }",
        "src/stable2.ts": "export function s2(): string { return 's2'; }",
        "src/mutating.ts": "export function mutateMe(): number { return 1; }",
      });

      const initialReport = await IndexPipeline.run({ workspaceRoot: ws });
      expect(initialReport.status).toBe("COMPLETE");
      expect(initialReport.counts.reusedExtractionsCount).toBe(0);
      expect(initialReport.counts.reextractedFilesCount).toBe(3);

      // Now mutate mutating.ts, add new.ts, and delete stable2.ts
      fs.writeFileSync(
        path.join(ws, "src/mutating.ts"),
        "export function mutateMe(): number { return 2; }\nexport const extra = true;",
        "utf8",
      );
      fs.writeFileSync(
        path.join(ws, "src/newFile.ts"),
        "export function brandNew(): boolean { return true; }",
        "utf8",
      );
      fs.unlinkSync(path.join(ws, "src/stable2.ts"));

      const refreshRes = runCli(["refresh", "--format", "json"], ws);
      expect(refreshRes.status).toBe(0);
      const refreshOutput = JSON.parse(refreshRes.stdout);
      expect(refreshOutput.status).toBe("COMPLETE");
      // stable1.ts was unchanged -> reused
      expect(refreshOutput.counts.reusedExtractionsCount).toBeGreaterThanOrEqual(1);
      // mutating.ts and newFile.ts -> re-extracted
      expect(refreshOutput.counts.reextractedFilesCount).toBe(2);

      // Verify that deleted file is not in active scan
      const cm = new ConnectionManager({ workspaceRoot: ws });
      await cm.initialize();
      try {
        const db = cm.getDatabase();
        const activeFiles = db
          .prepare("SELECT normalized_path FROM files WHERE scan_id = ?")
          .all(refreshOutput.scanId) as Array<{ normalized_path: string }>;
        const paths = activeFiles.map((f) => f.normalized_path);
        expect(paths).toContain("src/stable1.ts");
        expect(paths).toContain("src/mutating.ts");
        expect(paths).toContain("src/newFile.ts");
        expect(paths).not.toContain("src/stable2.ts");
      } finally {
        cm.close();
      }
    });
  });

  describe("E2E: Fault Isolation for Unreadable Files", () => {
    it("handles unreadable file without aborting the pipeline and sets status appropriately", async () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "fault-isolation-app" }),
        "src/good.ts": "export function ok(): boolean { return true; }",
        "src/bad.ts": "export function ok(): boolean { return true; }",
      });

      const origReadFile = fs.readFileSync;
      const readSpy = (filePath: any, options: any) => {
        if (typeof filePath === "string" && filePath.includes("bad.ts")) {
          throw new Error("EACCES: permission denied, read");
        }
        return origReadFile(filePath, options);
      };

      (fs as any).readFileSync = readSpy;
      try {
        const report = await IndexPipeline.run({ workspaceRoot: ws });
        expect(report.status).toBe("PARTIAL");
        expect(report.counts.filesFailed).toBe(1);
        expect(report.counts.filesIndexed).toBeGreaterThanOrEqual(1);

        const cm = new ConnectionManager({ workspaceRoot: ws });
        await cm.initialize();
        try {
          const db = cm.getDatabase();
          const scan = db
            .prepare("SELECT status, files_failed FROM scan_runs WHERE id = ?")
            .get(report.scanId) as any;
          expect(scan.status).toBe("PARTIAL");
          expect(scan.files_failed).toBe(1);
        } finally {
          cm.close();
        }
      } finally {
        (fs as any).readFileSync = origReadFile;
      }
    });
  });

  describe("E2E: CLI Strict Argument & Flag Validation", () => {
    it("rejects invalid arguments and incompatible options across commands", () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "cli-validation-app" }),
      });

      // 1. Positional arg on scan
      const resScanArg = runCli(["scan", "foo"], ws);
      expect(resScanArg.status).toBe(2);
      expect(resScanArg.stderr).toContain("Unexpected positional argument(s) for 'scan'");

      // 2. Incompatible query option on scan
      const resScanOpt = runCli(["scan", "--scan-id", "123"], ws);
      expect(resScanOpt.status).toBe(2);
      expect(resScanOpt.stderr).toContain("--scan-id is not supported for 'scan'");

      // 3. Positional arg on refresh
      const resRefreshArg = runCli(["refresh", "bar"], ws);
      expect(resRefreshArg.status).toBe(2);
      expect(resRefreshArg.stderr).toContain("Unexpected positional argument(s) for 'refresh'");

      // 4. Incompatible traversal flags on status
      const resStatusOpt = runCli(["status", "--target-categories", "function"], ws);
      expect(resStatusOpt.status).toBe(2);
      expect(resStatusOpt.stderr).toContain(
        "--relationship-types and --target-categories are only supported",
      );

      // 5. Incompatible query option on overview
      const resOverviewOpt = runCli(["overview", "--depth", "5"], ws);
      expect(resOverviewOpt.status).toBe(2);
      expect(resOverviewOpt.stderr).toContain("--depth is only supported for dependency");
    });
  });

  describe("E2E: Ambiguous Symbol Disambiguation and Edge Filtering via CLI", () => {
    it("emits disambiguation warning on ambiguous symbol queries", async () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "disambig-e2e-app" }),
        "src/moduleA.ts": "export function processItem(): string { return 'A'; }",
        "src/moduleB.ts": "export function processItem(): string { return 'B'; }",
      });

      const scanRes = runCli(["scan"], ws);
      expect(scanRes.status).toBe(0);

      const depRes = runCli(["dependencies", "processItem", "--format", "json"], ws);
      expect(depRes.status).toBe(0);
      const depJson = JSON.parse(depRes.stdout);
      expect(depJson.warnings).toBeDefined();
      expect(
        depJson.warnings.some((w: string) => w.includes("Ambiguous symbol 'processItem'")),
      ).toBe(true);
      expect(depJson.data.ambiguousCandidates).toHaveLength(2);
    });

    it("filters relationships via CLI --edge-types", async () => {
      const ws = createTempWorkspace();
      writeFiles(ws, {
        "package.json": JSON.stringify({ name: "filtering-e2e-app" }),
        "src/lib.ts": "export function helper(): void {}",
        "src/main.ts": [
          "import { helper } from './lib';",
          "export function entry(): void { helper(); }",
        ].join("\n"),
      });

      runCli(["scan"], ws);

      // Query only IMPORTS
      const resImports = runCli(
        ["dependencies", "src/main.ts", "--edge-types", "IMPORTS", "--format", "json"],
        ws,
      );
      expect(resImports.status).toBe(0);
      const jsonImports = JSON.parse(resImports.stdout);
      expect(jsonImports.data.direct.every((d: any) => d.relationship === "IMPORTS")).toBe(true);

      // Query only DEFINES
      const resDefines = runCli(
        ["dependencies", "src/main.ts", "--edge-types", "DEFINES", "--format", "json"],
        ws,
      );
      expect(resDefines.status).toBe(0);
      const jsonDefines = JSON.parse(resDefines.stdout);
      expect(jsonDefines.data.direct.every((d: any) => d.relationship === "DEFINES")).toBe(true);
    });
  });
});
