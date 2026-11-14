import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containsUnredactedSecrets,
  scanBufferForSecrets,
} from "../../scripts/scanner/sensitive-filter.ts";
import { ContentSanitizer } from "../../scripts/retrieval/content-sanitizer.ts";
import { redactString, redactValue } from "../../scripts/hooks/lib/secret-redactor.ts";
import { logDiagnostic } from "../../scripts/hooks/runtime/output.ts";
import { extractFileSymbols } from "../../scripts/extractor/index.ts";
import {
  HANDOFF_BLOCK_END,
  HANDOFF_BLOCK_START,
  parseAndValidateHandoffBundle,
} from "../../scripts/retrieval/orchestrator.ts";
import { handlePreToolUse } from "../../scripts/hooks/handlers/pre-tool-use.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ScanStore } from "../../scripts/storage/repositories/scan-store.ts";
import { SnapshotWriter } from "../../scripts/storage/transactions/snapshot-writer.ts";
import { FileStore } from "../../scripts/storage/repositories/file-store.ts";
import { SymbolStore } from "../../scripts/storage/repositories/symbol-store.ts";
import { EvidenceStore } from "../../scripts/storage/repositories/evidence-store.ts";
import { GraphStore } from "../../scripts/graph/graph-store.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import {
  buildSecretFixtures,
  NON_SECRET_SOURCE_CONTROLS,
} from "../fixtures/secret-redaction-fixtures.ts";

const tempWorkspaces: string[] = [];

function makeTempWs(prefix = "frontier-p78-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempWorkspaces.push(dir);
  return dir;
}

