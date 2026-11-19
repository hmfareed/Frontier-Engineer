import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRegressionCheck } from "../../scripts/evaluation/check-regression.ts";
import {
  compareEvaluationReports,
  determineRegressionStatus,
  formatRegressionReportJson,
  formatRegressionReportMarkdown,
} from "../../scripts/evaluation/regression-comparator.ts";
import type {
  EvaluationRunReport,
  ExecutableScenarioDocument,
  ScenarioExecutionResult,
} from "../../scripts/evaluation/types.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

function createMockReport(overrides: Partial<EvaluationRunReport> = {}): EvaluationRunReport {
  return {
    runId: "mock-run-001",
    version: 1,
    evaluatorVersion: "1.0.0",
    startedAt: "2026-11-19T00:00:00.000Z",
    completedAt: "2026-11-19T00:00:01.000Z",
    durationMs: 1000,
    totalScenarios: 3,
    passed: 3,
    failed: 0,
    errored: 0,
    skipped: 0,
    scenarios: [
      {
        scenarioId: "EXEC-01",
        scenarioTitle: "Scenario 01",
        category: "destructive_prevention",
        status: "passed",
        durationMs: 50,
        decision: "deny",
        assertions: [
          { id: "ASSERT-01", type: "decision_match", passed: true, description: "Pass" },
        ],
        telemetry: { eventsEmitted: 1, records: [] },
        isSimulated: true,
      },
      {
        scenarioId: "EXEC-02",
        scenarioTitle: "Scenario 02",
        category: "tool_classification",
        status: "passed",
        durationMs: 60,
        decision: "allow",
        assertions: [
          { id: "ASSERT-02", type: "decision_match", passed: true, description: "Pass" },
        ],
        telemetry: { eventsEmitted: 1, records: [] },
        isSimulated: true,
      },
      {
        scenarioId: "EXEC-03",
        scenarioTitle: "Scenario 03",
        category: "secret_redaction",
        status: "passed",
        durationMs: 70,
        decision: "allow",
        assertions: [
          { id: "ASSERT-03", type: "secret_redacted", passed: true, description: "Pass" },
        ],
        telemetry: { eventsEmitted: 1, records: [] },
        isSimulated: true,
      },
    ],
    telemetryStats: {
      totalEvents: 3,
      evaluationSourceVerified: true,
      allEvalContextsValid: true,
      diagnosticsCount: 0,
      quarantinedLinesCount: 0,
    },
    runtimeMode: "simulation",
    hostDisclaimer: "Simulated evaluation",
    ...overrides,
  };
}

