import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSessionStart } from "../../scripts/hooks/handlers/session-start.ts";
import { handlePreToolUse } from "../../scripts/hooks/handlers/pre-tool-use.ts";
import { handlePostToolUse } from "../../scripts/hooks/handlers/post-tool-use.ts";
import { handlePreInvocation } from "../../scripts/hooks/handlers/pre-invocation.ts";
import { handlePostInvocation } from "../../scripts/hooks/handlers/post-invocation.ts";
import { handleStop } from "../../scripts/hooks/handlers/stop.ts";
import { resolveAuditDir, validateAuditEvent } from "../../scripts/hooks/runtime/logger.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

describe("hook handler and audit logger integration", () => {
  let tempRoot: string;
  let tempWorkspace: string;
  let tempPluginData: string;
  let origPluginData: string | undefined;

  beforeEach(() => {
    origPluginData = process.env.PLUGIN_DATA;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fe-hook-events-"));
    tempWorkspace = path.join(tempRoot, "workspace");
    tempPluginData = path.join(tempRoot, "plugin-data");
    fs.mkdirSync(tempWorkspace, { recursive: true });
    fs.mkdirSync(tempPluginData, { recursive: true });
    fs.writeFileSync(
      path.join(tempWorkspace, "package.json"),
      JSON.stringify({ name: "hook-events-fixture", version: "1.0.0" }),
      "utf8",
    );
    process.env.PLUGIN_DATA = tempPluginData;
  });

  afterEach(() => {
    if (origPluginData === undefined) {
      delete process.env.PLUGIN_DATA;
    } else {
      process.env.PLUGIN_DATA = origPluginData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("exercises all six handlers end-to-end inside an isolated directory and writes valid v1 audit records", () => {
    const auditDir = resolveAuditDir(tempWorkspace);
    expect(auditDir).toBe(path.join(tempPluginData, "audit"));
    expect(auditDir).not.toContain(repoRoot());
    const auditFile = path.join(auditDir, "execution.jsonl");

    // 1. SessionStart
    const startRes = handleSessionStart({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
    });
    expect(startRes.injectSteps).toHaveLength(1);

    // 2. PreToolUse - allow
    const preAllow = handlePreToolUse({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      toolCall: { name: "run_command", args: { CommandLine: "npm run test" } },
      stepIdx: 1,
    });
    expect(preAllow.decision).toBe("allow");

    // 3. PreToolUse - deny
    const preDeny = handlePreToolUse({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      toolCall: { name: "run_command", args: { CommandLine: "rm -rf /" } },
      stepIdx: 2,
    });
    expect(preDeny.decision).toBe("deny");

    // 4. PostToolUse
    const postRes = handlePostToolUse({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      toolCall: { name: "run_command", args: { CommandLine: "npm run test" } },
      stepIdx: 3,
      error: "",
    });
    expect(postRes).toEqual({});

    // 5. PreInvocation
    const preInv = handlePreInvocation({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      invocationNum: 1,
    });
    expect(preInv.injectSteps).toHaveLength(1);

    // 6. PostInvocation
    const postInv = handlePostInvocation({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      invocationNum: 1,
      initialNumSteps: 3,
    });
    expect(postInv.injectSteps).toEqual([]);

    // 7. Stop
    const stopRes = handleStop({
      conversationId: "conv-evt-1",
      workspacePaths: [tempWorkspace],
      executionNum: 1,
      terminationReason: "NO_TOOL_CALL",
    });
    expect(stopRes).toEqual({});

    // Verify all 7 handler records exist in isolated temp audit log and validate against schema v1
    expect(fs.existsSync(auditFile)).toBe(true);
    const lines = fs
      .readFileSync(auditFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(7);
    for (const entry of lines) {
      expect(validateAuditEvent(entry)).toEqual([]);
      expect(entry.source).toBe("test");
      expect(entry.correlationId).toBe("conv-evt-1");
    }
    expect(lines.map((entry) => entry.eventType)).toEqual([
      "SessionStart",
      "PreToolUse",
      "PreToolUse",
      "PostToolUse",
      "PreInvocation",
      "PostInvocation",
      "Stop",
    ]);
  });
});
