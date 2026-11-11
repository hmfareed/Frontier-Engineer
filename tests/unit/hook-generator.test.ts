import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAntigravityHooksConfig,
  checkGeneratedHooks,
} from "../../scripts/lib/canonical-hooks.ts";
import { validateAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("Antigravity hooks generator and drift detection", () => {
  it("builds a valid Antigravity hooks.json matching schemas/hooks.schema.json", () => {
    const jsonStr = buildAntigravityHooksConfig(root);
    expect(jsonStr).toContain("frontier-session-init");
    expect(jsonStr).toContain("frontier-pre-tool-safety");
    expect(jsonStr).toContain("frontier-post-tool-audit");
    expect(jsonStr).toContain("frontier-engineering-context");
    expect(jsonStr).toContain("frontier-invocation-audit");
    expect(jsonStr).toContain("frontier-session-stop");

    const parsed = JSON.parse(jsonStr);
    expect(Object.keys(parsed)).toHaveLength(6);

    const schemaFindings = validateAgainstSchema(
      root,
      "hooks.json",
      "schemas/hooks.schema.json",
      "test-rule",
    );
    expect(schemaFindings).toEqual([]);
  });

  it("confirms current hooks.json has zero drift", () => {
    const findings = checkGeneratedHooks(root);
    expect(findings).toEqual([]);
  });

  it("detects drift when hooks.json is modified", () => {
    const hooksPath = path.join(root, "hooks.json");
    const original = fs.readFileSync(hooksPath, "utf8");
    try {
      fs.writeFileSync(hooksPath, original + "\n// drift", "utf8");
      const findings = checkGeneratedHooks(root);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.rule).toBe("stale-generated-hooks-json");
    } finally {
      fs.writeFileSync(hooksPath, original, "utf8");
    }
  });
});
