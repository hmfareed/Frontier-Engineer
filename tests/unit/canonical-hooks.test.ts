import { describe, expect, it } from "vitest";
import {
  HOOK_IDS,
  LIFECYCLE_EVENTS,
  REQUIRED_HOOK_SECTIONS,
  loadCanonicalHookSpecs,
  loadHookRegistry,
  validateCanonicalHooks,
} from "../../scripts/lib/canonical-hooks.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("canonical lifecycle hook specifications", () => {
  it("loads all six canonical hook specifications with zero validation errors", () => {
    const { specs, findings } = loadCanonicalHookSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(6);
    const loadedIds = specs.map((s) => s.id).sort();
    expect(loadedIds).toEqual([...HOOK_IDS].sort());
  });

  it("verifies every canonical hook implements all seven required sections", () => {
    const { specs } = loadCanonicalHookSpecs(root);
    for (const spec of specs) {
      for (const section of REQUIRED_HOOK_SECTIONS) {
        expect(spec.body, `Hook ${spec.id} missing section "${section}"`).toMatch(
          new RegExp(`^## ${section}\\s*$`, "m"),
        );
      }
    }
  });

  it("verifies hook registry frontmatter matches canonical hook specifications", () => {
    const { registry, findings } = loadHookRegistry(root);
    expect(findings).toEqual([]);
    expect(registry).not.toBeNull();
    expect(registry?.hooks).toHaveLength(6);

    const regIds = (registry?.hooks ?? []).map((h) => h.id).sort();
    expect(regIds).toEqual([...HOOK_IDS].sort());
  });

  it("ensures tool events define a non-empty matcher and valid timeout bounds", () => {
    const { specs } = loadCanonicalHookSpecs(root);
    for (const spec of specs) {
      expect(LIFECYCLE_EVENTS).toContain(spec.event);
      expect(spec.handler.timeout).toBeGreaterThan(0);
      expect(spec.handler.timeout).toBeLessThanOrEqual(120);
      expect(spec.handler.command).toContain("node scripts/hooks/");

      if (spec.event === "PreToolUse" || spec.event === "PostToolUse") {
        expect(spec.matcher).toBeDefined();
        expect(spec.matcher?.length).toBeGreaterThan(0);
      }
    }
  });

  it("runs full canonical hook validation with zero findings", () => {
    const findings = validateCanonicalHooks(root);
    expect(findings).toEqual([]);
  });
});
