import { describe, expect, it } from "vitest";
import {
  INTEGRATION_IDS,
  PERMISSION_CLASSES,
  REQUIRED_INTEGRATION_SECTIONS,
  checkGeneratedIntegrations,
  loadCanonicalIntegrations,
} from "../../scripts/lib/canonical-integrations.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("canonical integration specifications", () => {
  it("loads all 5 canonical integrations with zero schema or structural errors", () => {
    const { integrations, findings } = loadCanonicalIntegrations(root);
    expect(findings).toEqual([]);
    expect(integrations).toHaveLength(5);

    const ids = integrations.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([...INTEGRATION_IDS]));
  });

  it("ensures every integration implements all required sections in body", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    for (const integration of integrations) {
      for (const section of REQUIRED_INTEGRATION_SECTIONS) {
        const pattern = new RegExp(
          `^##\\s+${section.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`,
          "mi",
        );
        expect(
          pattern.test(integration.body),
          `Integration ${integration.id} is missing section '## ${section}'`,
        ).toBe(true);
      }
    }
  });

  it("verifies tool permission classes conform to verified authorization levels", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    for (const integration of integrations) {
      for (const tool of integration.capabilities.tools) {
        expect(PERMISSION_CLASSES).toContain(tool.permissionClass);
        expect(tool.agentAffinity.length).toBeGreaterThan(0);
      }
    }
  });

  it("ensures zero drift between canonical specs and generated Antigravity MCP config", () => {
    const driftFindings = checkGeneratedIntegrations(root);
    expect(driftFindings).toEqual([]);
  });
});
