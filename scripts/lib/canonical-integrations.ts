import path from "node:path";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { exists, readText } from "./walk.ts";
import { parseFrontmatter } from "./yaml-frontmatter.ts";

export const INTEGRATION_IDS = ["github", "context7", "playwright", "sentry", "database"] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const INTEGRATION_CATEGORIES = [
  "repository",
  "documentation",
  "browser_testing",
  "observability",
  "database",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const PERMISSION_CLASSES = [
  "read_only",
  "reversible_write",
  "external_side_effect",
  "destructive",
  "sensitive_data_access",
] as const;

export type PermissionClass = (typeof PERMISSION_CLASSES)[number];

export const POSTGRES_APPROVED_TOOLS = [
  "postgres_mcp_query",
  "postgres_mcp_db_context",
  "postgres_mcp_connect",
  "postgres_mcp_disconnect",
  "postgres_mcp_list_connection_profiles",
  "postgres_mcp_list_databases",
  "postgres_mcp_get_server_capabilities",
  "postgres_mcp_get_metrics_group",
] as const;

export const POSTGRES_PROHIBITED_TOOLS = [
  "postgres_mcp_modify",
  "postgres_mcp_bulk_load_csv",
  "postgres_mcp_add_connection",
  "postgres_mcp_remove_connection",
  "postgres_mcp_describe_csv",
] as const;

export const REQUIRED_INTEGRATION_SECTIONS = [
  "Purpose and overview",
  "Provider and maintenance",
  "Runtime requirements and transport",
  "Capabilities and tool definitions",
  "Security and permission boundaries",
  "Operational behavior and failure handling",
  "Cross-platform portability",
] as const;

export const CANONICAL_INTEGRATION_SCHEMA = "schemas/canonical-integration.schema.json";
export const INTEGRATION_REGISTRY_SCHEMA = "schemas/integration-registry.schema.json";

export interface CanonicalIntegrationSpec {
  relPath: string;
  id: IntegrationId;
  name: string;
  description: string;
  category: IntegrationCategory;
  version: string;
  lifecycle: string;
  provider: {
    name: string;
    documentationUrl: string;
    repositoryUrl: string;
    maintainer: string;
    license: string;
    verificationDate: string;
  };
  runtime: {
    transport: "stdio" | "streamable_http";
    runtime: "node" | "python" | "binary";
    executable: string;
    args: string[];
    envVars: Array<{
      name: string;
      required: boolean;
      description: string;
      secret: boolean;
    }>;
  };
  capabilities: {
    tools: Array<{
      name: string;
      description: string;
      permissionClass: PermissionClass;
      agentAffinity: string[];
    }>;
    resources: Array<{ uri: string; name: string; description: string }>;
    prompts: Array<{ name: string; description: string }>;
  };
  security: {
    authenticationType: "bearer_token" | "api_key" | "connection_string" | "none";
    permissionClasses: PermissionClass[];
    readOnlyAlternative: string;
    credentialEnvVars: string[];
    toolFiltering?: "allowlist" | "server_side" | "none";
  };
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface IntegrationRegistryEntry {
  id: string;
  name: string;
  category: string;
  lifecycle: string;
  optional: boolean;
  provider: {
    name: string;
    documentationUrl: string;
    maintainer: string;
  };
  specPaths: {
    integration: string;
    capabilities: string;
    security: string;
  };
  agentMappings: string[];
  fallbackBehavior: string;
  compatibility: {
    antigravity: string;
    claude_code: string;
    cursor: string;
    codex: string;
  };
}

export interface IntegrationRegistry {
  version: string;
  lastUpdated: string;
  integrations: IntegrationRegistryEntry[];
}

function hasHeading(body: string, title: string): boolean {
  const pattern = new RegExp(`^##\\s+${title.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "mi");
  return pattern.test(body);
}

/** Loads and validates all five canonical MCP integrations. */
export function loadCanonicalIntegrations(root: string): {
  integrations: CanonicalIntegrationSpec[];
  findings: Finding[];
} {
  const integrations: CanonicalIntegrationSpec[] = [];
  const findings: Finding[] = [];

  for (const id of INTEGRATION_IDS) {
    const dirRel = `specs/integrations/${id}`;
    const integrationPath = `${dirRel}/integration.md`;
    const capabilitiesPath = `${dirRel}/capabilities.md`;
    const securityPath = `${dirRel}/security.md`;

    // 1. Verify companion files exist
    if (!exists(root, capabilitiesPath)) {
      findings.push(
        finding(
          "error",
          "missing-integration-capabilities",
          capabilitiesPath,
          `Capabilities specification missing for canonical integration '${id}'.`,
        ),
      );
    }
    if (!exists(root, securityPath)) {
      findings.push(
        finding(
          "error",
          "missing-integration-security",
          securityPath,
          `Security policy specification missing for canonical integration '${id}'.`,
        ),
      );
    }

    // 2. Read and parse integration.md
    const text = readText(root, integrationPath);
    if (text === null) {
      findings.push(
        finding(
          "error",
          "missing-canonical-integration",
          integrationPath,
          `Canonical integration specification missing for '${id}'.`,
        ),
      );
      continue;
    }

    const parsed = parseFrontmatter(text);
    if (!parsed.present || parsed.error) {
      findings.push(
        finding(
          "error",
          "invalid-integration-frontmatter",
          integrationPath,
          `Integration '${id}' requires valid YAML frontmatter.`,
        ),
      );
      continue;
    }

    const data =
      typeof parsed.data === "object" && parsed.data !== null
        ? (parsed.data as Record<string, unknown>)
        : {};

    const schemaFindings = validateValueAgainstSchema(
      root,
      data,
      integrationPath,
      CANONICAL_INTEGRATION_SCHEMA,
      "canonical-integration-schema",
    );
    findings.push(...schemaFindings);

    if (data.id !== id) {
      findings.push(
        finding(
          "error",
          "integration-id-mismatch",
          integrationPath,
          `Integration frontmatter id '${data.id}' does not match directory '${id}'.`,
        ),
      );
    }

    // Verify required sections in body
    for (const section of REQUIRED_INTEGRATION_SECTIONS) {
      if (!hasHeading(parsed.body, section)) {
        findings.push(
          finding(
            "error",
            "missing-integration-section",
            integrationPath,
            `Canonical integration '${id}' missing required section '## ${section}'.`,
          ),
        );
      }
    }

    // Specific security validation for database integration
    if (id === "database") {
      const declaredTools = Array.isArray((data.capabilities as Record<string, unknown>)?.tools)
        ? ((data.capabilities as Record<string, unknown>).tools as Array<Record<string, unknown>>)
        : [];

      if (declaredTools.length === 0) {
        findings.push(
          finding(
            "error",
            "empty-database-tool-allowlist",
            integrationPath,
            "PostgreSQL database integration must declare a non-empty tool allowlist.",
          ),
        );
      }

      for (const t of declaredTools) {
        const toolName = String(t?.name || "");
        if (
          POSTGRES_PROHIBITED_TOOLS.includes(toolName as (typeof POSTGRES_PROHIBITED_TOOLS)[number])
        ) {
          findings.push(
            finding(
              "error",
              "prohibited-database-tool",
              integrationPath,
              `Tool '${toolName}' is strictly prohibited from the database tool allowlist due to risk classification.`,
            ),
          );
        } else if (
          !POSTGRES_APPROVED_TOOLS.includes(toolName as (typeof POSTGRES_APPROVED_TOOLS)[number])
        ) {
          findings.push(
            finding(
              "error",
              "unapproved-database-tool",
              integrationPath,
              `Tool '${toolName}' is not an approved PostgreSQL inspection tool.`,
            ),
          );
        }

        if (t?.permissionClass !== "read_only") {
          findings.push(
            finding(
              "error",
              "invalid-database-tool-permission",
              integrationPath,
              `Database tool '${toolName}' must have permissionClass 'read_only' (found '${t?.permissionClass}').`,
            ),
          );
        }
      }
    }

    integrations.push({
      relPath: integrationPath,
      id,
      name: String(data.name || ""),
      description: String(data.description || ""),
      category: data.category as IntegrationCategory,
      version: String(data.version || ""),
      lifecycle: String(data.lifecycle || ""),
      provider: data.provider as CanonicalIntegrationSpec["provider"],
      runtime: data.runtime as CanonicalIntegrationSpec["runtime"],
      capabilities: data.capabilities as CanonicalIntegrationSpec["capabilities"],
      security: data.security as CanonicalIntegrationSpec["security"],
      body: parsed.body,
      frontmatter: data,
    });
  }

  return { integrations, findings };
}

/** Loads and validates the central integration registry. */
export function loadIntegrationRegistry(root: string): {
  registry: IntegrationRegistry | null;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const registryRel = "specs/integrations/integration-registry.md";
  const text = readText(root, registryRel);

  if (text === null) {
    findings.push(
      finding(
        "error",
        "missing-integration-registry",
        registryRel,
        "Central integration registry file missing.",
      ),
    );
    return { registry: null, findings };
  }

  const parsed = parseFrontmatter(text);
  if (!parsed.present || parsed.error) {
    findings.push(
      finding(
        "error",
        "invalid-integration-registry-frontmatter",
        registryRel,
        "Integration registry requires valid YAML frontmatter.",
      ),
    );
    return { registry: null, findings };
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : {};

  const schemaFindings = validateValueAgainstSchema(
    root,
    data,
    registryRel,
    INTEGRATION_REGISTRY_SCHEMA,
    "integration-registry-schema",
  );
  findings.push(...schemaFindings);

  const entries = Array.isArray(data.integrations)
    ? (data.integrations as IntegrationRegistryEntry[])
    : [];

  const foundIds = new Set(entries.map((e) => e.id));
  for (const requiredId of INTEGRATION_IDS) {
    if (!foundIds.has(requiredId)) {
      findings.push(
        finding(
          "error",
          "missing-registered-integration",
          registryRel,
          `Integration '${requiredId}' is not registered in the central registry.`,
        ),
      );
    }
  }

  const registry: IntegrationRegistry = {
    version: String(data.version || ""),
    lastUpdated: String(data.lastUpdated || ""),
    integrations: entries,
  };

  return { registry, findings };
}

/** Validates canonical specifications and registry completeness. */
export function validateCanonicalIntegrations(root: string): Finding[] {
  const { findings: specFindings } = loadCanonicalIntegrations(root);
  const { findings: regFindings } = loadIntegrationRegistry(root);
  return [...specFindings, ...regFindings];
}

/** Builds the deterministic mcp_config.json and mcp_config.example.json adapter files. */
export function buildAntigravityMcpConfig(root: string): {
  mcp_config: string;
  mcp_config_example: string;
} {
  const { integrations } = loadCanonicalIntegrations(root);

  const mcpServers: Record<string, { command: string; args: string[]; disabled: boolean }> = {};
  const exampleServers: Record<
    string,
    {
      command: string;
      args: string[];
      disabled: boolean;
      description: string;
      requiredEnvironmentVariables: Record<string, string>;
    }
  > = {};

  for (const integration of integrations) {
    const serverConfig: {
      command: string;
      args: string[];
      disabled: boolean;
      enabledTools?: string[];
    } = {
      command: integration.runtime.executable,
      args: integration.runtime.args,
      disabled: true,
    };

    if (integration.security.toolFiltering === "allowlist" || integration.id === "database") {
      serverConfig.enabledTools = integration.capabilities.tools.map((t) => t.name);
    }

    mcpServers[integration.id] = serverConfig;

    const envMap: Record<string, string> = {};
    for (const envVar of integration.runtime.envVars) {
      envMap[envVar.name] = envVar.description;
    }

    const exampleConfig: {
      command: string;
      args: string[];
      disabled: boolean;
      enabledTools?: string[];
      description: string;
      requiredEnvironmentVariables: Record<string, string>;
    } = {
      command: integration.runtime.executable,
      args: integration.runtime.args,
      disabled: false,
      description: integration.description,
      requiredEnvironmentVariables: envMap,
    };

    if (integration.security.toolFiltering === "allowlist" || integration.id === "database") {
      exampleConfig.enabledTools = integration.capabilities.tools.map((t) => t.name);
    }

    exampleServers[integration.id] = exampleConfig;
  }

  const mcp_config = JSON.stringify({ mcpServers }, null, 2) + "\n";

  const exampleDoc = {
    $comment:
      "Example Antigravity MCP configuration for Frontier Engineer. To enable an integration, set disabled to false and export the required environment variables in your operating system environment before launching Antigravity.",
    mcpServers: exampleServers,
  };
  const mcp_config_example = JSON.stringify(exampleDoc, null, 2) + "\n";

  return { mcp_config, mcp_config_example };
}

function semanticJsonEqual(a: string, b: string): boolean {
  try {
    const objA = JSON.parse(a);
    const objB = JSON.parse(b);
    return JSON.stringify(objA) === JSON.stringify(objB);
  } catch {
    return false;
  }
}

/** Checks for drift between canonical specifications and generated Antigravity MCP adapter files. */
export function checkGeneratedIntegrations(root: string): Finding[] {
  const findings: Finding[] = [];
  const { mcp_config, mcp_config_example } = buildAntigravityMcpConfig(root);

  const currentConfig = readText(root, "mcp_config.json");
  if (currentConfig === null) {
    findings.push(
      finding(
        "error",
        "missing-mcp-config",
        "mcp_config.json",
        "Antigravity MCP configuration adapter file is missing.",
      ),
    );
  } else if (!semanticJsonEqual(currentConfig, mcp_config)) {
    findings.push(
      finding(
        "error",
        "drifted-mcp-config",
        "mcp_config.json",
        "mcp_config.json is out of date with canonical specifications. Run npm run generate:integrations.",
      ),
    );
  }

  const currentExample = readText(root, "mcp_config.example.json");
  if (currentExample === null) {
    findings.push(
      finding(
        "error",
        "missing-mcp-config-example",
        "mcp_config.example.json",
        "Antigravity MCP configuration example file is missing.",
      ),
    );
  } else if (!semanticJsonEqual(currentExample, mcp_config_example)) {
    findings.push(
      finding(
        "error",
        "drifted-mcp-config-example",
        "mcp_config.example.json",
        "mcp_config.example.json is out of date. Run npm run generate:integrations.",
      ),
    );
  }

  return findings;
}
