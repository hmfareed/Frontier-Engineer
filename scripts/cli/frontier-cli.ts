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
import { ArchitectureQueryEngine } from "../query/query-engine.ts";
import { QueryGrammar } from "../query/query-grammar.ts";
import { QueryFormatter } from "../query/query-formatter.ts";
import type { QueryOptions, TraversalQueryOptions } from "../query/types.ts";

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
    "dependents",
    "cycles",
    "file",
    "symbol",
    "tests",
    "decisions",
    "decision",
    "query",
  ]);

  if (!KNOWN_COMMANDS.has(subcommand)) {
    outputError(
      `Unknown subcommand: "${subcommand}". Use --help for available intelligence commands.`,
      2,
      format,
    );
    return 2;
  }

  const REQUIRES_TARGET: Record<string, string> = {
    component: "<component_name>",
    dependencies: "<target_file_or_component>",
    dependents: "<target_file_or_component>",
    file: "<file_path>",
    symbol: "<symbol_name>",
    decision: "<decision_id>",
    query: "<query_expression>",
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
    if (!repo.activeScanId && scanId === undefined && subcommand !== "status") {
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

      case "query":
        if (!target) {
          outputError("Missing required argument: <query_expression>", 2, format);
          return 2;
        }
        result = await QueryGrammar.execute(engine, target, queryOpts);
        break;

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

function printHelp(): void {
  process.stdout.write(`
Frontier Engineer — Architecture Intelligence Query CLI

Usage:
  frontier intelligence <command> [options]

Commands:
  status                     Show repository identity, database, and index freshness status
  overview                   Provide concise, evidence-backed architectural overview
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

Options:
  --format <text|json>       Output format (default: text)
  --workspace <path>         Target workspace root directory (default: current directory)
  --depth <n>                Maximum traversal depth for dependency queries (default: 3, max: 10)
  --limit <n>                Maximum number of results to display (default: 50)
  --scan-id <id>             Explicit historical scan ID to inspect (default: active scan)
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
