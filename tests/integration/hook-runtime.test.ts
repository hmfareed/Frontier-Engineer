import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const dispatcherPath = path.join(root, "scripts", "hooks", "runtime", "dispatcher.ts");

interface SubprocessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runDispatcher(args: string[], inputPayload: string): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [dispatcherPath, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });

    child.stdin.write(inputPayload);
    child.stdin.end();
  });
}

describe("hook dispatcher subprocess integration", () => {
  it("processes a safe tool call and returns allow", async () => {
    const payload = JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
      stepIdx: 1,
      conversationId: "test-runtime-1",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      payload,
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.decision).toBe("allow");
  });

  it("intercepts a destructive command and returns deny", async () => {
    const payload = JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "rmdir /s /q C:\\Projects" } },
      stepIdx: 2,
      conversationId: "test-runtime-2",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      payload,
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.decision).toBe("deny");
    expect(parsed.reason).toContain("prohibited");
  });

  it("intercepts secret exposure and returns deny", async () => {
    const payload = JSON.stringify({
      toolCall: { name: "read_file", args: { Path: "C:/Projects/Frontier-Engineer/.env" } },
      stepIdx: 3,
      conversationId: "test-runtime-3",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      payload,
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.decision).toBe("deny");
    expect(parsed.reason).toContain("Access to sensitive credential file (.env) is prohibited");
  });

  it("escalates high-risk git operations to ask", async () => {
    const payload = JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git clean -fdx" } },
      stepIdx: 4,
      conversationId: "test-runtime-4",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      payload,
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.decision).toBe("ask");
    expect(parsed.reason).toContain("developer review");
  });

  it("fails closed with deny on malformed JSON", async () => {
    const res = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      "this is completely invalid json {{{",
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.decision).toBe("deny");
    expect(parsed.reason).toContain("Safety check encountered an error");
    expect(res.stderr).toContain("FRONTIER_HOOK");
  });

  it("executes SessionStart and emits clean injectSteps", async () => {
    const payload = JSON.stringify({
      conversationId: "test-sess-start",
      workspacePaths: [root],
    });

    const res = await runDispatcher(
      ["--hook", "frontier-session-init", "--event", "SessionStart"],
      payload,
    );
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.injectSteps).toHaveLength(1);
    expect(parsed.injectSteps[0].systemMessage.systemMessage).toContain(
      "Frontier Engineer session initialized",
    );
  });

  it("executes PostToolUse and emits empty object", async () => {
    const payload = JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
      stepIdx: 5,
      conversationId: "test-post-tool",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-post-tool-audit", "--event", "PostToolUse"],
      payload,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("{}");
  });

  it("executes Stop event and flushes cleanly", async () => {
    const payload = JSON.stringify({
      executionNum: 1,
      terminationReason: "NO_TOOL_CALL",
      conversationId: "test-stop",
    });

    const res = await runDispatcher(
      ["--hook", "frontier-session-stop", "--event", "Stop"],
      payload,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("{}");
  });
});
