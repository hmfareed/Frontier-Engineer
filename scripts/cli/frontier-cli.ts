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

export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[]): Promise<number> {
  let format: "text" | "json" = "text";
  let workspaceRoot = process.cwd();
  let limit: number | undefined;
  let depth: number | undefined;
  let scanId: number | undefined;
  let verifyContent = false;
  let persistEvents = false;
  let allowPartial = false;
  let applyLifecycle = false;

  // Manual argument parsing without external dependencies
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format" && i + 1 < argv.length) {
      const val = argv[++i].toLowerCase();
      if (val === "json" || val === "text") {
        format = val;
      } else {
        outputError("Invalid format option: must be 'text' or 'json'.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--format=")) {
      const val = arg.split("=")[1].toLowerCase();
      if (val === "json" || val === "text") {
        format = val;
      } else {
        outputError("Invalid format option: must be 'text' or 'json'.", 2, format);
        return 2;
      }
    } else if (arg === "--workspace" && i + 1 < argv.length) {
      workspaceRoot = path.resolve(argv[++i]);
    } else if (arg.startsWith("--workspace=")) {
      workspaceRoot = path.resolve(arg.split("=")[1]);
    } else if (arg === "--limit" && i + 1 < argv.length) {
      limit = parseInt(argv[++i], 10);
      if (isNaN(limit) || limit < 1) {
        outputError("Invalid limit option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.split("=")[1], 10);
      if (isNaN(limit) || limit < 1) {
        outputError("Invalid limit option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--depth" && i + 1 < argv.length) {
      depth = parseInt(argv[++i], 10);
      if (isNaN(depth) || depth < 1) {
        outputError("Invalid depth option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--depth=")) {
      depth = parseInt(arg.split("=")[1], 10);
      if (isNaN(depth) || depth < 1) {
        outputError("Invalid depth option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--scan-id" && i + 1 < argv.length) {
      scanId = parseInt(argv[++i], 10);
      if (isNaN(scanId) || scanId < 1) {
        outputError("Invalid scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg.startsWith("--scan-id=")) {
      scanId = parseInt(arg.split("=")[1], 10);
      if (isNaN(scanId) || scanId < 1) {
        outputError("Invalid scan-id option: must be a positive integer.", 2, format);
        return 2;
      }
    } else if (arg === "--verify-content") {
      verifyContent = true;
    } else if (arg === "--persist-events") {
      persistEvents = true;
    } else if (arg === "--allow-partial") {
      allowPartial = true;
    } else if (arg === "--apply-lifecycle") {
      applyLifecycle = true;
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
  ]);

  if (!KNOWN_COMMANDS.has(subcommand)) {
    outputError(
      `Unknown subcommand: "${subcommand}". Use --help for available intelligence commands.`,
      2,
      format,
    );
    return 2;
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

  // Validate workspace and database availability
  if (!fs.existsSync(workspaceRoot)) {
    outputError(`Workspace root does not exist: ${workspaceRoot}`, 3, format);
    return 3;
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
    const queryOpts: QueryOptions = { limit, scanId };
    const traversalOpts: TraversalQueryOptions = { limit, depth, scanId };

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
        const baseScanId = parseInt(positional[1], 10);
        const targetScanId = parseInt(positional[2], 10);
        if (isNaN(baseScanId) || baseScanId < 1 || isNaN(targetScanId) || targetScanId < 1) {
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
          allowPartial,
          workspaceRoot,
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
        const baseScanId = parseInt(positional[1], 10);
        const targetScanId = parseInt(positional[2], 10);
        if (isNaN(baseScanId) || baseScanId < 1 || isNaN(targetScanId) || targetScanId < 1) {
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
          allowPartial,
          workspaceRoot,
          maxRecordsPerDomain: limit,
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
        const versions = memStore.getMemoryVersions(memory.id);
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
        err.code === "ERR_SNAPSHOT_NOT_FOUND"
      ) {
        outputError(err.message, 4, format);
        return 4;
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
      message.includes("Repository index is unavailable")
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

function outputError(message: string, exitCode: number, format: "text" | "json"): void {
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

function printHelp(): void {
  process.stdout.write(`
Frontier Engineer — Architecture Intelligence Query CLI

Usage:
  npm run frontier -- [intelligence] <command> [options]
  node scripts/cli/frontier-cli.ts [intelligence] <command> [options]

Commands:
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

Options:
  --format <text|json>       Output format (default: text)
  --workspace <path>         Target workspace root directory (default: current directory)
  --depth <n>                Maximum traversal depth for dependency queries (default: 3, max: 10)
  --limit <n>                Maximum number of results to display (default: 50)
  --scan-id <id>             Explicit historical scan ID to inspect (default: active scan)
  --verify-content           Perform full SHA-256 cryptographic content hash verification
  --persist-events           Persist factual/analytical change events to evolution_events table
  --apply-lifecycle          Apply validated memory lifecycle transitions and scan verifications
  --allow-partial            Allow comparing PARTIAL snapshots (marks result PARTIAL)
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
