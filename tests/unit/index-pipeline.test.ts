import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractFileSymbols, isAstExtractablePath } from "../../scripts/extractor/index.ts";
import { GraphBuilder } from "../../scripts/graph/graph-builder.ts";
import { IndexPipeline } from "../../scripts/indexer/index-pipeline.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { ArchitectureQueryEngine } from "../../scripts/query/query-engine.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";

describe("Phase 8.1 — End-to-End Indexing, Incremental Refresh, Polyglot Extraction & Call Graph", () => {
  let tmpWorkspace: string;
  const cliPath = path.resolve("scripts/cli/frontier-cli.ts");

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "fe-phase81-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  function writeFiles(root: string, files: Record<string, string>): void {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
  }

  function runCliSubprocess(args: string[], cwd: string = tmpWorkspace) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  describe("1. Polyglot-Safe Structural Extraction", () => {
    it("identifies TypeScript and JavaScript extensions as AST-extractable and excludes non-TS/JS languages", () => {
      expect(isAstExtractablePath("src/index.ts")).toBe(true);
      expect(isAstExtractablePath("src/App.tsx")).toBe(true);
      expect(isAstExtractablePath("src/esm.mts")).toBe(true);
      expect(isAstExtractablePath("src/cjs.cts")).toBe(true);
      expect(isAstExtractablePath("src/legacy.js")).toBe(true);
      expect(isAstExtractablePath("src/Component.jsx")).toBe(true);
      expect(isAstExtractablePath("src/module.mjs")).toBe(true);
      expect(isAstExtractablePath("src/common.cjs")).toBe(true);

      expect(isAstExtractablePath("services/worker.py")).toBe(false);
      expect(isAstExtractablePath("cmd/server/main.go")).toBe(false);
      expect(isAstExtractablePath("crates/core/src/lib.rs")).toBe(false);
      expect(isAstExtractablePath("src/Main.java")).toBe(false);
      expect(isAstExtractablePath("docs/adr/ADR-001.md")).toBe(false);
    });

    it("returns clean SUCCESS extraction with zero false syntax diagnostics for Python, Go, Rust, and Markdown files", async () => {
      const pyRes = await extractFileSymbols(
        "services/ml/train.py",
        "def train_model(x: int) -> int:\n    return x * 2\n",
      );
      expect(pyRes.status).toBe("SUCCESS");
      expect(pyRes.diagnostics).toHaveLength(0);
      expect(pyRes.symbols).toHaveLength(0);

      const goRes = await extractFileSymbols(
        "cmd/api/main.go",
        'package main\nfunc main() { println("hello") }\n',
      );
      expect(goRes.status).toBe("SUCCESS");
      expect(goRes.diagnostics).toHaveLength(0);

      const rsRes = await extractFileSymbols(
        "src/lib.rs",
        "pub fn compute(v: &[u8]) -> usize { v.len() }\n",
      );
      expect(rsRes.status).toBe("SUCCESS");
      expect(rsRes.diagnostics).toHaveLength(0);
    });

    it("still enforces canonical path boundary checks on non-TS/JS files", async () => {
      const badPy = await extractFileSymbols("../escape.py", "x = 1");
      expect(badPy.status).toBe("FAILED");
      expect(badPy.diagnostics[0]?.message).toContain("Invalid canonical path");
    });
  });

  describe("2. Call-Reference Graph Edge Construction (REFERENCES)", () => {
    it("persists REFERENCES edges for resolved cross-file and intra-file function/method calls", async () => {
      writeFiles(tmpWorkspace, {
        "src/auth/token.ts": [
          "export function verifyToken(raw: string): boolean {",
          "  return normalizeToken(raw).length > 0;",
          "}",
          "function normalizeToken(raw: string): string {",
          "  return raw.trim();",
          "}",
        ].join("\n"),
        "src/api/controller.ts": [
          'import { verifyToken } from "../auth/token.ts";',
          "export function handleRequest(header: string): boolean {",
          "  return verifyToken(header);",
          "}",
        ].join("\n"),
      });

      const tokenContent = fs.readFileSync(path.join(tmpWorkspace, "src/auth/token.ts"), "utf8");
      const controllerContent = fs.readFileSync(
        path.join(tmpWorkspace, "src/api/controller.ts"),
        "utf8",
      );

      const extToken = await extractFileSymbols("src/auth/token.ts", tokenContent, {
        workspaceRoot: tmpWorkspace,
      });
      const extController = await extractFileSymbols("src/api/controller.ts", controllerContent, {
        workspaceRoot: tmpWorkspace,
      });

      const { nodes, edges } = GraphBuilder.buildGraph({
        repositoryIdentity: "call-graph-repo",
        files: [
          {
            canonicalPath: "src/auth/token.ts",
            fileExtension: ".ts",
            classification: "source",
            sizeBytes: tokenContent.length,
            mtimeMs: 1700000000000,
            contentHash: "h1",
            hashState: "COMPUTED",
            inspectionStatus: "INCLUDED",
            exclusionStatus: "INCLUDED",
            exclusionReason: null,
          },
          {
            canonicalPath: "src/api/controller.ts",
            fileExtension: ".ts",
            classification: "source",
            sizeBytes: controllerContent.length,
            mtimeMs: 1700000000000,
            contentHash: "h2",
            hashState: "COMPUTED",
            inspectionStatus: "INCLUDED",
            exclusionStatus: "INCLUDED",
            exclusionReason: null,
          },
        ],
        extractions: new Map([
          ["src/auth/token.ts", extToken],
          ["src/api/controller.ts", extController],
        ]),
      });

      const handleReqNode = nodes.find(
        (n) => n.category === "symbol" && n.name === "handleRequest",
      );
      const verifyTokenNode = nodes.find(
        (n) => n.category === "symbol" && n.name === "verifyToken",
      );
      const normalizeTokenNode = nodes.find(
        (n) => n.category === "symbol" && n.name === "normalizeToken",
      );

      expect(handleReqNode).toBeDefined();
      expect(verifyTokenNode).toBeDefined();
      expect(normalizeTokenNode).toBeDefined();

      // Cross-file call: handleRequest -> REFERENCES -> verifyToken
      const crossFileCall = edges.find(
        (e) =>
          e.relationshipType === "REFERENCES" &&
          e.sourceNodeIdentity === handleReqNode!.nodeIdentity &&
          e.targetNodeIdentity === verifyTokenNode!.nodeIdentity,
      );
      expect(crossFileCall).toBeDefined();
      expect(crossFileCall?.confidence).toBe(1.0);
      expect(crossFileCall?.relationshipStatus).toBe("CONFIRMED");
      expect(crossFileCall?.metadata?.referenceKind).toBe("call");

      // Intra-file call: verifyToken -> REFERENCES -> normalizeToken
      const intraFileCall = edges.find(
        (e) =>
          e.relationshipType === "REFERENCES" &&
          e.sourceNodeIdentity === verifyTokenNode!.nodeIdentity &&
          e.targetNodeIdentity === normalizeTokenNode!.nodeIdentity,
      );
      expect(intraFileCall).toBeDefined();
    });
  });

  describe("3. Unified IndexPipeline (scan & incremental refresh)", () => {
    it("indexes a polyglot repository end-to-end with COMPLETE status, persisted components, and call edges", async () => {
      writeFiles(tmpWorkspace, {
        "package.json": JSON.stringify({
          name: "polyglot-service",
          main: "./src/index.ts",
        }),
        "src/utils/hash.ts": [
          "export function computeHash(input: string): string {",
          '  return "hash_" + input;',
          "}",
        ].join("\n"),
        "src/index.ts": [
          'import { computeHash } from "./utils/hash.ts";',
          "export function runService(payload: string): string {",
          "  return computeHash(payload);",
          "}",
        ].join("\n"),
        "tests/unit/index.test.ts": [
          'import { runService } from "../../src/index.ts";',
          "export function testRun(): void {",
          '  runService("abc");',
          "}",
        ].join("\n"),
        "scripts/worker.py": "def run_worker():\n    return True\n",
        "cmd/agent/main.go": "package main\nfunc main() {}\n",
        "docs/adr/ADR-001-hash-policy.md": [
          "# ADR-001: Hash Policy",
          "- **Status:** Accepted",
          "Governs src/utils/hash.ts.",
        ].join("\n"),
      });

      const report1 = await IndexPipeline.run({
        workspaceRoot: tmpWorkspace,
        incremental: false,
      });

      expect(report1.mode).toBe("SCAN");
      expect(report1.status).toBe("COMPLETE");
      expect(report1.promoted).toBe(true);
      expect(report1.skippedNoChanges).toBe(false);
      expect(report1.counts.filesFailed).toBe(0);
      expect(report1.counts.symbolsIndexed).toBeGreaterThanOrEqual(3);
      expect(report1.counts.componentsDetected).toBeGreaterThanOrEqual(1);
      expect(report1.counts.decisionsDetected).toBe(1);

      // Verify incremental refresh skips re-indexing when no files changed
      const refreshSkipped = await IndexPipeline.run({
        workspaceRoot: tmpWorkspace,
        incremental: true,
      });
      expect(refreshSkipped.mode).toBe("REFRESH_INCREMENTAL_SKIPPED");
      expect(refreshSkipped.skippedNoChanges).toBe(true);
      expect(refreshSkipped.scanId).toBe(report1.scanId);

      // Modify a file and verify incremental refresh detects staleness and creates a new scan
      writeFiles(tmpWorkspace, {
        "src/utils/hash.ts": [
          "export function computeHash(input: string): string {",
          '  return "sha256_" + input;',
          "}",
          "export function verifyHash(input: string, expected: string): boolean {",
          "  return computeHash(input) === expected;",
          "}",
        ].join("\n"),
      });

      const refreshReindexed = await IndexPipeline.run({
        workspaceRoot: tmpWorkspace,
        incremental: true,
      });
      expect(refreshReindexed.mode).toBe("REFRESH_REINDEXED");
      expect(refreshReindexed.skippedNoChanges).toBe(false);
      expect(refreshReindexed.scanId).toBeGreaterThan(report1.scanId);
      expect(refreshReindexed.previousActiveScanId).toBe(report1.scanId);
      expect(refreshReindexed.status).toBe("COMPLETE");

      // Verify symbol call dependents query works through ArchitectureQueryEngine
      const cm = new ConnectionManager({ workspaceRoot: tmpWorkspace });
      await cm.initialize();
      try {
        const qe = new ArchitectureQueryEngine(cm);
        const symDependents = await qe.getDependents("computeHash", { depth: 2 });
        expect(symDependents.data.direct.some((d) => d.pathOrName === "runService")).toBe(true);
        expect(symDependents.data.direct.some((d) => d.pathOrName === "verifyHash")).toBe(true);
      } finally {
        cm.close();
      }
    });

    it("evaluates and transitions engineering memories during refresh when applyLifecycle is enabled", async () => {
      writeFiles(tmpWorkspace, {
        "package.json": JSON.stringify({ name: "mem-refresh-repo" }),
        "src/feature.ts": "export const activeFeature = true;\n",
      });

      const scan1 = await IndexPipeline.run({ workspaceRoot: tmpWorkspace });
      expect(scan1.status).toBe("COMPLETE");

      const cm = new ConnectionManager({ workspaceRoot: tmpWorkspace });
      await cm.initialize();
      try {
        const db = cm.getDatabase();
        const repo = cm.getRepository();
        const memStore = new MemoryStore(db);
        const mem = memStore.createMemory({
          repositoryId: repo.id,
          memoryKey: "feature-flag-invariant",
          category: "architectural_knowledge",
          title: "Feature flag module exists",
          content: "src/feature.ts defines activeFeature.",
          confidence: 1.0,
          confidenceTier: "CONFIRMED",
          firstSeenScanId: scan1.scanId,
          lastSeenScanId: scan1.scanId,
        });
        memStore.addEvidence({
          repositoryId: repo.id,
          memoryId: mem.id,
          scanId: scan1.scanId,
          evidenceType: "source_file",
          sourcePath: "src/feature.ts",
          description: "src/feature.ts exists",
          confidence: 1.0,
        });
      } finally {
        cm.close();
      }

      // Delete src/feature.ts and run refresh with applyLifecycle: true
      fs.unlinkSync(path.join(tmpWorkspace, "src/feature.ts"));
      writeFiles(tmpWorkspace, {
        "src/replacement.ts": "export const replacement = 1;\n",
      });

      const scan2 = await IndexPipeline.run({
        workspaceRoot: tmpWorkspace,
        incremental: true,
        applyLifecycle: true,
      });
      expect(scan2.mode).toBe("REFRESH_REINDEXED");
      expect(scan2.lifecycleEvaluation).toBeDefined();
      expect(scan2.lifecycleEvaluation?.transitionedToStale).toBe(1);
    });
  });

  describe("4. CLI scan and refresh Subcommands", () => {
    it("executes 'scan', 'status', 'freshness', and 'refresh' via CLI subprocess", () => {
      writeFiles(tmpWorkspace, {
        "package.json": JSON.stringify({ name: "cli-scan-repo", main: "./src/main.ts" }),
        "src/main.ts": "export function main(): number { return 1; }\n",
        "scripts/helper.py": "print('ok')\n",
      });

      // 1. Run 'scan --format json'
      const scanProc = runCliSubprocess(["scan", "--format", "json"]);
      expect(scanProc.status).toBe(0);
      const scanJson = JSON.parse(scanProc.stdout);
      expect(scanJson.mode).toBe("SCAN");
      expect(scanJson.status).toBe("COMPLETE");
      expect(scanJson.promoted).toBe(true);
      expect(scanJson.counts.filesIndexed).toBeGreaterThanOrEqual(3);

      // 2. Run 'status --format json' and confirm index is FRESH
      const statusProc = runCliSubprocess(["status", "--format", "json"]);
      expect(statusProc.status).toBe(0);
      const statusJson = JSON.parse(statusProc.stdout);
      expect(statusJson.data.activeScanId).toBe(scanJson.scanId);
      expect(statusJson.data.isFresh).toBe(true);

      // 3. Run 'refresh --format json' with no changes -> skippedNoChanges: true
      const refreshNoop = runCliSubprocess(["refresh", "--format", "json"]);
      expect(refreshNoop.status).toBe(0);
      const refreshNoopJson = JSON.parse(refreshNoop.stdout);
      expect(refreshNoopJson.mode).toBe("REFRESH_INCREMENTAL_SKIPPED");
      expect(refreshNoopJson.skippedNoChanges).toBe(true);
      expect(refreshNoopJson.scanId).toBe(scanJson.scanId);

      // 4. Modify src/main.ts -> 'freshness' reports STALE -> 'refresh' re-indexes
      writeFiles(tmpWorkspace, {
        "src/main.ts": "export function main(): number { return 2; }\n",
      });
      const freshStaleProc = runCliSubprocess(["freshness", "--format", "json"]);
      expect(freshStaleProc.status).toBe(0);
      expect(JSON.parse(freshStaleProc.stdout).data.isStale).toBe(true);

      const refreshTextProc = runCliSubprocess(["refresh"]);
      expect(refreshTextProc.status).toBe(0);
      expect(refreshTextProc.stdout).toContain("Frontier Engineer — Repository Index");
      expect(refreshTextProc.stdout).toContain("REFRESH_REINDEXED");
    });
  });
});
