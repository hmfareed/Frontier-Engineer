/**
 * Phase 8.6C: Executable Behavioral Evaluation Subsystem
 * Type definitions for executable scenarios, assertions, runner results,
 * workspace isolation, and evaluation telemetry reporting.
 */

import type { AuditEvent, AuditEventType } from "../hooks/lib/audit-schema.ts";
import type { NormalizedTelemetryRecord } from "../telemetry/types.ts";

export type ScenarioCategory =
  | "destructive_prevention"
  | "path_boundary"
  | "secret_redaction"
  | "failure_resilience"
  | "timeout_boundary"
  | "procedural_compliance"
  | "telemetry_integrity"
  | "tool_classification";

export type TargetType = "hook" | "agent" | "skill" | "classifier" | "policy";

export type HookEventName =
  "SessionStart" | "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop";

export type IsolationMode = "temp_workspace" | "virtual_memory";

export type ExpectedDecision = "allow" | "deny" | "force_ask" | "ask" | "escalate" | "error";

export type ExpectedSemanticClass =
  | "trusted_read_only"
  | "workspace_read"
  | "workspace_write"
  | "external_side_effect"
  | "destructive"
  | "unknown";

export type ExpectedFailureBehavior = "fail_closed" | "fail_open";

export type AssertionType =
  | "decision_match"
  | "semantic_class_match"
  | "telemetry_emitted"
  | "secret_redacted"
  | "workspace_contained"
  | "output_matched"
  | "duration_bound"
  | "failure_behavior_match";

export interface ExecutableScenarioTarget {
  type: TargetType;
  id: string;
  event?: HookEventName;
}

export interface ExecutableScenarioEnvironment {
  isolation: IsolationMode;
  fixtures?: Record<string, string>;
  env?: Record<string, string>;
}

export interface ExecutableScenarioExecution {
  timeoutMs: number;
  toolName?: string;
  args?: Record<string, unknown>;
  rawInput?: string;
  payload?: Record<string, unknown>;
  simulateCrash?: boolean;
  simulateTimeout?: boolean;
}

export interface ExecutableScenarioAssertion {
  id: string;
  type: AssertionType;
  description: string;
  params?: Record<string, unknown>;
}

export interface ExecutableScenarioExpected {
  decision?: ExpectedDecision;
  semanticClass?: ExpectedSemanticClass;
  failureBehavior?: ExpectedFailureBehavior;
  assertions: ExecutableScenarioAssertion[];
}

export interface ExecutableScenarioSimulation {
  isSimulated: true;
  disclaimer: string;
}

export interface ExecutableScenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  description: string;
  target: ExecutableScenarioTarget;
  environment: ExecutableScenarioEnvironment;
  execution: ExecutableScenarioExecution;
  expected: ExecutableScenarioExpected;
  simulation: ExecutableScenarioSimulation;
}

export interface ExecutableScenarioDocument {
  version: number;
  evaluatorVersion: string;
  status: "defined" | "executing" | "measured";
  description?: string;
  scenarios: ExecutableScenario[];
}

export interface IsolatedWorkspace {
  readonly path: string;
  resolve(relPath: string): string;
  readFile(relPath: string): string;
  writeFile(relPath: string, content: string): void;
  exists(relPath: string): boolean;
  cleanup(): void;
}

export interface AssertionExecutionResult {
  id: string;
  type: AssertionType;
  passed: boolean;
  description: string;
  message?: string;
  actual?: unknown;
  expected?: unknown;
}

export interface ScenarioExecutionResult {
  scenarioId: string;
  scenarioTitle: string;
  category: ScenarioCategory;
  status: "passed" | "failed" | "error" | "skipped";
  durationMs: number;
  decision?: string;
  semanticClass?: string;
  assertions: AssertionExecutionResult[];
  telemetry: {
    eventsEmitted: number;
    records: AuditEvent[];
    normalizedRecords?: NormalizedTelemetryRecord[];
  };
  workspacePath?: string;
  error?: string;
  isSimulated: true;
}

export interface EvaluationTelemetryStats {
  totalEvents: number;
  evaluationSourceVerified: boolean;
  allEvalContextsValid: boolean;
  diagnosticsCount: number;
  quarantinedLinesCount: number;
}

export interface EvaluationRunOptions {
  runId?: string;
  evaluatorVersion?: string;
  scenarioFilter?: (scenario: ExecutableScenario) => boolean;
  categoryFilter?: string[];
  cleanWorkspaces?: boolean;
}

export interface EvaluationRunReport {
  runId: string;
  version: number;
  evaluatorVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalScenarios: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  scenarios: ScenarioExecutionResult[];
  telemetryStats: EvaluationTelemetryStats;
  runtimeMode: "simulation";
  hostDisclaimer: string;
}

export type RegressionStatus = "passed" | "regressed" | "improved" | "incompatible";

export interface ScenarioRegressionDiff {
  scenarioId: string;
  scenarioTitle: string;
  category: ScenarioCategory;
  baselineStatus: "passed" | "failed" | "error" | "skipped" | "missing";
  currentStatus: "passed" | "failed" | "error" | "skipped";
  durationDeltaMs: number;
  durationPercentChange: number;
  failedAssertions: string[];
  reasons: string[];
}

export interface LatencyRegression {
  scenarioId: string;
  scenarioTitle: string;
  baselineDurationMs: number;
  currentDurationMs: number;
  deltaMs: number;
  percentChange: number;
}

export interface RegressionComparisonReport {
  comparedAt: string;
  baselineRunId: string;
  currentRunId: string;
  overallStatus: RegressionStatus;
  hasRegressions: boolean;
  regressionsCount: number;
  improvementsCount: number;
  unchangedPassedCount: number;
  unchangedFailedCount: number;
  newScenariosCount: number;
  missingScenariosCount: number;
  regressions: ScenarioRegressionDiff[];
  improvements: ScenarioRegressionDiff[];
  latencyRegressions: LatencyRegression[];
  newScenarios: string[];
  missingScenarios: string[];
  runtimeMode: "simulation";
  hostDisclaimer: string;
}

export interface RegressionComparatorOptions {
  maxLatencyIncreasePercent?: number;
  maxLatencyIncreaseAbsoluteMs?: number;
  failOnMissingScenarios?: boolean;
}
