import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanonicalIntegrations } from "../../scripts/lib/canonical-integrations.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("integration security policies", () => {
  it("verifies no committed API tokens or secrets in generated MCP adapters", () => {
    const mcpConfig = fs.readFileSync(path.join(root, "mcp_config.json"), "utf8");
    const mcpExample = fs.readFileSync(path.join(root, "mcp_config.example.json"), "utf8");

    // Must not contain common secret token formats
    expect(mcpConfig).not.toMatch(/ghp_[A-Za-z0-9_]{36}/);
    expect(mcpConfig).not.toMatch(/sntrys_[A-Za-z0-9_]+/);
    expect(mcpExample).not.toMatch(/ghp_[A-Za-z0-9_]{36}/);
    expect(mcpExample).not.toMatch(/sntrys_[A-Za-z0-9_]+/);
  });

  it("enforces disabled: true by default in mcp_config.json", () => {
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(root, "mcp_config.json"), "utf8"));
    for (const [serverName, config] of Object.entries(
      mcpConfig.mcpServers as Record<string, { disabled: boolean }>,
    )) {
      expect(config.disabled, `Server ${serverName} must be disabled by default`).toBe(true);
    }
  });

  it("verifies database integration strictly prohibits DDL mutations", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const dbIntegration = integrations.find((i) => i.id === "database");
    expect(dbIntegration).toBeDefined();

    const toolNames = dbIntegration?.capabilities.tools.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain("execute_ddl");
    expect(toolNames).not.toContain("execute_mutation");
    expect(toolNames).not.toContain("drop_table");
    expect(toolNames).not.toContain("truncate_table");
  });

  it("verifies Playwright integration restricts browser access to test environments", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const pwIntegration = integrations.find((i) => i.id === "playwright");
    expect(pwIntegration).toBeDefined();

    const securityMd = fs.readFileSync(
      path.join(root, "specs", "integrations", "playwright", "security.md"),
      "utf8",
    );
    expect(securityMd).toContain("localhost");
    expect(securityMd).toContain("127.0.0.1");
    expect(securityMd).toContain("Prohibited");
  });

  it("verifies GitHub integration requires human confirmation for destructive actions", () => {
    const securityMd = fs.readFileSync(
      path.join(root, "specs", "integrations", "github", "security.md"),
      "utf8",
    );
    expect(securityMd).toContain("merge_pull_request");
    expect(securityMd).toContain("close_issue");
    expect(securityMd).toContain("delete_branch");
    expect(securityMd).toContain("Human-in-the-Loop");
  });
});
