import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildRuleAdapterFiles,
  checkGeneratedRules,
  validateCanonicalRules,
} from "./lib/canonical-rules.ts";
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

/** Generates loader-visible Antigravity rule files from canonical specifications. */
export function generateRules(
  root: string,
  checkOnly: boolean,
): { written: string[]; removed: string[]; findings: Finding[] } {
  const canonicalFindings = validateCanonicalRules(root);
  if (canonicalFindings.length > 0) {
    return { written: [], removed: [], findings: canonicalFindings };
  }

  const expected = buildRuleAdapterFiles(root);
  if (checkOnly) {
    return {
      written: [],
      removed: [],
      findings: checkGeneratedRules(root),
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

  const rulesDir = path.join(root, "rules");
  if (fs.existsSync(rulesDir)) {
    for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relPath = `rules/${entry.name}`;
      if (expected.has(relPath)) continue;
      const content = fs.readFileSync(path.join(rulesDir, entry.name), "utf8");
      if (content.includes("Generated from `specs/rules/")) {
        fs.unlinkSync(path.join(rulesDir, entry.name));
        removed.push(relPath);
      }
    }
  }

  return {
    written,
    removed,
    findings: checkGeneratedRules(root),
  };
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const root = resolveRoot(args);
  const checkOnly = args.includes("--check");
  const result = generateRules(root, checkOnly);

  if (result.findings.length > 0) {
    printFindings(result.findings);
  }
  const errors = result.findings.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    console.error(
      `\nRule generation ${checkOnly ? "check" : "failed"}: ${errors.length} error(s).`,
    );
    process.exitCode = 1;
  } else if (checkOnly) {
    console.log(`Generated rules are up to date (${buildRuleAdapterFiles(root).size} files).`);
  } else {
    console.log(
      `Generated ${result.written.length} file(s), removed ${result.removed.length} stale file(s), ${buildRuleAdapterFiles(root).size} rules total.`,
    );
  }
}
