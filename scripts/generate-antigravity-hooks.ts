import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildAntigravityHooksConfig,
  checkGeneratedHooks,
  validateCanonicalHooks,
} from "./lib/canonical-hooks.ts";
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

/** Generates Antigravity hooks.json from canonical specifications. */
export function generateHooks(
  root: string,
  checkOnly: boolean,
): { written: string[]; findings: Finding[] } {
  const canonicalFindings = validateCanonicalHooks(root);
  if (canonicalFindings.length > 0) {
    return { written: [], findings: canonicalFindings };
  }

  if (checkOnly) {
    return {
      written: [],
      findings: checkGeneratedHooks(root),
    };
  }

  const hooksConfig = buildAntigravityHooksConfig(root);
  const written: string[] = [];

  const hooksPath = path.join(root, "hooks.json");
  if (!fs.existsSync(hooksPath) || fs.readFileSync(hooksPath, "utf8") !== hooksConfig) {
    fs.writeFileSync(hooksPath, hooksConfig, "utf8");
    written.push("hooks.json");
  }

  return { written, findings: [] };
}

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const root = resolveRoot(args);

  const result = generateHooks(root, checkOnly);

  if (result.findings.length > 0) {
    console.error(`Hook generation check failed with ${result.findings.length} issue(s):`);
    printFindings(result.findings);
    process.exit(1);
  }

  if (checkOnly) {
    console.log("Antigravity hooks.json is in sync with canonical specifications.");
    return;
  }

  if (result.written.length === 0) {
    console.log("Antigravity hooks.json is already up to date.");
  } else {
    console.log(`Generated Antigravity hooks configuration:`);
    for (const rel of result.written) {
      console.log(`  + ${rel}`);
    }
  }
}

if (invokedAsScript()) {
  main();
}