describe("Phase 8.6D: Evaluation Regression Comparator Subsystem", () => {
  describe("Identical report comparison", () => {
    it("reports clean pass with zero regressions when reports are identical", () => {
      const baseline = createMockReport({ runId: "base-001" });
      const current = createMockReport({ runId: "curr-001" });

      const comparison = compareEvaluationReports(current, baseline);

      expect(comparison.hasRegressions).toBe(false);
      expect(comparison.overallStatus).toBe("passed");
      expect(comparison.regressionsCount).toBe(0);
      expect(comparison.improvementsCount).toBe(0);
      expect(comparison.unchangedPassedCount).toBe(3);
      expect(comparison.newScenariosCount).toBe(0);
      expect(comparison.missingScenariosCount).toBe(0);

      const status = determineRegressionStatus(comparison);
      expect(status.passed).toBe(true);
      expect(status.exitCode).toBe(0);
      expect(status.summary).toContain("PASSED: 0 regressions");
    });
  });

  describe("Regression detection", () => {
    it("detects a behavioral regression when a previously passing scenario fails", () => {
      const baseline = createMockReport({ runId: "base-001" });
      const current = createMockReport({
        runId: "curr-001",
        passed: 2,
        failed: 1,
        scenarios: [
          baseline.scenarios[0],
          {
            ...baseline.scenarios[1],
            status: "failed",
            assertions: [
              {
                id: "ASSERT-02",
                type: "decision_match",
                passed: false,
                description: "Pass",
                message: "Expected allow, got deny",
              },
            ],
          },
          baseline.scenarios[2],
        ],
      });

      const comparison = compareEvaluationReports(current, baseline);

      expect(comparison.hasRegressions).toBe(true);
      expect(comparison.overallStatus).toBe("regressed");
      expect(comparison.regressionsCount).toBe(1);
      expect(comparison.regressions[0].scenarioId).toBe("EXEC-02");
      expect(comparison.regressions[0].baselineStatus).toBe("passed");
      expect(comparison.regressions[0].currentStatus).toBe("failed");
      expect(comparison.regressions[0].failedAssertions).toEqual(["ASSERT-02"]);
      expect(comparison.regressions[0].reasons).toContain("Expected allow, got deny");

      const status = determineRegressionStatus(comparison);
      expect(status.passed).toBe(false);
      expect(status.exitCode).toBe(1);
      expect(status.summary).toContain("FAILED: 1 behavioral regression(s) detected");
    });

    it("detects an execution error regression", () => {
      const baseline = createMockReport();
      const current = createMockReport({
        scenarios: [
          baseline.scenarios[0],
          baseline.scenarios[1],
          {
            ...baseline.scenarios[2],
            status: "error",
            error: "Unexpected runtime exception",
            assertions: [],
          },
        ],
      });

      const comparison = compareEvaluationReports(current, baseline);
      expect(comparison.hasRegressions).toBe(true);
      expect(comparison.regressions[0].scenarioId).toBe("EXEC-03");
      expect(comparison.regressions[0].currentStatus).toBe("error");
      expect(comparison.regressions[0].reasons).toContain(
        "Execution error: Unexpected runtime exception",
      );
    });
  });

  describe("Quality improvement detection", () => {
    it("detects an improvement when a previously failing scenario now passes", () => {
      const baseline = createMockReport({
        scenarios: [
          baselineFailedScenario(),
          createMockReport().scenarios[1],
          createMockReport().scenarios[2],
        ],
      });
      const current = createMockReport(); // all passing

      const comparison = compareEvaluationReports(current, baseline);

      expect(comparison.hasRegressions).toBe(false);
      expect(comparison.overallStatus).toBe("improved");
      expect(comparison.improvementsCount).toBe(1);
      expect(comparison.improvements[0].scenarioId).toBe("EXEC-01");
      expect(comparison.improvements[0].baselineStatus).toBe("failed");
      expect(comparison.improvements[0].currentStatus).toBe("passed");

      const status = determineRegressionStatus(comparison);
      expect(status.passed).toBe(true);
      expect(status.exitCode).toBe(0);
      expect(status.summary).toContain("PASSED: 0 regressions, 1 improvement(s)");
    });
  });

  describe("Latency regression detection", () => {
    it("flags latency regression when scenario duration increases beyond threshold", () => {
      const baseline = createMockReport({
        scenarios: [{ ...createMockReport().scenarios[0], durationMs: 100 }],
      });
      const current = createMockReport({
        scenarios: [{ ...createMockReport().scenarios[0], durationMs: 2500 }], // +2400ms, +2400%
      });

      const comparison = compareEvaluationReports(current, baseline, {
        maxLatencyIncreasePercent: 200,
        maxLatencyIncreaseAbsoluteMs: 1000,
      });

      expect(comparison.latencyRegressions.length).toBe(1);
      expect(comparison.latencyRegressions[0].scenarioId).toBe("EXEC-01");
      expect(comparison.latencyRegressions[0].deltaMs).toBe(2400);
      expect(comparison.latencyRegressions[0].percentChange).toBe(2400);
    });
  });

  describe("New and missing scenario handling", () => {
    it("tracks newly introduced scenarios", () => {
      const baseline = createMockReport({
        scenarios: [createMockReport().scenarios[0]],
      });
      const current = createMockReport(); // has EXEC-01, EXEC-02, EXEC-03

      const comparison = compareEvaluationReports(current, baseline);
      expect(comparison.newScenariosCount).toBe(2);
      expect(comparison.newScenarios).toContain("EXEC-02");
      expect(comparison.newScenarios).toContain("EXEC-03");
    });

    it("tracks missing scenarios and flags regression if failOnMissingScenarios is enabled", () => {
      const baseline = createMockReport(); // has 3
      const current = createMockReport({
        scenarios: [baseline.scenarios[0]], // missing 02 and 03
      });

      const comparisonNoFail = compareEvaluationReports(current, baseline, {
        failOnMissingScenarios: false,
      });
      expect(comparisonNoFail.missingScenariosCount).toBe(2);
      expect(comparisonNoFail.hasRegressions).toBe(false);

      const comparisonFail = compareEvaluationReports(current, baseline, {
        failOnMissingScenarios: true,
      });
      expect(comparisonFail.hasRegressions).toBe(true);
      expect(comparisonFail.regressionsCount).toBe(2);
    });
  });

  describe("Report formatters", () => {
    it("formats regression report as structured JSON", () => {
      const baseline = createMockReport();
      const current = createMockReport();
      const comparison = compareEvaluationReports(current, baseline);

      const jsonStr = formatRegressionReportJson(comparison);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.baselineRunId).toBe(baseline.runId);
      expect(parsed.overallStatus).toBe("passed");
      expect(parsed.runtimeMode).toBe("simulation");
    });

    it("formats regression report as Markdown with alert banners", () => {
      const baseline = createMockReport();
      const current = createMockReport({
        scenarios: [
          {
            ...baseline.scenarios[0],
            status: "failed",
            assertions: [
              {
                id: "A1",
                type: "decision_match",
                passed: false,
                description: "fail",
                message: "Denied",
              },
            ],
          },
        ],
      });
      const comparison = compareEvaluationReports(current, baseline);

      const md = formatRegressionReportMarkdown(comparison);
      expect(md).toContain("# Behavioral Evaluation Regression Comparison Report");
      expect(md).toContain("Regression Alert");
      expect(md).toContain("| `EXEC-01` |");
    });
  });

  describe("End-to-end regression check script integration", () => {
    it("executes runRegressionCheck against canonical scenarios and baseline cleanly", async () => {
      const result = await runRegressionCheck();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("PASSED: 0 regressions");
      expect(result.output).toContain("**Overall Status:** **PASSED**");
    });
  });
});

function baselineFailedScenario(): ScenarioExecutionResult {
  return {
    scenarioId: "EXEC-01",
    scenarioTitle: "Scenario 01",
    category: "destructive_prevention",
    status: "failed",
    durationMs: 50,
    decision: "allow",
    assertions: [{ id: "ASSERT-01", type: "decision_match", passed: false, description: "Failed" }],
    telemetry: { eventsEmitted: 1, records: [] },
    isSimulated: true,
  };
}
