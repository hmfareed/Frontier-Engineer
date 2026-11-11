import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildAntigravityMcpConfig,
  checkGeneratedIntegrations,
  validateCanonicalIntegrations,
} from "./lib/canonical-integrations.ts";
import { repoRoot } from "./lib/paths.ts";
import type { Finding } from "./lib/types.ts";

function resolveRoot(args: string[]): string {
  const index = args.indexOf("--root");
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : repoRoot();
}

function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function printFindings(findings: Finding[]): void {
  for (const item of findings) {
    console.error(
      `  ${item.severity.toUpperCase().padEnd(7)} ${item.file} :: ${item.rule} :: ${item.message}`,
    );
  }
}

/** Generates loader-visible Antigravity MCP configuration files from canonical specifications. */
export function generateIntegrations(
  root: string,
  checkOnly: boolean,
): { written: string[]; findings: Finding[] } {
  const canonicalFindings = validateCanonicalIntegrations(root);
  if (canonicalFindings.length > 0) {
    return { written: [], findings: canonicalFindings };
  }

  if (checkOnly) {
    return {
      written: [],
      findings: checkGeneratedIntegrations(root),
    };
  }

  const { mcp_config, mcp_config_example } = buildAntigravityMcpConfig(root);
  const written: string[] = [];

  const mcpConfigPath = path.join(root, "mcp_config.json");
  if (!fs.existsSync(mcpConfigPath) || fs.readFileSync(mcpConfigPath, "utf8") !== mcp_config) {
    fs.writeFileSync(mcpConfigPath, mcp_config, "utf8");
    written.push("mcp_config.json");
  }

  const examplePath = path.join(root, "mcp_config.example.json");
  if (!fs.existsSync(examplePath) || fs.readFileSync(examplePath, "utf8") !== mcp_config_example) {
    fs.writeFileSync(examplePath, mcp_config_example, "utf8");
    written.push("mcp_config.example.json");
  }

  return { written, findings: [] };
}

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const root = resolveRoot(args);

  const result = generateIntegrations(root, checkOnly);

  if (result.findings.length > 0) {
    console.error(
      `MCP integration generation check failed with ${result.findings.length} issue(s):`,
    );
    printFindings(result.findings);
    process.exit(1);
  }

  if (checkOnly) {
    console.log("Antigravity MCP integration adapters are in sync with canonical specifications.");
    return;
  }

  if (result.written.length === 0) {
    console.log("Antigravity MCP configuration files are already up to date.");
  } else {
    console.log(`Generated ${result.written.length} Antigravity MCP configuration file(s):`);
    for (const rel of result.written) {
      console.log(`  + ${rel}`);
    }
  }
}

if (invokedAsScript()) {
  main();
}
