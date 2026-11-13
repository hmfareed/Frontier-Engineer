import { describe, expect, it } from "vitest";
import { TaskClassifier } from "../../scripts/retrieval/task-classifier.ts";

describe("TaskClassifier (Deterministic Intent & Target Extraction)", () => {
  it("classifies distinct engineering task intents deterministically", () => {
    const cases: Array<{ prompt: string; expected: string }> = [
      {
        prompt: "Review module boundaries, circular dependencies, and ADR-007 decisions",
        expected: "architecture_design",
      },
      {
        prompt: "Implement a new rate limiter endpoint in src/api/limiter.ts",
        expected: "feature_implementation",
      },
      {
        prompt: "Fix crash and root cause of null exception in ConnectionManager",
        expected: "bug_fix",
      },
      {
        prompt: "Refactor and decouple the storage serializer module",
        expected: "refactoring",
      },
      {
        prompt: "Audit authentication middleware for secret exposure and OWASP path traversal",
        expected: "security_audit",
      },
      {
        prompt: "Add Vitest unit tests and edge case coverage for QueryGrammar",
        expected: "test_generation",
      },
      {
        prompt: "Improve accessibility WCAG contrast and Tailwind layout in CardModal.tsx",
        expected: "ui_ux_work",
      },
      {
        prompt: "Compare scan 1 to scan 2 for architectural drift and stale memory",
        expected: "evolution_review",
      },
    ];

    for (const c of cases) {
      const first = TaskClassifier.classify({
        agentId: "frontier-engineer",
        taskSummary: c.prompt,
      });
      const second = TaskClassifier.classify({
        agentId: "frontier-engineer",
        taskSummary: c.prompt,
      });
      expect(first).toEqual(second);
      expect(first.primaryTaskType).toBe(c.expected);
    }
  });

  it("extracts normalized files, symbols, ADRs, components, and scan pairs while isolating unsafe paths", () => {
    const res = TaskClassifier.classify({
      agentId: "implementation-engineer",
      taskSummary:
        "Inspect src\\query\\query-engine.ts and FreshnessEvaluator against ADR-7 between scan 3 and scan 5; ignore ../../etc/passwd",
      targetFiles: ["./scripts/cli/frontier-cli.ts", "/root/.ssh/id_rsa", "../escape.ts"],
      targetSymbols: ["ArchitectureQueryEngine"],
    });

    expect(res.extractedTargets.files).toEqual([
      "scripts/cli/frontier-cli.ts",
      "src/query/query-engine.ts",
    ]);
    expect(res.extractedTargets.ignoredUnsafeTargets).toEqual([
      "../../etc/passwd",
      "../escape.ts",
      "/root/.ssh/id_rsa",
    ]);
    expect(res.extractedTargets.symbols).toContain("FreshnessEvaluator");
    expect(res.extractedTargets.symbols).toContain("ArchitectureQueryEngine");
    expect(res.extractedTargets.adrs).toEqual(["ADR-007"]);
    expect(res.extractedTargets.components).toContain("cli");
    expect(res.extractedTargets.components).toContain("query");
    expect(res.extractedTargets.baseScanId).toBe(3);
    expect(res.extractedTargets.targetScanId).toBe(5);
    expect(res.primaryTaskType).toBe("evolution_review");
  });

  it("falls back to general_inspection when no domain signal appears", () => {
    const res = TaskClassifier.classify({
      agentId: "frontier-engineer",
      taskSummary: "Look around please",
    });
    expect(res.primaryTaskType).toBe("general_inspection");
    expect(res.classificationSignals).toContain("default fallback: general_inspection");
  });
});
