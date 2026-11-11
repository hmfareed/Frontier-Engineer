import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_APPROVED_TOOLS,
  POSTGRES_PROHIBITED_TOOLS,
  loadCanonicalIntegrations,
} from "../../scripts/lib/canonical-integrations.ts";
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

  it("verifies Microsoft PostgreSQL MCP launch command includes the run argument", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const dbIntegration = integrations.find((i) => i.id === "database");
    expect(dbIntegration).toBeDefined();
    expect(dbIntegration?.runtime.executable).toBe("npx");
    expect(dbIntegration?.runtime.args).toEqual(["-y", "@microsoft/postgres-mcp@0.3.0", "run"]);
  });

  it("verifies PostgreSQL integration strictly excludes mutating tools and only exposes read-only tools", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const dbIntegration = integrations.find((i) => i.id === "database");
    expect(dbIntegration).toBeDefined();

    const toolNames = dbIntegration?.capabilities.tools.map((t) => t.name) ?? [];
    // Mutating tools strictly excluded
    expect(toolNames).not.toContain("postgres_mcp_modify");
    expect(toolNames).not.toContain("postgres_mcp_bulk_load_csv");
    expect(toolNames).not.toContain("postgres_mcp_add_connection");
    expect(toolNames).not.toContain("postgres_mcp_remove_connection");

    // All exposed tools must be read_only
    for (const tool of dbIntegration?.capabilities.tools ?? []) {
      expect(tool.permissionClass).toBe("read_only");
    }
  });

  it("verifies Sentry integration requires official SENTRY_AUTH_TOKEN and does not use deprecated SENTRY_ACCESS_TOKEN", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const sentryIntegration = integrations.find((i) => i.id === "sentry");
    expect(sentryIntegration).toBeDefined();

    const envNames = sentryIntegration?.runtime.envVars.map((e) => e.name) ?? [];
    expect(envNames).toContain("SENTRY_AUTH_TOKEN");
    expect(envNames).not.toContain("SENTRY_ACCESS_TOKEN");

    const credEnvVars = sentryIntegration?.security.credentialEnvVars ?? [];
    expect(credEnvVars).toContain("SENTRY_AUTH_TOKEN");
    expect(credEnvVars).not.toContain("SENTRY_ACCESS_TOKEN");

    const integrationMd = fs.readFileSync(
      path.join(root, "specs", "integrations", "sentry", "integration.md"),
      "utf8",
    );
    expect(integrationMd).toContain("SENTRY_AUTH_TOKEN");
    expect(integrationMd).not.toContain("If SENTRY_ACCESS_TOKEN is unset");
  });

  it("verifies Playwright security policy accurately documents the six security dimensions without overstating isolation", () => {
    const securityMd = fs.readFileSync(
      path.join(root, "specs", "integrations", "playwright", "security.md"),
      "utf8",
    );
    expect(securityMd).toContain("Browser Profile Isolation");
    expect(securityMd).toContain("Browser Process Isolation");
    expect(securityMd).toContain("Operating-System Sandboxing");
    expect(securityMd).toContain("Filesystem Access");
    expect(securityMd).toContain("Network Access");
    expect(securityMd).toContain("Website Interaction & External Side Effects");
    // Verify explicit disclaimer that Node.js process is not sandboxed
    expect(securityMd).toContain(
      "Node.js MCP server process itself is **not** sandboxed by default",
    );
  });

  it("verifies GitHub integration enforces server-side --read-only and fine-grained PAT scopes", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const ghIntegration = integrations.find((i) => i.id === "github");
    expect(ghIntegration).toBeDefined();
    expect(ghIntegration?.runtime.args).toContain("--read-only");

    const securityMd = fs.readFileSync(
      path.join(root, "specs", "integrations", "github", "security.md"),
      "utf8",
    );
    expect(securityMd).toContain("Contents");
    expect(securityMd).toContain("Issues");
    expect(securityMd).toContain("Pull requests");
    expect(securityMd).toContain("Read-only");
  });

  it("verifies all five canonical integrations pin exact provider versions", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const expectedVersions: Record<string, string> = {
      github: "2.1.0",
      context7: "4.6.0",
      playwright: "0.0.85",
      sentry: "0.49.0",
      database: "0.3.0",
    };

    for (const integration of integrations) {
      const expectedVer = expectedVersions[integration.id];
      expect(expectedVer).toBeDefined();

      const argsJoined = integration.runtime.args.join(" ");
      expect(argsJoined).not.toContain("@latest");
      expect(argsJoined).not.toContain(":latest");
      expect(argsJoined).toMatch(new RegExp(expectedVer.replace(".", "\\.")));
    }
  });

  it("verifies database configuration has a non-empty enabledTools allowlist containing only approved tools", () => {
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(root, "mcp_config.json"), "utf8"));
    const mcpExample = JSON.parse(
      fs.readFileSync(path.join(root, "mcp_config.example.json"), "utf8"),
    );

    const dbConfig = mcpConfig.mcpServers.database;
    const dbExample = mcpExample.mcpServers.database;

    expect(dbConfig).toBeDefined();
    expect(dbConfig.enabledTools).toBeDefined();
    expect(Array.isArray(dbConfig.enabledTools)).toBe(true);
    expect(dbConfig.enabledTools.length).toBe(POSTGRES_APPROVED_TOOLS.length);
    expect(dbConfig.enabledTools.length).toBeGreaterThan(0);

    // Exact tool allowlist match
    for (const approved of POSTGRES_APPROVED_TOOLS) {
      expect(dbConfig.enabledTools).toContain(approved);
      expect(dbExample.enabledTools).toContain(approved);
    }

    // No prohibited tools present
    for (const prohibited of POSTGRES_PROHIBITED_TOOLS) {
      expect(dbConfig.enabledTools).not.toContain(prohibited);
      expect(dbExample.enabledTools).not.toContain(prohibited);
    }

    // Database remains disabled by default in production adapter
    expect(dbConfig.disabled).toBe(true);
  });

  it("verifies other integrations do not unintentionally inherit the database tool allowlist", () => {
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(root, "mcp_config.json"), "utf8"));
    const mcpExample = JSON.parse(
      fs.readFileSync(path.join(root, "mcp_config.example.json"), "utf8"),
    );

    const nonDatabaseServers = ["github", "context7", "playwright", "sentry"];

    for (const serverId of nonDatabaseServers) {
      const serverConfig = mcpConfig.mcpServers[serverId];
      expect(serverConfig).toBeDefined();
      expect(
        serverConfig.enabledTools,
        `Server '${serverId}' must not inherit enabledTools allowlist in mcp_config.json`,
      ).toBeUndefined();

      const exampleConfig = mcpExample.mcpServers[serverId];
      expect(exampleConfig).toBeDefined();
      expect(
        exampleConfig.enabledTools,
        `Server '${serverId}' must not inherit enabledTools allowlist in mcp_config.example.json`,
      ).toBeUndefined();
    }
  });

  it("verifies destructive, external-side-effect, and filesystem tools are strictly excluded from database capabilities", () => {
    const { integrations } = loadCanonicalIntegrations(root);
    const dbIntegration = integrations.find((i) => i.id === "database");
    expect(dbIntegration).toBeDefined();

    const toolNames = dbIntegration?.capabilities.tools.map((t) => t.name) ?? [];

    // Destructive tools
    expect(toolNames).not.toContain("postgres_mcp_modify");
    expect(toolNames).not.toContain("postgres_mcp_remove_connection");

    // External-side-effect tools
    expect(toolNames).not.toContain("postgres_mcp_bulk_load_csv");
    expect(toolNames).not.toContain("postgres_mcp_add_connection");

    // Local filesystem access tool
    expect(toolNames).not.toContain("postgres_mcp_describe_csv");

    // Total tools exposed must match approved tools count
    expect(toolNames).toHaveLength(POSTGRES_APPROVED_TOOLS.length);
  });

  it("verifies validation rejects prohibited, unapproved, or non-read-only database tools", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-db-test-"));
    try {
      fs.cpSync(path.join(root, "schemas"), path.join(tempDir, "schemas"), { recursive: true });
      for (const id of ["github", "context7", "playwright", "sentry", "database"]) {
        fs.cpSync(
          path.join(root, "specs", "integrations", id),
          path.join(tempDir, "specs", "integrations", id),
          { recursive: true },
        );
      }
      fs.cpSync(
        path.join(root, "specs", "integrations", "integration-registry.md"),
        path.join(tempDir, "specs", "integrations", "integration-registry.md"),
      );

      const dbSpecPath = path.join(tempDir, "specs", "integrations", "database", "integration.md");
      const validSpec = fs.readFileSync(dbSpecPath, "utf8");

      // Test 1: Adding a prohibited mutating tool (postgres_mcp_modify)
      const specWithModify = validSpec.replace("postgres_mcp_query", "postgres_mcp_modify");
      fs.writeFileSync(dbSpecPath, specWithModify, "utf8");
      const { findings: findingsModify } = loadCanonicalIntegrations(tempDir);
      expect(findingsModify.some((f) => f.rule === "prohibited-database-tool")).toBe(true);

      // Test 2: Adding an unknown tool (postgres_mcp_unknown_xyz)
      const specWithUnknown = validSpec.replace("postgres_mcp_query", "postgres_mcp_unknown_xyz");
      fs.writeFileSync(dbSpecPath, specWithUnknown, "utf8");
      const { findings: findingsUnknown } = loadCanonicalIntegrations(tempDir);
      expect(findingsUnknown.some((f) => f.rule === "unapproved-database-tool")).toBe(true);

      // Test 3: Setting a non-read_only permissionClass
      const specWithDestructive = validSpec.replace(
        'permissionClass: "read_only"',
        'permissionClass: "destructive"',
      );
      fs.writeFileSync(dbSpecPath, specWithDestructive, "utf8");
      const { findings: findingsPerm } = loadCanonicalIntegrations(tempDir);
      expect(findingsPerm.some((f) => f.rule === "invalid-database-tool-permission")).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
