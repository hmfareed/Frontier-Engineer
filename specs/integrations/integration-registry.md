---
version: "0.5.0"
lastUpdated: "2026-11-10"
integrations:
  - id: "github"
    name: "GitHub Integration"
    category: "repository"
    lifecycle: "available"
    optional: true
    provider:
      name: "Model Context Protocol Official"
      documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github"
      maintainer: "Anthropic / MCP Working Group"
    specPaths:
      integration: "specs/integrations/github/integration.md"
      capabilities: "specs/integrations/github/capabilities.md"
      security: "specs/integrations/github/security.md"
    agentMappings:
      - "frontier-engineer"
      - "implementation-engineer"
      - "qa-engineer"
    fallbackBehavior: "Fall back to local git CLI and gh command-line client if authenticated locally."
    compatibility:
      antigravity: "supported"
      claude_code: "supported"
      cursor: "supported"
      codex: "supported"
  - id: "context7"
    name: "Context7 Documentation"
    category: "documentation"
    lifecycle: "available"
    optional: true
    provider:
      name: "Upstash Context7"
      documentationUrl: "https://github.com/upstash/context7"
      maintainer: "Upstash Team"
    specPaths:
      integration: "specs/integrations/context7/integration.md"
      capabilities: "specs/integrations/context7/capabilities.md"
      security: "specs/integrations/context7/security.md"
    agentMappings:
      - "frontier-engineer"
      - "architect"
      - "implementation-engineer"
      - "security-auditor"
    fallbackBehavior: "Fall back to offline installed documentation, node_modules types, and built-in knowledge."
    compatibility:
      antigravity: "supported"
      claude_code: "supported"
      cursor: "supported"
      codex: "supported"
  - id: "playwright"
    name: "Playwright Browser Testing"
    category: "browser_testing"
    lifecycle: "available"
    optional: true
    provider:
      name: "Model Context Protocol Official"
      documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/playwright"
      maintainer: "Anthropic / MCP Working Group"
    specPaths:
      integration: "specs/integrations/playwright/integration.md"
      capabilities: "specs/integrations/playwright/capabilities.md"
      security: "specs/integrations/playwright/security.md"
    agentMappings:
      - "frontier-engineer"
      - "qa-engineer"
      - "design-engineer"
    fallbackBehavior: "Fall back to local headless test runners (playwright test, jest, vitest) via terminal execution."
    compatibility:
      antigravity: "supported"
      claude_code: "supported"
      cursor: "supported"
      codex: "supported"
  - id: "sentry"
    name: "Sentry Observability"
    category: "observability"
    lifecycle: "available"
    optional: true
    provider:
      name: "Model Context Protocol Official"
      documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sentry"
      maintainer: "Sentry / MCP Working Group"
    specPaths:
      integration: "specs/integrations/sentry/integration.md"
      capabilities: "specs/integrations/sentry/capabilities.md"
      security: "specs/integrations/sentry/security.md"
    agentMappings:
      - "frontier-engineer"
      - "architect"
      - "implementation-engineer"
      - "qa-engineer"
    fallbackBehavior: "Fall back to local log files, test assertion outputs, and reproduction test suites."
    compatibility:
      antigravity: "supported"
      claude_code: "supported"
      cursor: "supported"
      codex: "supported"
  - id: "database"
    name: "PostgreSQL Database Inspection"
    category: "database"
    lifecycle: "available"
    optional: true
    provider:
      name: "Model Context Protocol Official"
      documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres"
      maintainer: "Anthropic / MCP Working Group"
    specPaths:
      integration: "specs/integrations/database/integration.md"
      capabilities: "specs/integrations/database/capabilities.md"
      security: "specs/integrations/database/security.md"
    agentMappings:
      - "frontier-engineer"
      - "architect"
      - "implementation-engineer"
      - "security-auditor"
    fallbackBehavior: "Fall back to local SQL schema files, migration files, and database unit/integration fixtures."
    compatibility:
      antigravity: "supported"
      claude_code: "supported"
      cursor: "supported"
      codex: "supported"
---

# Central MCP Integration Registry

The Central MCP Integration Registry defines all external integrations supported by Frontier Engineer. Each integration provides external capabilities through standard Model Context Protocol (MCP) servers.

## Registry Summary

| Integration  | Category          | Lifecycle   | Optional | Provider                        | Transport | Default Status    |
| :----------- | :---------------- | :---------- | :------- | :------------------------------ | :-------- | :---------------- |
| `github`     | `repository`      | `available` | Yes      | Model Context Protocol Official | `stdio`   | Disabled (Opt-in) |
| `context7`   | `documentation`   | `available` | Yes      | Upstash Context7                | `stdio`   | Disabled (Opt-in) |
| `playwright` | `browser_testing` | `available` | Yes      | Model Context Protocol Official | `stdio`   | Disabled (Opt-in) |
| `sentry`     | `observability`   | `available` | Yes      | Model Context Protocol Official | `stdio`   | Disabled (Opt-in) |
| `database`   | `database`        | `available` | Yes      | Model Context Protocol Official | `stdio`   | Disabled (Opt-in) |

## Operational Principles

1. **Zero Mandatory External Servers**: Every integration is optional (`optional: true`). Missing external credentials or server binaries must never prevent core agent operation or local engineering workflows.
2. **Platform-Neutral Core**: All integration definitions and capabilities are maintained in platform-independent canonical markdown files under `specs/integrations/`.
3. **Generated Adapters**: Platform configurations (such as Antigravity's `mcp_config.json`) are compiled deterministically by generator scripts.
4. **Selective Agent Routing**: Agents only access integrations aligned with their architectural domain.
