import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSkillAdapterFiles,
  checkGeneratedSkills,
  validateCanonicalSkillSpecs,
} from "./lib/canonical-skills.ts";
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

/** Generates loader-visible Antigravity skill files from canonical specifications. */
export function generateSkills(
  root: string,
  checkOnly: boolean,
): { written: string[]; removed: string[]; findings: Finding[] } {
  const canonicalFindings = validateCanonicalSkillSpecs(root);
  if (canonicalFindings.length > 0) {
    return { written: [], removed: [], findings: canonicalFindings };
  }

  const expected = buildSkillAdapterFiles(root);
  if (checkOnly) {
    return {
      written: [],
      removed: [],
      findings: checkGeneratedSkills(root),
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

  return {
    written,
    removed,
    findings: checkGeneratedSkills(root),
  };
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const root = resolveRoot(args);
  const checkOnly = args.includes("--check");
  const result = generateSkills(root, checkOnly);

  if (result.findings.length > 0) {
    printFindings(result.findings);
  }
  const errors = result.findings.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    console.error(
      `\nSkill generation ${checkOnly ? "check" : "failed"}: ${errors.length} error(s).`,
    );
    process.exitCode = 1;
  } else if (checkOnly) {
    console.log(`Generated skills are up to date (${buildSkillAdapterFiles(root).size} files).`);
  } else {
    console.log(
      `Generated ${result.written.length} file(s), removed ${result.removed.length} stale file(s), ${buildSkillAdapterFiles(root).size} files total.`,
    );
  }
}
