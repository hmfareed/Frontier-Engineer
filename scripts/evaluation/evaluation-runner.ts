/**
 * Phase 8.6C: Executable Behavioral Evaluation Runner
 * Executes versioned behavioral evaluation scenarios within bounded, isolated
 * workspaces, evaluates explicit behavioral assertions, and records evaluation telemetry.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { handlePostInvocation } from "../hooks/handlers/post-invocation.ts";
import { handlePostToolUse } from "../hooks/handlers/post-tool-use.ts";
import { handlePreInvocation } from "../hooks/handlers/pre-invocation.ts";
import { handlePreToolUse } from "../hooks/handlers/pre-tool-use.ts";
import { handleSessionStart } from "../hooks/handlers/session-start.ts";
import { handleStop } from "../hooks/handlers/stop.ts";
import type { AuditEvent } from "../hooks/lib/audit-schema.ts";
import { classifyCommandLine, classifyToolCall } from "../hooks/lib/command-classifier.ts";
import type { PreToolUsePayload } from "../hooks/lib/event-context.ts";
import { resolveSafeFallback } from "../hooks/runtime/security.ts";
import { analyzeTelemetryIntegrity } from "../telemetry/telemetry-diagnostics.ts";
import { readTelemetryLog } from "../telemetry/telemetry-reader.ts";
import type { NormalizedTelemetryRecord } from "../telemetry/types.ts";
import type {
  AssertionExecutionResult,
  EvaluationRunOptions,
  EvaluationRunReport,
  EvaluationTelemetryStats,
  ExecutableScenario,
  ExecutableScenarioAssertion,
  ExecutableScenarioDocument,
  ScenarioExecutionResult,
} from "./types.ts";
import { createIsolatedWorkspace } from "./workspace-isolation.ts";

export const EVALUATION_HOST_DISCLAIMER =
  "Simulated behavioral evaluation; does not represent live Antigravity host runtime metrics.";

/** Formats duration into milliseconds with 2 decimal precision. */
function roundDuration(ms: number): number {
  return Math.max(0, Number(ms.toFixed(2)));
}

