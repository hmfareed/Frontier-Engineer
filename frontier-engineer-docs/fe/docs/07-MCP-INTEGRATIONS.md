# Part 07 — MCP Integrations

MCP integrations give Frontier Engineer access to external capabilities through supported Model Context Protocol servers. They are optional and installed according to need.

## 7.1 Playwright MCP
Repository: https://github.com/microsoft/playwright-mcp

Purpose: browser automation, UI interaction testing, form testing, navigation verification, screenshot capture, browser-based workflows.
Used primarily by the QA Engineer and Design Engineer.

## 7.2 GitHub MCP
Repository: https://github.com/github/github-mcp-server

Purpose: repository information, issues, pull requests, commit information, code review workflows, project collaboration.
Require explicit permission for consequential write operations.

## 7.3 Context7
Repository: https://github.com/upstash/context7

Purpose: retrieve current library documentation, check framework APIs, reduce outdated implementation advice, investigate version-specific changes.

## 7.4 Chrome DevTools MCP
Repository: https://github.com/ChromeDevTools/chrome-devtools-mcp

Purpose: browser console inspection, network inspection, runtime debugging, performance analysis, browser-based diagnostics.

## 7.5 MCP security requirements

Each integration must be reviewed for:

- Source authenticity
- Maintainer reputation
- Permissions
- Authentication requirements
- Network access
- Data exposure
- Command execution
- Write operations
- Credential handling

Never provide an MCP server with unrestricted access simply because it is useful.

## 7.6 Integration policy

MCP configuration must use the exact schema supported by the installed Antigravity version. Do not copy configuration examples blindly from unrelated agent platforms.

## 7.7 Integration matrix

| Integration | Primary users | Write access? | Credentials | Default |
| --- | --- | --- | --- | --- |
| Playwright MCP | QA, Design | Browser actions only | None | Optional |
| GitHub MCP | Coordinator, Security | Yes (approval required) | Token | Optional |
| Context7 | All | No | Varies | Optional |
| Chrome DevTools MCP | Design, QA, Performance | Browser actions only | None | Optional |
