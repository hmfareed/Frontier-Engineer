#!/usr/bin/env node
/**
 * Phase 8.6D: CI Regression Check Runner
 * Executes the behavioral evaluation suite, compares results against the
 * canonical baseline, and exits with 0 on clean/improved status or 1 on regression.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.ts";
import {
  compareEvaluationReports,
  determineRegressionStatus,
  executeEvaluationSuite,
  formatRegressionReportJson,
  formatRegressionReportMarkdown,
} from "./index.ts";
import type { EvaluationRunReport, ExecutableScenarioDocument } from "./types.ts";

export interface CheckRegressionOptions {
  scenariosPath?: string;
  baselinePath?: string;
  format?: "text" | "json" | "markdown";
  failOnMissingScenarios?: boolean;
}

export async function runRegressionCheck(
  options: CheckRegressionOptions = {},
): Promise<{ exitCode: number; output: string }> {
  const root = repoRoot();
  const scenariosPath =
    options.scenariosPath ?? path.join(root, "specs", "evaluation", "executable-scenarios.json");
  const baselinePath =
    options.baselinePath ?? path.join(root, "specs", "evaluation", "baseline-report.json");
  const format = options.format ?? "text";

  if (!fs.existsSync(scenariosPath)) {
    const msg = `Error: Scenarios file not found: ${scenariosPath}`;
    return { exitCode: 1, output: msg };
  }

  if (!fs.existsSync(baselinePath)) {
    const msg = `Error: Baseline file not found: ${baselinePath}`;
    return { exitCode: 1, output: msg };
  }

  const scenariosDoc: ExecutableScenarioDocument = JSON.parse(
    fs.readFileSync(scenariosPath, "utf8"),
  );
  const baselineReport: EvaluationRunReport = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  const currentReport = await executeEvaluationSuite(scenariosDoc);
  const comparison = compareEvaluationReports(currentReport, baselineReport, {
    failOnMissingScenarios: options.failOnMissingScenarios,
  });

  const { exitCode, summary } = determineRegressionStatus(comparison);

  let output: string;
  if (format === "json") {
    output = formatRegressionReportJson(comparison);
  } else if (format === "markdown") {
    output = formatRegressionReportMarkdown(comparison);
  } else {
    // text
    const md = formatRegressionReportMarkdown(comparison);
    output = `${md}\n\n${summary}`;
  }

  return { exitCode, output };
}

// Auto-run if directly executed
const isDirectlyExecuted =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith("check-regression.ts") ||
    process.argv[1].endsWith("check-regression.js"));

if (isDirectlyExecuted) {
  const args = process.argv.slice(2);
  let format: "text" | "json" | "markdown" = "text";
  let baselinePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      const f = args[i + 1];
      if (f === "json" || f === "markdown" || f === "text") {
        format = f;
      }
      i++;
    } else if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = args[i + 1];
      i++;
    }
  }

  runRegressionCheck({ format, baselinePath }).then(({ exitCode, output }) => {
    if (exitCode === 0) {
      console.log(output);
    } else {
      console.error(output);
    }
    process.exit(exitCode);
  });
}
