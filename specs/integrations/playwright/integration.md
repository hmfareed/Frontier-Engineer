---
id: "playwright"
name: "Playwright Browser Testing"
description: "Enables browser automation, interactive DOM inspection, accessibility tree validation, and screenshot capture for UI verification."
category: "browser_testing"
version: "1.0.0"
lifecycle: "available"
provider:
  name: "Model Context Protocol Official"
  documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/playwright"
  repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  maintainer: "Anthropic / MCP Working Group"
  license: "MIT"
  verificationDate: "2026-11-10"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@modelcontextprotocol/server-playwright"
  envVars:
    - name: "PLAYWRIGHT_HEADLESS"
      required: false
      description: "Controls headless execution mode. Defaults to true for automated and CI environments."
      secret: false
capabilities:
  tools:
    - name: "navigate"
      description: "Navigates the browser to a target local or staging URL."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "take_screenshot"
      description: "Captures a full-page or element screenshot for visual regression inspection."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "get_accessibility_tree"
      description: "Extracts the rendered accessibility snapshot conforming to WCAG standards."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "get_console_logs"
      description: "Retrieves console error logs, warnings, and network error events."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "query_dom_elements"
      description: "Queries DOM elements using CSS selectors or accessible roles."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "fill_form"
      description: "Inputs synthetic text into form inputs within local or staging environments."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "click_element"
      description: "Clicks on an interactive element to trigger client-side UI transitions."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "submit_form"
      description: "Submits a form triggering potential backend mutations."
      permissionClass: "external_side_effect"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
  resources: []
  prompts: []
security:
  authenticationType: "none"
  permissionClasses:
    - "read_only"
    - "reversible_write"
    - "external_side_effect"
  readOnlyAlternative: "Use terminal headless test commands (npx playwright test) or static component tests."
  credentialEnvVars: []
platformConfig: {}
---

# Playwright Browser Testing Integration Specification

## Purpose and overview

The Playwright MCP integration gives Frontier Engineer direct programmatic access to headless browser instances. It enables specialist agents—particularly `qa-engineer` and `design-engineer`—to execute end-to-end tests, inspect live accessibility trees, capture visual regression artifacts, and diagnose runtime frontend errors.

## Provider and maintenance

- **Provider:** Model Context Protocol Official Reference Servers
- **Upstream Package:** `@modelcontextprotocol/server-playwright`
- **Maintainer:** Anthropic / MCP Working Group
- **License:** MIT
- **Documentation:** [https://github.com/modelcontextprotocol/servers/tree/main/src/playwright](https://github.com/modelcontextprotocol/servers/tree/main/src/playwright)
- **Verification Date:** 2026-11-10

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher) with Playwright browsers installed
- **Executable:** `npx`
- **Execution Command:** `npx -y @modelcontextprotocol/server-playwright`
- **Environment Variables:**
  - `PLAYWRIGHT_HEADLESS` (optional): Set to `true` (default) for headless execution.

## Capabilities and tool definitions

The integration provides tools grouped by permission class:

1. **Read-only tools:** `navigate`, `take_screenshot`, `get_accessibility_tree`, `get_console_logs`, `query_dom_elements`.
2. **Reversible write tools:** `fill_form`, `click_element` (confined to test environments).
3. **External side effect tools:** `submit_form`.

See [`capabilities.md`](capabilities.md) for full parameter and return schemas.

## Security and permission boundaries

- **URL Restriction:** Navigation is strictly constrained to `localhost`, `127.0.0.1`, and explicit development/staging origins. Interaction with production URLs is blocked.
- **Credential Autofill Prohibition:** Never use Playwright tools to enter production credentials, real credit card numbers, or real personal identities. Only synthetic test fixtures are permitted.
- **Form Submission Guard:** Submitting forms (`submit_form`) that could trigger remote transactions requires approval when targeting non-local URLs.

See [`security.md`](security.md) for sandbox constraints and security controls.

## Operational behavior and failure handling

- **Offline Default:** If browser binaries are not installed or dev servers are down, operations fail fast with diagnostic guidance (`npx playwright install`).
- **Timeout Management:** All browser interactions enforce strict timeouts (default 10,000ms) to prevent hanging the agent session.
- **Graceful Degradation:** When browser automation is unavailable, agents fall back to static component tests, DOM parsing, and terminal test runners.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