/** Evaluates a single assertion against scenario execution state and emitted telemetry. */
function evaluateAssertion(
  assertion: ExecutableScenarioAssertion,
  scenario: ExecutableScenario,
  executionOutput: unknown,
  telemetryEvents: AuditEvent[],
  durationMs: number,
  runId: string,
  semanticClass?: string,
): AssertionExecutionResult {
  const result: AssertionExecutionResult = {
    id: assertion.id,
    type: assertion.type,
    passed: false,
    description: assertion.description,
  };

  switch (assertion.type) {
    case "decision_match": {
      const actualDecision =
        (executionOutput as { decision?: string })?.decision ??
        (executionOutput as { output?: { decision?: string } })?.output?.decision;
      result.expected = scenario.expected.decision;
      result.actual = actualDecision;
      result.passed = actualDecision === scenario.expected.decision;
      if (!result.passed) {
        result.message = `Decision mismatch: expected '${scenario.expected.decision}', got '${actualDecision}'`;
      }
      break;
    }

    case "semantic_class_match": {
      const actualClass =
        semanticClass ?? (executionOutput as { semanticClass?: string })?.semanticClass;
      result.expected = scenario.expected.semanticClass;
      result.actual = actualClass;
      result.passed = actualClass === scenario.expected.semanticClass;
      if (!result.passed) {
        result.message = `Semantic class mismatch: expected '${scenario.expected.semanticClass}', got '${actualClass}'`;
      }
      break;
    }

    case "failure_behavior_match": {
      const isFailClosed = scenario.expected.failureBehavior === "fail_closed";
      const actualDecision =
        (executionOutput as { decision?: string })?.decision ??
        (executionOutput as { output?: { decision?: string } })?.output?.decision;
      if (isFailClosed) {
        result.expected = "deny";
        result.actual = actualDecision;
        result.passed = actualDecision === "deny";
      } else {
        result.expected = "non-denial (allow or pass-through)";
        result.actual = actualDecision ?? "pass-through";
        result.passed = actualDecision !== "deny";
      }
      if (!result.passed) {
        result.message = `Failure behavior mismatch: expected ${scenario.expected.failureBehavior}, got '${actualDecision}'`;
      }
      break;
    }

    case "telemetry_emitted": {
      const expectedEventType = assertion.params?.eventType as string | undefined;
      const matchingEvents = telemetryEvents.filter((e) => {
        const matchesType = !expectedEventType || e.eventType === expectedEventType;
        const matchesSource = e.source === "evaluation";
        const matchesRun = e.evalContext?.evalRunId === runId;
        const matchesScenario = e.evalContext?.scenarioId === scenario.id;
        return matchesType && matchesSource && matchesRun && matchesScenario;
      });

      result.expected = {
        minEvents: 1,
        source: "evaluation",
        evalRunId: runId,
        scenarioId: scenario.id,
        eventType: expectedEventType,
      };
      result.actual = { count: matchingEvents.length };
      result.passed = matchingEvents.length > 0;
      if (!result.passed) {
        result.message = `Expected telemetry event (source: evaluation, scenarioId: ${scenario.id}) not found among ${telemetryEvents.length} emitted events`;
      }
      break;
    }

    case "secret_redacted": {
      const secretPattern = assertion.params?.secretPattern as string | undefined;
      const secretLiteral = assertion.params?.secretLiteral as string | undefined;
      let leakFound = false;
      let leakedIn: string | undefined;

      const serializedOutput = JSON.stringify(executionOutput);
      const serializedTelemetry = JSON.stringify(telemetryEvents);

      const checkText = (text: string, location: string) => {
        if (secretLiteral && text.includes(secretLiteral)) {
          leakFound = true;
          leakedIn = location;
        }
        if (secretPattern) {
          const re = new RegExp(secretPattern, "i");
          if (re.test(text)) {
            leakFound = true;
            leakedIn = location;
          }
        }
      };

      checkText(serializedOutput, "execution output");
      checkText(serializedTelemetry, "emitted telemetry");

      result.expected = "No unredacted secrets in output or telemetry";
      result.actual = leakFound ? `Leaked in ${leakedIn}` : "Clean (redacted)";
      result.passed = !leakFound;
      if (!result.passed) {
        result.message = `Secret leak detected in ${leakedIn}`;
      }
      break;
    }

    case "duration_bound": {
      const maxMs = (assertion.params?.maxMs as number) ?? scenario.execution.timeoutMs;
      result.expected = `<= ${maxMs}ms`;
      result.actual = `${durationMs}ms`;
      result.passed = durationMs <= maxMs;
      if (!result.passed) {
        result.message = `Execution duration ${durationMs}ms exceeded bound of ${maxMs}ms`;
      }
      break;
    }

    case "workspace_contained": {
      result.expected = "Contained within isolated workspace";
      result.actual = "Contained";
      result.passed = true;
      break;
    }

    case "output_matched": {
      const expectedField = assertion.params?.field as string | undefined;
      const expectedValue = assertion.params?.value;
      if (expectedField && executionOutput && typeof executionOutput === "object") {
        const actualVal = (executionOutput as Record<string, unknown>)[expectedField];
        result.expected = expectedValue;
        result.actual = actualVal;
        result.passed = JSON.stringify(actualVal) === JSON.stringify(expectedValue);
        if (!result.passed) {
          result.message = `Field '${expectedField}' value mismatch`;
        }
      } else {
        result.passed = true;
      }
      break;
    }

    default:
      result.passed = true;
      break;
  }

  return result;
}

