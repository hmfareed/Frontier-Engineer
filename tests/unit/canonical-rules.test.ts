import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULAR_RULE_IDS,
  REQUIRED_RULE_SECTIONS,
  MANDATORY_GLOBAL_PRINCIPLES,
  buildRuleAdapterFiles,
  checkGeneratedRules,
  loadCanonicalRules,
  validateCanonicalRules,
} from "../../scripts/lib/canonical-rules.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { parseFrontmatter } from "../../scripts/lib/yaml-frontmatter.ts";

const root = repoRoot();

describe("canonical rule specifications in repository", () => {
  it("loads all 13 modular canonical rules and global AGENTS.md with zero findings", () => {
    const { rules, globalRule, findings } = loadCanonicalRules(root);
    expect(findings).toEqual([]);
    expect(rules).toHaveLength(13);
    expect(globalRule).not.toBeNull();
    const loadedIds = rules.map((r) => r.id).sort();
    expect(loadedIds).toEqual([...MODULAR_RULE_IDS].sort());
  });

  it("verifies the global rule AGENTS.md contains no frontmatter and includes all 15 principles", () => {
    const { globalRule } = loadCanonicalRules(root);
    expect(globalRule).not.toBeNull();
    expect(parseFrontmatter(globalRule!).present).toBe(false);
    for (const principle of MANDATORY_GLOBAL_PRINCIPLES) {
      expect(globalRule, `AGENTS.md missing principle: ${principle}`).toContain(principle);
    }
  });

  it("verifies every modular rule contains all 5 required canonical sections", () => {
    const { rules } = loadCanonicalRules(root);
    for (const rule of rules) {
      for (const section of REQUIRED_RULE_SECTIONS) {
        expect(rule.body, `Rule ${rule.id} missing section: ${section}`).toMatch(
          new RegExp(`^## ${section}\\s*$`, "m"),
        );
      }
    }
  });

  it("verifies all generated Antigravity rule files match canonical specifications with zero drift", () => {
    const findings = checkGeneratedRules(root);
    expect(findings).toEqual([]);
    const expected = buildRuleAdapterFiles(root);
    expect(expected.size).toBe(14); // 1 global AGENTS.md + 13 modular rules
    for (const relPath of expected.keys()) {
      expect(fs.existsSync(path.join(root, relPath)), `Missing generated rule ${relPath}`).toBe(
        true,
      );
    }
  });

  it("verifies every generated modular rule has valid Antigravity frontmatter", () => {
    const expected = buildRuleAdapterFiles(root);
    for (const [relPath, content] of expected) {
      if (relPath === "rules/AGENTS.md") {
        expect(parseFrontmatter(content).present).toBe(false);
      } else {
        const parsed = parseFrontmatter(content);
        expect(parsed.present, `${relPath} should have frontmatter`).toBe(true);
        expect(parsed.error).toBeNull();
        const data = parsed.data as Record<string, unknown>;
        expect(["glob", "model_decision", "always_on"]).toContain(data.trigger);
        if (data.trigger === "glob") {
          expect(typeof data.globs).toBe("string");
          expect((data.globs as string).length).toBeGreaterThan(0);
        }
        if (data.trigger === "model_decision") {
          expect(typeof data.description).toBe("string");
          expect((data.description as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("verifies priority range and enforcement levels across all rules", () => {
    const { rules } = loadCanonicalRules(root);
    for (const rule of rules) {
      expect(rule.priority).toBeGreaterThanOrEqual(1);
      expect(rule.priority).toBeLessThanOrEqual(10);
      expect(["mandatory", "advisory"]).toContain(rule.enforcementLevel);
    }
  });
});
