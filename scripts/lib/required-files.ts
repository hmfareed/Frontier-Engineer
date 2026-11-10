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
  "docs/04-AGENT-SPECIFICATIONS.md",
  "docs/05-AGENT-COORDINATION.md",
  "docs/06-AGENT-COMMUNICATION.md",
  "docs/07-AGENT-PORTABILITY.md",
  "docs/08-AGENT-EVALUATION.md",
  "docs/09-ENGINEERING-PRINCIPLES.md",
  "docs/15-REPOSITORY-STRUCTURE.md",
  "docs/24-OFFICIAL-FORMAT-VERIFICATION.md",
  "docs/adr/ADR-001-foundation.md",
  "docs/adr/ADR-002-agent-system.md",
  "scripts/validate.ts",
  "scripts/generate-antigravity-agents.ts",
  "specs/handoff-contract.md",
  "specs/handoff-examples.json",
  "specs/evaluation/scenarios.json",
  "specs/adapters/README.md",
  "specs/adapters/antigravity.md",
  "schemas/canonical-agent.schema.json",
  "schemas/handoff.schema.json",
  "schemas/evaluation-scenarios.schema.json",
];

export const REQUIRED_DIRECTORIES: string[] = [
  "agents",
  "specs/agents",
  "specs/adapters",
  "specs/evaluation",
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
