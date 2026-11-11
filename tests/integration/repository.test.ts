import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAdapterFiles,
  checkAdapterRegistry,
  checkGeneratedAgents,
  loadCanonicalSpecs,
} from "../../scripts/lib/canonical.ts";
import {
  buildSkillAdapterFiles,
  checkGeneratedSkills,
  loadCanonicalSkillSpecs,
} from "../../scripts/lib/canonical-skills.ts";
import {
  buildRuleAdapterFiles,
  checkGeneratedRules,
  loadCanonicalRules,
} from "../../scripts/lib/canonical-rules.ts";
import {
  checkGeneratedHooks,
  loadCanonicalHookSpecs,
  validateCanonicalHooks,
} from "../../scripts/lib/canonical-hooks.ts";
import { checkContracts } from "../../scripts/lib/contracts.ts";
import { checkPluginManifest } from "../../scripts/lib/json-config.ts";
import { checkMarkdownLinks } from "../../scripts/lib/markdown-links.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { countBySeverity } from "../../scripts/lib/report.ts";
import { REQUIRED_DIRECTORIES, REQUIRED_FILES } from "../../scripts/lib/required-files.ts";
import { checkSecretHygiene } from "../../scripts/lib/security.ts";
import type { Finding } from "../../scripts/lib/types.ts";
import {
  checkMetadata,
  checkYamlSyntax,
  parseFrontmatter,
} from "../../scripts/lib/yaml-frontmatter.ts";
import { runChecks } from "../../scripts/validate.ts";

const root = repoRoot();

function errors(findings: Finding[]): Finding[] {
  return findings.filter((item) => item.severity === "error");
}

