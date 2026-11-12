/**
 * Phase 7.4 — Deterministic Natural Query Grammar Parser
 * Parses natural-language-like query expressions into structured query executions without stochastic LLMs.
 */

import type { ArchitectureQueryEngine } from "./query-engine.ts";
import type { QueryResult, QueryOptions } from "./types.ts";

export interface ParsedQueryIntent {
  category:
    | "status"
    | "overview"
    | "components"
    | "component"
    | "entrypoints"
    | "dependencies"
    | "dependents"
    | "cycles"
    | "file"
    | "symbol"
    | "tests"
    | "decisions"
    | "decision";
  target?: string;
  parameters?: Record<string, unknown>;
}

export class QueryGrammar {
  private static readonly SUPPORTED_EXAMPLES = [
    "what does this repository contain? (or 'overview')",
    "what is the status of the index? (or 'status')",
    "what are the architectural components? (or 'components')",
    "inspect component <name>",
    "what are the entry points? (or 'entrypoints')",
    "what does <target> depend on? (or 'dependencies <target>')",
    "what depends on <target>? (or 'dependents <target>')",
    "are there circular dependencies? (or 'cycles')",
    "which tests cover <target>? (or 'tests <target>')",
    "what architectural decisions are documented? (or 'decisions')",
    "inspect decision <id>",
    "inspect file <path>",
    "find symbol <name>",
  ];

  public static parse(queryStr: string): ParsedQueryIntent {
    const raw = queryStr.trim();
    if (!raw) {
      throw new Error("Query expression cannot be empty.");
    }

    const rawTrimmed = raw.replace(/[?!.,;]+$/, "").trim();
    const clean = rawTrimmed.toLowerCase();

    // 1. Status
    if (
      clean === "status" ||
      clean === "show status" ||
      clean === "index status" ||
      clean === "what is the index status" ||
      clean === "what is the status of the index" ||
      clean === "is index fresh"
    ) {
      return { category: "status" };
    }

    // 2. Overview
    if (
      clean === "overview" ||
      clean === "repo overview" ||
      clean === "what does this repository contain" ||
      clean === "what is this repository" ||
      clean === "summarize architecture" ||
      clean === "architecture summary"
    ) {
      return { category: "overview" };
    }

    // 3. Components
    if (
      clean === "components" ||
      clean === "list components" ||
      clean === "show components" ||
      clean === "what are the architectural components" ||
      clean === "what are the components" ||
      clean === "what components exist"
    ) {
      return { category: "components" };
    }

    // Single Component inspection
    const compMatch =
      rawTrimmed.match(/^(?:inspect\s+component|show\s+component|component)\s+(.+)$/i) ||
      rawTrimmed.match(
        /^(?:which\s+files\s+are\s+responsible\s+for|where\s+is)\s+(auth|authentication|database|backend|frontend|api)$/i,
      );

    if (compMatch) {
      let target = compMatch[1].trim();
      if (target.toLowerCase() === "authentication") target = "auth";
      return { category: "component", target };
    }

    // 4. Entrypoints
    if (
      clean === "entrypoints" ||
      clean === "list entrypoints" ||
      clean === "show entrypoints" ||
      clean === "what are the entry points" ||
      clean === "what are the application entry points" ||
      clean === "find entrypoints"
    ) {
      return { category: "entrypoints" };
    }

    // 5. Cycles
    if (
      clean === "cycles" ||
      clean === "circular dependencies" ||
      clean === "show cycles" ||
      clean === "find cycles" ||
      clean === "are there circular dependencies" ||
      clean === "check circular dependencies"
    ) {
      return { category: "cycles" };
    }

    // 6. Dependencies
    const depMatch =
      rawTrimmed.match(
        /^(?:dependencies\s+of|dependencies|what\s+does)\s+(.+?)(?:\s+depend\s+on)?$/i,
      ) || rawTrimmed.match(/^what\s+does\s+(.+?)\s+import$/i);

    if (depMatch && !clean.startsWith("dependents")) {
      const target = depMatch[1].replace(/^(?:the\s+)/i, "").trim();
      return { category: "dependencies", target };
    }

    // 7. Dependents
    const dependentsMatch =
      rawTrimmed.match(
        /^(?:dependents\s+of|dependents|what\s+depends\s+on|which\s+modules\s+depend\s+on)\s+(.+)$/i,
      ) || rawTrimmed.match(/^what\s+imports\s+(.+)$/i);

    if (dependentsMatch) {
      const target = dependentsMatch[1].replace(/^(?:the\s+)/i, "").trim();
      return { category: "dependents", target };
    }

    // 8. Tests
    const testMatch = rawTrimmed.match(
      /^(?:tests\s+for|tests|which\s+tests\s+cover|find\s+tests\s+for)\s+(.+)$/i,
    );

    if (testMatch) {
      return { category: "tests", target: testMatch[1].trim() };
    }
    if (
      clean === "tests" ||
      clean === "list tests" ||
      clean === "show tests" ||
      clean === "all tests"
    ) {
      return { category: "tests" };
    }

    // 9. Decisions (ADRs)
    if (
      clean === "decisions" ||
      clean === "list decisions" ||
      clean === "show decisions" ||
      clean === "what architectural decisions are documented" ||
      clean === "what adrs exist" ||
      clean === "list adrs"
    ) {
      return { category: "decisions" };
    }

    const decisionMatch = rawTrimmed.match(
      /^(?:inspect\s+decision|show\s+decision|decision|adr)\s+(.+)$/i,
    );
    if (decisionMatch) {
      return { category: "decision", target: decisionMatch[1].trim() };
    }

    // 10. File
    const fileMatch = rawTrimmed.match(/^(?:inspect\s+file|show\s+file|file)\s+(.+)$/i);
    if (fileMatch) {
      return { category: "file", target: fileMatch[1].trim() };
    }

    // 11. Symbol
    const symMatch = rawTrimmed.match(/^(?:find\s+symbol|inspect\s+symbol|symbol)\s+(.+)$/i);
    if (symMatch) {
      return { category: "symbol", target: symMatch[1].trim() };
    }

    // Unrecognized query
    throw new Error(
      `Unsupported query pattern: "${queryStr}".\n\nSupported query forms include:\n${QueryGrammar.SUPPORTED_EXAMPLES.map(
        (ex) => `  - ${ex}`,
      ).join("\n")}`,
    );
  }

  public static async execute(
    engine: ArchitectureQueryEngine,
    queryStr: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<any>> {
    const intent = this.parse(queryStr);

    switch (intent.category) {
      case "status":
        return engine.getStatus();
      case "overview":
        return engine.getOverview(options);
      case "components":
        return engine.listComponents(options);
      case "component":
        return engine.getComponent(intent.target!, options);
      case "entrypoints":
        return engine.getEntrypoints(options);
      case "dependencies":
        return engine.getDependencies(intent.target!, options);
      case "dependents":
        return engine.getDependents(intent.target!, options);
      case "cycles":
        return engine.getCycles(options);
      case "file":
        return engine.getFile(intent.target!, options);
      case "symbol":
        return engine.getSymbol(intent.target!, options);
      case "tests":
        return engine.getTests(intent.target, options);
      case "decisions":
        return engine.getDecisions(options);
      case "decision":
        return engine.getDecision(intent.target!, options);
      default:
        throw new Error(`Unhandled query category: ${intent.category}`);
    }
  }
}
