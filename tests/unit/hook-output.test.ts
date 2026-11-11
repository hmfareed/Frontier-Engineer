import { describe, expect, it } from "vitest";
import { resolveSafeFallback } from "../../scripts/hooks/runtime/security.ts";

describe("hook output protocol and safe fallbacks", () => {
  it("enforces fail-closed deny for PreToolUse errors", () => {
    const fallback = resolveSafeFallback(
      "PreToolUse",
      "frontier-pre-tool-safety",
      "SyntaxError: Unexpected token",
    );
    expect(fallback.exitCode).toBe(0);
    const out = fallback.output as { decision: string; reason: string };
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain("Safety check encountered an error");
  });

  it("enforces graceful degradation for SessionStart errors", () => {
    const fallback = resolveSafeFallback(
      "SessionStart",
      "frontier-session-init",
      "Workspace path not found",
    );
    expect(fallback.exitCode).toBe(0);
    const out = fallback.output as {
      injectSteps: Array<{ systemMessage: { systemMessage: string } }>;
    };
    expect(out.injectSteps).toHaveLength(1);
    expect(out.injectSteps[0]?.systemMessage.systemMessage).toContain("degraded mode");
  });

  it("enforces fail-open for PostToolUse and Stop", () => {
    const postTool = resolveSafeFallback(
      "PostToolUse",
      "frontier-post-tool-audit",
      "Disk write error",
    );
    expect(postTool.output).toEqual({});

    const stop = resolveSafeFallback("Stop", "frontier-session-stop", "Flush failure");
    expect(stop.output).toEqual({});
  });

  it("enforces fail-open for PreInvocation and PostInvocation", () => {
    const preInv = resolveSafeFallback(
      "PreInvocation",
      "frontier-engineering-context",
      "Context timeout",
    );
    const out = preInv.output as { injectSteps: unknown[]; terminationBehavior: string };
    expect(out.injectSteps).toEqual([]);
    expect(out.terminationBehavior).toBe("");

    const postInv = resolveSafeFallback(
      "PostInvocation",
      "frontier-invocation-audit",
      "Telemetry failure",
    );
    expect((postInv.output as { injectSteps: unknown[] }).injectSteps).toEqual([]);
  });
});
