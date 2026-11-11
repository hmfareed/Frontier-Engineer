import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_INTEGRATION_SCHEMA,
  REQUIRED_INTEGRATION_SECTIONS,
  loadCanonicalIntegrations,
} from "../../scripts/lib/canonical-integrations.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const temporaryRoots: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-integrations-"));
  temporaryRoots.push(dir);
  fs.cpSync(path.join(root, "schemas"), path.join(dir, "schemas"), { recursive: true });
  for (const id of ["github", "context7", "playwright", "sentry", "database"]) {
    fs.mkdirSync(path.join(dir, "specs", "integrations", id), { recursive: true });
  }
  return dir;
}

function validIntegration(overrides: Record<string, unknown> = {}, body?: string): string {
  const frontmatter = {
    id: "github",
    name: "GitHub Integration",
    description: "Connects agents to remote repositories for PRs, issues, and code inspection.",
    category: "repository",
    version: "1.0.0",
    lifecycle: "available",
    provider: {
      name: "Model Context Protocol Official",
      documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers",
      maintainer: "Anthropic / MCP Working Group",
      license: "MIT",
      verificationDate: "2026-11-10",
    },
    runtime: {
      transport: "stdio",
      runtime: "node",
      executable: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envVars: [
        {
          name: "GITHUB_PERSONAL_ACCESS_TOKEN",
          required: true,
          description: "GitHub token with scoped repo access.",
          secret: true,
        },
      ],
    },
    capabilities: {
      tools: [
        {
          name: "get_file_contents",
          description: "Reads file contents.",
          permissionClass: "read_only",
          agentAffinity: ["frontier-engineer", "implementation-engineer"],
        },
      ],
      resources: [],
      prompts: [],
    },
    security: {
      authenticationType: "bearer_token",
      permissionClasses: ["read_only"],
      readOnlyAlternative: "Use local git status, log, diff.",
      credentialEnvVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    },
    platformConfig: {},
    ...overrides,
  };

  const sections = REQUIRED_INTEGRATION_SECTIONS.map(
    (sec) => `## ${sec}\n\nTechnical details for ${sec}.\n`,
  ).join("\n");

  return `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n\n# GitHub Integration\n\n${body ?? sections}`;
}

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("canonical integration schema and validator", () => {
  it("rejects non-empty platformConfig to protect neutrality", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "integration.md"),
      validIntegration({ platformConfig: { antigravitySpecificField: true } }),
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "capabilities.md"),
      "# Capabilities\n",
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "security.md"),
      "# Security\n",
    );

    const { findings } = loadCanonicalIntegrations(temp);
    expect(
      findings.some(
        (f) =>
          f.rule === "canonical-integration-schema" &&
          f.message.includes("NOT have additional properties"),
      ),
    ).toBe(true);
  });

  it("rejects invalid lifecycle states", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "integration.md"),
      validIntegration({ lifecycle: "unsupported_lifecycle" }),
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "capabilities.md"),
      "# Capabilities\n",
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "security.md"),
      "# Security\n",
    );

    const { findings } = loadCanonicalIntegrations(temp);
    expect(
      findings.some(
        (f) =>
          f.rule === "canonical-integration-schema" &&
          f.message.includes("must be equal to one of the allowed values"),
      ),
    ).toBe(true);
  });

  it("rejects invalid categories", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "integration.md"),
      validIntegration({ category: "invalid_category" }),
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "capabilities.md"),
      "# Capabilities\n",
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "security.md"),
      "# Security\n",
    );

    const { findings } = loadCanonicalIntegrations(temp);
    expect(
      findings.some(
        (f) =>
          f.rule === "canonical-integration-schema" &&
          f.message.includes("must be equal to one of the allowed values"),
      ),
    ).toBe(true);
  });

  it("rejects invalid permission classes on tools", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "integration.md"),
      validIntegration({
        capabilities: {
          tools: [
            {
              name: "invalid_tool",
              description: "Tool with invalid class.",
              permissionClass: "super_admin_write",
              agentAffinity: ["frontier-engineer"],
            },
          ],
          resources: [],
          prompts: [],
        },
      }),
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "capabilities.md"),
      "# Capabilities\n",
    );
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "security.md"),
      "# Security\n",
    );

    const { findings } = loadCanonicalIntegrations(temp);
    expect(
      findings.some(
        (f) =>
          f.rule === "canonical-integration-schema" &&
          f.message.includes("must be equal to one of the allowed values"),
      ),
    ).toBe(true);
  });

  it("detects missing companion files (capabilities.md or security.md)", () => {
    const temp = makeRoot();
    fs.writeFileSync(
      path.join(temp, "specs", "integrations", "github", "integration.md"),
      validIntegration(),
    );
    // Deliberately omit capabilities.md and security.md

    const { findings } = loadCanonicalIntegrations(temp);
    expect(findings.some((f) => f.rule === "missing-integration-capabilities")).toBe(true);
    expect(findings.some((f) => f.rule === "missing-integration-security")).toBe(true);
  });
});