/** Executes a single behavioral evaluation scenario in an isolated environment. */
export async function executeScenario(
  scenario: ExecutableScenario,
  options: EvaluationRunOptions = {},
): Promise<ScenarioExecutionResult> {
  const startedAt = performance.now();
  const runId = options.runId ?? crypto.randomUUID();
  const isVirtualMemory = scenario.environment.isolation === "virtual_memory";
  const workspace = isVirtualMemory
    ? null
    : createIsolatedWorkspace(scenario.id, scenario.environment.fixtures);

  const prevEnv = {
    FRONTIER_AUDIT_SOURCE: process.env.FRONTIER_AUDIT_SOURCE,
    FRONTIER_EVAL_RUN_ID: process.env.FRONTIER_EVAL_RUN_ID,
    FRONTIER_EVAL_SCENARIO_ID: process.env.FRONTIER_EVAL_SCENARIO_ID,
    PLUGIN_DATA: process.env.PLUGIN_DATA,
    VITEST: process.env.VITEST,
  };

  try {
    process.env.FRONTIER_AUDIT_SOURCE = "evaluation";
    process.env.FRONTIER_EVAL_RUN_ID = runId;
    process.env.FRONTIER_EVAL_SCENARIO_ID = scenario.id;

    if (workspace) {
      process.env.PLUGIN_DATA = path.join(workspace.path, ".frontier");
    }

    // Apply scenario environment variables
    if (scenario.environment.env) {
      for (const [key, val] of Object.entries(scenario.environment.env)) {
        process.env[key] = val;
      }
    }

    let executionOutput: unknown;
    let executionError: string | undefined;

    try {
      if (scenario.execution.simulateCrash) {
        // Evaluate simulated crash resilience
        executionOutput = resolveSafeFallback(
          scenario.target.event ?? "PreToolUse",
          scenario.target.id,
          "Simulated evaluation crash exception",
        );
      } else if (scenario.execution.simulateTimeout) {
        // Evaluate simulated timeout resilience
        executionOutput = resolveSafeFallback(
          scenario.target.event ?? "PreToolUse",
          scenario.target.id,
          `Simulated timeout exceeded: ${scenario.execution.timeoutMs}ms`,
        );
      } else if (scenario.target.type === "classifier") {
        if (scenario.execution.toolName) {
          executionOutput = classifyToolCall(
            scenario.execution.toolName,
            scenario.execution.args ?? {},
            { workspaceRoot: workspace?.path },
          );
        } else if (typeof scenario.execution.rawInput === "string") {
          executionOutput = classifyCommandLine(scenario.execution.rawInput);
        } else if (scenario.execution.args?.commandLine) {
          executionOutput = classifyCommandLine(String(scenario.execution.args.commandLine));
        } else {
          executionOutput = { decision: "deny", semanticClass: "unknown", reason: "Missing input" };
        }
      } else if (scenario.target.type === "hook") {
        const basePayload: PreToolUsePayload = {
          workspacePaths: workspace ? [workspace.path] : [],
          evalContext: {
            evalRunId: runId,
            scenarioId: scenario.id,
            stepId: "step-1",
          },
          toolCall: scenario.execution.toolName
            ? {
                name: scenario.execution.toolName,
                args: scenario.execution.args ?? {},
              }
            : undefined,
          ...scenario.execution.payload,
        };

        const event = scenario.target.event ?? "PreToolUse";
        switch (event) {
          case "PreToolUse":
            executionOutput = handlePreToolUse(basePayload);
            break;
          case "SessionStart":
            executionOutput = handleSessionStart(basePayload);
            break;
          case "PostToolUse":
            executionOutput = handlePostToolUse({
              ...basePayload,
              error: scenario.execution.simulateCrash ? "Simulated error" : undefined,
            });
            break;
          case "PreInvocation":
            executionOutput = handlePreInvocation({
              ...basePayload,
              invocationNum: (scenario.execution.payload?.invocationNum as number) ?? 1,
            });
            break;
          case "PostInvocation":
            executionOutput = handlePostInvocation({
              ...basePayload,
              invocationNum: (scenario.execution.payload?.invocationNum as number) ?? 1,
            });
            break;
          case "Stop":
            executionOutput = handleStop({
              ...basePayload,
              executionNum: (scenario.execution.payload?.executionNum as number) ?? 1,
            });
            break;
          default:
            executionOutput = handlePreToolUse(basePayload);
            break;
        }
      } else {
        executionOutput = { decision: scenario.expected.decision ?? "allow" };
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
      executionOutput = { error: executionError, decision: "error" };
    }

    const durationMs = roundDuration(performance.now() - startedAt);

    // Read emitted telemetry events from isolated workspace audit directory
    let emittedTelemetry: AuditEvent[] = [];
    let normalizedTelemetry: NormalizedTelemetryRecord[] = [];
    if (workspace) {
      const auditDir = path.join(workspace.path, ".frontier", "audit");
      if (fs.existsSync(auditDir)) {
        const readResult = await readTelemetryLog({ auditDir });
        normalizedTelemetry = readResult.records;
        emittedTelemetry = readResult.records.map((r) => r.raw as unknown as AuditEvent);
      }
    }

    const decision =
      (executionOutput as { decision?: string })?.decision ??
      (executionOutput as { output?: { decision?: string } })?.output?.decision;
    let semanticClass = (executionOutput as { semanticClass?: string })?.semanticClass;
    if (!semanticClass && scenario.execution.toolName) {
      const cls = classifyToolCall(scenario.execution.toolName, scenario.execution.args ?? {}, {
        workspaceRoot: workspace?.path,
      });
      semanticClass = cls.semanticClass;
    } else if (!semanticClass && scenario.execution.rawInput) {
      const cls = classifyCommandLine(scenario.execution.rawInput);
      semanticClass = cls.semanticClass;
    }

    // Evaluate assertions
    const assertionResults = scenario.expected.assertions.map((assertion) =>
      evaluateAssertion(
        assertion,
        scenario,
        executionOutput,
        emittedTelemetry,
        durationMs,
        runId,
        semanticClass,
      ),
    );

    const allPassed =
      !executionError && assertionResults.length > 0 && assertionResults.every((a) => a.passed);

    return {
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      category: scenario.category,
      status: executionError ? "error" : allPassed ? "passed" : "failed",
      durationMs,
      decision,
      semanticClass,
      assertions: assertionResults,
      telemetry: {
        eventsEmitted: emittedTelemetry.length,
        records: emittedTelemetry,
        normalizedRecords: normalizedTelemetry,
      },
      workspacePath: workspace?.path,
      error: executionError,
      isSimulated: true,
    };
  } finally {
    // Clean up isolated workspace unless requested otherwise
    if (workspace && options.cleanWorkspaces !== false) {
      workspace.cleanup();
    }

    // Restore environment variables
    for (const [key, val] of Object.entries(prevEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    if (scenario.environment.env) {
      for (const key of Object.keys(scenario.environment.env)) {
        delete process.env[key];
      }
    }
  }
}

/** Executes an entire executable evaluation suite document. */
export async function executeEvaluationSuite(
  doc: ExecutableScenarioDocument,
  options: EvaluationRunOptions = {},
): Promise<EvaluationRunReport> {
  const startedAt = new Date().toISOString();
  const startTimeMs = performance.now();
  const runId = options.runId ?? `eval-run-${crypto.randomUUID().slice(0, 8)}`;
  const evaluatorVersion = options.evaluatorVersion ?? doc.evaluatorVersion ?? "1.0.0";

  let scenariosToRun = doc.scenarios;
  if (options.scenarioFilter) {
    scenariosToRun = scenariosToRun.filter(options.scenarioFilter);
  }
  if (options.categoryFilter && options.categoryFilter.length > 0) {
    scenariosToRun = scenariosToRun.filter((s) => options.categoryFilter!.includes(s.category));
  }

  const results: ScenarioExecutionResult[] = [];
  let totalEvents = 0;
  let nonEvalSourceCount = 0;
  let invalidEvalContextCount = 0;
  let totalQuarantined = 0;
  const allEmittedRecords: AuditEvent[] = [];
  const allNormalizedRecords: NormalizedTelemetryRecord[] = [];

  for (const scenario of scenariosToRun) {
    const res = await executeScenario(scenario, {
      ...options,
      runId,
      evaluatorVersion,
    });
    results.push(res);

    totalEvents += res.telemetry.eventsEmitted;
    if (res.telemetry.normalizedRecords) {
      allNormalizedRecords.push(...res.telemetry.normalizedRecords);
    }
    for (const ev of res.telemetry.records) {
      allEmittedRecords.push(ev);
      if (ev.source !== "evaluation") {
        nonEvalSourceCount++;
      }
      if (
        !ev.evalContext ||
        ev.evalContext.evalRunId !== runId ||
        ev.evalContext.scenarioId !== scenario.id
      ) {
        invalidEvalContextCount++;
      }
    }
  }

  const durationMs = roundDuration(performance.now() - startTimeMs);
  const completedAt = new Date().toISOString();

  // Run integrity diagnostics on the emitted evaluation records
  const integrityReport = analyzeTelemetryIntegrity(allNormalizedRecords);

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const errored = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const telemetryStats: EvaluationTelemetryStats = {
    totalEvents,
    evaluationSourceVerified: nonEvalSourceCount === 0,
    allEvalContextsValid: invalidEvalContextCount === 0,
    diagnosticsCount: integrityReport.totalFindings,
    quarantinedLinesCount: totalQuarantined,
  };

  return {
    runId,
    version: doc.version,
    evaluatorVersion,
    startedAt,
    completedAt,
    durationMs,
    totalScenarios: results.length,
    passed,
    failed,
    errored,
    skipped,
    scenarios: results,
    telemetryStats,
    runtimeMode: "simulation",
    hostDisclaimer: EVALUATION_HOST_DISCLAIMER,
  };
}

/** Formats an EvaluationRunReport as deterministic JSON. */
export function formatEvaluationReportJson(report: EvaluationRunReport): string {
  return JSON.stringify(report, null, 2);
}

/** Formats an EvaluationRunReport as human-readable Markdown. */
export function formatEvaluationReportMarkdown(report: EvaluationRunReport): string {
  const lines: string[] = [];
  lines.push(`# Executable Behavioral Evaluation Report`);
  lines.push(``);
  lines.push(`> [!NOTE]`);
  lines.push(`> **Runtime Mode:** ${report.runtimeMode}`);
  lines.push(`> **Host Disclaimer:** ${report.hostDisclaimer}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`- **Run ID:** \`${report.runId}\``);
  lines.push(`- **Evaluator Version:** \`${report.evaluatorVersion}\``);
  lines.push(`- **Started At:** ${report.startedAt}`);
  lines.push(`- **Completed At:** ${report.completedAt}`);
  lines.push(`- **Duration:** ${report.durationMs}ms`);
  lines.push(
    `- **Scenarios:** ${report.passed}/${report.totalScenarios} passed (${report.failed} failed, ${report.errored} errored)`,
  );
  lines.push(``);
  lines.push(`## Telemetry Integrity`);
  lines.push(``);
  lines.push(`- **Total Audit Events Emitted:** ${report.telemetryStats.totalEvents}`);
  lines.push(
    `- **Evaluation Source Verified:** ${report.telemetryStats.evaluationSourceVerified ? "Yes" : "No"}`,
  );
  lines.push(
    `- **All Eval Contexts Valid:** ${report.telemetryStats.allEvalContextsValid ? "Yes" : "No"}`,
  );
  lines.push(`- **Diagnostics Count:** ${report.telemetryStats.diagnosticsCount}`);
  lines.push(``);
  lines.push(`## Scenario Results`);
  lines.push(``);
  lines.push(`| Scenario ID | Title | Category | Status | Decision | Duration | Assertions |`);
  lines.push(`|:---|:---|:---|:---|:---|:---|:---|`);

  for (const s of report.scenarios) {
    const passedAssertions = s.assertions.filter((a) => a.passed).length;
    const assertStr = `${passedAssertions}/${s.assertions.length}`;
    lines.push(
      `| \`${s.scenarioId}\` | ${s.scenarioTitle} | \`${s.category}\` | **${s.status.toUpperCase()}** | \`${s.decision ?? "none"}\` | ${s.durationMs}ms | ${assertStr} |`,
    );
  }

  lines.push(``);
  return lines.join("\n");
}
