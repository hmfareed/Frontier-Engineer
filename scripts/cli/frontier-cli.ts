#!/usr/bin/env node
/**
 * Phase 7.4 — Frontier Engineer Intelligence Query CLI
 * Command-line interface for querying repository architecture intelligence.
 *
 * Exit codes:
 *   0 — Success
 *   1 — Operational failure
 *   2 — Invalid command or arguments
 *   3 — Repository or index unavailable
 *   4 — Target entity not found
 */

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { ConnectionManager } from "../storage/connection-manager.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { MemoryLifecycleEvaluator } from "../memory/memory-lifecycle-evaluator.ts";
import { ArchitectureQueryEngine } from "../query/query-engine.ts";
import { QueryGrammar } from "../query/query-grammar.ts";
import { QueryFormatter } from "../query/query-formatter.ts";
import type { QueryOptions, TraversalQueryOptions } from "../query/types.ts";
import {
  SnapshotComparator,
  SnapshotComparisonError,
  ComparisonSerializer,
  EvolutionAnalyzer,
  EvolutionSerializer,
  type SnapshotComparison,
} from "../evolution/index.ts";
import {
  AGENT_RETRIEVAL_POLICIES,
  RetrievalEngine,
  RetrievalFormatter,
  parseAndValidateHandoffBundle,
  prepareDelegationHandoff,
  validateHandoffAttachment,
  validateHandoffPayload,
  validateRetrievalResponse,
  type AgentId,
} from "../retrieval/index.ts";
import { IndexPipeline, type IndexExecutionReport } from "../indexer/index.ts";
import {
  executeTelemetryCommand,
  type TelemetryGeneration,
  type TelemetrySortField,
  type TelemetrySortOrder,
} from "../telemetry/index.ts";

