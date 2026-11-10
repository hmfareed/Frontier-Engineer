import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { SKILL_IDS } from "../../scripts/lib/canonical-skills.ts";

const root = repoRoot();

describe("skill evaluation scenarios", () => {
  it("validates specs/evaluation/skill-scenarios.json against its schema", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "skill-scenarios.json"),
      "utf8",
    );
    const data = JSON.parse(raw);
    const findings = validateValueAgainstSchema(
      root,
      data,
      "specs/evaluation/skill-scenarios.json",
      "schemas/skill-evaluation-scenarios.schema.json",
      "invalid-skill-scenarios",
    );
    expect(findings).toEqual([]);
    expect(data.status).toBe("defined");
  });

  it("defines at least two scenarios for every one of the ten canonical skills", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "skill-scenarios.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as { skills: Record<string, unknown[]> };
    for (const skillId of SKILL_IDS) {
      expect(data.skills[skillId], `Missing scenarios for skill ${skillId}`).toBeDefined();
      expect(data.skills[skillId].length).toBeGreaterThanOrEqual(2);
    }
  });

  it("includes all six core evaluation rubric dimensions", () => {
    const raw = fs.readFileSync(
      path.join(root, "specs", "evaluation", "skill-scenarios.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as { rubric: Array<{ dimension: string }> };
    expect(data.rubric.length).toBeGreaterThanOrEqual(6);
    const dimensions = data.rubric.map((r) => r.dimension);
    expect(dimensions).toContain("Procedural Fidelity");
    expect(dimensions).toContain("Technical Depth");
    expect(dimensions).toContain("Evidence & Verification");
    expect(dimensions).toContain("Honest Test-State Discipline");
  });
});
