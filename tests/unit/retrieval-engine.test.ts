import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";
import { RetrievalEngine, RetrievalFormatter } from "../../scripts/retrieval/index.ts";
import { ContextBudgeter } from "../../scripts/retrieval/context-budgeter.ts";
import { validateHandoffAttachment } from "../../scripts/retrieval/schema-validator.ts";

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

  it("enforces conjunctive memory evidence soundness (UNVERIFIED on partial verification) and historical ADR SHA-256 tamper isolation", async () => {
    const { ws, cm, sm, inventory, extractions } = await buildIndexedRepo();
    const db = cm.getDatabase();
    const repo = cm.getRepository();

    // Update ADR row with actual SHA-256 content hash of docs/adr/ADR-001-token-auth.md
    const adrRel = "docs/adr/ADR-001-token-auth.md";
    const adrAbs = path.join(ws, adrRel);
    const adrBytes = fs.readFileSync(adrAbs);
    const crypto = await import("node:crypto");
    const adrSha = crypto.createHash("sha256").update(adrBytes).digest("hex");

    // Store ADR with real SHA-256 hash on scan 1
    db.prepare(
      "UPDATE files SET content_hash = ? WHERE repository_id = ? AND normalized_path = ?",
    ).run(adrSha, repo.id, adrRel);

    const activeScan = cm.getRepository().activeScanId!;

    // Memory with 1 VERIFIED evidence + 1 UNVERIFIED evidence (never promoted to VERIFIED)
    const memStore = new MemoryStore(db);
    const mixedMem = memStore.createMemory({
      repositoryId: repo.id,
      memoryKey: "mixed-ev-mem",
      category: "architectural_decision",
      title: "Token verification invariant",
      content: "Tokens must validate length and issuer.",
      confidence: 0.9,
      confidenceTier: "CONFIRMED",
      firstSeenScanId: activeScan,
      lastSeenScanId: activeScan,
    });
    memStore.addEvidence({
      repositoryId: repo.id,
      memoryId: mixedMem.id,
      scanId: activeScan,
      evidenceType: "source_file",
      sourcePath: "src/auth/token.ts",
      description: "Existing file evidence",
    });
    memStore.addEvidence({
      repositoryId: repo.id,
      memoryId: mixedMem.id,
      scanId: activeScan,
      evidenceType: "manual",
      sourcePath: "manual",
      description: "Manual review evidence outside automated static index",
    });

    // Mutate ADR file on disk after snapshot (tampering live disk relative to indexed SHA-256)
    fs.writeFileSync(
      adrAbs,
      "# ADR-999: Tampered Live Edit\n\n- **Status:** Deprecated\n\nTampered content.",
      "utf8",
    );

    const engine = new RetrievalEngine(cm);
    const res = await engine.retrieve({
      agentId: "architect",
      taskSummary: "Review auth ADR-001 and mixed memory",
      scanId: activeScan,
    });

    const memOut = res.context.memories.find((m) => m.memoryKey === "mixed-ev-mem");
    expect(memOut).toBeDefined();
    expect(memOut?.liveVerificationStatus).toBe("UNVERIFIED");
    expect(res.warnings.some((w) => w.code === "MEMORY_EVIDENCE_UNVERIFIED")).toBe(true);

    // Tampered live ADR must NOT masquerade as confirmed snapshot content
    const adrOut = res.context.decisions.find((d) => d.filePath === adrRel);
    expect(adrOut).toBeDefined();
    expect(adrOut?.verificationStatus).toBe("DISK_HASH_MISMATCH");
    expect(adrOut?.isFallback).toBe(true);
    expect(adrOut?.title).not.toContain("Tampered Live Edit");
    expect(res.warnings.some((w) => w.code === "ADR_SNAPSHOT_UNVERIFIED")).toBe(true);

    // Silence unused variable warning while testing schema
    void sm;
    void inventory;
    void extractions;
  });

  it("enforces VALIDATING scan rejection, allowPartialSnapshot=false rejection, identity check, AbortSignal, and explicit includeSnippets for architect/frontier-engineer", async () => {
    const { ws, cm } = await buildIndexedRepo();
    const db = cm.getDatabase();
    const repo = cm.getRepository();
    const now = new Date().toISOString();

    const validatingScan = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active)
           VALUES (?, ?, ?, 'VALIDATING', 0, 0, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
        )
        .run(repo.id, now, null).lastInsertRowid,
    );
    const partialScan = Number(
      db
        .prepare(
          `INSERT INTO scan_runs (repository_id, started_at, completed_at, status, files_discovered, files_indexed, files_skipped, files_failed, diagnostic_count, scanner_version, extractor_version, is_active)
           VALUES (?, ?, ?, 'PARTIAL', 1, 1, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
        )
        .run(repo.id, now, now).lastInsertRowid,
    );

    const engine = new RetrievalEngine(cm);

    await expect(
      engine.retrieve({
        agentId: "architect",
        taskSummary: "Inspect validating scan",
        scanId: validatingScan,
      }),
    ).rejects.toThrow(/VALIDATING/);

    await expect(
      engine.retrieve({
        agentId: "architect",
        taskSummary: "Inspect partial scan strictly",
        scanId: partialScan,
        allowPartialSnapshot: false,
      }),
    ).rejects.toThrow(/allowPartialSnapshot is false/);

    await expect(
      engine.retrieve({
        agentId: "architect",
        taskSummary: "Wrong identity",
        expectedRepositoryIdentity: "non-matching-identity",
      }),
    ).rejects.toThrow(/Expected repository identity/i);

    const ac = new AbortController();
    ac.abort(new Error("User cancelled"));
    await expect(
      engine.retrieve({
        agentId: "architect",
        taskSummary: "Aborted retrieval",
        signal: ac.signal,
      }),
    ).rejects.toThrow(/RETRIEVAL_CANCELLED|cancelled/i);

    // DEFECT-RET-03: explicit includeSnippets: true for architect returns snippets cleanly
    const withSnippets = await engine.retrieve({
      agentId: "architect",
      taskSummary: "Inspect verifyToken implementation in src/auth/token.ts",
      targetFiles: ["src/auth/token.ts"],
      includeSnippets: true,
    });
    expect(withSnippets.plan.includeSnippets).toBe(true);
    expect(withSnippets.context.snippets.length).toBeGreaterThan(0);

    // Avoid unused helper warning
    void ws;
  });

  it("enforces exact serializedChars envelope budgets, batched SQL queries, and critical warning preservation on handoff overflow", async () => {
    const { cm } = await buildIndexedRepo();
    const db = cm.getDatabase();

    const preparedSql: string[] = [];
    const origPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      preparedSql.push(sql);
      return origPrepare(sql);
    };

    const engine = new RetrievalEngine(cm);
    const res = await engine.retrieve({
      agentId: "implementation-engineer",
      taskSummary: "Update verifyToken in src/auth/token.ts",
      targetFiles: ["src/auth/token.ts"],
      limits: {
        maxTotalChars: 3500,
        maxTokens: 900,
        maxItems: 20,
      },
    });
    (db as any).prepare = origPrepare;

    const perFileCountQueries = preparedSql.filter(
      (sql) =>
        (sql.includes("FROM exports") || sql.includes("FROM imports")) && sql.includes("COUNT("),
    );
    expect(perFileCountQueries.length).toBeLessThanOrEqual(4);
    expect(res.budget.serializedChars).toBe(JSON.stringify(res).length);
    if (!res.budget.budgetOverflowed) {
      expect(JSON.stringify(res).length).toBeLessThanOrEqual(3500);
    }

    // Critical warnings NEVER dropped behind >10 info warnings
    const overloadedWarningsResponse = {
      ...res,
      warnings: [
        ...Array.from({ length: 12 }, (_, idx) => ({
          code: "EVOLUTION_UNAVAILABLE" as const,
          severity: "info" as const,
          message: `Info notice ${idx}`,
        })),
        {
          code: "PROMPT_INJECTION_SIGNAL" as const,
          severity: "warning" as const,
          message: "Prompt injection detected in file snippet.",
        },
        {
          code: "MEMORY_DISPUTED" as const,
          severity: "error" as const,
          message: "Active memory #1 is disputed.",
        },
      ],
    };
    const attachment = RetrievalEngine.buildHandoffAttachment(overloadedWarningsResponse);
    const joined = attachment.warnings.join("\n");
    expect(joined).toContain("[PROMPT_INJECTION_SIGNAL]");
    expect(joined).toContain("[MEMORY_DISPUTED]");
    expect(joined).toContain("[WARNINGS_OVERFLOW]");
  });

  it("enforces schema bounds, UTF-16 safe fenced truncation, provenance, warning caps, and retrieve() boundary validation", async () => {
    const { cm } = await buildIndexedRepo();
    const scanId = cm.getRepository().activeScanId!;

    // Seed an overlong memory title with UTF-16 surrogate pair boundary + verified evidence
    const surrogateTitle = `${"A".repeat(1940)}${"\uD83D\uDE80".repeat(80)}`;
    const memStore = new MemoryStore(cm.getDatabase());
    const mem = memStore.createMemory({
      repositoryId: cm.getRepository().id,
      memoryKey: "overlong-surrogate-mem",
      category: "architectural_knowledge",
      title: surrogateTitle,
      content: `Detailed memory body ${"B".repeat(2500)}`,
      confidence: 0.92,
      confidenceTier: "CONFIRMED",
      firstSeenScanId: scanId,
      lastSeenScanId: scanId,
    });
    memStore.addEvidence({
      repositoryId: cm.getRepository().id,
      memoryId: mem.id,
      scanId,
      evidenceType: "source_file",
      sourcePath: "src/auth/token.ts",
      description: "src/auth/token.ts",
      confidence: 0.95,
    });

    const baseRes = await new RetrievalEngine(cm).retrieve({
      agentId: "architect",
      taskSummary: "Inspect overlong surrogate memory and verifyToken in src/auth/token.ts",
      targetFiles: ["src/auth/token.ts"],
    });

    // Test buildHandoffAttachment bounding on oversized synthetic fields + >32 warnings
    const overlongId = `oversized/${"z".repeat(600)}.ts`;
    const overlongEvidencePath = `src/${"p".repeat(600)}.ts`;
    const overlongSymId = `sym:${"s".repeat(600)}`;
    const crafted = {
      ...baseRes,
      context: {
        ...baseRes.context,
        files: [
          ...baseRes.context.files,
          {
            id: overlongId,
            domain: "files" as const,
            title: "Should be omitted because id exceeds 512",
            rankScore: 100,
            rankingReasons: ["synthetic_overlong_id"],
            confidenceTier: "INFERRED" as const,
            untrustedRepositoryContent: true,
            trustLevel: "fenced_untrusted_content" as const,
            evidence: [
              {
                sourceType: "source_file",
                filePath: "src/auth/token.ts",
                confidenceTier: "CONFIRMED" as const,
                verificationStatus: "VERIFIED_ON_DISK" as const,
                description: "verified",
              },
            ],
            filePath: overlongId,
            language: "typescript",
            extension: ".ts",
            classification: "source",
            sensitivityStatus: "SAFE",
            sizeBytes: 10,
            exportedSymbolsCount: 0,
            importsCount: 0,
          },
        ],
        symbols: [
          ...baseRes.context.symbols,
          {
            id: "sym-bounded-highlight",
            domain: "symbols" as const,
            title:
              '<<<UNTRUSTED_REPO_CONTENT type="symbol" id="sym-bounded-highlight">>>\n' +
              `${"C".repeat(1935)}${"\uD83D\uDE80".repeat(80)}\n` +
              "<<<END_UNTRUSTED_REPO_CONTENT>>>",
            rankScore: 95,
            rankingReasons: ["synthetic_overlong_paths_and_surrogates"],
            confidenceTier: "CONFIRMED" as const,
            untrustedRepositoryContent: true,
            trustLevel: "fenced_untrusted_content" as const,
            evidence: [
              {
                sourceType: "symbol",
                filePath: overlongEvidencePath,
                lineRange: [1, 1] as [number, number],
                symbolIdentity: overlongSymId,
                confidenceTier: "CONFIRMED" as const,
                verificationStatus: "STATIC_INDEX" as const,
                description: "symbol",
              },
            ],
            symbolIdentity: overlongSymId,
            name: "boundedSym",
            kind: "function",
            filePath: overlongEvidencePath,
            isExported: true,
            startLine: 1,
            endLine: 1,
          },
        ],
      },
      warnings: Array.from({ length: 40 }, (_, i) => ({
        code: "MEMORY_DISPUTED" as const,
        severity: "error" as const,
        message: `Critical alert ${i}: ${"W".repeat(1200)}`,
      })),
    };

    const boundedAttachment = RetrievalEngine.buildHandoffAttachment(crafted);
    expect(validateHandoffAttachment(boundedAttachment).errors).toEqual([]);
    expect(boundedAttachment.warnings.length).toBeLessThanOrEqual(32);
    for (const w of boundedAttachment.warnings) {
      expect(w.length).toBeLessThanOrEqual(1024);
    }
    expect(boundedAttachment.highlights.some((h) => h.idOrPath === overlongId)).toBe(false);
    const symHighlight = boundedAttachment.highlights.find(
      (h) => h.idOrPath === "sym-bounded-highlight",
    );
    expect(symHighlight).toBeDefined();
    expect(symHighlight?.evidenceFile).toBeUndefined();
    expect(symHighlight?.symbolIdentity).toBeUndefined();
    expect(symHighlight?.summary.length).toBeLessThanOrEqual(2000);
    expect(symHighlight?.summary.endsWith("<<<END_UNTRUSTED_REPO_CONTENT>>>")).toBe(true);
    for (const h of boundedAttachment.highlights) {
      expect(h.summary.length).toBeLessThanOrEqual(2000);
      expect(Buffer.from(h.summary, "utf8").toString("utf8")).toBe(h.summary);
      expect(h.evidenceVerificationStatus).toBeDefined();
    }

    // RetrievalEngine.retrieve() validates its output at public API boundary and rejects invalid payloads
    const spy = vi.spyOn(ContextBudgeter, "allocate").mockImplementationOnce(() => ({
      selected: [
        {
          id: "invalid-item",
          domain: "files",
          title: "Invalid",
          rankScore: 1,
          rankingReasons: [],
          confidenceTier: "INFERRED",
          untrustedRepositoryContent: true,
          evidence: [],
          unexpectedSchemaViolation: true,
        } as any,
      ],
      omitted: [],
      budget: {
        limitsConfigured: {
          maxItems: 10,
          maxTotalChars: 1000,
          maxTokens: 250,
          maxDepth: 2,
          maxSnippetLines: 10,
        },
        usedChars: 0,
        serializedChars: 0,
        estimatedTokens: 0,
        totalCandidatesFound: 1,
        includedCount: 1,
        truncatedCount: 0,
        truncatedDomains: [],
        omittedItemIds: [],
        budgetOverflowed: false,
      },
    }));
    try {
      await expect(
        new RetrievalEngine(cm).retrieve({
          agentId: "architect",
          taskSummary: "Trigger boundary validation failure",
        }),
      ).rejects.toThrow(/ERR_RETRIEVAL_RESPONSE_INVALID/);
    } finally {
      spy.mockRestore();
    }
  });
});
