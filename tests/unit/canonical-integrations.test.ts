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

  it("strictly prohibits deprecated legacy MCP server packages in runtime arguments and commands", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const deprecatedPackages = [
      "@modelcontextprotocol/server-github",
      "@modelcontextprotocol/server-playwright",
      "@modelcontextprotocol/server-postgres",
      "@modelcontextprotocol/server-sentry",
    ];

    for (const integration of integrations) {
      const runtimeString = JSON.stringify(integration.runtime);
      for (const deprecated of deprecatedPackages) {
        expect(
          runtimeString.includes(deprecated),
          `Integration ${integration.id} runtime commands must not use deprecated package ${deprecated}`,
        ).toBe(false);
      }
    }
  });

  it("verifies all integrations use officially verified provider references and licenses", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    for (const integration of integrations) {
      expect(["provider_verified", "runtime_tested"]).toContain(integration.lifecycle);
      expect(integration.provider.documentationUrl).toMatch(/^https?:\/\//);
      expect(integration.provider.maintainer.length).toBeGreaterThan(0);
    }
  });
});