function makeMinimalHandoffPayload(summaryText: string): string {
  const bundle = {
    contract: "frontier-engineer/handoff",
    version: 1,
    taskId: "FE-780",
    requestSummary: summaryText,
    objective: "Verify secret parity across handoff boundaries",
    scope: ["scripts/"],
    constraints: [],
    expectedDeliverables: ["audit findings"],
    repositoryContext: "ctx",
    relevantFiles: ["scripts/scanner/sensitive-filter.ts"],
    acceptanceCriteria: ["zero leaked secrets"],
    risks: [],
    requiredVerification: ["npm run test"],
    degradedIndexingMode: "DEGRADED_UNINDEXED",
    degradedReason: "Unit parity check on unindexed workspace",
  };
  return `${HANDOFF_BLOCK_START}\n${JSON.stringify(bundle)}\n${HANDOFF_BLOCK_END}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempWorkspaces.splice(0, tempWorkspaces.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Phase 7.8 — Final Security, Storage & Release-Readiness Remediation", () => {
  describe("Stage 1: Cross-Module Secret Redaction & Validation Parity (AUD-C-01, AUD-C-03)", () => {
    const fixtures = buildSecretFixtures();

    it("enforces complete redaction with zero leaked segments across sensitive-filter, ContentSanitizer, hooks redactor, extractor, orchestrator, and PreToolUse", async () => {
      const ws = makeTempWs("frontier-p78-secrets-");

      for (const item of fixtures) {
        // 1. Canonical containsUnredactedSecrets
        expect(containsUnredactedSecrets(item.token), item.id).toBe(true);

        // 2. scanBufferForSecrets (high-confidence scanner detections)
        const scanRes = scanBufferForSecrets(Buffer.from(item.token, "utf8"));
        if (item.detectedByFileScanner) {
          expect(scanRes.detected, `${item.id} scanBufferForSecrets`).toBe(true);
          for (const frag of item.forbiddenFragments) {
            expect(scanRes.redactedText, `${item.id} scanBufferForSecrets tail`).not.toContain(
              frag,
            );
          }
        }

        // 3. ContentSanitizer.sanitizeUntrustedText (zero partial tail leakage + idempotency)
        const sanitized = ContentSanitizer.sanitizeUntrustedText(`prefix ${item.token} suffix`);
        expect(sanitized.redacted, `${item.id} ContentSanitizer.redacted`).toBe(true);
        for (const frag of item.forbiddenFragments) {
          expect(sanitized.text, `${item.id} ContentSanitizer tail`).not.toContain(frag);
        }
        expect(containsUnredactedSecrets(sanitized.text), `${item.id} cs idempotent`).toBe(false);

        // 4. Hooks redactString (zero leaked tail + idempotency)
        const hookRedacted = redactString(`prefix ${item.token} suffix`);
        for (const frag of item.forbiddenFragments) {
          expect(hookRedacted, `${item.id} redactString tail`).not.toContain(frag);
        }
        expect(containsUnredactedSecrets(hookRedacted), `${item.id} hr idempotent`).toBe(false);

        // 5. Self-contained extractor diagnostic redaction
        if (item.detectedByExtractor) {
          const singleLineToken = item.token.replace(/\r?\n/g, " ");
          const malformedSource = `export const broken = <Tag ${singleLineToken} />; const z = <Open ${singleLineToken}`;
          const extracted = await extractFileSymbols("src/malformed.tsx", malformedSource);
          const diagDump = JSON.stringify(extracted.diagnostics);
          for (const frag of item.forbiddenFragments) {
            expect(diagDump, `${item.id} extractor diagnostic`).not.toContain(frag);
          }
        }

        // 6. Handoff consumer validation (parseAndValidateHandoffBundle) must reject raw secrets
        const handoffPayload = makeMinimalHandoffPayload(`Audit ${item.token}`);
        const parsed = parseAndValidateHandoffBundle(handoffPayload, {
          workspaceRoot: ws,
          allowUnindexedDegraded: true,
        });
        expect(parsed.valid, `${item.id} handoff rejection`).toBe(false);
        expect(parsed.errors.some((e) => e.includes("unredacted secret"))).toBe(true);

        // Once sanitized, handoff payload must not fail secret screening
        expect(
          containsUnredactedSecrets(ContentSanitizer.sanitizeUntrustedText(item.token).text),
        ).toBe(false);

        // 7. PreToolUse must deny unredacted secrets across invoke_subagent, send_message, and marker-bearing tools
        const invokeDeny = handlePreToolUse({
          hookEventName: "PreToolUse",
          cwd: ws,
          workspacePaths: [ws],
          toolCall: {
            name: "invoke_subagent",
            args: { TypeName: "security-auditor", Prompt: handoffPayload },
          },
        });
        expect(invokeDeny.decision, `${item.id} PreToolUse invoke_subagent`).toBe("deny");

        const sendDeny = handlePreToolUse({
          hookEventName: "PreToolUse",
          cwd: ws,
          workspacePaths: [ws],
          toolCall: {
            name: "send_message",
            args: { Recipient: "security-auditor", Message: handoffPayload },
          },
        });
        expect(sendDeny.decision, `${item.id} PreToolUse send_message`).toBe("deny");

        const markerToolDeny = handlePreToolUse({
          hookEventName: "PreToolUse",
          cwd: ws,
          workspacePaths: [ws],
          toolCall: {
            name: "custom_unrecognized_tool",
            args: { payload: handoffPayload },
          },
        });
        expect(markerToolDeny.decision, `${item.id} PreToolUse marker tool`).toBe("deny");
      }
    });

    it("preserves non-secret source code, CSS identifiers, prose, and .env.example placeholders without false positives", () => {
      const ws = makeTempWs("frontier-p78-nonsecret-");

      for (const control of NON_SECRET_SOURCE_CONTROLS) {
        expect(scanBufferForSecrets(Buffer.from(control, "utf8")).detected).toBe(false);
        if (!control.includes("DATABASE_URL=")) {
          expect(containsUnredactedSecrets(control)).toBe(false);
          expect(ContentSanitizer.sanitizeUntrustedText(control).text).toBe(control);
          expect(redactString(control)).toBe(control);
        }
      }

      const cleanHandoff = makeMinimalHandoffPayload(
        "Review sk-button-primary-navigation-drawer styling and Basic validation helper",
      );
      const parsed = parseAndValidateHandoffBundle(cleanHandoff, {
        workspaceRoot: ws,
        allowUnindexedDegraded: true,
      });
      expect(parsed.valid).toBe(true);
      expect(parsed.mode).toBe("DEGRADED_UNINDEXED");
    });
  });

  describe("Stage 2: Cycle-Safe Value Redaction & Resilient Diagnostics (AUD-C-02)", () => {
    const ghToken = ["gho", "Z1x2C3v4B5n6M7a8S9d0F1g2H3j4K5l6Q7w8"].join("_");
    const slackToken = ["xoxb", "12345", "678901234567", "ZyXwVuTsRqPoNm"].join("-");
    const sentryToken = ["sntrys", "abc_def-123=45678901234567890=="].join("_");

    it("handles self-references, nested cycles, repeated sibling DAG references, arrays with cycles, and deep nesting", () => {
      // 1. Self-referencing object
      const selfRef: Record<string, unknown> = { note: `key=${ghToken}` };
      selfRef.self = selfRef;
      const redSelf = redactValue(selfRef) as Record<string, unknown>;
      expect(redSelf.note).toBe("key=[REDACTED_GITHUB_TOKEN]");
      expect(redSelf.self).toBe("[Circular]");

      // 2. Nested circular reference
      const root: Record<string, unknown> = { child: { note: `s=${slackToken}` } };
      (root.child as Record<string, unknown>).parent = root;
      const redNested = redactValue(root) as {
        child: { note: string; parent: unknown };
      };
      expect(redNested.child.note).toBe("s=[REDACTED_SLACK_TOKEN]");
      expect(redNested.child.parent).toBe("[Circular]");

      // 3. Repeated non-circular DAG reference must redact both copies without false '[Circular]'
      const sharedNode = { detail: `shared=${sentryToken}`, apiKey: "raw-secret" };
      const dag = { branchA: sharedNode, branchB: sharedNode };
      const redDag = redactValue(dag) as {
        branchA: typeof sharedNode;
        branchB: typeof sharedNode;
      };
      expect(redDag.branchA.detail).toBe("shared=sntrys_[REDACTED]");
      expect(redDag.branchB.detail).toBe("shared=sntrys_[REDACTED]");
      expect(redDag.branchA.apiKey).toBe("[REDACTED]");
      expect(redDag.branchB.apiKey).toBe("[REDACTED]");

      // 4. Arrays containing circular objects
      const arrNode: Record<string, unknown> = { msg: `x=${slackToken}` };
      arrNode.loop = arrNode;
      const redArr = redactValue([arrNode, sharedNode]) as Array<Record<string, unknown>>;
      expect(redArr[0].msg).toBe("x=[REDACTED_SLACK_TOKEN]");
      expect(redArr[0].loop).toBe("[Circular]");
      expect(redArr[1].detail).toBe("shared=sntrys_[REDACTED]");

      // 5. Deeply nested structure (5,000 levels) must not overflow JS call stack
      let deep: Record<string, unknown> = { leaf: `token ${ghToken}` };
      for (let i = 0; i < 5000; i++) {
        deep = { next: deep };
      }
      const redDeep = redactValue(deep) as Record<string, unknown>;
      let cursor: unknown = redDeep;
      for (let i = 0; i < 5000; i++) {
        cursor = (cursor as Record<string, unknown>).next;
      }
      expect((cursor as Record<string, unknown>).leaf).toBe("token [REDACTED_GITHUB_TOKEN]");
    });

    it("emits redacted stderr diagnostics for circular context and unexpected serialization errors without silently dropping", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      // Circular context containing secrets
      const circCtx: Record<string, unknown> = { slack: slackToken };
      circCtx.self = circCtx;
      logDiagnostic(`Circular failure ${ghToken}`, circCtx);

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const firstLine = String(stderrSpy.mock.calls[0]?.[0] ?? "");
      expect(firstLine).toContain("[FRONTIER_HOOK ");
      expect(firstLine).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(firstLine).toContain("[REDACTED_SLACK_TOKEN]");
      expect(firstLine).toContain('"[Circular]"');
      expect(firstLine).not.toContain(ghToken);
      expect(firstLine).not.toContain("678901234567");

      // Context with throwing toJSON / unserializable BigInt still emits diagnostic + redacted error
      const hostileContext: Record<string, unknown> = {
        big: BigInt(42),
        toJSON() {
          throw new Error(`toJSON boom ${ghToken}`);
        },
      };
      logDiagnostic(`Fallback check ${slackToken}`, hostileContext);
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      const secondLine = String(stderrSpy.mock.calls[1]?.[0] ?? "");
      expect(secondLine).toContain("[REDACTED_SLACK_TOKEN]");
      expect(secondLine).toContain("contextSerializationError");
      expect(secondLine).not.toContain(ghToken);
    });
  });

  describe("Stage 3: Storage Integrity & Repository-Scoped Cleanup (AUD-B-01, AUD-B-02)", () => {
    function buildMinimalInventory(
      workspaceRoot: string,
      files: string[],
      scanStatus: FileInventoryResult["scanStatus"] = "COMPLETE",
    ): FileInventoryResult {
      return {
        workspaceRoot,
        scannedAt: new Date().toISOString(),
        scanStatus,
        files: files.map((canonicalPath) => ({
          canonicalPath,
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: 120,
          mtimeMs: 1700000000000,
          contentHash: `hash_${canonicalPath}`,
          hashState: "COMPUTED",
          inspectionStatus: "INSPECTED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        })),
        summary: {
          totalFilesDiscovered: files.length,
          totalFilesInspected: files.length,
          totalFilesExcluded: 0,
          totalFilesUnreadable: 0,
          totalBytesDiscovered: files.length * 120,
          totalBytesInspected: files.length * 120,
        },
        totalFilesScanned: files.length,
        totalBytesScanned: files.length * 120,
        limitExceeded: false,
        scanDurationMs: 1,
      };
    }

    it("detects ACTIVE_SCAN_MISMATCH for null active_scan_id with active scan, inactive scan, missing scan, and cross-repo scan", async () => {
      const ws1 = makeTempWs("frontier-p78-db1-");
      const cm = new ConnectionManager({ workspaceRoot: ws1 });
      const sm = new StorageManager(cm);
      await sm.initialize();

      try {
        const db = cm.getDatabase();
        const repo1 = cm.getRepository().id;
        const scanStore = new ScanStore(db);

        const snap1 = await SnapshotWriter.persist(db, repo1, {
          repositoryIdentity: cm.getRepository().identity,
          rootPath: ws1,
          displayName: "ws1",
          inventory: buildMinimalInventory(ws1, ["src/a.ts"]),
          extractions: new Map(),
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        expect(snap1.status).toBe("COMPLETE");
        expect(snap1.promoted).toBe(true);

        // Normal healthy DB passes
        const healthy = await sm.validateIntegrity(repo1, snap1.scanId);
        expect(healthy.isValid).toBe(true);
        expect(healthy.issues).toEqual([]);

        // Corruption 1: active_scan_id = NULL while scan_runs.is_active = 1
        db.prepare("UPDATE repositories SET active_scan_id = NULL WHERE id = ?").run(repo1);
        const nullMismatch = await sm.validateIntegrity(repo1, snap1.scanId);
        expect(nullMismatch.isValid).toBe(false);
        expect(nullMismatch.issues.some((i) => i.code === "ACTIVE_SCAN_MISMATCH")).toBe(true);

        // Corruption 2: active_scan_id references an INACTIVE scan
        const s2 = scanStore.createScanRun({
          repositoryId: repo1,
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        scanStore.completeScan(s2.id, "COMPLETE");
        db.prepare("UPDATE repositories SET active_scan_id = ? WHERE id = ?").run(s2.id, repo1);
        db.prepare("UPDATE scan_runs SET is_active = 0 WHERE repository_id = ?").run(repo1);
        const inactiveMismatch = await sm.validateIntegrity(repo1);
        expect(inactiveMismatch.isValid).toBe(false);
        expect(inactiveMismatch.issues.some((i) => i.code === "ACTIVE_SCAN_MISMATCH")).toBe(true);

        // Corruption 3: active_scan_id points to a missing scan ID
        db.prepare("UPDATE repositories SET active_scan_id = 999999 WHERE id = ?").run(repo1);
        const missingMismatch = await sm.validateIntegrity(repo1);
        expect(missingMismatch.isValid).toBe(false);
        expect(
          missingMismatch.issues.some(
            (i) => i.code === "ACTIVE_SCAN_MISMATCH" && i.message.includes("missing"),
          ),
        ).toBe(true);

        // Corruption 4: active_scan_id points to a scan belonging to a DIFFERENT repository
        const repo2Res = db
          .prepare(
            "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, 3)",
          )
          .run(
            "repo_other",
            "/tmp/other-repo",
            "other-repo",
            new Date().toISOString(),
            new Date().toISOString(),
          );
        const repo2 = Number(repo2Res.lastInsertRowid);
        const otherScan = scanStore.createScanRun({
          repositoryId: repo2,
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        scanStore.completeScan(otherScan.id, "COMPLETE");
        scanStore.promoteScan(repo2, otherScan.id);
        db.prepare("UPDATE repositories SET active_scan_id = ? WHERE id = ?").run(
          otherScan.id,
          repo1,
        );
        const crossRepoMismatch = await sm.validateIntegrity(repo1);
        expect(crossRepoMismatch.isValid).toBe(false);
        expect(
          crossRepoMismatch.issues.some(
            (i) => i.code === "ACTIVE_SCAN_MISMATCH" && i.message.includes("missing or cross-repo"),
          ),
        ).toBe(true);
      } finally {
        await sm.close();
      }
    });

    it("isolates repository-scoped staging cleanup and maps FATAL_ERROR inventory to FAILED without replacing active COMPLETE snapshot", async () => {
      const ws = makeTempWs("frontier-p78-db2-");
      const cm = new ConnectionManager({ workspaceRoot: ws });
      const sm = new StorageManager(cm);
      await sm.initialize();

      try {
        const db = cm.getDatabase();
        const repoA = cm.getRepository().id;
        const now = new Date().toISOString();
        const repoBRes = db
          .prepare(
            "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, 3)",
          )
          .run("repo_b_iso", "/tmp/repo-b-iso", "repo-b", now, now);
        const repoB = Number(repoBRes.lastInsertRowid);

        // Persist valid COMPLETE scan on Repo A and Repo B
        const snapA = await SnapshotWriter.persist(db, repoA, {
          repositoryIdentity: cm.getRepository().identity,
          rootPath: ws,
          displayName: "repoA",
          inventory: buildMinimalInventory(ws, ["src/a.ts"]),
          extractions: new Map(),
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        const snapB = await SnapshotWriter.persist(db, repoB, {
          repositoryIdentity: "repo_b_iso",
          rootPath: "/tmp/repo-b-iso",
          displayName: "repoB",
          inventory: buildMinimalInventory(ws, ["src/b.ts"]),
          extractions: new Map(),
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        expect(snapA.promoted).toBe(true);
        expect(snapB.promoted).toBe(true);

        // Create interrupted RUNNING scan on Repo A with files, symbols, evidence, and graph nodes
        const scanStore = new ScanStore(db);
        const crashedScanA = scanStore.createScanRun({
          repositoryId: repoA,
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        const fileStore = new FileStore(db);
        const symbolStore = new SymbolStore(db);
        const evidenceStore = new EvidenceStore(db);
        const graphStore = new GraphStore(db);

        const invCrashed = buildMinimalInventory(ws, ["src/crashed.ts"]);
        const fMap = fileStore.insertFiles(repoA, crashedScanA.id, invCrashed.files);
        const fileId = fMap.get("src/crashed.ts")!;
        symbolStore.insertSymbols({
          repositoryId: repoA,
          scanId: crashedScanA.id,
          fileId,
          symbols: [
            {
              symbolId: "sym_crashed",
              name: "crashedFn",
              parentScope: null,
              kind: "function",
              fingerprint: "fp_crashed",
              isExported: true,
              sourceEvidence: {
                lineStart: 1,
                lineEnd: 3,
                colStart: 0,
                colEnd: 25,
                evidenceHash: "ev_crashed",
              },
            },
          ],
          evidenceStore,
        });
        graphStore.insertGraph({
          repositoryId: repoA,
          scanId: crashedScanA.id,
          nodes: [
            {
              nodeIdentity: "file:src/crashed.ts",
              category: "file",
              name: "src/crashed.ts",
              fileId,
              metadata: {},
            },
          ],
          edges: [],
          pathToId: fMap,
          symbolMap: new Map(),
        });

        // Recover interrupted scans only for Repo A
        const recovered = await sm.recoverInterruptedScans(repoA);
        expect(recovered).toBe(1);

        // Crashed staging rows removed via repository_id + scan_id cascade
        expect(
          (
            db
              .prepare("SELECT COUNT(*) AS c FROM files WHERE scan_id = ?")
              .get(crashedScanA.id) as { c: number }
          ).c,
        ).toBe(0);
        expect(
          (
            db
              .prepare("SELECT COUNT(*) AS c FROM symbols WHERE scan_id = ?")
              .get(crashedScanA.id) as { c: number }
          ).c,
        ).toBe(0);
        expect(
          (
            db
              .prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE scan_id = ?")
              .get(crashedScanA.id) as { c: number }
          ).c,
        ).toBe(0);
        expect(scanStore.getScanById(crashedScanA.id)?.status).toBe("FAILED");

        // Repo B and Repo A's existing COMPLETE active scans remain untouched
        expect(scanStore.getActiveScan(repoA)?.id).toBe(snapA.scanId);
        expect(scanStore.getActiveScan(repoB)?.id).toBe(snapB.scanId);
        expect(
          (
            db
              .prepare("SELECT COUNT(*) AS c FROM files WHERE repository_id = ? AND scan_id = ?")
              .get(repoB, snapB.scanId) as { c: number }
          ).c,
        ).toBe(1);

        // Stage 3 requirement 4: FATAL_ERROR inventory maps to FAILED cleanly and leaves active scan untouched
        const fatalRes = await SnapshotWriter.persist(db, repoA, {
          repositoryIdentity: cm.getRepository().identity,
          rootPath: ws,
          displayName: "repoA",
          inventory: buildMinimalInventory(ws, ["src/fatal.ts"], "FATAL_ERROR"),
          extractions: new Map(),
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        expect(fatalRes.status).toBe("FAILED");
        expect(fatalRes.promoted).toBe(false);
        expect(fatalRes.filesIndexed).toBe(0);
        expect(scanStore.getScanById(fatalRes.scanId)?.status).toBe("FAILED");
        expect(scanStore.getActiveScan(repoA)?.id).toBe(snapA.scanId);
      } finally {
        await sm.close();
      }
    });
  });
});
