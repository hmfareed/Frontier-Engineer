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
  "docs/09-SKILLS-ARCHITECTURE.md",
  "docs/10-SKILL-SPECIFICATIONS.md",
  "docs/11-SKILL-ACTIVATION.md",
  "docs/12-SKILL-AGENT-INTEGRATION.md",
  "docs/13-SKILL-PORTABILITY.md",
  "docs/14-ENGINEERING-PRINCIPLES.md",
  "docs/15-RULES-ARCHITECTURE.md",
  "docs/16-RULE-SPECIFICATIONS.md",
  "docs/17-RULE-ACTIVATION.md",
  "docs/18-RULE-PRIORITY-AND-CONFLICTS.md",
  "docs/19-RULE-PORTABILITY.md",
  "docs/20-REPOSITORY-STRUCTURE.md",
  "docs/21-MCP-ARCHITECTURE.md",
  "docs/22-MCP-INTEGRATIONS.md",
  "docs/23-MCP-SECURITY.md",
  "docs/24-MCP-CONFIGURATION.md",
  "docs/25-MCP-PORTABILITY.md",
  "docs/26-MCP-OPERATIONS.md",
  "docs/27-OFFICIAL-FORMAT-VERIFICATION.md",
  "docs/28-HOOKS-ARCHITECTURE.md",
  "docs/29-HOOKS-SPECIFICATIONS.md",
  "docs/30-HOOKS-SECURITY.md",
  "docs/31-HOOKS-RUNTIME.md",
  "docs/32-HOOKS-TESTING.md",
  "docs/33-HOOKS-PORTABILITY.md",
  "docs/adr/ADR-001-foundation.md",
  "docs/adr/ADR-002-agent-system.md",
  "docs/adr/ADR-003-skills-system.md",
  "docs/adr/ADR-004-rules-system.md",
  "docs/adr/ADR-005-mcp-integration-architecture.md",
  "docs/adr/ADR-006-lifecycle-hooks-architecture.md",
  "mcp_config.json",
  "mcp_config.example.json",
  "hooks.json",
  "scripts/validate.ts",
  "scripts/generate-antigravity-agents.ts",
  "scripts/generate-antigravity-skills.ts",
  "scripts/generate-antigravity-rules.ts",
  "scripts/generate-antigravity-integrations.ts",
  "scripts/generate-antigravity-hooks.ts",
  "scripts/lib/canonical-integrations.ts",
  "scripts/lib/canonical-hooks.ts",
  "specs/handoff-contract.md",
  "specs/handoff-examples.json",
  "specs/evaluation/scenarios.json",
  "specs/evaluation/skill-scenarios.json",
  "specs/evaluation/hook-scenarios.json",
  "specs/adapters/README.md",
  "specs/adapters/antigravity.md",
  "specs/integrations/README.md",
  "specs/integrations/integration-registry.md",
  "specs/integrations/github/integration.md",
  "specs/integrations/github/capabilities.md",
  "specs/integrations/github/security.md",
  "specs/integrations/context7/integration.md",
  "specs/integrations/context7/capabilities.md",
  "specs/integrations/context7/security.md",
  "specs/integrations/playwright/integration.md",
  "specs/integrations/playwright/capabilities.md",
  "specs/integrations/playwright/security.md",
  "specs/integrations/sentry/integration.md",
  "specs/integrations/sentry/capabilities.md",
  "specs/integrations/sentry/security.md",
  "specs/integrations/database/integration.md",
  "specs/integrations/database/capabilities.md",
  "specs/integrations/database/security.md",
  "specs/hooks/README.md",
  "specs/hooks/hook-registry.md",
  "specs/hooks/hook-security-model.md",
  "specs/hooks/session-start.md",
  "specs/hooks/pre-tool-use.md",
  "specs/hooks/post-tool-use.md",
  "specs/hooks/pre-invocation.md",
  "specs/hooks/post-invocation.md",
  "specs/hooks/stop.md",
  "schemas/canonical-agent.schema.json",
  "schemas/canonical-skill.schema.json",
  "schemas/canonical-rule.schema.json",
  "schemas/canonical-integration.schema.json",
  "schemas/canonical-hook.schema.json",
  "schemas/integration-registry.schema.json",
  "schemas/hook-registry.schema.json",
  "schemas/hook-evaluation-scenarios.schema.json",
  "schemas/handoff.schema.json",
  "schemas/evaluation-scenarios.schema.json",
  "schemas/skill-evaluation-scenarios.schema.json",
];

export const REQUIRED_DIRECTORIES: string[] = [
  "agents",
  "specs/agents",
  "specs/adapters",
  "specs/evaluation",
  "specs/skills",
  "specs/skills/references",
  "specs/rules",
  "specs/integrations",
  "specs/integrations/github",
  "specs/integrations/context7",
  "specs/integrations/playwright",
  "specs/integrations/sentry",
  "specs/integrations/database",
  "specs/hooks",
  "skills",
  "rules",
  "scripts",
  "scripts/hooks",
  "scripts/hooks/runtime",
  "scripts/hooks/handlers",
  "scripts/hooks/lib",
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
          `Document is not indexed in docs/README.md. Add a link to [${name}](${name}).`,
        ),
      );
    }
  }
  return findings;
}