describe("repository foundation", () => {
  it("passes every critical validation check", { timeout: 15000 }, () => {
    const results = runChecks(root);
    expect(countBySeverity(results).error).toBe(0);
    for (const result of results) {
      expect(
        errors(result.findings),
        `${result.name}: ${JSON.stringify(errors(result.findings))}`,
      ).toEqual([]);
    }
  });

  it("has no broken Markdown links anywhere in the repository", () => {
    expect(checkMarkdownLinks(root)).toEqual([]);
  });

  it("has a valid plugin manifest and a bundled logo", () => {
    expect(checkPluginManifest(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, "assets", "logo.svg"))).toBe(true);
  });

  it("has valid YAML syntax and no invalid component metadata", () => {
    expect(errors(checkYamlSyntax(root))).toEqual([]);
    expect(errors(checkMetadata(root))).toEqual([]);
  });

  it("has no committed secrets", () => {
    expect(errors(checkSecretHygiene(root))).toEqual([]);
  });

  it("contains every required file and directory", () => {
    for (const rel of REQUIRED_FILES) {
      expect(fs.existsSync(path.join(root, rel)), rel).toBe(true);
    }
    for (const rel of REQUIRED_DIRECTORIES) {
      expect(fs.statSync(path.join(root, rel)).isDirectory(), rel).toBe(true);
    }
  });

  it("keeps the always-on rule free of YAML frontmatter", () => {
    const content = fs.readFileSync(path.join(root, "rules", "AGENTS.md"), "utf8");
    expect(parseFrontmatter(content).present).toBe(false);
    expect(content).toContain("Inspect before implementing");
  });

  it("keeps plugin.json and package.json identity in sync", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    expect(manifest.name).toBe("frontier-engineer");
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.version).toBe("0.6.2");
  });

  it("ships verified mcp_config.json and verified hooks.json", () => {
    expect(fs.existsSync(path.join(root, "mcp_config.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "hooks.json"))).toBe(true);
  });

  it("ships six canonical hooks and matching generated hooks.json", () => {
    const { specs, findings } = loadCanonicalHookSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(6);
    expect(checkGeneratedHooks(root)).toEqual([]);
    expect(validateCanonicalHooks(root)).toEqual([]);
  });

  it("ships six canonical specs and six matching generated adapters", () => {
    const { specs, findings } = loadCanonicalSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(6);
    expect(buildAdapterFiles(root).size).toBe(6);
    expect(checkGeneratedAgents(root)).toEqual([]);
    expect(checkAdapterRegistry(root)).toEqual([]);
  });

  it("ships ten canonical skills and twenty matching generated files", () => {
    const { specs, findings } = loadCanonicalSkillSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(10);
    expect(buildSkillAdapterFiles(root).size).toBe(20);
    expect(checkGeneratedSkills(root)).toEqual([]);
  });

  it("ships fourteen canonical rules and fourteen matching generated files", () => {
    const { rules, globalRule, findings } = loadCanonicalRules(root);
    expect(findings).toEqual([]);
    expect(rules).toHaveLength(13);
    expect(globalRule).not.toBeNull();
    expect(buildRuleAdapterFiles(root).size).toBe(14);
    expect(checkGeneratedRules(root)).toEqual([]);
  });

  it("passes the handoff and evaluation contract checks", () => {
    expect(checkContracts(root)).toEqual([]);
  });

  it("emits only verified Antigravity frontmatter in generated agents", () => {
    for (const [, content] of buildAdapterFiles(root)) {
      const data = parseFrontmatter(content).data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(
        ["commandExecutionPolicy", "description", "mainAgent", "model", "name", "subagent"].sort(),
      );
      expect(data.commandExecutionPolicy).toBe("sandbox");
    }
  });

  it("indexes every Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, and Phase 6 document", () => {
    const index = fs.readFileSync(path.join(root, "docs", "README.md"), "utf8");
    for (const name of [
      "01-PROJECT-OVERVIEW.md",
      "02-TECHNOLOGY-STACK.md",
      "03-SYSTEM-ARCHITECTURE.md",
      "04-AGENT-SPECIFICATIONS.md",
      "05-AGENT-COORDINATION.md",
      "06-AGENT-COMMUNICATION.md",
      "07-AGENT-PORTABILITY.md",
      "08-AGENT-EVALUATION.md",
      "09-SKILLS-ARCHITECTURE.md",
      "10-SKILL-SPECIFICATIONS.md",
      "11-SKILL-ACTIVATION.md",
      "12-SKILL-AGENT-INTEGRATION.md",
      "13-SKILL-PORTABILITY.md",
      "14-ENGINEERING-PRINCIPLES.md",
      "15-RULES-ARCHITECTURE.md",
      "16-RULE-SPECIFICATIONS.md",
      "17-RULE-ACTIVATION.md",
      "18-RULE-PRIORITY-AND-CONFLICTS.md",
      "19-RULE-PORTABILITY.md",
      "20-REPOSITORY-STRUCTURE.md",
      "21-MCP-ARCHITECTURE.md",
      "22-MCP-INTEGRATIONS.md",
      "23-MCP-SECURITY.md",
      "24-MCP-CONFIGURATION.md",
      "25-MCP-PORTABILITY.md",
      "26-MCP-OPERATIONS.md",
      "27-OFFICIAL-FORMAT-VERIFICATION.md",
      "28-HOOKS-ARCHITECTURE.md",
      "29-HOOKS-SPECIFICATIONS.md",
      "30-HOOKS-SECURITY.md",
      "31-HOOKS-RUNTIME.md",
      "32-HOOKS-TESTING.md",
      "33-HOOKS-PORTABILITY.md",
      "adr/ADR-001-foundation.md",
      "adr/ADR-002-agent-system.md",
      "adr/ADR-003-skills-system.md",
      "adr/ADR-004-rules-system.md",
      "adr/ADR-005-mcp-integration-architecture.md",
      "adr/ADR-006-lifecycle-hooks-architecture.md",
    ]) {
      expect(index, name).toContain(name);
    }
  });

  it("verifies MCP integration configuration and generated adapters", () => {
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(root, "mcp_config.json"), "utf8"));
    expect(Object.keys(mcpConfig.mcpServers)).toHaveLength(5);
    expect(Object.keys(mcpConfig.mcpServers).sort()).toEqual([
      "context7",
      "database",
      "github",
      "playwright",
      "sentry",
    ]);
  });

  it("documents the verified component layout", () => {
    const structure = fs.readFileSync(
      path.join(root, "docs", "20-REPOSITORY-STRUCTURE.md"),
      "utf8",
    );
    for (const component of [
      "plugin.json",
      "agents/",
      "skills/",
      "rules/",
      "scripts/",
      "schemas/",
    ]) {
      expect(structure).toContain(component);
    }
  });
});
