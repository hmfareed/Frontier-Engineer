import { exists, isDirectory, readText, walkFiles } from "./walk.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";

export const REQUIRED_FILES: string[] = [
  "plugin.json",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "package.json",
  "tsconfig.json",
  ".gitignore",
  ".prettierrc.json",
  ".markdownlint-cli2.jsonc",
  "vitest.config.ts",
  "docs/README.md",
  "docs/01-PROJECT-OVERVIEW.md",
  "docs/02-TECHNOLOGY-STACK.md",
  "docs/03-SYSTEM-ARCHITECTURE.md",
  "docs/15-REPOSITORY-STRUCTURE.md",
  "docs/24-OFFICIAL-FORMAT-VERIFICATION.md",
  "docs/adr/ADR-001-foundation.md",
  "scripts/validate.ts",
];

export const REQUIRED_DIRECTORIES: string[] = [
  "agents",
  "skills",
  "rules",
  "scripts",
  "tests",
  "docs",
  "schemas",
  "assets",
  ".github/workflows",
];

export function checkRequiredFiles(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const rel of REQUIRED_FILES) {
    if (!exists(root, rel)) {
      findings.push(
        finding("error", "required-file-missing", rel, `Required file is missing. Create ${rel}.`),
      );
    }
  }
  for (const rel of REQUIRED_DIRECTORIES) {
    if (!isDirectory(root, rel)) {
      findings.push(
        finding(
          "error",
          "required-dir-missing",
          rel,
          `Required directory is missing. Create ${rel}/.`,
        ),
      );
    }
  }
  return findings;
}

/**
 * Every authored document under docs/ must be reachable from docs/README.md.
 * This catches documentation that exists but is never discoverable.
 */
export function checkDocumentationIndex(root: string): Finding[] {
  const findings: Finding[] = [];
  const index = readText(root, "docs/README.md");
  if (index === null) return findings;

  const docs = walkFiles(root, (rel) => rel.startsWith("docs/") && rel.endsWith(".md"));
  for (const doc of docs) {
    if (doc === "docs/README.md") continue;
    const name = doc.slice("docs/".length);
    if (!index.includes(name)) {
      findings.push(
        finding(
          "error",
          "doc-not-indexed",
          doc,
          `Document is not referenced from docs/README.md. Add a link containing "${name}".`,
        ),
      );
    }
  }
  return findings;
}
