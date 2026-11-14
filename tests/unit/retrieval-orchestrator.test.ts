import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import {
  assessRetrievalEligibility,
  parseAndValidateHandoffBundle,
  prepareDelegationHandoff,
  clearSchemaValidatorCache,
  validateRetrievalResponse,
} from "../../scripts/retrieval/index.ts";
import { handlePreToolUse } from "../../scripts/hooks/handlers/pre-tool-use.ts";

describe("Retrieval Orchestrator & Antigravity Delegation Integration", () => {
  const tempDirs: string[] = [];
  const managers: ConnectionManager[] = [];

  function makeDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    clearSchemaValidatorCache();
    for (const cm of managers.splice(0)) {
      cm.close();
    }
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  async function seedIndexedRepo(): Promise<string> {
    const ws = makeDir("fe-ret-orch-");
    fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "orch-repo" }), "utf8");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    const srcContent = "export function validateSession(id: string) { return id.length > 4; }\n";
    fs.writeFileSync(path.join(ws, "src", "session.ts"), srcContent, "utf8");
    const stat = fs.statSync(path.join(ws, "src", "session.ts"));

    const cm = new ConnectionManager({ workspaceRoot: ws });
    managers.push(cm);
    await cm.initialize();
    const sm = new StorageManager(cm);

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/session.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: "h_session",
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
      scanDurationMs: 2,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "orch-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();
    managers.pop();
    return ws;
  }

  it("checks retrieval eligibility read-only without ever creating .frontier on unindexed workspaces", async () => {
    const emptyWs = makeDir("fe-orch-empty-");
    const check = assessRetrievalEligibility(emptyWs);
    expect(check.eligible).toBe(false);
    expect(check.reasonCode).toBe("NO_INDEX_DB");
    expect(fs.existsSync(path.join(emptyWs, ".frontier"))).toBe(false);

    const halt = await prepareDelegationHandoff({
      workspaceRoot: emptyWs,
      targetAgent: "architect",
      taskId: "FE-NO-IDX-1",
      taskSummary: "Inspect architecture",
    });
    expect(halt.status).toBe("INDEX_UNAVAILABLE");
    expect(halt.handoff).toBeNull();
    expect(fs.existsSync(path.join(emptyWs, ".frontier"))).toBe(false);

    const degraded = await prepareDelegationHandoff({
      workspaceRoot: emptyWs,
      targetAgent: "architect",
      taskId: "FE-DEG-2",
      taskSummary: "Inspect architecture statically",
      allowUnindexedFallback: true,
    });
    expect(degraded.status).toBe("DEGRADED_UNINDEXED");
    expect(degraded.schemaValidation.handoffValid).toBe(true);
    expect(degraded.handoff?.retrievalContext).toBeUndefined();
    expect(degraded.promptSection).toContain("UNAVAILABLE");
    expect(fs.existsSync(path.join(emptyWs, ".frontier"))).toBe(false);
  });

  it("executes end-to-end coordinator -> specialist handoff, schema validation, bundle parsing, and PreToolUse hook checks", async () => {
    const ws = await seedIndexedRepo();
    const prepared = await prepareDelegationHandoff({
      workspaceRoot: ws,
      targetAgent: "security-auditor",
      fromAgent: "frontier-engineer",
      taskId: "FE-ORCH-200",
      taskSummary: "Audit session validation in src/session.ts",
      relevantFiles: ["src/session.ts"],
    });

    expect(prepared.status).toBe("READY");
    expect(prepared.eligibility.eligible).toBe(true);
    expect(prepared.schemaValidation.retrievalValid).toBe(true);
    expect(prepared.schemaValidation.handoffValid).toBe(true);
    expect(prepared.schemaValidation.errors).toEqual([]);
    expect(prepared.retrievalResponse).not.toBeNull();
    expect(validateRetrievalResponse(prepared.retrievalResponse).valid).toBe(true);
    expect(prepared.handoff?.retrievalContext?.contract).toBe(
      "frontier-engineer/retrieval-attachment",
    );

    // Consumer side parses and validates the embedded handoff bundle
    const bundle = parseAndValidateHandoffBundle(prepared.promptSection!);
    expect(bundle.found).toBe(true);
    expect(bundle.valid).toBe(true);
    expect(bundle.retrievalAttachmentValid).toBe(true);
    expect(bundle.untrustedWarningPresent).toBe(true);
    expect(bundle.handoff?.taskId).toBe("FE-ORCH-200");

    // PreToolUse hook allows/escalates clean delegation bundle without denying, and blocks tampered/secret bundles
    const allowRes = handlePreToolUse({
      toolCall: {
        name: "invoke_subagent",
        args: {
          TypeName: "security-auditor",
          Prompt: prepared.promptSection!,
        },
      },
    });
    expect(allowRes.decision).not.toBe("deny");

    const malformedRes = handlePreToolUse({
      toolCall: {
        name: "invoke_subagent",
        args: {
          TypeName: "security-auditor",
          Prompt:
            'Inspect:\n<<<FRONTIER_HANDOFF_JSON>>>\n{"contract":"frontier-engineer/handoff","bad":true}\n<<<END_FRONTIER_HANDOFF_JSON>>>',
        },
      },
    });
    expect(malformedRes.decision).toBe("deny");

    // Duplicate ambiguous handoff blocks rejected
    const dupBundle = parseAndValidateHandoffBundle(
      `${prepared.promptSection!}\n${prepared.promptSection!}`,
    );
    expect(dupBundle.valid).toBe(false);
    expect(dupBundle.errors[0]).toContain("Multiple FRONTIER_HANDOFF_JSON");
  });
});