export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[]): Promise<number> {
  let format: "text" | "json" | "markdown" = "text";
  let workspaceRoot = process.cwd();
  let workspaceProvided = false;
  let limit: number | undefined;
  let depth: number | undefined;
  let scanId: number | undefined;
  let verifyContent = false;
  let persistEvents = false;
  let allowPartialOpt: boolean | undefined;
  let seenAllowPartial = false;
  let seenNoAllowPartial = false;
  let allowStaleOpt = false;
  let applyLifecycle = false;
  let incrementalOpt = false;
  let agentId: AgentId = "frontier-engineer";
  let agentProvided = false;
  let fromAgentOpt: AgentId | undefined;
  let taskIdOpt: string | undefined;
  let taskSummary: string | undefined;
  let inputPathOpt: string | undefined;
  let allowUnindexed = false;
  let maxChars: number | undefined;
  let maxTokens: number | undefined;
  let includeSnippets: boolean | undefined;
  let seenIncludeSnippets = false;
  let seenNoSnippets = false;
  let includeHistorical = false;
  let baseScanIdOpt: number | undefined;
  let targetScanIdOpt: number | undefined;
  const targetFiles: string[] = [];
  const targetSymbols: string[] = [];
  const targetComponents: string[] = [];
  const targetAdrs: string[] = [];

  // Telemetry & Audit options
  let auditDirOpt: string | undefined;
  let includeRotatedOpt = false;
  let maxLinesOpt: number | undefined;
  let aggregateModeOpt = false;
  let diagnosticsModeOpt = false;
  const eventTypeOpt: string[] = [];
  let eventIdOpt: string | undefined;
  const policyDecisionOpt: string[] = [];
  const toolNameOpt: string[] = [];
  const statusOpt: string[] = [];
  const sourceOpt: string[] = [];
  let correlationIdOpt: string | undefined;
  let conversationIdOpt: string | undefined;
  let executionIdOpt: string | undefined;
  let agentIdOpt: string | undefined;
  let skillIdOpt: string | undefined;
  let startTimeOpt: string | undefined;
  let endTimeOpt: string | undefined;
  let exactTimeOpt: string | undefined;
  let textSearchOpt: string | undefined;
  let generationOpt: TelemetryGeneration | undefined;
  let sortByOpt: TelemetrySortField | undefined;
  let sortOrderOpt: TelemetrySortOrder | undefined;
  let pageOpt: number | undefined;
  let pageSizeOpt: number | undefined;

  // Manual argument parsing without external dependencies
  const positional: string[] = [];

  const splitList = (raw: string): string[] =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const parseStrictPositiveInt = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextVal = (flagName: string): string | null => {
      if (i + 1 >= argv.length) {
        outputError(`Missing value for option '${flagName}'.`, 2, format);
        return null;
      }
      return argv[++i];
    };

    if (arg === "--format") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      const val = raw.toLowerCase();
      if (val === "json" || val === "text" || val === "markdown") {
        format = val as "text" | "json" | "markdown";
      } else {
        outputError("Invalid format option: must be 'text', 'json', or 'markdown'.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--format=")) {
      const val = arg.slice("--format=".length).toLowerCase();
      if (val === "json" || val === "text" || val === "markdown") {
        format = val as "text" | "json" | "markdown";
      } else {
        outputError("Invalid format option: must be 'text', 'json', or 'markdown'.", 2, format);
        return 2;
      }
    } else if (arg === "--workspace") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      workspaceRoot = path.resolve(raw);
      workspaceProvided = true;
    } else if (arg.startsWith("--workspace=")) {
      workspaceRoot = path.resolve(arg.slice("--workspace=".length));
      workspaceProvided = true;
    } else if (arg === "--limit") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      limit = parseStrictPositiveInt(raw);
      if (limit === undefined) {
        outputError("Invalid limit option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--limit=")) {
      limit = parseStrictPositiveInt(arg.slice("--limit=".length));
      if (limit === undefined) {
        outputError("Invalid limit option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--max-chars") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      maxChars = parseStrictPositiveInt(raw);
      if (maxChars === undefined) {
        outputError("Invalid max-chars option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--max-chars=")) {
      maxChars = parseStrictPositiveInt(arg.slice("--max-chars=".length));
      if (maxChars === undefined) {
        outputError("Invalid max-chars option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--max-tokens") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      maxTokens = parseStrictPositiveInt(raw);
      if (maxTokens === undefined) {
        outputError("Invalid max-tokens option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--max-tokens=")) {
      maxTokens = parseStrictPositiveInt(arg.slice("--max-tokens=".length));
      if (maxTokens === undefined) {
        outputError("Invalid max-tokens option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--depth") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      depth = parseStrictPositiveInt(raw);
      if (depth === undefined) {
        outputError("Invalid depth option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--depth=")) {
      depth = parseStrictPositiveInt(arg.slice("--depth=".length));
      if (depth === undefined) {
        outputError("Invalid depth option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--scan-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      scanId = parseStrictPositiveInt(raw);
      if (scanId === undefined) {
        outputError("Invalid scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--scan-id=")) {
      scanId = parseStrictPositiveInt(arg.slice("--scan-id=".length));
      if (scanId === undefined) {
        outputError("Invalid scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--base-scan-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      baseScanIdOpt = parseStrictPositiveInt(raw);
      if (baseScanIdOpt === undefined) {
        outputError("Invalid base-scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--base-scan-id=")) {
      baseScanIdOpt = parseStrictPositiveInt(arg.slice("--base-scan-id=".length));
      if (baseScanIdOpt === undefined) {
        outputError("Invalid base-scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--target-scan-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      targetScanIdOpt = parseStrictPositiveInt(raw);
      if (targetScanIdOpt === undefined) {
        outputError("Invalid target-scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--target-scan-id=")) {
      targetScanIdOpt = parseStrictPositiveInt(arg.slice("--target-scan-id=".length));
      if (targetScanIdOpt === undefined) {
        outputError("Invalid target-scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--agent") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      const candidate = raw.trim() as AgentId;
      if (!(candidate in AGENT_RETRIEVAL_POLICIES)) {
        outputError(`Unknown agent ID: '${candidate}'.`, 2, format);
        return 2;
      }
      agentId = candidate;
      agentProvided = true;
    } else if (arg.startsWith("--agent=")) {
      const candidate = arg.slice("--agent=".length).trim() as AgentId;
      if (!(candidate in AGENT_RETRIEVAL_POLICIES)) {
        outputError(`Unknown agent ID: '${candidate}'.`, 2, format);
        return 2;
      }
      agentId = candidate;
      agentProvided = true;
    } else if (arg === "--from") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      const candidate = raw.trim() as AgentId;
      if (!(candidate in AGENT_RETRIEVAL_POLICIES)) {
        outputError(`Unknown source agent ID: '${candidate}'.`, 2, format);
        return 2;
      }
      fromAgentOpt = candidate;
    } else if (arg.startsWith("--from=")) {
      const candidate = arg.slice("--from=".length).trim() as AgentId;
      if (!(candidate in AGENT_RETRIEVAL_POLICIES)) {
        outputError(`Unknown source agent ID: '${candidate}'.`, 2, format);
        return 2;
      }
      fromAgentOpt = candidate;
    } else if (arg === "--task") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      taskSummary = raw;
    } else if (arg.startsWith("--task=")) {
      taskSummary = arg.slice("--task=".length);
    } else if (arg === "--task-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      taskIdOpt = raw;
    } else if (arg.startsWith("--task-id=")) {
      taskIdOpt = arg.slice("--task-id=".length);
    } else if (arg === "--input") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      inputPathOpt = raw;
    } else if (arg.startsWith("--input=")) {
      inputPathOpt = arg.slice("--input=".length);
    } else if (arg === "--file") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      targetFiles.push(...splitList(raw));
    } else if (arg.startsWith("--file=")) {
      targetFiles.push(...splitList(arg.slice("--file=".length)));
    } else if (arg === "--symbol") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      targetSymbols.push(...splitList(raw));
    } else if (arg.startsWith("--symbol=")) {
      targetSymbols.push(...splitList(arg.slice("--symbol=".length)));
    } else if (arg === "--component") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      targetComponents.push(...splitList(raw));
    } else if (arg.startsWith("--component=")) {
      targetComponents.push(...splitList(arg.slice("--component=".length)));
    } else if (arg === "--adr") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      targetAdrs.push(...splitList(raw));
    } else if (arg.startsWith("--adr=")) {
      targetAdrs.push(...splitList(arg.slice("--adr=".length)));
    } else if (arg === "--include-snippets") {
      seenIncludeSnippets = true;
      includeSnippets = true;
    } else if (arg === "--no-snippets") {
      seenNoSnippets = true;
      includeSnippets = false;
    } else if (arg === "--include-historical") {
      includeHistorical = true;
    } else if (arg === "--verify-content") {
      verifyContent = true;
    } else if (arg === "--persist-events") {
      persistEvents = true;
    } else if (arg === "--allow-partial") {
      seenAllowPartial = true;
      allowPartialOpt = true;
    } else if (arg === "--no-allow-partial") {
      seenNoAllowPartial = true;
      allowPartialOpt = false;
    } else if (arg === "--allow-stale") {
      allowStaleOpt = true;
    } else if (arg === "--allow-unindexed") {
      allowUnindexed = true;
    } else if (arg === "--apply-lifecycle") {
      applyLifecycle = true;
    } else if (arg === "--incremental") {
      incrementalOpt = true;
    } else if (arg === "--audit-dir") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      auditDirOpt = raw;
    } else if (arg.startsWith("--audit-dir=")) {
      auditDirOpt = arg.slice("--audit-dir=".length);
    } else if (arg === "--include-rotated") {
      includeRotatedOpt = true;
    } else if (arg === "--max-lines") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      maxLinesOpt = parseStrictPositiveInt(raw);
      if (maxLinesOpt === undefined) {
        outputError("Invalid max-lines option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--max-lines=")) {
      maxLinesOpt = parseStrictPositiveInt(arg.slice("--max-lines=".length));
      if (maxLinesOpt === undefined) {
        outputError("Invalid max-lines option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--aggregate" || arg === "--summary") {
      aggregateModeOpt = true;
    } else if (arg === "--diagnostics" || arg === "--integrity") {
      diagnosticsModeOpt = true;
    } else if (arg === "--event-type") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      eventTypeOpt.push(...splitList(raw));
    } else if (arg.startsWith("--event-type=")) {
      eventTypeOpt.push(...splitList(arg.slice("--event-type=".length)));
    } else if (arg === "--event-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      eventIdOpt = raw.trim();
    } else if (arg.startsWith("--event-id=")) {
      eventIdOpt = arg.slice("--event-id=".length).trim();
    } else if (arg === "--decision" || arg === "--policy-decision") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      policyDecisionOpt.push(...splitList(raw));
    } else if (arg.startsWith("--decision=")) {
      policyDecisionOpt.push(...splitList(arg.slice("--decision=".length)));
    } else if (arg.startsWith("--policy-decision=")) {
      policyDecisionOpt.push(...splitList(arg.slice("--policy-decision=".length)));
    } else if (arg === "--tool" || arg === "--tool-name") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      toolNameOpt.push(...splitList(raw));
    } else if (arg.startsWith("--tool=")) {
      toolNameOpt.push(...splitList(arg.slice("--tool=".length)));
    } else if (arg.startsWith("--tool-name=")) {
      toolNameOpt.push(...splitList(arg.slice("--tool-name=".length)));
    } else if (arg === "--status") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      statusOpt.push(...splitList(raw));
    } else if (arg.startsWith("--status=")) {
      statusOpt.push(...splitList(arg.slice("--status=".length)));
    } else if (arg === "--source") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      sourceOpt.push(...splitList(raw));
    } else if (arg.startsWith("--source=")) {
      sourceOpt.push(...splitList(arg.slice("--source=".length)));
    } else if (arg === "--correlation-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      correlationIdOpt = raw.trim();
    } else if (arg.startsWith("--correlation-id=")) {
      correlationIdOpt = arg.slice("--correlation-id=".length).trim();
    } else if (arg === "--conversation-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      conversationIdOpt = raw.trim();
    } else if (arg.startsWith("--conversation-id=")) {
      conversationIdOpt = arg.slice("--conversation-id=".length).trim();
    } else if (arg === "--execution-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      executionIdOpt = raw.trim();
    } else if (arg.startsWith("--execution-id=")) {
      executionIdOpt = arg.slice("--execution-id=".length).trim();
    } else if (arg === "--agent-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      agentIdOpt = raw.trim();
    } else if (arg.startsWith("--agent-id=")) {
      agentIdOpt = arg.slice("--agent-id=".length).trim();
    } else if (arg === "--skill-id") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      skillIdOpt = raw.trim();
    } else if (arg.startsWith("--skill-id=")) {
      skillIdOpt = arg.slice("--skill-id=".length).trim();
    } else if (arg === "--start-time") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      startTimeOpt = raw.trim();
    } else if (arg.startsWith("--start-time=")) {
      startTimeOpt = arg.slice("--start-time=".length).trim();
    } else if (arg === "--end-time") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      endTimeOpt = raw.trim();
    } else if (arg.startsWith("--end-time=")) {
      endTimeOpt = arg.slice("--end-time=".length).trim();
    } else if (arg === "--exact-time") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      exactTimeOpt = raw.trim();
    } else if (arg.startsWith("--exact-time=")) {
      exactTimeOpt = arg.slice("--exact-time=".length).trim();
    } else if (arg === "--text" || arg === "--text-search") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      textSearchOpt = raw;
    } else if (arg.startsWith("--text=")) {
      textSearchOpt = arg.slice("--text=".length);
    } else if (arg.startsWith("--text-search=")) {
      textSearchOpt = arg.slice("--text-search=".length);
    } else if (arg === "--generation") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      generationOpt = raw.trim() as any;
    } else if (arg.startsWith("--generation=")) {
      generationOpt = arg.slice("--generation=".length).trim() as any;
    } else if (arg === "--sort-by") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      sortByOpt = raw.trim() as any;
    } else if (arg.startsWith("--sort-by=")) {
      sortByOpt = arg.slice("--sort-by=".length).trim() as any;
    } else if (arg === "--sort-order") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      sortOrderOpt = raw.trim().toLowerCase() as any;
    } else if (arg.startsWith("--sort-order=")) {
      sortOrderOpt = arg.slice("--sort-order=".length).trim().toLowerCase() as any;
    } else if (arg === "--page") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      pageOpt = parseStrictPositiveInt(raw);
      if (pageOpt === undefined) {
        outputError("Invalid --page option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--page=")) {
      pageOpt = parseStrictPositiveInt(arg.slice("--page=".length));
      if (pageOpt === undefined) {
        outputError("Invalid --page option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--page-size") {
      const raw = nextVal(arg);
      if (raw === null) return 2;
      pageSizeOpt = parseStrictPositiveInt(raw);
      if (pageSizeOpt === undefined) {
        outputError(
          "Invalid --page-size option: must be a positive integer between 1 and 1000.",
          2,
          format,
        );
        return 2;
      }
    } else if (arg.startsWith("--page-size=")) {
      pageSizeOpt = parseStrictPositiveInt(arg.slice("--page-size=".length));
      if (pageSizeOpt === undefined) {
        outputError(
          "Invalid --page-size option: must be a positive integer between 1 and 1000.",
          2,
          format,
        );
        return 2;
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return 0;
    } else if (arg.startsWith("-")) {
      outputError(`Unknown option: ${arg}`, 2, format);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  if (seenIncludeSnippets && seenNoSnippets) {
    outputError(
      "Conflicting options: cannot specify both --include-snippets and --no-snippets.",
      2,
      format,
    );
    return 2;
  }

  if (seenAllowPartial && seenNoAllowPartial) {
    outputError(
      "Conflicting options: cannot specify both --allow-partial and --no-allow-partial.",
      2,
      format,
    );
    return 2;
  }

  // Handle command prefix: 'frontier intelligence <subcommand>' or 'intelligence <subcommand>' or '<subcommand>'
  if (positional[0] === "frontier") {
    positional.shift();
  }
  if (positional[0] === "intelligence") {
    positional.shift();
  }

  const subcommand = positional[0]?.toLowerCase();
  const target = positional.slice(1).join(" ").trim() || undefined;

  if (!subcommand) {
    printHelp();
    return 2;
  }

  const KNOWN_COMMANDS = new Set([
    "scan",
    "refresh",
    "status",
    "overview",
    "components",
    "component",
    "entrypoints",
    "dependencies",
    "deps",
    "dependents",
    "cycles",
    "file",
    "symbol",
    "tests",
    "decisions",
    "decision",
    "freshness",
    "query",
    "compare",
    "evolution",
    "drift",
    "debt",
    "memories",
    "memory",
    "retrieve",
    "prepare-handoff",
    "validate-handoff",
    "telemetry",
    "audit",
  ]);

  if (!KNOWN_COMMANDS.has(subcommand)) {
    outputError(
      `Unknown subcommand: "${subcommand}". Use --help for available intelligence commands.`,
      2,
      format,
    );
    return 2;
  }

  const isTelemetryCommand = subcommand === "telemetry" || subcommand === "audit";

  if (!isTelemetryCommand && format === "markdown") {
    outputError("Invalid format option: must be 'text' or 'json'.", 2, "text");
    return 2;
  }

  const hasTelemetryFlags =
    auditDirOpt !== undefined ||
    includeRotatedOpt ||
    maxLinesOpt !== undefined ||
    aggregateModeOpt ||
    diagnosticsModeOpt ||
    eventTypeOpt.length > 0 ||
    eventIdOpt !== undefined ||
    policyDecisionOpt.length > 0 ||
    toolNameOpt.length > 0 ||
    statusOpt.length > 0 ||
    sourceOpt.length > 0 ||
    correlationIdOpt !== undefined ||
    conversationIdOpt !== undefined ||
    executionIdOpt !== undefined ||
    agentIdOpt !== undefined ||
    skillIdOpt !== undefined ||
    startTimeOpt !== undefined ||
    endTimeOpt !== undefined ||
    exactTimeOpt !== undefined ||
    textSearchOpt !== undefined ||
    generationOpt !== undefined ||
    sortByOpt !== undefined ||
    sortOrderOpt !== undefined ||
    pageOpt !== undefined ||
    pageSizeOpt !== undefined;

  if (!isTelemetryCommand && hasTelemetryFlags) {
    outputError(
      `Telemetry options are only supported for 'telemetry' and 'audit' subcommands (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (isTelemetryCommand) {
    if (
      depth !== undefined ||
      scanId !== undefined ||
      baseScanIdOpt !== undefined ||
      targetScanIdOpt !== undefined ||
      agentProvided ||
      fromAgentOpt !== undefined ||
      taskSummary !== undefined ||
      taskIdOpt !== undefined ||
      inputPathOpt !== undefined ||
      targetFiles.length > 0 ||
      targetSymbols.length > 0 ||
      targetComponents.length > 0 ||
      targetAdrs.length > 0 ||
      includeSnippets !== undefined ||
      includeHistorical ||
      verifyContent ||
      persistEvents ||
      seenAllowPartial ||
      seenNoAllowPartial ||
      allowStaleOpt ||
      allowUnindexed ||
      applyLifecycle ||
      incrementalOpt
    ) {
      outputError(
        `Intelligence options are not supported for telemetry/audit commands.`,
        2,
        format,
      );
      return 2;
    }

    // Handle telemetry sub-actions: list, summary/aggregate, verify/diagnostics/integrity, show <id>
    const action = positional[1]?.toLowerCase();
    if (action) {
      if (action === "list" || action === "query") {
        // default query mode
      } else if (action === "summary" || action === "aggregate") {
        aggregateModeOpt = true;
      } else if (action === "verify" || action === "diagnostics" || action === "integrity") {
        diagnosticsModeOpt = true;
      } else if (action === "show") {
        const id = positional[2]?.trim();
        if (!id) {
          outputError(
            "Missing required event ID for 'show' action: telemetry show <event_id>",
            2,
            format,
          );
          return 2;
        }
        eventIdOpt = id;
      } else {
        outputError(
          `Unknown telemetry action: "${action}". Supported actions: list, summary, verify, show <id>.`,
          2,
          format,
        );
        return 2;
      }
    }

    const result = await executeTelemetryCommand({
      workspaceRoot,
      auditDir: auditDirOpt,
      format,
      includeRotated: includeRotatedOpt,
      maxLines: maxLinesOpt,
      aggregateMode: aggregateModeOpt,
      diagnosticsMode: diagnosticsModeOpt,
      eventType: eventTypeOpt.length > 0 ? eventTypeOpt : undefined,
      eventId: eventIdOpt,
      policyDecision: policyDecisionOpt.length > 0 ? policyDecisionOpt : undefined,
      toolName: toolNameOpt.length > 0 ? toolNameOpt : undefined,
      status: statusOpt.length > 0 ? statusOpt : undefined,
      source: sourceOpt.length > 0 ? sourceOpt : undefined,
      correlationId: correlationIdOpt,
      conversationId: conversationIdOpt,
      executionId: executionIdOpt,
      agentId: agentIdOpt,
      skillId: skillIdOpt,
      startTime: startTimeOpt,
      endTime: endTimeOpt,
      exactTime: exactTimeOpt,
      textSearch: textSearchOpt,
      generation: generationOpt,
      sortBy: sortByOpt,
      sortOrder: sortOrderOpt,
      page: pageOpt,
      pageSize: pageSizeOpt ?? limit,
    });

    if (result.exitCode === 0) {
      process.stdout.write(result.output.endsWith("\n") ? result.output : result.output + "\n");
      return 0;
    } else {
      outputError(result.error ?? "Telemetry command failed.", result.exitCode, format);
      return result.exitCode;
    }
  }

  if (
    subcommand === "compare" ||
    subcommand === "evolution" ||
    subcommand === "drift" ||
    subcommand === "debt"
  ) {
    if (positional.length < 3) {
      outputError(
        `Missing required arguments: ${subcommand} <base_scan_id> <target_scan_id>`,
        2,
        format,
      );
      return 2;
    }
  }

  const REQUIRES_TARGET: Record<string, string> = {
    component: "<component_name>",
    dependencies: "<target_file_or_component>",
    deps: "<target_file_or_component>",
    dependents: "<target_file_or_component>",
    file: "<file_path>",
    symbol: "<symbol_name>",
    decision: "<decision_id>",
    query: "<query_expression>",
    memory: "<memory_key_or_id>",
  };

  if (REQUIRES_TARGET[subcommand] && !target) {
    outputError(`Missing required argument: ${REQUIRES_TARGET[subcommand]}`, 2, format);
    return 2;
  }

  // ISSUE-CLI-02: Enforce flag compatibility with selected subcommand
  if (
    persistEvents &&
    subcommand !== "compare" &&
    subcommand !== "evolution" &&
    subcommand !== "scan" &&
    subcommand !== "refresh"
  ) {
    outputError(
      `--persist-events is only supported for 'compare' and 'evolution' subcommands (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (incrementalOpt && subcommand !== "scan" && subcommand !== "refresh") {
    outputError(
      `--incremental is only supported for 'scan' and 'refresh' subcommands (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (applyLifecycle) {
    if (
      subcommand !== "evolution" &&
      subcommand !== "memories" &&
      subcommand !== "scan" &&
      subcommand !== "refresh"
    ) {
      outputError(
        `--apply-lifecycle is only supported for 'evolution' and 'memories --scan-id <id>' subcommands (got '${subcommand}').`,
        2,
        format,
      );
      return 2;
    }
    if (subcommand === "memories" && scanId === undefined) {
      outputError(
        `--apply-lifecycle on 'memories' requires an explicit --scan-id <id>.`,
        2,
        format,
      );
      return 2;
    }
  }

  const isRetrievalCommand = subcommand === "retrieve" || subcommand === "prepare-handoff";

  if (isRetrievalCommand) {
    if ((baseScanIdOpt !== undefined) !== (targetScanIdOpt !== undefined)) {
      outputError("Both --base-scan-id and --target-scan-id must be provided together.", 2, format);
      return 2;
    }
    if (scanId !== undefined && (baseScanIdOpt !== undefined || targetScanIdOpt !== undefined)) {
      outputError(
        "Conflicting options: --scan-id cannot be combined with --base-scan-id/--target-scan-id.",
        2,
        format,
      );
      return 2;
    }
    if (taskSummary !== undefined && target !== undefined) {
      outputError(
        "Conflicting inputs: pass the task summary via --task or positional arguments, not both.",
        2,
        format,
      );
      return 2;
    }
    const resolvedTask = (taskSummary ?? target ?? "").trim();
    if (!resolvedTask) {
      outputError(
        `Missing required task summary for ${subcommand}: pass --task "<summary>" or positional text.`,
        2,
        format,
      );
      return 2;
    }
  }

  // Validate retrieval-only flags against unrelated subcommands
  if (
    !isRetrievalCommand &&
    (agentProvided ||
      taskSummary !== undefined ||
      targetFiles.length > 0 ||
      targetSymbols.length > 0 ||
      targetComponents.length > 0 ||
      targetAdrs.length > 0 ||
      maxChars !== undefined ||
      maxTokens !== undefined ||
      includeSnippets !== undefined ||
      includeHistorical ||
      baseScanIdOpt !== undefined ||
      targetScanIdOpt !== undefined)
  ) {
    outputError(
      `Retrieval options (--agent, --task, --file, --symbol, --component, --adr, --max-chars, --max-tokens, --include-snippets, --include-historical, --base-scan-id, --target-scan-id) are only supported for 'retrieve' and 'prepare-handoff' (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (
    subcommand !== "prepare-handoff" &&
    (taskIdOpt !== undefined || fromAgentOpt !== undefined || allowUnindexed)
  ) {
    outputError(
      `Options --task-id, --from, and --allow-unindexed are only supported for 'prepare-handoff' (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (subcommand !== "validate-handoff" && inputPathOpt !== undefined) {
    outputError(
      `Option --input is only supported for 'validate-handoff' (got '${subcommand}').`,
      2,
      format,
    );
    return 2;
  }

  if (subcommand === "validate-handoff") {
    if (inputPathOpt !== undefined && target !== undefined) {
      outputError(
        "Conflicting inputs: pass handoff input path either via --input or as positional argument, not both.",
        2,
        format,
      );
      return 2;
    }
    const inputSource = inputPathOpt ?? target;
    if (!inputSource) {
      outputError(
        "Missing required input for validate-handoff: pass --input <path> (or '-') or positional file path.",
        2,
        format,
      );
      return 2;
    }

    let rawContent: string;
    if (inputSource === "-") {
      rawContent = fs.readFileSync(0, "utf8");
    } else {
      const resolvedInput = path.resolve(inputSource);
      if (!fs.existsSync(resolvedInput)) {
        outputError(`Handoff input file not found: ${resolvedInput}`, 4, format);
        return 4;
      }
      rawContent = fs.readFileSync(resolvedInput, "utf8");
    }

    let valid = false;
    let contract: string = "unknown";
    let mode: "INDEXED" | "DEGRADED_UNINDEXED" | "INVALID" | undefined;
    let attachmentValid = true;
    let untrustedWarningPresent = true;
    let errors: string[] = [];

    const consumerOptions = {
      workspaceRoot: workspaceProvided ? workspaceRoot : undefined,
      allowPartialSnapshot: allowPartialOpt === true,
      allowStaleSnapshot: allowStaleOpt,
    };

    if (
      rawContent.includes("<<<FRONTIER_HANDOFF_JSON>>>") ||
      rawContent.includes("<<<END_FRONTIER_HANDOFF_JSON>>>")
    ) {
      const bundle = parseAndValidateHandoffBundle(rawContent, consumerOptions);
      valid = bundle.valid;
      contract = bundle.handoff?.contract ?? "frontier-engineer/handoff";
      mode = bundle.mode;
      attachmentValid = bundle.retrievalAttachmentValid;
      untrustedWarningPresent = bundle.untrustedWarningPresent;
      errors = bundle.errors;
    } else {
      try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.contract === "frontier-engineer/retrieval"
        ) {
          const check = validateRetrievalResponse(parsed);
          valid = check.valid;
          contract = "frontier-engineer/retrieval";
          errors = check.errors;
        } else {
          const check = validateHandoffPayload(parsed);
          contract =
            parsed && typeof parsed === "object" && typeof parsed.contract === "string"
              ? parsed.contract
              : "frontier-engineer/handoff";
          errors = [...check.errors];
          if (parsed && typeof parsed === "object" && parsed.retrievalContext !== undefined) {
            const att = validateHandoffAttachment(parsed.retrievalContext);
            attachmentValid = att.valid;
            errors.push(...att.errors);
          }
          // Apply full semantic consumer checks (stripped retrievalContext, partial/stale, workspace identity)
          const syntheticBundle = `<<<FRONTIER_HANDOFF_JSON>>>\n${rawContent}\n<<<END_FRONTIER_HANDOFF_JSON>>>`;
          const bundle = parseAndValidateHandoffBundle(syntheticBundle, consumerOptions);
          mode = bundle.mode;
          if (!bundle.retrievalAttachmentValid) {
            attachmentValid = false;
          }
          for (const err of bundle.errors) {
            if (!errors.includes(err)) {
              errors.push(err);
            }
          }
          untrustedWarningPresent = false;
          valid = errors.length === 0;
        }
      } catch (err: any) {
        valid = false;
        mode = "INVALID";
        errors = [`Invalid JSON input: ${err?.message ?? String(err)}`];
      }
    }

    const report: Record<string, unknown> = {
      valid,
      contract,
      ...(mode !== undefined ? { mode } : {}),
      attachmentValid,
      untrustedWarningPresent,
      errors,
    };

    if (format === "json") {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else if (valid) {
      process.stdout.write(`VALID handoff/retrieval payload (${contract}).\n`);
    } else {
      process.stdout.write(
        `INVALID handoff/retrieval payload (${contract}):\n  - ${errors.join("\n  - ")}\n`,
      );
    }
    return valid ? 0 : 2;
  }

  // Validate workspace availability
  if (!fs.existsSync(workspaceRoot)) {
    outputError(`Workspace root does not exist: ${workspaceRoot}`, 3, format);
    return 3;
  }

  if (subcommand === "scan" || subcommand === "refresh") {
    try {
      const report = await IndexPipeline.run({
        workspaceRoot,
        incremental: subcommand === "refresh" || incrementalOpt,
        allowPartialPromotion: allowPartialOpt === true,
        applyLifecycle,
        persistEvents,
      });

      if (format === "json") {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(formatTerminalIndexReport(report) + "\n");
      }

      if (
        report.status === "COMPLETE" ||
        (report.status === "PARTIAL" && allowPartialOpt === true)
      ) {
        return 0;
      }
      if (report.status === "PARTIAL" && !report.promoted) {
        return 3;
      }
      return 1;
    } catch (err: any) {
      outputError(err?.message || String(err), 1, format);
      return 1;
    }
  }

  if (subcommand === "prepare-handoff") {
    const resolvedTask = (taskSummary ?? target ?? "").trim();
    try {
      const prepared = await prepareDelegationHandoff({
        workspaceRoot,
        targetAgent: agentId,
        fromAgent: fromAgentOpt,
        taskId: taskIdOpt ?? "FE-HANDOFF-001",
        taskSummary: resolvedTask,
        relevantFiles: targetFiles.length > 0 ? targetFiles : undefined,
        targetSymbols: targetSymbols.length > 0 ? targetSymbols : undefined,
        targetComponents: targetComponents.length > 0 ? targetComponents : undefined,
        targetAdrs: targetAdrs.length > 0 ? targetAdrs : undefined,
        scanId,
        baseScanId: baseScanIdOpt,
        targetScanId: targetScanIdOpt,
        verifyContentHashes: verifyContent,
        includeSnippets,
        includeHistoricalMemories: includeHistorical,
        allowPartialSnapshot: allowPartialOpt,
        allowUnindexedFallback: allowUnindexed,
        limits: {
          ...(limit !== undefined ? { maxItems: limit } : {}),
          ...(maxChars !== undefined ? { maxTotalChars: maxChars } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(depth !== undefined ? { maxDepth: depth } : {}),
        },
      });

      if (prepared.status === "INDEX_UNAVAILABLE") {
        outputError(prepared.eligibility.reason, 3, format);
        return 3;
      }

      if (prepared.status === "BLOCKED_SENSITIVE_TARGET") {
        outputError(
          prepared.eligibility.reason ||
            prepared.limitations.join("; ") ||
            "Sensitive target blocked.",
          2,
          format,
        );
        return 2;
      }

      if (
        prepared.status === "VALIDATION_FAILED" ||
        prepared.schemaValidation.errors.length > 0 ||
        !prepared.handoff ||
        !prepared.promptSection
      ) {
        const details =
          prepared.schemaValidation.errors.length > 0
            ? prepared.schemaValidation.errors
            : [...prepared.limitations, ...prepared.warnings.map((w) => w.message)];
        outputError(
          `Prepared handoff failed validation (${prepared.status}): ${details.join("; ") || "no detailed error reported"}`,
          1,
          format,
        );
        return 1;
      }

      if (format === "json") {
        process.stdout.write(JSON.stringify(prepared, null, 2) + "\n");
      } else {
        process.stdout.write(prepared.promptSection + "\n");
      }
      return 0;
    } catch (err: any) {
      if (
        err instanceof SnapshotComparisonError &&
        (err.code === "ERR_SCAN_NOT_FOUND" ||
          err.code === "ERR_BASE_SNAPSHOT_NOT_FOUND" ||
          err.code === "ERR_TARGET_SNAPSHOT_NOT_FOUND" ||
          err.code === "ERR_SNAPSHOT_NOT_FOUND")
      ) {
        outputError(err.message, 4, format);
        return 4;
      }
      if (
        err instanceof SnapshotComparisonError &&
        (err.code === "ERR_SCAN_INCOMPLETE" ||
          err.code === "ERR_SCAN_FAILED" ||
          err.code === "ERR_PARTIAL_SCAN_NOT_ALLOWED" ||
          err.code === "ERR_SCAN_INVALID_STATUS")
      ) {
        outputError(err.message, 3, format);
        return 3;
      }
      const msg = err?.message || String(err);
      if (
        msg.includes("not found") ||
        msg.includes("No matching") ||
        msg.includes("was not found")
      ) {
        outputError(msg, 4, format);
        return 4;
      }
      if (
        msg.includes("No active scan") ||
        msg.includes("VALIDATING") ||
        msg.includes("allowPartialSnapshot is false") ||
        msg.includes("allowPartial is false") ||
        msg.includes("Repository index is unavailable") ||
        msg.includes("ERR_PARTIAL_SCAN_NOT_ALLOWED") ||
        msg.includes("ERR_SCAN_INCOMPLETE") ||
        msg.includes("ERR_SCAN_FAILED") ||
        msg.includes("ERR_SCAN_INVALID_STATUS") ||
        msg.includes("PARTIAL_DISALLOWED") ||
        msg.includes("SCAN_NOT_READY") ||
        msg.includes("has status PARTIAL") ||
        msg.includes("has status FAILED")
      ) {
        outputError(msg, 3, format);
        return 3;
      }
      outputError(msg, 1, format);
      return 1;
    }
  }

  if (subcommand === "retrieve") {
    const dbPath = path.join(workspaceRoot, ".frontier", "intelligence", "index.sqlite");
    if (!fs.existsSync(dbPath)) {
      outputError(
        `Repository index is unavailable: no index database found at '${dbPath}'. Run repository scan first.`,
        3,
        format,
      );
      return 3;
    }
  }

  let connectionManager: ConnectionManager | null = null;
  try {
    connectionManager = new ConnectionManager({ workspaceRoot });
    await connectionManager.initialize();

    const repo = connectionManager.getRepository();
    if (
      !repo.activeScanId &&
      scanId === undefined &&
      subcommand !== "status" &&
      subcommand !== "freshness" &&
      subcommand !== "compare" &&
      subcommand !== "evolution" &&
      subcommand !== "drift" &&
      subcommand !== "debt" &&
      subcommand !== "memories" &&
      subcommand !== "memory"
    ) {
      outputError(
        `Repository index is unavailable: no active scan exists for '${repo.identity}'. Run repository scan to generate an index.`,
        3,
        format,
      );
      return 3;
    }

    const engine = new ArchitectureQueryEngine(connectionManager);
    const queryOpts: QueryOptions = { limit, scanId, allowPartial: allowPartialOpt === true };
    const traversalOpts: TraversalQueryOptions = {
      limit,
      depth,
      scanId,
      allowPartial: allowPartialOpt === true,
    };

    let result: any;

    switch (subcommand) {
      case "status":
        result = await engine.getStatus();
        break;

      case "overview":
        result = await engine.getOverview(queryOpts);
        break;

      case "components":
        result = await engine.listComponents(queryOpts);
        break;

      case "component":
        if (!target) {
          outputError("Missing required argument: <component_name>", 2, format);
          return 2;
        }
        result = await engine.getComponent(target, queryOpts);
        break;

      case "entrypoints":
        result = await engine.getEntrypoints(queryOpts);
        break;

      case "dependencies":
      case "deps":
        if (!target) {
          outputError("Missing required argument: <target_file_or_component>", 2, format);
          return 2;
        }
        result = await engine.getDependencies(target, traversalOpts);
        break;

      case "dependents":
        if (!target) {
          outputError("Missing required argument: <target_file_or_component>", 2, format);
          return 2;
        }
        result = await engine.getDependents(target, traversalOpts);
        break;

      case "cycles":
        result = await engine.getCycles(queryOpts);
        break;

      case "file":
        if (!target) {
          outputError("Missing required argument: <file_path>", 2, format);
          return 2;
        }
        result = await engine.getFile(target, queryOpts);
        break;

      case "symbol":
        if (!target) {
          outputError("Missing required argument: <symbol_name>", 2, format);
          return 2;
        }
        result = await engine.getSymbol(target, queryOpts);
        break;

      case "tests":
        result = await engine.getTests(target, queryOpts);
        break;

      case "decisions":
        result = await engine.getDecisions(queryOpts);
        break;

      case "decision":
        if (!target) {
          outputError("Missing required argument: <decision_id>", 2, format);
          return 2;
        }
        result = await engine.getDecision(target, queryOpts);
        break;

      case "freshness":
        result = await engine.getFreshness({
          ...queryOpts,
          verifyContentHashes: verifyContent,
        });
        break;

      case "query":
        if (!target) {
          outputError("Missing required argument: <query_expression>", 2, format);
          return 2;
        }
        result = await QueryGrammar.execute(engine, target, queryOpts);
        break;

      case "compare": {
        const baseScanId = /^\d+$/.test(positional[1].trim()) ? Number(positional[1].trim()) : NaN;
        const targetScanId = /^\d+$/.test(positional[2].trim())
          ? Number(positional[2].trim())
          : NaN;
        if (
          !Number.isSafeInteger(baseScanId) ||
          baseScanId < 1 ||
          !Number.isSafeInteger(targetScanId) ||
          targetScanId < 1
        ) {
          outputError(
            "Invalid scan ID: base_scan_id and target_scan_id must be positive integers.",
            2,
            format,
          );
          return 2;
        }
        const comparator = new SnapshotComparator(connectionManager.getDatabase());
        const comparison = comparator.compare(baseScanId, targetScanId, {
          persistEvents,
          allowPartial: allowPartialOpt === true,
          workspaceRoot,
          expectedRepositoryId: repo.id,
        });

        if (format === "json") {
          process.stdout.write(ComparisonSerializer.serialize(comparison, true) + "\n");
        } else {
          process.stdout.write(formatTerminalComparison(comparison) + "\n");
        }
        return 0;
      }

      case "evolution":
      case "drift":
      case "debt": {
        const baseScanId = /^\d+$/.test(positional[1].trim()) ? Number(positional[1].trim()) : NaN;
        const targetScanId = /^\d+$/.test(positional[2].trim())
          ? Number(positional[2].trim())
          : NaN;
        if (
          !Number.isSafeInteger(baseScanId) ||
          baseScanId < 1 ||
          !Number.isSafeInteger(targetScanId) ||
          targetScanId < 1
        ) {
          outputError(
            "Invalid scan ID: base_scan_id and target_scan_id must be positive integers.",
            2,
            format,
          );
          return 2;
        }
        const analyzer = new EvolutionAnalyzer(connectionManager.getDatabase());
        const analysis = analyzer.analyze(baseScanId, targetScanId, {
          persistEvents,
          applyLifecycle,
          allowPartial: allowPartialOpt === true,
          workspaceRoot,
          maxRecordsPerDomain: limit,
          expectedRepositoryId: repo.id,
        });

        if (subcommand === "evolution") {
          if (format === "json") {
            process.stdout.write(EvolutionSerializer.serialize(analysis, true) + "\n");
          } else {
            process.stdout.write(EvolutionSerializer.formatTerminal(analysis) + "\n");
          }
          return 0;
        }

        if (subcommand === "drift") {
          const payload = {
            analysisId: analysis.analysisId,
            repositoryId: analysis.repositoryId,
            repositoryIdentity: analysis.repositoryIdentity,
            baseSnapshot: analysis.baseSnapshot,
            targetSnapshot: analysis.targetSnapshot,
            status: analysis.status,
            drift: analysis.drift,
            decisions: analysis.decisions,
          };
          if (format === "json") {
            process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          } else {
            process.stdout.write(formatTerminalDrift(payload) + "\n");
          }
          return 0;
        }

        const debtPayload = {
          analysisId: analysis.analysisId,
          repositoryId: analysis.repositoryId,
          repositoryIdentity: analysis.repositoryIdentity,
          baseSnapshot: analysis.baseSnapshot,
          targetSnapshot: analysis.targetSnapshot,
          status: analysis.status,
          debt: analysis.debt,
        };
        if (format === "json") {
          process.stdout.write(JSON.stringify(debtPayload, null, 2) + "\n");
        } else {
          process.stdout.write(formatTerminalDebt(debtPayload) + "\n");
        }
        return 0;
      }

      case "memories": {
        const db = connectionManager.getDatabase();
        const memStore = new MemoryStore(db);
        const allMemories = memStore.listMemories(repo.id);
        const memories = limit !== undefined ? allMemories.slice(0, limit) : allMemories;
        const lifecycleEvaluation =
          scanId !== undefined
            ? MemoryLifecycleEvaluator.evaluateRepository(db, repo.id, scanId, undefined, {
                applyLifecycle,
                allowPartial: allowPartialOpt === true,
                workspaceRoot,
              })
            : null;
        const payload = {
          repositoryId: repo.id,
          repositoryIdentity: repo.identity,
          totalCount: allMemories.length,
          memories,
          lifecycleEvaluation,
        };
        if (format === "json") {
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        } else {
          process.stdout.write(formatTerminalMemories(payload) + "\n");
        }
        return 0;
      }

      case "memory": {
        if (!target) {
          outputError("Missing required argument: <memory_key_or_id>", 2, format);
          return 2;
        }
        const db = connectionManager.getDatabase();
        const memStore = new MemoryStore(db);
        const memory = /^\d+$/.test(target)
          ? memStore.getMemory(repo.id, parseInt(target, 10))
          : memStore.getMemoryByKey(repo.id, target);
        if (!memory) {
          outputError(
            `Engineering memory '${target}' not found in repository ${repo.id}.`,
            4,
            format,
          );
          return 4;
        }
        const versions = memStore.getMemoryVersions(repo.id, memory.id);
        const evidence = memStore.getMemoryEvidence(repo.id, memory.id);
        const relationships = memStore.getRelationships(repo.id, memory.id);
        const payload = {
          repositoryId: repo.id,
          repositoryIdentity: repo.identity,
          memory,
          versions,
          evidence,
          relationships,
        };
        if (format === "json") {
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        } else {
          process.stdout.write(formatTerminalMemoryDetail(payload) + "\n");
        }
        return 0;
      }

      case "retrieve": {
        const resolvedTask = (taskSummary ?? target ?? "").trim();
        const retrievalEngine = new RetrievalEngine(connectionManager);
        const retrieval = await retrievalEngine.retrieve({
          agentId,
          taskSummary: resolvedTask,
          targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
          targetSymbols: targetSymbols.length > 0 ? targetSymbols : undefined,
          targetComponents: targetComponents.length > 0 ? targetComponents : undefined,
          targetAdrs: targetAdrs.length > 0 ? targetAdrs : undefined,
          scanId,
          baseScanId: baseScanIdOpt,
          targetScanId: targetScanIdOpt,
          verifyContentHashes: verifyContent,
          includeSnippets,
          includeHistoricalMemories: includeHistorical,
          allowPartialSnapshot: allowPartialOpt,
          limits: {
            ...(limit !== undefined ? { maxItems: limit } : {}),
            ...(maxChars !== undefined ? { maxTotalChars: maxChars } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(depth !== undefined ? { maxDepth: depth } : {}),
          },
        });
        if (format === "json") {
          process.stdout.write(RetrievalFormatter.formatJson(retrieval, true) + "\n");
        } else {
          process.stdout.write(RetrievalFormatter.formatTerminal(retrieval) + "\n");
        }
        return 0;
      }

      default:
        outputError(
          `Unknown subcommand: "${subcommand}". Use --help for available intelligence commands.`,
          2,
          format,
        );
        return 2;
    }

    // Output formatted result
    if (format === "json") {
      process.stdout.write(QueryFormatter.formatJson(result) + "\n");
    } else {
      process.stdout.write(QueryFormatter.formatTerminal(result) + "\n");
    }

    return 0;
  } catch (err: any) {
    if (err instanceof SnapshotComparisonError) {
      if (
        err.code === "ERR_BASE_SNAPSHOT_NOT_FOUND" ||
        err.code === "ERR_TARGET_SNAPSHOT_NOT_FOUND" ||
        err.code === "ERR_SNAPSHOT_NOT_FOUND" ||
        err.code === "ERR_SCAN_NOT_FOUND"
      ) {
        outputError(err.message, 4, format);
        return 4;
      }
      if (
        err.code === "ERR_SCAN_INCOMPLETE" ||
        err.code === "ERR_SCAN_FAILED" ||
        err.code === "ERR_PARTIAL_SCAN_NOT_ALLOWED" ||
        err.code === "ERR_SCAN_INVALID_STATUS"
      ) {
        outputError(err.message, 3, format);
        return 3;
      }
      outputError(err.message, 2, format);
      return 2;
    }

    const message = err?.message || String(err);

    // Differentiate "not found" (exit code 4) vs operational failure (exit code 1) vs syntax (2)
    if (
      message.includes("not found") ||
      message.includes("No matching") ||
      message.includes("was not found")
    ) {
      outputError(message, 4, format);
      return 4;
    }

    if (message.includes("Unsupported query pattern") || message.includes("cannot be empty")) {
      outputError(message, 2, format);
      return 2;
    }

    if (
      message.includes("No active scan") ||
      message.includes("Corrupt database") ||
      message.includes("Repository index is unavailable") ||
      message.includes("VALIDATING") ||
      message.includes("allowPartialSnapshot is false") ||
      message.includes("allowPartial is false") ||
      message.includes("ERR_PARTIAL_SCAN_NOT_ALLOWED") ||
      message.includes("ERR_SCAN_INCOMPLETE") ||
      message.includes("ERR_SCAN_FAILED") ||
      message.includes("ERR_SCAN_INVALID_STATUS")
    ) {
      outputError(message, 3, format);
      return 3;
    }

    outputError(message, 1, format);
    return 1;
  } finally {
    if (connectionManager) {
      connectionManager.close();
    }
  }
}

function outputError(
  message: string,
  exitCode: number,
  format: "text" | "json" | "markdown",
): void {
  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          error: message,
          exitCode,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stderr.write(`Error (${exitCode}): ${message}\n`);
  }
}

function formatTerminalComparison(c: SnapshotComparison): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`Frontier Engineer — Snapshot Comparison: ${c.comparisonId}`);
  lines.push(`Repository: ${c.repositoryIdentity} (ID: ${c.repositoryId}) | Status: ${c.status}`);
  lines.push(`Base Snapshot:   ID ${c.baseSnapshot.scanId} (started: ${c.baseSnapshot.startedAt})`);
  lines.push(
    `Target Snapshot: ID ${c.targetSnapshot.scanId} (started: ${c.targetSnapshot.startedAt})`,
  );
  lines.push(`Compared At:     ${c.comparedAt}`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`Summary:`);
  lines.push(
    `  Files:        +${c.summary.files.added} added, ~${c.summary.files.modified} modified, -${c.summary.files.deleted} deleted, =${c.summary.files.unchanged} unchanged (renamed: ${c.summary.files.renamed})`,
  );
  lines.push(
    `  Symbols:      +${c.summary.symbols.added} added, -${c.summary.symbols.removed} removed, ~${c.summary.symbols.modified} modified, ->${c.summary.symbols.relocated} relocated, =${c.summary.symbols.unchanged} unchanged`,
  );
  lines.push(
    `  Dependencies: +${c.summary.dependencies.added} added, -${c.summary.dependencies.removed} removed, ~${c.summary.dependencies.modified} modified, ?${c.summary.dependencies.unresolved} unresolved`,
  );
  lines.push(
    `  Components:   +${c.summary.components.added} added, -${c.summary.components.removed} removed, ~${c.summary.components.modified} modified, =${c.summary.components.unchanged} unchanged`,
  );
  lines.push(
    `  ADRs:         +${c.summary.adrs.added} added, -${c.summary.adrs.removed} removed, ~${c.summary.adrs.modified} modified, =${c.summary.adrs.unchanged} unchanged`,
  );
  lines.push(`  Evidence:     ${c.evidence.length} verifiable records`);
  if (c.limitations.length > 0) {
    lines.push(`  Limitations:  ${c.limitations.length} items`);
    for (const lim of c.limitations) {
      lines.push(`    * [${lim.code}] ${lim.description}`);
    }
  }
  lines.push(`================================================================================`);
  return lines.join("\n");
}

function formatTerminalDrift(payload: {
  analysisId: string;
  repositoryIdentity: string;
  drift: {
    totalFindings: number;
    findings: { severity: string; confidenceTier: string; driftType: string; title: string }[];
  };
  decisions: {
    totalCorrelations: number;
    correlations: {
      severity: string;
      confidenceTier: string;
      correlationType: string;
      title: string;
    }[];
  };
}): string {
  const lines: string[] = [];
  lines.push(`Frontier Engineer — Architectural Drift (${payload.analysisId})`);
  lines.push(`Repository: ${payload.repositoryIdentity}`);
  lines.push(`Drift Findings: ${payload.drift.totalFindings}`);
  for (const f of payload.drift.findings) {
    lines.push(`  [${f.severity}] (${f.confidenceTier}) ${f.driftType}: ${f.title}`);
  }
  lines.push(`ADR Correlations: ${payload.decisions.totalCorrelations}`);
  for (const c of payload.decisions.correlations) {
    lines.push(`  [${c.severity}] (${c.confidenceTier}) ${c.correlationType}: ${c.title}`);
  }
  return lines.join("\n");
}

function formatTerminalDebt(payload: {
  analysisId: string;
  repositoryIdentity: string;
  debt: {
    introducedCount: number;
    worsenedCount: number;
    persistingCount: number;
    resolvedCount: number;
    items: {
      state: string;
      severity: string;
      confidenceTier: string;
      category: string;
      title: string;
    }[];
  };
}): string {
  const lines: string[] = [];
  lines.push(`Frontier Engineer — Engineering Debt (${payload.analysisId})`);
  lines.push(`Repository: ${payload.repositoryIdentity}`);
  lines.push(
    `Totals: +${payload.debt.introducedCount} introduced, ~${payload.debt.worsenedCount} worsened, =${payload.debt.persistingCount} persisting, -${payload.debt.resolvedCount} resolved`,
  );
  for (const item of payload.debt.items) {
    lines.push(
      `  [${item.state}/${item.severity}] (${item.confidenceTier}) ${item.category}: ${item.title}`,
    );
  }
  return lines.join("\n");
}

function formatTerminalMemories(payload: {
  repositoryIdentity: string;
  totalCount: number;
  memories: {
    id: number;
    memoryKey: string;
    category: string;
    status: string;
    version: number;
    title: string;
  }[];
  lifecycleEvaluation: { totalEvaluated: number } | null;
}): string {
  const lines: string[] = [];
  lines.push(`Frontier Engineer — Engineering Memories (${payload.repositoryIdentity})`);
  lines.push(`Total Memories: ${payload.totalCount}`);
  for (const m of payload.memories) {
    lines.push(`  #${m.id} [${m.status}] v${m.version} (${m.category}) ${m.memoryKey}: ${m.title}`);
  }
  if (payload.lifecycleEvaluation) {
    lines.push(`Evaluated against scan: ${payload.lifecycleEvaluation.totalEvaluated} memories`);
  }
  return lines.join("\n");
}

function formatTerminalMemoryDetail(payload: {
  repositoryIdentity: string;
  memory: {
    id: number;
    memoryKey: string;
    category: string;
    status: string;
    version: number;
    title: string;
    content: string;
    lastSeenScanId: number | null;
    supersededById: number | null;
  };
  versions: { version: number; status: string; changeReason: string }[];
  evidence: { evidenceType: string; sourcePath: string; isContradictory: boolean }[];
  relationships: { relationshipType: string; sourceMemoryId: number; targetMemoryId: number }[];
}): string {
  const m = payload.memory;
  const lines: string[] = [];
  lines.push(`Frontier Engineer — Engineering Memory #${m.id} (${m.memoryKey})`);
  lines.push(`Repository: ${payload.repositoryIdentity}`);
  lines.push(`Title:      ${m.title}`);
  lines.push(`Category:   ${m.category} | Status: ${m.status} | Version: ${m.version}`);
  lines.push(
    `Last Scan:  ${m.lastSeenScanId ?? "N/A"} | Superseded By: ${m.supersededById ?? "None"}`,
  );
  lines.push(`Content:    ${m.content}`);
  lines.push(`Evidence (${payload.evidence.length}):`);
  for (const ev of payload.evidence) {
    lines.push(
      `  - [${ev.isContradictory ? "CONTRADICTORY" : "SUPPORTING"}] ${ev.evidenceType}: ${ev.sourcePath}`,
    );
  }
  lines.push(`Versions (${payload.versions.length}):`);
  for (const v of payload.versions) {
    lines.push(`  - v${v.version} (${v.status}): ${v.changeReason}`);
  }
  lines.push(`Relationships (${payload.relationships.length}):`);
  for (const r of payload.relationships) {
    lines.push(`  - ${r.sourceMemoryId} -[${r.relationshipType}]-> ${r.targetMemoryId}`);
  }
  return lines.join("\n");
}

function formatTerminalIndexReport(report: IndexExecutionReport): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`Frontier Engineer — Repository Index Pipeline (${report.mode})`);
  lines.push(
    `Repository: ${report.repositoryIdentity} (ID: ${report.repositoryId}) | Status: ${report.status}`,
  );
  lines.push(
    `Scan ID:    ${report.scanId ?? "N/A"} | Previous Scan ID: ${report.previousActiveScanId ?? "N/A"} | Promoted: ${report.promoted}`,
  );
  lines.push(`Duration:   ${report.durationMs}ms`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`Discovery & Extraction:`);
  lines.push(
    `  Files:      ${report.counts.filesDiscovered} discovered, ${report.counts.filesIndexed} indexed, ${report.counts.filesSkipped} skipped, ${report.counts.filesFailed} failed`,
  );
  lines.push(
    `  Extracted:  ${report.counts.symbolsIndexed} symbols, ${report.counts.importsIndexed} imports, ${report.counts.exportsIndexed} exports`,
  );
  lines.push(
    `  Graph:      ${report.counts.nodesCreated} nodes, ${report.counts.edgesCreated} edges`,
  );
  lines.push(
    `  Components: ${report.counts.componentsDetected} components, ${report.counts.entrypointsDetected} entrypoints, ${report.counts.decisionsDetected} ADRs, ${report.counts.testAssociationsDetected} test links`,
  );
  if (report.lifecycleEvaluation) {
    lines.push(
      `  Memories:   ${report.lifecycleEvaluation.totalEvaluated} evaluated (stale: ${report.lifecycleEvaluation.transitionedToStale}, disputed: ${report.lifecycleEvaluation.transitionedToDisputed})`,
    );
  }
  if (report.diagnostics.length > 0) {
    lines.push(`  Diagnostics (${report.diagnostics.length}):`);
    for (const d of report.diagnostics.slice(0, 10)) {
      lines.push(`    * ${d}`);
    }
  }
  lines.push(`================================================================================`);
  return lines.join("\n");
}

function printHelp(): void {
  process.stdout.write(`
Frontier Engineer — Architecture Intelligence Query CLI

Usage:
  npm run frontier -- [intelligence] <command> [options]
  node scripts/cli/frontier-cli.ts [intelligence] <command> [options]

Commands:
  # Indexing & Lifecycle Commands (2)
  scan                       Execute full end-to-end repository indexing and snapshot promotion
  refresh                    Incrementally refresh repository index when stale and evaluate memory lifecycle

  # Primary Architecture Commands (15)
  status                     Show repository identity, database, and index freshness status
  overview                   Provide concise, evidence-backed architectural overview
  freshness                  Evaluate non-destructive index freshness against filesystem
  components                 List detected architectural components and boundaries
  component <name>           Inspect a component's files, symbols, dependencies, and tests
  entrypoints                Discover and list verified application entrypoints
  dependencies <target>      Inspect direct and transitive dependencies of a file or component
  dependents <target>        Inspect what files or components depend on a given target
  cycles                     Detect circular dependency loops and strongly connected components
  file <path>                Inspect file metadata, extracted symbols, imports, and exports
  symbol <name>              Search for symbols by name across indexed source files
  tests [target]             Query test associations for a module or list all test coverage
  decisions                  List discovered Architecture Decision Records (ADRs)
  decision <id>              Inspect an ADR and its governed components
  query "<expression>"       Deterministic natural query expression

  # Command Aliases (1)
  deps <target>              Alias for 'dependencies <target>'

  # Snapshot Comparison & Evolution Intelligence Commands (6)
  compare <base-id> <target-id>   Compare two snapshots deterministically across all architectural domains
  evolution <base-id> <target-id> Run full evolution, drift, ADR correlation, debt, and memory lifecycle analysis
  drift <base-id> <target-id>     Analyze architectural boundary drift and ADR governance correlations
  debt <base-id> <target-id>      Analyze engineering debt (introduced, worsened, persisting, resolved)
  memories                        List durable engineering memories (use --scan-id for lifecycle validation)
  memory <key-or-id>              Inspect a single memory, its version history, evidence, and relationships

  # Agent Retrieval & Orchestration Commands (3)
  retrieve                        Retrieve role-aware, budgeted, evidence-backed task context for an agent
  prepare-handoff                 Retrieve grounded context and emit a schema-validated delegation handoff
  validate-handoff <path>         Validate a handoff JSON file or FRONTIER_HANDOFF_JSON delegation prompt

  # Telemetry & Audit Commands (2)
  telemetry [list|summary|verify|show <id>] Query runtime audit telemetry logs, summary stats, and integrity
  audit [list|summary|verify|show <id>]     Alias for 'telemetry'

Options:
  --format <text|json|markdown> Output format (default: text; markdown supported for telemetry/audit)
  --workspace <path>         Target workspace root directory (default: current directory)
  --depth <n>                Maximum traversal depth for dependency queries (default: 3, max: 10)
  --limit <n>                Maximum number of results to display (default: 50)
  --scan-id <id>             Explicit single scan ID to inspect (cannot combine with --base-scan-id/--target-scan-id)
  --agent <agent-id>         Target agent policy profile for 'retrieve' / 'prepare-handoff' (default: frontier-engineer)
  --from <agent-id>          Source coordinator agent ID for 'prepare-handoff' (default: frontier-engineer)
  --task "<summary>"         Task description for 'retrieve' / 'prepare-handoff'
  --task-id <id>             Task identifier for 'prepare-handoff' (default: FE-HANDOFF-001)
  --input <path>             Input file path (or '-' for stdin) for 'validate-handoff'
  --file <path>              Target file hint for 'retrieve' / 'prepare-handoff' (repeatable)
  --symbol <name>            Target symbol hint for 'retrieve' / 'prepare-handoff' (repeatable)
  --component <name>         Target component hint for 'retrieve' / 'prepare-handoff' (repeatable)
  --adr <id>                 Target ADR identifier hint for 'retrieve' / 'prepare-handoff' (repeatable)
  --max-chars <n>            Serialized character budget ceiling for 'retrieve' / 'prepare-handoff'
  --max-tokens <n>           Token budget ceiling for 'retrieve' / 'prepare-handoff'
  --include-snippets         Include bounded SAFE source snippets in 'retrieve' / 'prepare-handoff'
  --no-snippets              Suppress source snippets in 'retrieve' / 'prepare-handoff'
  --include-historical       Include SUPERSEDED/ARCHIVED memories in 'retrieve' / 'prepare-handoff'
  --base-scan-id <id>        Optional base scan ID for evolution retrieval (paired with --target-scan-id)
  --target-scan-id <id>      Optional target scan ID for evolution retrieval (paired with --base-scan-id)
  --verify-content           Perform full SHA-256 cryptographic content hash verification
  --persist-events           Persist factual/analytical change events to evolution_events table
  --apply-lifecycle          Apply validated memory lifecycle transitions and scan verifications
  --allow-partial            Allow PARTIAL snapshots (marks result PARTIAL)
  --no-allow-partial         Reject PARTIAL snapshots during 'retrieve' / 'prepare-handoff'
  --allow-stale              Allow STALE snapshots during 'validate-handoff' consumer check
  --allow-unindexed          Emit degraded static-inspection handoff when repository index is unavailable

  # Telemetry Query & Filtering Options
  --audit-dir <path>         Override target audit directory (default: .frontier/audit)
  --include-rotated          Include rotated historical log files (execution.jsonl.1..3)
  --max-lines <n>            Maximum total lines to scan across audit log files
  --aggregate, --summary     Generate categorical distributions and summary metrics
  --diagnostics, --integrity Run structural and continuity integrity diagnostics
  --event-type <type>        Filter by event type (repeatable, comma-separated)
  --event-id <id>            Filter by exact event ID
  --decision <decision>      Filter by policy decision (ALLOW, WARN, BLOCK, ERROR)
  --tool <name>              Filter by tool name (repeatable, comma-separated)
  --status <status>          Filter by status (SUCCESS, FAILURE, ERROR)
  --source <source>          Filter by event source (repeatable, comma-separated)
  --correlation-id <id>      Filter by correlation ID
  --conversation-id <id>     Filter by conversation ID
  --execution-id <id>        Filter by execution ID
  --agent-id <id>            Filter by agent ID
  --skill-id <id>            Filter by skill ID
  --start-time <iso|ms>      Filter events starting at or after timestamp
  --end-time <iso|ms>        Filter events ending at or before timestamp
  --exact-time <iso|ms>      Filter events matching exact timestamp
  --text "<query>"           Search approved text fields (tool, reason, summary, error)
  --generation <gen>         Filter by schema generation (modern-v1 or legacy)
  --sort-by <field>          Sort field: timestamp, eventType, durationMs, stepIdx
  --sort-order <asc|desc>    Sort direction (default: asc)
  --page <n>                 Page number for paginated results (1-based, default: 1)
  --page-size <n>            Results per page (1-1000, default: 50)
  --help, -h                 Display this help message

Exit codes:
  0 — Success
  1 — Operational failure
  2 — Invalid command or arguments
  3 — Repository or index unavailable
  4 — Target entity not found
\n`);
}

// Auto-run if executed as script
const isDirectlyExecuted =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith("frontier-cli.ts") ||
    process.argv[1].endsWith("frontier-cli.js"));

if (isDirectlyExecuted) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
