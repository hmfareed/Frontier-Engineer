---
id: "sentry"
name: "Sentry Observability"
description: "Provides access to Sentry error monitoring, stack trace inspection, crash reports, and release performance metrics."
category: "observability"
version: "1.0.0"
lifecycle: "available"
provider:
  name: "Model Context Protocol Official"
  documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sentry"
  repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  maintainer: "Sentry / MCP Working Group"
  license: "MIT"
  verificationDate: "2026-11-10"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@modelcontextprotocol/server-sentry"
  envVars:
    - name: "SENTRY_AUTH_TOKEN"
      required: true
      description: "Sentry authentication token with read/write access to issues and events."
      secret: true
    - name: "SENTRY_ORG"
      required: false
      description: "Default Sentry organization slug."
      secret: false
capabilities:
  tools:
    - name: "get_issue"
      description: "Retrieves issue metadata, culprit, tag distribution, and status."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "list_unresolved_events"
      description: "Lists unresolved error events matching frequency, environment, or tag criteria."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "get_stack_trace"
      description: "Retrieves de-obfuscated symbolicated stack traces and breadcrumbs for an event."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "get_release_stats"
      description: "Queries crash-free user/session rates and adoption curves for a release."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "qa-engineer"
    - name: "query_project_performance"
      description: "Analyzes transaction duration, p95 latency, and throughput across endpoints."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "update_issue_status"
      description: "Transitions issue state (e.g., unresolved to resolved or ignored)."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "add_issue_note"
      description: "Attaches an engineering diagnosis or root-cause explanation to an issue."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "assign_issue"
      description: "Assigns a Sentry issue to a team member or team."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
  resources: []
  prompts: []
security:
  authenticationType: "bearer_token"
  permissionClasses:
    - "read_only"
    - "reversible_write"
  readOnlyAlternative: "Analyze local terminal error logs, reproduction test cases, and application log files."
  credentialEnvVars:
    - "SENTRY_AUTH_TOKEN"
platformConfig: {}
---

# Sentry Observability Integration Specification

## Purpose and overview

The Sentry MCP integration connects Frontier Engineer to live error tracking and application performance monitoring. It equips specialist agents—particularly `implementation-engineer` and `qa-engineer`—with the ability to triage production crashes, inspect symbolicated stack traces, analyze user breadcrumbs, and diagnose performance regressions directly against telemetry data.

## Provider and maintenance

- **Provider:** Model Context Protocol Official Reference Servers
- **Upstream Package:** `@modelcontextprotocol/server-sentry`
- **Maintainer:** Sentry / MCP Working Group
- **License:** MIT
- **Documentation:** [https://github.com/modelcontextprotocol/servers/tree/main/src/sentry](https://github.com/modelcontextprotocol/servers/tree/main/src/sentry)
- **Verification Date:** 2026-11-10

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @modelcontextprotocol/server-sentry`
- **Environment Variables:**
  - `SENTRY_AUTH_TOKEN`: Sentry user or internal integration auth token.
  - `SENTRY_ORG` (optional): Default organization slug.

## Capabilities and tool definitions

The integration exposes tools grouped by permission class:

1. **Read-only tools:** `get_issue`, `list_unresolved_events`, `get_stack_trace`, `get_release_stats`, `query_project_performance`.
2. **Reversible write tools:** `update_issue_status`, `add_issue_note`, `assign_issue`.

See [`capabilities.md`](capabilities.md) for full parameter definitions.

## Security and permission boundaries

- **Read-Only Token Scoping:** Tokens should only be granted `project:read`, `event:read`, and `issue:read` permissions unless status updates are explicitly desired.
- **PII Scrubbing:** Stack traces and breadcrumbs are filtered to prevent exfiltration of Personally Identifiable Information (PII) into model conversation history.
- **No Destructive Operations:** Sentry tools cannot delete projects, delete releases, or purge organization data.

See [`security.md`](security.md) for data governance and threat modeling.

## Operational behavior and failure handling

- **Offline Default:** If `SENTRY_AUTH_TOKEN` is unset or invalid, the integration remains disabled. Agents rely on local test reproductions, local log files, and debug outputs.
- **Rate Limiting:** Sentry API rate limits (HTTP 429) trigger backoff and fall back to cached issue context.
- **Project Isolation:** All queries must explicitly specify the organization and project slug.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
