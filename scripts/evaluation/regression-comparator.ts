/**
 * Phase 8.6D: Evaluation Regression Comparator
 * Compares current evaluation run reports against established baselines to detect
 * behavioral regressions, assertion failures, latency anomalies, and improvements.
 */

import { EVALUATION_HOST_DISCLAIMER } from "./evaluation-runner.ts";
import type {
  EvaluationRunReport,
  LatencyRegression,
  RegressionComparisonReport,
  RegressionComparatorOptions,
  RegressionStatus,
  ScenarioExecutionResult,
  ScenarioRegressionDiff,
} from "./types.ts";

const DEFAULT_MAX_LATENCY_PERCENT = 200; // 200% increase
const DEFAULT_MAX_LATENCY_ABSOLUTE_MS = 1000; // 1000ms slowdown

/**
 * Compares an active evaluation run report against an accepted baseline report.
 */
export function compareEvaluationReports(
  current: EvaluationRunReport,
  baseline: EvaluationRunReport,
  options: RegressionComparatorOptions = {},
): RegressionComparisonReport {
  const maxLatencyPercent = options.maxLatencyIncreasePercent ?? DEFAULT_MAX_LATENCY_PERCENT;
  const maxLatencyAbsoluteMs =
    options.maxLatencyIncreaseAbsoluteMs ?? DEFAULT_MAX_LATENCY_ABSOLUTE_MS;

  const baselineMap = new Map<string, ScenarioExecutionResult>();
  for (const s of baseline.scenarios) {
    baselineMap.set(s.scenarioId, s);
  }

  const currentMap = new Map<string, ScenarioExecutionResult>();
  for (const s of current.scenarios) {
    currentMap.set(s.scenarioId, s);
  }

  const regressions: ScenarioRegressionDiff[] = [];
  const improvements: ScenarioRegressionDiff[] = [];
  const latencyRegressions: LatencyRegression[] = [];
  const newScenarios: string[] = [];
  const missingScenarios: string[] = [];

  let unchangedPassedCount = 0;
  let unchangedFailedCount = 0;

  // Evaluate all current scenarios against baseline
  for (const [id, curr] of currentMap.entries()) {
    const base = baselineMap.get(id);

    if (!base) {
      newScenarios.push(id);
      if (curr.status === "passed") {
        improvements.push({
          scenarioId: id,
          scenarioTitle: curr.scenarioTitle,
          category: curr.category,
          baselineStatus: "missing",
          currentStatus: curr.status,
          durationDeltaMs: curr.durationMs,
          durationPercentChange: 100,
          failedAssertions: [],
          reasons: ["New scenario introduced and passing."],
        });
      }
      continue;
    }

    const durationDeltaMs = Math.round((curr.durationMs - base.durationMs) * 100) / 100;
    const durationPercentChange =
      base.durationMs > 0
        ? Math.round(((curr.durationMs - base.durationMs) / base.durationMs) * 10000) / 100
        : 0;

    // Check for latency anomalies
    if (durationDeltaMs > maxLatencyAbsoluteMs && durationPercentChange > maxLatencyPercent) {
      latencyRegressions.push({
        scenarioId: id,
        scenarioTitle: curr.scenarioTitle,
        baselineDurationMs: base.durationMs,
        currentDurationMs: curr.durationMs,
        deltaMs: durationDeltaMs,
        percentChange: durationPercentChange,
      });
    }

    // Check status transition
    if (base.status === "passed" && curr.status !== "passed") {
      const failedAssertions = curr.assertions.filter((a) => !a.passed).map((a) => a.id);
      const reasons: string[] = [];
      if (curr.error) reasons.push(`Execution error: ${curr.error}`);
      for (const a of curr.assertions.filter((a) => !a.passed)) {
        if (a.message) reasons.push(a.message);
      }

      regressions.push({
        scenarioId: id,
        scenarioTitle: curr.scenarioTitle,
        category: curr.category,
        baselineStatus: base.status,
        currentStatus: curr.status,
        durationDeltaMs,
        durationPercentChange,
        failedAssertions,
        reasons,
      });
    } else if (base.status !== "passed" && curr.status === "passed") {
      improvements.push({
        scenarioId: id,
        scenarioTitle: curr.scenarioTitle,
        category: curr.category,
        baselineStatus: base.status,
        currentStatus: curr.status,
        durationDeltaMs,
        durationPercentChange,
        failedAssertions: [],
        reasons: [`Recovered from previous ${base.status} state.`],
      });
    } else if (curr.status === "passed") {
      unchangedPassedCount++;
    } else {
      unchangedFailedCount++;
    }
  }

  // Check for missing scenarios that were in baseline
  for (const id of baselineMap.keys()) {
    if (!currentMap.has(id)) {
      missingScenarios.push(id);
      if (options.failOnMissingScenarios) {
        const base = baselineMap.get(id)!;
        regressions.push({
          scenarioId: id,
          scenarioTitle: base.scenarioTitle,
          category: base.category,
          baselineStatus: base.status,
          currentStatus: "failed",
          durationDeltaMs: -base.durationMs,
          durationPercentChange: -100,
          failedAssertions: [],
          reasons: ["Scenario was present in baseline but missing from current run."],
        });
      }
    }
  }

  const hasRegressions = regressions.length > 0;
  let overallStatus: RegressionStatus = "passed";
  if (hasRegressions) {
    overallStatus = "regressed";
  } else if (improvements.length > 0) {
    overallStatus = "improved";
  }

  return {
    comparedAt: new Date().toISOString(),
    baselineRunId: baseline.runId,
    currentRunId: current.runId,
    overallStatus,
    hasRegressions,
    regressionsCount: regressions.length,
    improvementsCount: improvements.length,
    unchangedPassedCount,
    unchangedFailedCount,
    newScenariosCount: newScenarios.length,
    missingScenariosCount: missingScenarios.length,
    regressions,
    improvements,
    latencyRegressions,
    newScenarios,
    missingScenarios,
    runtimeMode: "simulation",
    hostDisclaimer: EVALUATION_HOST_DISCLAIMER,
  };
}

