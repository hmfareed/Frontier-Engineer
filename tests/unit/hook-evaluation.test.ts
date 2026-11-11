import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyCommandLine,
  classifyFilePath,
} from "../../scripts/hooks/lib/command-classifier.ts";
import { resolveSafeFallback } from "../../scripts/hooks/runtime/security.ts";
import { handlePreInvocation } from "../../scripts/hooks/handlers/pre-invocation.ts";
import { handleStop } from "../../scripts/hooks/handlers/stop.ts";
import { validateAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("hook adversarial evaluation scenarios", () => {
  it("validates specs/evaluation/hook-scenarios.json against hook-evaluation-scenarios.schema.json", () => {
    const findings = validateAgainstSchema(
      root,
      "specs/evaluation/hook-scenarios.json",
      "schemas/hook-evaluation-scenarios.schema.json",
      "test-rule",
    );
    expect(findings).toEqual([]);
  });

  it("verifies expected outcomes across all 15 adversarial evaluation scenarios", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "hook-scenarios.json"),
      "utf8",
    );
    const scenarios = JSON.parse(raw);
    expect(scenarios).toHaveLength(15);

    for (const scenario of scenarios) {
      if (scenario.simulateTimeout || scenario.simulateCrash) {
        const fallback = resolveSafeFallback(scenario.event, "test-hook", "Simulated failure");
        const dec = (fallback.output as { decision?: string }).decision;
        expect(dec, `Scenario ${scenario.id} decision mismatch`).toBe(scenario.expectedDecision);
      } else if (scenario.simulateWriteFailure) {
        const fallback = resolveSafeFallback(scenario.event, "test-hook", "Write error");
        expect(scenario.expectedDecision).toBe("allow");
        expect(fallback.output).toEqual({});
      } else if (scenario.rawInput) {
        const fallback = resolveSafeFallback(scenario.event, "test-hook", "Malformed JSON");
        expect((fallback.output as { decision: string }).decision).toBe(scenario.expectedDecision);
      } else if (scenario.duplicateCall) {
        const res = handleStop({ executionNum: 2, terminationReason: "NO_TOOL_CALL" });
        expect(res).toEqual({});
      } else if (scenario.invocationNum) {
        const res = handlePreInvocation({ invocationNum: scenario.invocationNum });
        expect(res.injectSteps.length).toBeGreaterThan(0);
      } else if (scenario.id === "HOOK-SCEN-13") {
        const fallback = resolveSafeFallback("SessionStart", "frontier-session-init", "Missing ws");
        expect((fallback.output as { injectSteps: unknown[] }).injectSteps).toHaveLength(1);
      } else if (scenario.toolName === "run_command" && scenario.args?.CommandLine) {
        const result = classifyCommandLine(scenario.args.CommandLine);
        expect(
          result.decision,
          `Scenario ${scenario.id} (${scenario.name}) decision mismatch`,
        ).toBe(scenario.expectedDecision);
      } else if (scenario.toolName === "read_file" && scenario.args?.Path) {
        const result = classifyFilePath(scenario.args.Path, "read");
        expect(
          result.decision,
          `Scenario ${scenario.id} (${scenario.name}) decision mismatch`,
        ).toBe(scenario.expectedDecision);
      }
    }
  });
});
