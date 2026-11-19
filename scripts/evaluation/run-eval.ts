#!/usr/bin/env node
/**
 * Phase 8.6D: Executable Evaluation Suite CLI Runner
 * Runs the complete behavioral evaluation suite and outputs structured results.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.ts";
import {
  executeEvaluationSuite,
  formatEvaluationReportJson,
  formatEvaluationReportMarkdown,
} from "./index.ts";
import type { ExecutableScenarioDocument } from "./types.ts";

export async function runEvaluationCli(
  argv: string[] = [],
): Promise<{ exitCode: number; output: string }> {
  const root = repoRoot();
  const scenariosPath = path.join(root, "specs", "evaluation", "executable-scenarios.json");

  let format: "text" | "json" | "markdown" = "markdown";
  let categoryFilter: string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--format" && argv[i + 1]) {
      const f = argv[i + 1];
      if (f === "json" || f === "markdown" || f === "text") {
        format = f;
      }
      i++;
    } else if (argv[i] === "--category" && argv[i + 1]) {
      categoryFilter = argv[i + 1].split(",").map((c) => c.trim());
      i++;
    }
  }

  const doc: ExecutableScenarioDocument = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
  const report = await executeEvaluationSuite(doc, { categoryFilter });

  let output: string;
  if (format === "json") {
    output = formatEvaluationReportJson(report);
  } else {
    output = formatEvaluationReportMarkdown(report);
  }

  const exitCode = report.failed === 0 && report.errored === 0 ? 0 : 1;
  return { exitCode, output };
}

// Auto-run if directly executed
const isDirectlyExecuted =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith("run-eval.ts") ||
    process.argv[1].endsWith("run-eval.js"));

if (isDirectlyExecuted) {
  runEvaluationCli(process.argv.slice(2)).then(({ exitCode, output }) => {
    if (exitCode === 0) {
      console.log(output);
    } else {
      console.error(output);
    }
    process.exit(exitCode);
  });
}
