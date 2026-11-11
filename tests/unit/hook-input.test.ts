import { describe, expect, it } from "vitest";
import { validateEventPayload } from "../../scripts/hooks/runtime/validation.ts";

describe("hook payload validation", () => {
  it("validates PreToolUse payload structure", () => {
    const valid = {
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
      stepIdx: 2,
    };
    expect(validateEventPayload("PreToolUse", valid).valid).toBe(true);

    const missingToolCall = { stepIdx: 2 };
    expect(validateEventPayload("PreToolUse", missingToolCall).valid).toBe(false);

    const missingName = { toolCall: { args: {} } };
    expect(validateEventPayload("PreToolUse", missingName).valid).toBe(false);
  });

  it("validates PostToolUse payload structure", () => {
    const valid = {
      toolCall: { name: "run_command", args: {} },
      stepIdx: 3,
      error: "",
    };
    expect(validateEventPayload("PostToolUse", valid).valid).toBe(true);

    const invalid = { stepIdx: 3 };
    expect(validateEventPayload("PostToolUse", invalid).valid).toBe(false);
  });

  it("validates SessionStart, PreInvocation, and Stop payloads", () => {
    expect(validateEventPayload("SessionStart", { conversationId: "abc" }).valid).toBe(true);
    expect(validateEventPayload("PreInvocation", { invocationNum: 1 }).valid).toBe(true);
    expect(validateEventPayload("Stop", { executionNum: 1 }).valid).toBe(true);
  });

  it("rejects non-object payloads or unknown lifecycle events", () => {
    expect(validateEventPayload("PreToolUse", null).valid).toBe(false);
    expect(validateEventPayload("PreToolUse", "string").valid).toBe(false);
    expect(validateEventPayload("UnknownEvent", {}).valid).toBe(false);
  });
});
