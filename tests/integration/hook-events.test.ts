import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleSessionStart } from "../../scripts/hooks/handlers/session-start.ts";
import { handlePreToolUse } from "../../scripts/hooks/handlers/pre-tool-use.ts";
import { handlePostToolUse } from "../../scripts/hooks/handlers/post-tool-use.ts";
import { handlePreInvocation } from "../../scripts/hooks/handlers/pre-invocation.ts";
import { handlePostInvocation } from "../../scripts/hooks/handlers/post-invocation.ts";
import { handleStop } from "../../scripts/hooks/handlers/stop.ts";
import { resolveAuditDir } from "../../scripts/hooks/runtime/logger.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("hook handler and audit logger integration", () => {
  const auditDir = resolveAuditDir(root);
  const auditFile = path.join(auditDir, "execution.jsonl");

  it("exercises all six handlers end-to-end and writes audit records", () => {
    // 1. SessionStart
    const startRes = handleSessionStart({
      conversationId: "conv-evt-1",
      workspacePaths: [root],
    });
    expect(startRes.injectSteps).toHaveLength(1);

    // 2. PreToolUse - allow
    const preAllow = handlePreToolUse({
      conversationId: "conv-evt-1",
      toolCall: { name: "run_command", args: { CommandLine: "npm run test" } },
      stepIdx: 1,
    });
    expect(preAllow.decision).toBe("allow");

    // 3. PreToolUse - deny
    const preDeny = handlePreToolUse({
      conversationId: "conv-evt-1",
      toolCall: { name: "run_command", args: { CommandLine: "rm -rf /" } },
      stepIdx: 2,
    });
    expect(preDeny.decision).toBe("deny");

    // 4. PostToolUse
    const postRes = handlePostToolUse({
      conversationId: "conv-evt-1",
      toolCall: { name: "run_command", args: { CommandLine: "npm run test" } },
      stepIdx: 3,
      error: "",
    });
    expect(postRes).toEqual({});

    // 5. PreInvocation
    const preInv = handlePreInvocation({
      conversationId: "conv-evt-1",
      invocationNum: 1,
    });
    expect(preInv.injectSteps).toHaveLength(1);

    // 6. PostInvocation
    const postInv = handlePostInvocation({
      conversationId: "conv-evt-1",
      invocationNum: 1,
      initialNumSteps: 3,
    });
    expect(postInv.injectSteps).toEqual([]);

    // 7. Stop
    const stopRes = handleStop({
      conversationId: "conv-evt-1",
      executionNum: 1,
      terminationReason: "NO_TOOL_CALL",
    });
    expect(stopRes).toEqual({});

    // Verify audit records exist on disk
    expect(fs.existsSync(auditFile)).toBe(true);
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content).toContain("SessionStart");
    expect(content).toContain("PreToolUse");
    expect(content).toContain("PostToolUse");
    expect(content).toContain("PostInvocation");
    expect(content).toContain("Stop");
  });
});
