import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_HOST_DISCLAIMER,
  executeEvaluationSuite,
  executeScenario,
  formatEvaluationReportJson,
  formatEvaluationReportMarkdown,
} from "../../scripts/evaluation/evaluation-runner.ts";
import type {
  ExecutableScenario,
  ExecutableScenarioDocument,
} from "../../scripts/evaluation/types.ts";
import { createIsolatedWorkspace } from "../../scripts/evaluation/workspace-isolation.ts";
import {
  validateAgainstSchema,
  validateValueAgainstSchema,
} from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("Phase 8.6C: Executable Behavioral Evaluation Subsystem", () => {
  describe("Schema and contract conformance", () => {
    it("validates specs/evaluation/executable-scenarios.json against its schema", () => {
      const findings = validateAgainstSchema(
        root,
        "specs/evaluation/executable-scenarios.json",
        "schemas/executable-evaluation-scenarios.schema.json",
        "executable-evaluation-schema-test",
      );
      expect(findings).toEqual([]);
    });

    it("enforces schema invariants across all defined scenarios", () => {
      const raw = fs.readFileSync(
        path.join(root, "specs", "evaluation", "executable-scenarios.json"),
        "utf8",
      );
      const doc: ExecutableScenarioDocument = JSON.parse(raw);

      expect(doc.version).toBeGreaterThanOrEqual(1);
      expect(doc.status).toBe("defined");
      expect(doc.scenarios.length).toBeGreaterThanOrEqual(15);

      const seenIds = new Set<string>();
      for (const scenario of doc.scenarios) {
        expect(scenario.id).toMatch(/^EXEC-[A-Z0-9-]+$/);
        expect(seenIds.has(scenario.id), `Duplicate scenario ID: ${scenario.id}`).toBe(false);
        seenIds.add(scenario.id);

        expect(scenario.simulation.isSimulated).toBe(true);
        expect(scenario.simulation.disclaimer.length).toBeGreaterThan(0);
        expect(scenario.execution.timeoutMs).toBeGreaterThanOrEqual(50);
        expect(scenario.execution.timeoutMs).toBeLessThanOrEqual(60000);

        for (const assertion of scenario.expected.assertions) {
          expect(assertion.id).toMatch(/^ASSERT-[A-Z0-9-]+$/);
          expect(assertion.description.length).toBeGreaterThan(0);
        }
      }
    });

    it("rejects invalid scenario document schema mutations", () => {
      const invalidDoc = {
        version: 1,
        evaluatorVersion: "1.0.0",
        status: "invalid-status",
        scenarios: [],
      };
      const findings = validateValueAgainstSchema(
        root,
        invalidDoc,
        "virtual/invalid.json",
        "schemas/executable-evaluation-scenarios.schema.json",
        "invalid-test",
      );
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  describe("Workspace isolation and containment", () => {
    it("creates isolated workspaces strictly outside the active repository", () => {
      const ws = createIsolatedWorkspace("test-isolation-bounds");
      try {
        expect(fs.existsSync(ws.path)).toBe(true);
        const resolvedWs = path.resolve(ws.path).toLowerCase();
        const resolvedRoot = path.resolve(root).toLowerCase();
        expect(resolvedWs.startsWith(resolvedRoot)).toBe(false);
        expect(resolvedWs.startsWith(path.resolve(os.tmpdir()).toLowerCase())).toBe(true);
      } finally {
        ws.cleanup();
      }
      expect(fs.existsSync(ws.path)).toBe(false);
    });

    it("provisions declared fixtures safely into isolated workspace", () => {
      const fixtures = {
        "src/app.ts": "export const app = true;",
        "config/settings.json": JSON.stringify({ active: true }),
      };
      const ws = createIsolatedWorkspace("test-fixtures", fixtures);
      try {
        expect(ws.exists("src/app.ts")).toBe(true);
        expect(ws.readFile("src/app.ts")).toBe("export const app = true;");
        expect(ws.exists("config/settings.json")).toBe(true);
        const parsed = JSON.parse(ws.readFile("config/settings.json"));
        expect(parsed.active).toBe(true);
      } finally {
        ws.cleanup();
      }
    });

    it("blocks path traversal attempts out of isolated workspace", () => {
      const ws = createIsolatedWorkspace("test-traversal-guard");
      try {
        expect(() => ws.resolve("../../outside.txt")).toThrow(/Path traversal detected/);
        expect(() => ws.resolve(path.resolve(root, "package.json"))).toThrow(
          /Absolute paths are prohibited/,
        );
      } finally {
        ws.cleanup();
      }
    });
  });

  describe("Deterministic scenario execution", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "executable-scenarios.json"),
      "utf8",
    );
    const doc: ExecutableScenarioDocument = JSON.parse(raw);

    it("executes destructive rmdir prevention scenario (EXEC-DESTRUCTIVE-RMDIR)", async () => {
      const scenario = doc.scenarios.find((s) => s.id === "EXEC-DESTRUCTIVE-RMDIR")!;
      const result = await executeScenario(scenario);

      expect(result.status).toBe("passed");
      expect(result.decision).toBe("deny");
      expect(result.semanticClass).toBe("destructive");
      expect(result.assertions.every((a) => a.passed)).toBe(true);
      expect(result.isSimulated).toBe(true);
      expect(result.telemetry.eventsEmitted).toBeGreaterThanOrEqual(1);
      expect(result.telemetry.records[0].source).toBe("evaluation");
    });

    it("executes safe npm test authorization scenario (EXEC-SAFE-NPM-TEST)", async () => {
      const scenario = doc.scenarios.find((s) => s.id === "EXEC-SAFE-NPM-TEST")!;
      const result = await executeScenario(scenario);

      expect(result.status).toBe("passed");
      expect(result.decision).toBe("allow");
      expect(result.semanticClass).toBe("workspace_read");
      expect(result.assertions.every((a) => a.passed)).toBe(true);
    });

    it("executes path traversal dotdot prevention scenario (EXEC-PATH-TRAVERSAL-DOTDOT)", async () => {
      const scenario = doc.scenarios.find((s) => s.id === "EXEC-PATH-TRAVERSAL-DOTDOT")!;
      const result = await executeScenario(scenario);

      expect(result.status).toBe("passed");
      expect(result.decision).toBe("deny");
      expect(result.assertions.every((a) => a.passed)).toBe(true);
    });

    it("executes secret token redaction scenario (EXEC-SECRET-TOKEN-REDACT)", async () => {
      const scenario = doc.scenarios.find((s) => s.id === "EXEC-SECRET-TOKEN-REDACT")!;
      const result = await executeScenario(scenario);

      expect(result.status).toBe("passed");
      expect(result.assertions.every((a) => a.passed)).toBe(true);
      // Verify raw secret literal is nowhere in emitted records
      const serialized = JSON.stringify(result.telemetry.records);
      expect(serialized.includes("ghp_0123456789abcdefghijklmnopqrstuvwxyz")).toBe(false);
    });

    it("executes crash resilience scenarios (fail closed vs fail open)", async () => {
      const failClosed = doc.scenarios.find((s) => s.id === "EXEC-CRASH-PRE-TOOL-FAIL-CLOSED")!;
      const resClosed = await executeScenario(failClosed);
      expect(resClosed.status).toBe("passed");
      expect(resClosed.decision).toBe("deny");

      const failOpen = doc.scenarios.find((s) => s.id === "EXEC-CRASH-POST-INVOCATION-FAIL-OPEN")!;
      const resOpen = await executeScenario(failOpen);
      expect(resOpen.status).toBe("passed");
      expect(resOpen.decision).not.toBe("deny");
    });

    it("executes simulated timeout scenario bounded within limits (EXEC-TIMEOUT-PRE-TOOL-SAFE-FALLBACK)", async () => {
      const timeoutScen = doc.scenarios.find(
        (s) => s.id === "EXEC-TIMEOUT-PRE-TOOL-SAFE-FALLBACK",
      )!;
      const result = await executeScenario(timeoutScen);
      expect(result.status).toBe("passed");
      expect(result.decision).toBe("deny");
      expect(result.durationMs).toBeLessThanOrEqual(timeoutScen.execution.timeoutMs);
    });

    it("executes subagent delegation gating scenario (EXEC-SUBAGENT-GATE-RESTRICTED)", async () => {
      const subagentScen = doc.scenarios.find((s) => s.id === "EXEC-SUBAGENT-GATE-RESTRICTED")!;
      const result = await executeScenario(subagentScen);
      expect(result.status).toBe("passed");
      expect(result.decision).toBe("deny");
    });
  });

  describe("Full suite execution and report generation", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "executable-scenarios.json"),
      "utf8",
    );
    const doc: ExecutableScenarioDocument = JSON.parse(raw);

    it("executes the entire suite with 100% pass rate and verified telemetry", async () => {
      const report = await executeEvaluationSuite(doc);

      expect(report.totalScenarios).toBe(doc.scenarios.length);
      expect(report.passed).toBe(doc.scenarios.length);
      expect(report.failed).toBe(0);
      expect(report.errored).toBe(0);
      expect(report.runtimeMode).toBe("simulation");
      expect(report.hostDisclaimer).toBe(EVALUATION_HOST_DISCLAIMER);

      expect(report.telemetryStats.evaluationSourceVerified).toBe(true);
      expect(report.telemetryStats.allEvalContextsValid).toBe(true);
      expect(report.telemetryStats.totalEvents).toBeGreaterThanOrEqual(10);
    });

    it("supports category filtering in suite execution", async () => {
      const report = await executeEvaluationSuite(doc, {
        categoryFilter: ["destructive_prevention"],
      });
      expect(report.totalScenarios).toBe(4);
      expect(report.passed).toBe(4);
      expect(report.scenarios.every((s) => s.category === "destructive_prevention")).toBe(true);
    });

    it("formats evaluation report as structured JSON and Markdown", async () => {
      const report = await executeEvaluationSuite(doc, {
        categoryFilter: ["destructive_prevention"],
      });

      const jsonStr = formatEvaluationReportJson(report);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.runId).toBe(report.runId);
      expect(parsed.runtimeMode).toBe("simulation");

      const mdStr = formatEvaluationReportMarkdown(report);
      expect(mdStr).toContain("# Executable Behavioral Evaluation Report");
      expect(mdStr).toContain("Runtime Mode:");
      expect(mdStr).toContain("Host Disclaimer:");
      expect(mdStr).toContain("EXEC-DESTRUCTIVE-RMDIR");
    });
  });
});
