---
id: "sentry"
name: "Sentry Observability"
description: "Provides access to Sentry error monitoring, stack trace inspection, crash reports, and issue triage using official @sentry/mcp-server."
category: "observability"
version: "1.1.0"
lifecycle: "blocked"
provider:
  name: "Sentry (Official / getsentry)"
  documentationUrl: "https://github.com/getsentry/sentry-mcp"
  repositoryUrl: "https://github.com/getsentry/sentry-mcp"
  maintainer: "Sentry Team"
  license: "Apache-2.0"
  verificationDate: "2026-11-11"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@sentry/mcp-server@0.49.0"
  envVars:
    - name: "SENTRY_AUTH_TOKEN"
      required: true
      description: "Sentry User Auth Token with project read permissions (org:read, project:read, event:read)."
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
    - name: "list_issues"
      description: "Lists issues matching query filters (e.g., is:unresolved level:error)."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "get_event"
      description: "Retrieves de-obfuscated symbolicated stack traces, breadcrumbs, and tags for a specific crash event."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "list_events"
      description: "Lists recent crash events associated with an issue or project."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "search_issues"
      description: "Searches Sentry issues by error message, culprit, or tag."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "qa-engineer"
  resources: []
  prompts: []
security:
  authenticationType: "bearer_token"
  permissionClasses:
    - "read_only"
  readOnlyAlternative: "Analyze local terminal error logs, reproduction test cases, and application log files."
  credentialEnvVars:
    - "SENTRY_AUTH_TOKEN"
platformConfig: {}
---

# Sentry Observability Integration Specification

## Purpose and overview

The Sentry MCP integration connects Frontier Engineer to live error tracking and application crash telemetry via Sentry's official `@sentry/mcp-server`. It equips specialist agents—particularly `implementation-engineer` and `qa-engineer`—with the ability to triage production crashes, inspect symbolicated stack traces, analyze user breadcrumbs, and diagnose regressions directly against telemetry data.

## Provider and maintenance

- **Provider:** Sentry (Official / getsentry)
- **Upstream Package:** `@sentry/mcp-server@0.49.0`
- **Upstream Repository:** [https://github.com/getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp)
- **Documentation:** [https://github.com/getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp)
- **Maintainer:** Sentry Team
- **License:** Apache-2.0
- **Verification Date:** 2026-11-11
- **Status Note:** Replaces the deprecated reference server `@modelcontextprotocol/server-sentry`.

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v22.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @sentry/mcp-server@0.49.0`
- **Environment Variables:**
  - `SENTRY_AUTH_TOKEN`: Official auth token with scoped read permissions (`org:read`, `project:read`, `event:read`). Note: The legacy variable `SENTRY_ACCESS_TOKEN` is deprecated upstream.
  - `SENTRY_ORG` (optional): Default organization slug.

## Capabilities and tool definitions

The integration exposes read-only diagnostic tools:

- `get_issue`: Retrieves issue summary, culprit, frequency, and tags.
- `list_issues`: Lists issues filtered by environment, level, or status.
- `get_event`: Retrieves detailed symbolicated stack frames and user breadcrumbs.
- `list_events`: Lists error occurrences for an issue.
- `search_issues`: Searches issues across projects.

See [`capabilities.md`](capabilities.md) for full parameter definitions.

## Security and permission boundaries

Enforcement operates across five defensive layers:

1. **Server-Level Scoping (Layer A):** Exposes read-only telemetry queries; administrative endpoints (project deletion, organization settings) are not exposed.
2. **Host-Level Configuration (Layer B):** Configured as `"disabled": true` in `mcp_config.json`.
3. **Provider/Infrastructure Permissions (Layer C):** Scoped token with `event:read`, `issue:read`, `project:read`. No write or admin privileges.
4. **Behavioral Governance (Layer D):** Automatic client-side scrubbing of PII (emails, auth headers, passwords) from retrieved stack traces before injecting into prompt context.
5. **Human Approval (Layer E):** Resolving or archiving issues requires developer consent.

See [`security.md`](security.md) for data governance and threat modeling.

## Operational behavior and failure handling

- **Offline Default:** If `SENTRY_ACCESS_TOKEN` is unset or invalid, the integration remains disabled. Agents rely on local test reproductions, local log files, and debug outputs.
- **Rate Limiting:** Sentry API rate limits (HTTP 429) trigger backoff and fall back to cached issue context.
- **Project Isolation:** All queries must explicitly specify the organization and project slug.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
