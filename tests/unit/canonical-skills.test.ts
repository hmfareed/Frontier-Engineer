import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_SKILL_SECTIONS,
  SKILL_IDS,
  buildSkillAdapterFiles,
  checkGeneratedSkills,
  loadCanonicalSkillSpecs,
  validateCanonicalSkillSpecs,
} from "../../scripts/lib/canonical-skills.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("canonical skill specifications in repository", () => {
  it("loads all ten canonical skills with zero findings", () => {
    const { specs, findings } = loadCanonicalSkillSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(10);
    const loadedIds = specs.map((s) => s.id).sort();
    expect(loadedIds).toEqual([...SKILL_IDS].sort());
  });

  it("verifies every skill has all ten required canonical sections", () => {
    const { specs } = loadCanonicalSkillSpecs(root);
    for (const spec of specs) {
      for (const section of REQUIRED_SKILL_SECTIONS) {
        expect(spec.body, `Skill ${spec.id} missing section ${section}`).toMatch(
          new RegExp(`^## ${section}\\s*$`, "m"),
        );
      }
    }
  });

  it("verifies all generated Antigravity skill files match canonical specifications", () => {
    const findings = checkGeneratedSkills(root);
    expect(findings).toEqual([]);
    const expected = buildSkillAdapterFiles(root);
    expect(expected.size).toBe(20); // 10 SKILL.md + 10 references
    for (const relPath of expected.keys()) {
      expect(fs.existsSync(path.join(root, relPath)), `Missing ${relPath}`).toBe(true);
    }
  });

  it("verifies each canonical skill defines meaningful activation and non-activation guidelines", () => {
    const { specs } = loadCanonicalSkillSpecs(root);
    for (const spec of specs) {
      expect(spec.activationTriggers.length).toBeGreaterThanOrEqual(3);
      expect(spec.nonActivationGuidelines.length).toBeGreaterThanOrEqual(3);
      expect(spec.requiredCapabilities.length).toBeGreaterThanOrEqual(1);
      expect(spec.primaryAgents.length).toBeGreaterThanOrEqual(1);
    }
  });
});
