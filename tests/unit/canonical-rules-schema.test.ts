import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MANDATORY_GLOBAL_PRINCIPLES,
  REQUIRED_RULE_SECTIONS,
  buildRuleAdapterContent,
  loadCanonicalRules,
  validateCanonicalRules,
  type CanonicalRuleSpec,
} from "../../scripts/lib/canonical-rules.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const temporaryRoots: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-rules-"));
  temporaryRoots.push(dir);
  fs.cpSync(path.join(root, "schemas"), path.join(dir, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs", "rules", "engineering"), { recursive: true });
  // write minimal valid global AGENTS.md
  const globalLines = [
    "# Global Rules",
    "",
    ...MANDATORY_GLOBAL_PRINCIPLES.map((p, i) => `${i + 1}. ${p}.`),
  ];
  fs.writeFileSync(path.join(dir, "specs", "rules", "AGENTS.md"), globalLines.join("\n"), "utf8");
  return dir;
}

function ruleSpec(overrides: Record<string, unknown> = {}, body?: string): string {
  const frontmatter: Record<string, unknown> = {
    id: "general-engineering",
    name: "General Engineering",
    category: "engineering",
    triggerType: "glob",
    globs: "**/*.{ts,tsx,js,jsx}",
    description: "Foundational engineering standards and clean architecture invariants.",
    priority: 8,
    enforcementLevel: "mandatory",
    platformConfig: {},
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete frontmatter[key];
    } else {
      frontmatter[key] = value;
    }
  }
  const sections = REQUIRED_RULE_SECTIONS.map(
    (section) => `## ${section}\n\nTechnical details for ${section}.\n`,
  ).join("\n");
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n# General Engineering\n\n${body ?? sections}`;
}

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("canonical rule schema and validator", () => {
  it("rejects non-empty platformConfig to protect neutrality", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "rules", "engineering", "general-engineering.md"),
      ruleSpec({ platformConfig: { vendorSpecificFlag: true } }),
      "utf8",
    );
    const findings = validateCanonicalRules(temp);
    expect(findings.some((item) => item.rule === "invalid-canonical-rule")).toBe(true);
  });

  it("requires globs property when triggerType is glob", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "rules", "engineering", "general-engineering.md"),
      ruleSpec({ triggerType: "glob", globs: undefined }),
      "utf8",
    );
    const findings = validateCanonicalRules(temp);
    expect(findings.some((item) => item.rule === "invalid-canonical-rule")).toBe(true);
  });

  it("flags missing required sections", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "rules", "engineering", "general-engineering.md"),
      ruleSpec({}, "## Purpose\n\nOnly purpose is defined.\n"),
      "utf8",
    );
    const findings = validateCanonicalRules(temp);
    expect(findings.some((item) => item.rule === "canonical-rule-section-missing")).toBe(true);
  });

  it("requires filename to match frontmatter id", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "rules", "engineering", "mismatched-file.md"),
      ruleSpec({ id: "general-engineering" }),
      "utf8",
    );
    const findings = validateCanonicalRules(temp);
    expect(findings.some((item) => item.rule === "canonical-rule-id-filename-mismatch")).toBe(true);
  });

  it("builds Antigravity rule adapter with verified frontmatter", () => {
    const mockSpec: CanonicalRuleSpec = {
      relPath: "specs/rules/engineering/general-engineering.md",
      id: "general-engineering",
      name: "General Engineering",
      category: "engineering",
      triggerType: "glob",
      globs: "**/*.{ts,tsx}",
      description: "Applies to TypeScript source files.",
      priority: 8,
      enforcementLevel: "mandatory",
      body: "## Purpose\n\nStandards.\n",
      frontmatter: {},
    };

    const content = buildRuleAdapterContent(mockSpec);
    expect(content).toContain('trigger: "glob"');
    expect(content).toContain('globs: "**/*.{ts,tsx}"');
    expect(content).toContain('description: "Applies to TypeScript source files."');
    expect(content).toContain("# General Engineering Rule");
  });
});
