import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildAdapterFiles,
  checkAdapterRegistry,
  checkGeneratedAgents,
  validateCanonicalSpecs,
} from "./lib/canonical.ts";
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

/** Generates loader-visible Antigravity agent files from the canonical specifications. */
export function generate(
  root: string,
  checkOnly: boolean,
): { written: string[]; removed: string[]; findings: Finding[] } {
  const canonicalFindings = validateCanonicalSpecs(root);
  if (canonicalFindings.length > 0) {
    return { written: [], removed: [], findings: canonicalFindings };
  }

  const expected = buildAdapterFiles(root);
  if (checkOnly) {
    return {
      written: [],
      removed: [],
      findings: [...checkGeneratedAgents(root), ...checkAdapterRegistry(root)],
    };
  }

  const written: string[] = [];
  const removed: string[] = [];
  for (const [relPath, content] of expected) {
    const absolute = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (fs.existsSync(absolute) && fs.readFileSync(absolute, "utf8") === content) continue;
    fs.writeFileSync(absolute, content, "utf8");
    written.push(relPath);
  }

  const agentsDir = path.join(root, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relPath = `agents/${entry.name}`;
      if (expected.has(relPath)) continue;
      const content = fs.readFileSync(path.join(agentsDir, entry.name), "utf8");
      if (content.includes("Generated from `specs/agents/")) {
        fs.unlinkSync(path.join(agentsDir, entry.name));
        removed.push(relPath);
      }
    }
  }

  return {
    written,
    removed,
    findings: [...checkGeneratedAgents(root), ...checkAdapterRegistry(root)],
  };
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const root = resolveRoot(args);
  const checkOnly = args.includes("--check");
  const result = generate(root, checkOnly);

  if (result.findings.length > 0) {
    printFindings(result.findings);
  }
  const errors = result.findings.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    console.error(`\nGeneration ${checkOnly ? "check" : "failed"}: ${errors.length} error(s).`);
    process.exitCode = 1;
  } else if (checkOnly) {
    console.log(`Generated agents are up to date (${buildAdapterFiles(root).size} files).`);
  } else {
    console.log(
      `Generated ${result.written.length} file(s), removed ${result.removed.length} stale file(s), ${buildAdapterFiles(root).size} agents total.`,
    );
  }
}
