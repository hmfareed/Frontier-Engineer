import { describe, expect, it } from "vitest";
import {
  INTEGRATION_IDS,
  loadIntegrationRegistry,
} from "../../scripts/lib/canonical-integrations.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("canonical integration registry", () => {
  it("loads and strictly validates specs/integrations/integration-registry.md", () => {
    const { registry, findings } = loadIntegrationRegistry(root);
    expect(findings).toEqual([]);
    expect(registry).not.toBeNull();
    expect(registry?.integrations).toHaveLength(5);
  });

  it("registers every required canonical integration", () => {
    const { registry } = loadIntegrationRegistry(root);
    const registeredIds = registry?.integrations.map((e) => e.id) ?? [];
    for (const requiredId of INTEGRATION_IDS) {
      expect(registeredIds).toContain(requiredId);
    }
  });

  it("verifies all integrations declare optional: true to prevent blocking local execution", () => {
    const { registry } = loadIntegrationRegistry(root);
    for (const entry of registry?.integrations ?? []) {
      expect(entry.optional).toBe(true);
      expect(entry.fallbackBehavior.length).toBeGreaterThan(10);
    }
  });

  it("confirms compatibility declarations for supported platforms", () => {
    const { registry } = loadIntegrationRegistry(root);
    for (const entry of registry?.integrations ?? []) {
      expect(entry.compatibility.antigravity).toBe("supported");
      expect(entry.compatibility.claude_code).toBe("supported");
      expect(entry.compatibility.cursor).toBe("supported");
      expect(entry.compatibility.codex).toBe("supported");
    }
  });
});
