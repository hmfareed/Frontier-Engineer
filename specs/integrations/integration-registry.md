---
version: "0.5.1"
lastUpdated: "2026-11-11"
integrations:
  - id: "github"
    name: "GitHub Integration"
    category: "repository"
    lifecycle: "provider_verified"
    optional: true
    provider:
      name: "GitHub (Official)"
      documentationUrl: "https://github.com/github/github-mcp-server"
      maintainer: "GitHub"
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
    lifecycle: "provider_verified"
    optional: true
    provider:
      name: "Upstash Context7"
      documentationUrl: "https://context7.com"
      maintainer: "Upstash"
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
    lifecycle: "provider_verified"
    optional: true
    provider:
      name: "Playwright (Official / Microsoft)"
      documentationUrl: "https://playwright.dev/mcp/installation"
      maintainer: "Microsoft / Playwright Team"
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
    lifecycle: "provider_verified"
    optional: true
    provider:
      name: "Sentry (Official / getsentry)"
      documentationUrl: "https://github.com/getsentry/sentry-mcp"
      maintainer: "Sentry Team"
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
    lifecycle: "provider_verified"
    optional: true
    provider:
      name: "Microsoft (Official / microsoft)"
      documentationUrl: "https://github.com/microsoft/postgres-mcp"
      maintainer: "Microsoft"
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

The Central MCP Integration Registry defines all external integrations supported by Frontier Engineer. Each integration provides external capabilities through verified Model Context Protocol (MCP) servers.

## Registry Summary

| Integration  | Category          | Lifecycle           | Optional | Provider                         | Transport | Default Status    |
| :----------- | :---------------- | :------------------ | :------- | :------------------------------- | :-------- | :---------------- |
| `github`     | `repository`      | `provider_verified` | Yes      | GitHub (Official)                | `stdio`   | Disabled (Opt-in) |
| `context7`   | `documentation`   | `provider_verified` | Yes      | Upstash Context7                 | `stdio`   | Disabled (Opt-in) |
| `playwright` | `browser_testing` | `provider_verified` | Yes      | Playwright (Official / Microsoft)| `stdio`   | Disabled (Opt-in) |
| `sentry`     | `observability`   | `provider_verified` | Yes      | Sentry (Official / getsentry)    | `stdio`   | Disabled (Opt-in) |
| `database`   | `database`        | `provider_verified` | Yes      | Microsoft (Official / microsoft) | `stdio`   | Disabled (Opt-in) |

## Operational Principles

1. **Zero Mandatory External Servers**: Every integration is optional (`optional: true`). Missing external credentials or server binaries must never prevent core agent operation or local engineering workflows.
2. **Platform-Neutral Core**: All integration definitions and capabilities are maintained in platform-independent canonical markdown files under `specs/integrations/`.
3. **Generated Adapters**: Platform configurations (such as Antigravity's `mcp_config.json`) are compiled deterministically by generator scripts.
4. **Selective Agent Routing**: Agents only access integrations aligned with their architectural domain.
