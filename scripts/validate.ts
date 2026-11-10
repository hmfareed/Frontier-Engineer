import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkJsonSyntax,
  checkConfigPlacement,
  checkOptionalConfigs,
  checkPluginManifest,
} from "./lib/json-config.ts";
import { checkMarkdownLinks } from "./lib/markdown-links.ts";
import { repoRoot } from "./lib/paths.ts";
import { checkDocumentationIndex, checkRequiredFiles } from "./lib/required-files.ts";
import { countBySeverity, formatReport } from "./lib/report.ts";
import { checkSecretHygiene } from "./lib/security.ts";
import type { CheckResult } from "./lib/types.ts";
import { checkMetadata, checkYamlSyntax } from "./lib/yaml-frontmatter.ts";

/** All foundation checks. Pure with respect to output: callers decide how to report or exit. */
export function runChecks(root: string): CheckResult[] {
  return [
    {
      name: "required files and documentation index",
      findings: [...checkRequiredFiles(root), ...checkDocumentationIndex(root)],
    },
    {
      name: "JSON syntax and verified plugin manifest",
      findings: [...checkJsonSyntax(root), ...checkPluginManifest(root)],
    },
    {
      name: "optional component configs and placement",
      findings: [...checkOptionalConfigs(root), ...checkConfigPlacement(root)],
    },
    {
      name: "YAML syntax and component metadata",
      findings: [...checkYamlSyntax(root), ...checkMetadata(root)],
    },
    {
      name: "Markdown links and references",
      findings: checkMarkdownLinks(root),
    },
    {
      name: "secret hygiene",
      findings: checkSecretHygiene(root),
    },
  ];
}

function resolveRoot(args: string[]): string {
  const index = args.indexOf("--root");
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : repoRoot();
}

function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const results = runChecks(resolveRoot(args));
  if (args.includes("--json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results));
  }
  process.exitCode = countBySeverity(results).error > 0 ? 1 : 0;
}
