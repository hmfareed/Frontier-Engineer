import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_SKILL_SECTIONS,
  SKILL_IDS,
  buildSkillAdapterContent,
  loadCanonicalSkillSpecs,
  validateCanonicalSkillSpecs,
  type CanonicalSkillSpec,
} from "../../scripts/lib/canonical-skills.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const temporaryRoots: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-skills-"));
  temporaryRoots.push(dir);
  fs.cpSync(path.join(root, "schemas"), path.join(dir, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs", "skills"), { recursive: true });
  return dir;
}

function skillSpec(overrides: Record<string, unknown> = {}, body?: string): string {
  const frontmatter = {
    id: "architecture",
    name: "Architecture",
    title: "System Architecture and Technical Design",
    version: 1,
    summary:
      "Designs reliable, scalable and maintainable software systems. Inspects existing architecture and evaluates trade-offs.",
    description:
      "Use when designing system architecture, evaluating architectural trade-offs, planning service boundaries, or recording ADRs.",
    requiredCapabilities: ["repository-inspection", "architecture-analysis"],
    primaryAgents: ["architect", "frontier-engineer"],
    activationTriggers: ["architecture review", "system design"],
    nonActivationGuidelines: ["small CSS changes", "isolated bug fixes"],
    platformConfig: {},
    ...overrides,
  };
  const sections = REQUIRED_SKILL_SECTIONS.map(
    (section) => `## ${section}\n\nTechnical details for ${section}.\n`,
  ).join("\n");
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n# Architecture\n\n${body ?? sections}`;
}

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("canonical skill schema and validator", () => {
  it("rejects non-empty platformConfig to protect neutrality", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "skills", "architecture.md"),
      skillSpec({ platformConfig: { antigravitySpecificField: true } }),
      "utf8",
    );
    const findings = validateCanonicalSkillSpecs(temp);
    expect(findings.some((item) => item.rule === "invalid-canonical-skill")).toBe(true);
  });

  it("flags missing required sections", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "skills", "architecture.md"),
      skillSpec({}, "## Purpose\n\nOnly purpose is defined.\n"),
      "utf8",
    );
    const findings = validateCanonicalSkillSpecs(temp);
    expect(findings.some((item) => item.rule === "canonical-skill-section-missing")).toBe(true);
  });

  it("requires filename to match frontmatter id", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "skills", "mismatched-name.md"),
      skillSpec({ id: "architecture" }),
      "utf8",
    );
    const findings = validateCanonicalSkillSpecs(temp);
    expect(findings.some((item) => item.rule === "canonical-skill-id-filename-mismatch")).toBe(
      true,
    );
  });

  it("builds clean Antigravity skill adapter with matching name and description", () => {
    const mockSpec: CanonicalSkillSpec = {
      relPath: "specs/skills/architecture.md",
      id: "architecture",
      name: "Architecture",
      title: "System Architecture and Technical Design",
      version: 1,
      summary: "Designs reliable, scalable and maintainable software systems.",
      description: "Use when designing system architecture or recording ADRs.",
      requiredCapabilities: ["repository-inspection"],
      primaryAgents: ["architect"],
      activationTriggers: ["architecture review"],
      nonActivationGuidelines: ["small CSS changes"],
      body: "## Purpose\n\nDesign systems.\n\n## Progressive disclosure references\n\nCheck reference.",
      frontmatter: {},
    };

    const content = buildSkillAdapterContent(mockSpec);
    expect(content).toContain('name: "architecture"');
    expect(content).toContain(
      'description: "Use when designing system architecture or recording ADRs."',
    );
    expect(content).toContain("# Architecture — System Architecture and Technical Design");
    expect(content).toContain("> Generated from `specs/skills/architecture.md`");
  });
});