/** Determines process exit code and summary message from a comparison report. */
export function determineRegressionStatus(comparison: RegressionComparisonReport): {
  passed: boolean;
  exitCode: 0 | 1;
  summary: string;
} {
  if (comparison.hasRegressions) {
    return {
      passed: false,
      exitCode: 1,
      summary: `FAILED: ${comparison.regressionsCount} behavioral regression(s) detected compared to baseline ${comparison.baselineRunId}.`,
    };
  }

  if (comparison.overallStatus === "improved") {
    return {
      passed: true,
      exitCode: 0,
      summary: `PASSED: 0 regressions, ${comparison.improvementsCount} improvement(s) detected over baseline ${comparison.baselineRunId}.`,
    };
  }

  return {
    passed: true,
    exitCode: 0,
    summary: `PASSED: 0 regressions, all ${comparison.unchangedPassedCount} scenario(s) match baseline expectations.`,
  };
}

/** Formats a RegressionComparisonReport as JSON. */
export function formatRegressionReportJson(report: RegressionComparisonReport): string {
  return JSON.stringify(report, null, 2);
}

/** Formats a RegressionComparisonReport as human-readable Markdown. */
export function formatRegressionReportMarkdown(report: RegressionComparisonReport): string {
  const lines: string[] = [];
  lines.push(`# Behavioral Evaluation Regression Comparison Report`);
  lines.push(``);
  lines.push(`> [!NOTE]`);
  lines.push(`> **Runtime Mode:** ${report.runtimeMode}`);
  lines.push(`> **Host Disclaimer:** ${report.hostDisclaimer}`);
  lines.push(``);

  if (report.hasRegressions) {
    lines.push(`> [!WARNING]`);
    lines.push(
      `> **Regression Alert:** ${report.regressionsCount} scenario(s) regressed compared to baseline \`${report.baselineRunId}\`.`,
    );
    lines.push(``);
  } else if (report.overallStatus === "improved") {
    lines.push(`> [!TIP]`);
    lines.push(
      `> **Quality Improvement:** ${report.improvementsCount} scenario(s) improved over baseline \`${report.baselineRunId}\`.`,
    );
    lines.push(``);
  }

  lines.push(`## Comparison Summary`);
  lines.push(``);
  lines.push(`- **Baseline Run:** \`${report.baselineRunId}\``);
  lines.push(`- **Current Run:** \`${report.currentRunId}\``);
  lines.push(`- **Compared At:** ${report.comparedAt}`);
  lines.push(`- **Overall Status:** **${report.overallStatus.toUpperCase()}**`);
  lines.push(`- **Regressions:** ${report.regressionsCount}`);
  lines.push(`- **Improvements:** ${report.improvementsCount}`);
  lines.push(`- **Unchanged Passing:** ${report.unchangedPassedCount}`);
  lines.push(`- **New Scenarios:** ${report.newScenariosCount}`);
  lines.push(`- **Missing Scenarios:** ${report.missingScenariosCount}`);
  lines.push(``);

  if (report.regressions.length > 0) {
    lines.push(`## Regressed Scenarios`);
    lines.push(``);
    lines.push(`| Scenario ID | Title | Category | Baseline | Current | Reasons |`);
    lines.push(`|:---|:---|:---|:---|:---|:---|`);
    for (const r of report.regressions) {
      const reasonStr = r.reasons.join("; ") || "Assertion failure";
      lines.push(
        `| \`${r.scenarioId}\` | ${r.scenarioTitle} | \`${r.category}\` | \`${r.baselineStatus}\` | **\`${r.currentStatus}\`** | ${reasonStr} |`,
      );
    }
    lines.push(``);
  }

  if (report.improvements.length > 0) {
    lines.push(`## Improved Scenarios`);
    lines.push(``);
    lines.push(`| Scenario ID | Title | Category | Previous | Current |`);
    lines.push(`|:---|:---|:---|:---|:---|`);
    for (const imp of report.improvements) {
      lines.push(
        `| \`${imp.scenarioId}\` | ${imp.scenarioTitle} | \`${imp.category}\` | \`${imp.baselineStatus}\` | **\`${imp.currentStatus}\`** |`,
      );
    }
    lines.push(``);
  }

  if (report.latencyRegressions.length > 0) {
    lines.push(`## Latency Anomalies`);
    lines.push(``);
    lines.push(`| Scenario ID | Baseline Duration | Current Duration | Slowdown |`);
    lines.push(`|:---|:---|:---|:---|`);
    for (const lat of report.latencyRegressions) {
      lines.push(
        `| \`${lat.scenarioId}\` | ${lat.baselineDurationMs}ms | ${lat.currentDurationMs}ms | +${lat.deltaMs}ms (+${lat.percentChange}%) |`,
      );
    }
    lines.push(``);
  }

  return lines.join("\n");
}
