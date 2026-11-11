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

  it("escalates high-risk git operations to force_ask", async () => {
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
    expect(parsed.decision).toBe("force_ask");
    expect(parsed.reason).toContain("developer review");
  });

  it("correctly evaluates native Antigravity file operations", async () => {
    // view_file safe
    const safeView = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: "C:/Projects/Frontier-Engineer/package.json" },
        },
        stepIdx: 5,
        conversationId: "test-runtime-5",
      }),
    );
    expect(safeView.code).toBe(0);
    expect(JSON.parse(safeView.stdout).decision).toBe("allow");

    // view_file sensitive
    const sensitiveView = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: "C:/Projects/Frontier-Engineer/.env" },
        },
        stepIdx: 6,
        conversationId: "test-runtime-6",
      }),
    );
    expect(sensitiveView.code).toBe(0);
    expect(JSON.parse(sensitiveView.stdout).decision).toBe("deny");

    // write_to_file sensitive
    const sensitiveWrite = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      JSON.stringify({
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: "id_rsa", Content: "private" },
        },
        stepIdx: 7,
        conversationId: "test-runtime-7",
      }),
    );
    expect(sensitiveWrite.code).toBe(0);
    expect(JSON.parse(sensitiveWrite.stdout).decision).toBe("deny");

    // replace_file_content sensitive
    const sensitiveReplace = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      JSON.stringify({
        toolCall: {
          name: "replace_file_content",
          args: { TargetFile: "credentials.json", Target: "a", Replacement: "b" },
        },
        stepIdx: 8,
        conversationId: "test-runtime-8",
      }),
    );
    expect(sensitiveReplace.code).toBe(0);
    expect(JSON.parse(sensitiveReplace.stdout).decision).toBe("deny");

    // multi_replace_file_content sensitive
    const sensitiveMultiReplace = await runDispatcher(
      ["--hook", "frontier-pre-tool-safety", "--event", "PreToolUse"],
      JSON.stringify({
        toolCall: {
          name: "multi_replace_file_content",
          args: { TargetFile: "server.key" },
        },
        stepIdx: 9,
        conversationId: "test-runtime-9",
      }),
    );
    expect(sensitiveMultiReplace.code).toBe(0);
    expect(JSON.parse(sensitiveMultiReplace.stdout).decision).toBe("deny");
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
      stepIdx: 10,
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
