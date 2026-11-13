import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";
import { RetrievalEngine, RetrievalFormatter } from "../../scripts/retrieval/index.ts";

const root = repoRoot();

describe("RetrievalEngine (End-to-End Orchestration, Freshness, Memory & Evolution)", () => {
  const tempDirs: string[] = [];
  const managers: ConnectionManager[] = [];

  function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-ret-engine-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const cm of managers.splice(0)) {
      cm.close();
    }
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function writeDiskFile(
    ws: string,
    rel: string,
    content: string,
  ): { size: number; mtimeMs: number } {
    const full = path.join(ws, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    const fixedTime = new Date(1700000000000);
    fs.utimesSync(full, fixedTime, fixedTime);
    const stat = fs.statSync(full);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  }

  async function buildIndexedRepo() {
    const ws = makeTempWorkspace();
    const pkgInfo = writeDiskFile(
      ws,
      "package.json",
      JSON.stringify({ name: "retrieval-fixture", main: "./src/index.ts" }),
    );
    const indexInfo = writeDiskFile(
      ws,
      "src/index.ts",
      'import { verifyToken } from "./auth/token.ts";\nexport function startApp() {\n  return verifyToken("ok");\n}\n',
    );
    const tokenInfo = writeDiskFile(
      ws,
      "src/auth/token.ts",
      "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
    );
    const testInfo = writeDiskFile(
      ws,
      "tests/unit/token.test.ts",
      'import { verifyToken } from "../../src/auth/token.ts";\nexport const tested = verifyToken("a");\n',
    );
    const adrInfo = writeDiskFile(
      ws,
      "docs/adr/ADR-001-token-auth.md",
      "# ADR-001: Stateless Token Verification\n\n- **Status:** Accepted\n- **Date:** 2026-11-12\n\nGoverns src/auth.",
    );

    const files = [
      { path: "package.json", cls: "configuration" as const, meta: pkgInfo, hash: "h_pkg" },
      { path: "src/index.ts", cls: "source" as const, meta: indexInfo, hash: "h_idx" },
      { path: "src/auth/token.ts", cls: "source" as const, meta: tokenInfo, hash: "h_tok" },
      { path: "tests/unit/token.test.ts", cls: "source" as const, meta: testInfo, hash: "h_test" },
      {
        path: "docs/adr/ADR-001-token-auth.md",
        cls: "documentation" as const,
        meta: adrInfo,
        hash: "h_adr",
      },
    ];

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date(1700000001000).toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f.path,
        fileExtension: path.posix.extname(f.path),
        classification: f.cls,
        sizeBytes: f.meta.size,
        mtimeMs: f.meta.mtimeMs,
        contentHash: f.hash,
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
        totalBytesDiscovered: files.reduce((a, b) => a + b.meta.size, 0),
        totalBytesInspected: files.reduce((a, b) => a + b.meta.size, 0),
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.reduce((a, b) => a + b.meta.size, 0),
      limitExceeded: false,
      scanDurationMs: 12,
    };

    const extractions = new Map<string, ExtractionResult>();
    extractions.set("src/auth/token.ts", {
      canonicalPath: "src/auth/token.ts",
      symbols: [
        {
          symbolId: "src/auth/token.ts#verifyToken",
          name: "verifyToken",
          parentScope: null,
          kind: "function",
          isExported: true,
          fingerprint: "fp_verify_token",
          sourceEvidence: {
            lineStart: 1,
            lineEnd: 3,
            colStart: 0,
            colEnd: 1,
            evidenceHash: "ev_tok",
          },
        },
      ],
      imports: [],
      exports: [
        {
          name: "verifyToken",
          localName: "verifyToken",
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
          symbolId: "src/index.ts#startApp",
          name: "startApp",
          parentScope: null,
          kind: "function",
          isExported: true,
          fingerprint: "fp_start_app",
          sourceEvidence: {
            lineStart: 2,
            lineEnd: 4,
            colStart: 0,
            colEnd: 1,
            evidenceHash: "ev_start",
          },
        },
      ],
      imports: [
        {
          specifier: "./auth/token.ts",
          resolvedPath: "src/auth/token.ts",
          importedSymbols: [{ name: "verifyToken" }],
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
    extractions.set("tests/unit/token.test.ts", {
      canonicalPath: "tests/unit/token.test.ts",
      symbols: [],
      imports: [
        {
          specifier: "../../src/auth/token.ts",
          resolvedPath: "src/auth/token.ts",
          importedSymbols: [{ name: "verifyToken" }],
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

    const cm = new ConnectionManager({ workspaceRoot: ws });
    managers.push(cm);
    const sm = new StorageManager(cm);
    await sm.initialize();

    const snap1 = await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "retrieval-fixture",
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = cm.getDatabase();
    const repo = cm.getRepository();
    const memStore = new MemoryStore(db);

    // 1. Verified ACTIVE memory
    const memActive = memStore.createMemory({
      repositoryId: repo.id,
      memoryKey: "auth-token-invariant",
      category: "architectural_knowledge",
      title: "Token verification invariant",
      content: "verifyToken guarantees non-empty token semantics for auth boundary.",
      confidence: 1.0,
      confidenceTier: "CONFIRMED",
      firstSeenScanId: snap1.scanId,
      lastSeenScanId: snap1.scanId,
    });
    memStore.addEvidence({
      repositoryId: repo.id,
      memoryId: memActive.id,
      scanId: snap1.scanId,
      evidenceType: "source_file",
      sourcePath: "src/auth/token.ts",
      sourceHash: "h_tok",
      description: "Token module exists",
    });

    // 2. Stale / missing evidence memory
    const memStale = memStore.createMemory({
      repositoryId: repo.id,
      memoryKey: "legacy-session-cache",
      category: "technical_debt",
      title: "Legacy session cache reference",
      content: "Previously relied on src/auth/legacy-cache.ts.",
      confidence: 0.8,
      confidenceTier: "INFERRED",
      firstSeenScanId: snap1.scanId,
      lastSeenScanId: snap1.scanId,
    });
    memStore.addEvidence({
      repositoryId: repo.id,
      memoryId: memStale.id,
      scanId: snap1.scanId,
      evidenceType: "source_file",
      sourcePath: "src/auth/legacy-cache.ts",
      description: "Removed legacy file",
    });

    // 3. Archived memory (excluded unless includeHistoricalMemories: true)
    const memArchived = memStore.createMemory({
      repositoryId: repo.id,
      memoryKey: "archived-note",
      category: "project_context",
      title: "Archived setup note",
      content: "Old initialization order no longer applicable.",
      confidence: 0.7,
      confidenceTier: "CANDIDATE",
      firstSeenScanId: snap1.scanId,
      lastSeenScanId: snap1.scanId,
    });
    memStore.transitionLifecycle({
      repositoryId: repo.id,
      memoryId: memArchived.id,
      targetStatus: "ARCHIVED",
      changeReason: "Obsolete",
      sourceScanId: snap1.scanId,
    });

    return { ws, cm, sm, scan1Id: snap1.scanId, inventory, extractions };
  }

  it("produces deterministic, schema-validated RetrievalResponse and handoff attachment across roles", async () => {
    const { cm } = await buildIndexedRepo();
    const engine = new RetrievalEngine(cm);

    const implReq = {
      agentId: "implementation-engineer" as const,
      taskSummary: "Update verifyToken in src/auth/token.ts cleanly against ADR-001",
    };

    const resA = await engine.retrieve(implReq);
    const resB = await engine.retrieve(implReq);

    expect(resA.retrievalId).toBe(resB.retrievalId);
    expect(RetrievalFormatter.formatJson(resA)).toBe(RetrievalFormatter.formatJson(resB));

    const schemaFindings = validateValueAgainstSchema(
      root,
      resA,
      "retrieval-response.json",
      "schemas/retrieval-context.schema.json",
      "retrieval-schema",
    );
    expect(schemaFindings).toEqual([]);

    expect(resA.classification.primaryTaskType).toBe("feature_implementation");
    expect(resA.context.files.some((f) => f.filePath === "src/auth/token.ts")).toBe(true);
    expect(resA.context.symbols.some((s) => s.name === "verifyToken")).toBe(true);
    expect(resA.context.tests.some((t) => t.sourceFilePath === "src/auth/token.ts")).toBe(true);
    expect(resA.context.decisions.some((d) => d.adrId === "ADR-001")).toBe(true);
    expect(resA.context.snippets.some((s) => s.filePath === "src/auth/token.ts")).toBe(true);

    // Memory filtering & live verification without DB mutation
    const activeMem = resA.context.memories.find((m) => m.memoryKey === "auth-token-invariant");
    const staleMem = resA.context.memories.find((m) => m.memoryKey === "legacy-session-cache");
    expect(activeMem?.liveVerificationStatus).toBe("VERIFIED");
    expect(staleMem?.liveVerificationStatus).toBe("MISSING");
    expect(resA.context.memories.some((m) => m.memoryKey === "archived-note")).toBe(false);
    expect(resA.warnings.some((w) => w.code === "MEMORY_STALE")).toBe(true);

    // Architectural role excludes snippets by default
    const archRes = await engine.retrieve({
      agentId: "architect",
      taskSummary: "Review auth architecture boundaries and ADR-001",
    });
    expect(archRes.context.snippets).toEqual([]);
    expect(archRes.context.components.length).toBeGreaterThan(0);

    // Historical memories opt-in
    const histRes = await engine.retrieve({
      agentId: "architect",
      taskSummary: "Inspect archived project notes",
      includeHistoricalMemories: true,
    });
    expect(histRes.context.memories.some((m) => m.memoryKey === "archived-note")).toBe(true);

    // Handoff compact attachment validates against handoff schema
    const attachment = RetrievalEngine.buildHandoffAttachment(resA);
    expect(attachment.contract).toBe("frontier-engineer/retrieval-attachment");
    expect(attachment.highlights.length).toBeGreaterThan(0);
    expect(attachment.highlights.length).toBeLessThanOrEqual(12);
  });

  it("surfaces INDEX_STALE warnings when workspace files change after indexing", async () => {
    const { ws, cm } = await buildIndexedRepo();
    fs.writeFileSync(
      path.join(ws, "src/auth/token.ts"),
      'export function verifyToken(token: string) { return token.startsWith("v2_"); }\n',
      "utf8",
    );

    const engine = new RetrievalEngine(cm);
    const res = await engine.retrieve({
      agentId: "qa-engineer",
      taskSummary: "Check tests for verifyToken",
    });

    expect(res.snapshot.freshness.isStale).toBe(true);
    expect(res.warnings.some((w) => w.code === "INDEX_STALE")).toBe(true);
  });

  it("supports multi-snapshot evolution retrieval in strictly read-only mode", async () => {
    const { ws, cm, sm, scan1Id, inventory, extractions } = await buildIndexedRepo();

    const extraInfo = writeDiskFile(
      ws,
      "src/auth/revocation.ts",
      "export const revoked = new Set<string>();\n",
    );
    const inv2: FileInventoryResult = {
      ...inventory,
      scannedAt: new Date().toISOString(),
      files: [
        ...inventory.files,
        {
          canonicalPath: "src/auth/revocation.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: extraInfo.size,
          mtimeMs: extraInfo.mtimeMs,
          contentHash: "h_rev",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
      ],
      totalFilesScanned: inventory.files.length + 1,
    };

    const snap2 = await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "retrieval-fixture",
      inventory: inv2,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = cm.getDatabase();
    const eventsBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM evolution_events").get() as { c: number }
    ).c;

    const engine = new RetrievalEngine(cm);
    const res = await engine.retrieve({
      agentId: "architect",
      taskSummary: `Compare scan ${scan1Id} to scan ${snap2.scanId} for auth drift`,
    });

    expect(res.context.evolution).not.toBeNull();
    expect(res.context.evolution?.baseScanId).toBe(scan1Id);
    expect(res.context.evolution?.targetScanId).toBe(snap2.scanId);
    expect(res.context.evolution?.filesAdded).toBe(1);

    const eventsAfter = (
      db.prepare("SELECT COUNT(*) AS c FROM evolution_events").get() as { c: number }
    ).c;
    expect(eventsAfter).toBe(eventsBefore);
  });
});
