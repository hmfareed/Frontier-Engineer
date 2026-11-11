---
id: "playwright"
name: "Playwright Browser Testing"
description: "Enables browser automation, interactive DOM inspection, accessibility tree validation, and screenshot capture for UI verification using official @playwright/mcp."
category: "browser_testing"
version: "1.1.0"
lifecycle: "runtime_tested"
provider:
  name: "Playwright (Official / Microsoft)"
  documentationUrl: "https://playwright.dev/mcp/installation"
  repositoryUrl: "https://github.com/microsoft/playwright-mcp"
  maintainer: "Microsoft / Playwright Team"
  license: "Apache-2.0"
  verificationDate: "2026-11-11"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@playwright/mcp@0.0.85"
    - "--headless"
    - "--isolated"
  envVars:
    - name: "PLAYWRIGHT_HEADLESS"
      required: false
      description: "Controls headless execution mode (default: true via CLI flag)."
      secret: false
    - name: "PLAYWRIGHT_ISOLATED"
      required: false
      description: "Enforces in-memory isolated profile without persistent cookies or local storage (default: true via CLI flag)."
      secret: false
capabilities:
  tools:
    - name: "browser_navigate"
      description: "Navigates the browser to a target local or staging URL."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "browser_take_screenshot"
      description: "Captures a full-page or element screenshot for visual regression inspection."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "browser_snapshot"
      description: "Extracts the rendered accessibility snapshot conforming to WCAG standards."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "design-engineer"
    - name: "browser_click"
      description: "Clicks on an interactive element to trigger client-side UI transitions."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "browser_fill_form"
      description: "Inputs synthetic text into form inputs within local or staging environments."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "browser_hover"
      description: "Hovers over an interactive element to trigger hover states."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "design-engineer"
    - name: "browser_select_option"
      description: "Selects an option in a dropdown menu."
      permissionClass: "reversible_write"
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
  readOnlyAlternative: "Use terminal headless test commands (npx playwright test) or static component tests."
  credentialEnvVars: []
platformConfig: {}
---

# Playwright Browser Testing Integration Specification

## Purpose and overview

The Playwright MCP integration connects Frontier Engineer to headless browser automation via Microsoft's official `@playwright/mcp` package. It enables specialist agents—particularly `qa-engineer` and `design-engineer`—to execute end-to-end user journeys, capture accessibility snapshots, inspect live DOM structures, and record visual regression evidence.

## Provider and maintenance

- **Provider:** Playwright (Official / Microsoft)
- **Upstream Package:** `@playwright/mcp@0.0.85`
- **Documentation:** [https://playwright.dev/mcp/installation](https://playwright.dev/mcp/installation)
- **Repository:** [https://github.com/microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- **Maintainer:** Microsoft / Playwright Team
- **License:** Apache-2.0
- **Verification Date:** 2026-11-11
- **Status Note:** Replaces the deprecated reference server `@modelcontextprotocol/server-playwright`.

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v20.0.0 or higher) with Playwright browser dependencies
- **Executable:** `npx`
- **Execution Command:** `npx -y @playwright/mcp@0.0.85 --headless --isolated`
- **Flags:**
  - `--headless`: Enforces headless execution without opening GUI windows.
  - `--isolated`: Ensures the browser session runs with an in-memory browser context without persisting cookies or storage to disk, and without accessing the developer's personal browser profiles. Note that `--isolated` governs browser profile state only and does not provide an operating system sandbox for the host process.

## Capabilities and tool definitions

The integration exposes tools grouped by permission class:

1. **Read-only tools:** `navigate`, `screenshot`, `accessibility_snapshot`.
2. **Reversible write tools:** `click`, `fill`, `hover`, `select` (confined to test environments).

See [`capabilities.md`](capabilities.md) for full parameter definitions.

## Security and permission boundaries

Enforcement operates across five defensive layers:

1. **Server-Level Isolation (Layer A):** `--isolated` flag ensures zero access to personal user browser profiles, history, or saved passwords. All sessions start pristine in memory. This isolates browser profile state but does not constitute an operating system sandbox or network jail for the host process.
2. **Host-Level Configuration (Layer B):** Configured with `"disabled": true` in `mcp_config.json`.
3. **Environment Boundaries (Layer C):** Browser execution is constrained to `localhost`, `127.0.0.1`, and explicit test URLs. Cloud metadata endpoints (`169.254.169.254`) are strictly blocked.
4. **Behavioral Governance (Layer D):** Frontier Engineer rules prohibit autofilling real production credentials or personal user data.
5. **Human Approval (Layer E):** Submitting forms targeting non-local URLs requires explicit human confirmation.

See [`security.md`](security.md) for full sandbox constraints.

## Operational behavior and failure handling

- **Offline Default:** If browser binaries are not installed or dev servers are down, operations fail fast with diagnostic guidance (`npx playwright install`).
- **Timeout Management:** All browser interactions enforce strict timeouts (default 10,000ms) to prevent hanging the agent session.
- **Graceful Degradation:** When browser automation is unavailable, agents fall back to static component tests, DOM parsing, and terminal test runners.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
