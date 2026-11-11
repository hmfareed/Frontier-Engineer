# Sentry Integration Security Policy

## Threat Model

Sentry error logs and performance events capture runtime application state from production or staging. Primary security risks:

1. **PII and Sensitive Data Exposure:** Stack traces, HTTP request headers, query parameters, or breadcrumbs containing sensitive customer data (passwords, JWTs, credit card numbers, email addresses, personal health information).
2. **Token Compromise:** Exposure of `SENTRY_AUTH_TOKEN` granting unauthorized access to an entire organization's monitoring infrastructure. Note: The legacy variable `SENTRY_ACCESS_TOKEN` is officially deprecated upstream.
3. **Malicious Error Payloads (Prompt Injection):** Error messages or exception payloads deliberately injected by external attackers to manipulate agent analysis when triaging logs.

## Authentication Architecture & Windows Best Practices

The official `@sentry/mcp-server` supports two primary authentication approaches:

1. **Direct `SENTRY_AUTH_TOKEN` Environment Variable (Recommended for Antigravity):**
   - The token is exported in the user shell or workspace environment.
   - It takes precedence over any local CLI configuration and avoids interactive terminal logins.
   - Note: The previous variable `SENTRY_ACCESS_TOKEN` is officially deprecated upstream; `SENTRY_AUTH_TOKEN` must be used.
2. **Sentry CLI Login (`sentry auth login`):**
   - Stores user credentials in `~/.sentryclirc` shared with the local `sentry-cli`.
   - On Windows, interactive prompts in background agent sessions can stall execution; exporting `SENTRY_AUTH_TOKEN` directly is the reliable method.

## Defense-in-Depth Enforcement Boundaries

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Human-in-the-Loop Approval                             │
│ Modifying issue statuses (resolve, ignore) requires consent     │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Behavioral Rules (Frontier Engineer Rules System)      │
│ PII redaction; error payloads treated as untrusted data         │
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Provider Token Scopes                                  │
│ Minimal read-only scopes: org:read, project:read, event:read    │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ Kept dormant ("disabled": true) in mcp_config.json              │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: MCP Server-Side Scoping                                │
│ Official @sentry/mcp-server with scoped issue endpoints         │
└─────────────────────────────────────────────────────────────────┘
```

### Layer A: Server-Side Tool Scoping

The official `@sentry/mcp-server` exposes issue and telemetry inspection. Sensitive administrative endpoints (deleting projects, revoking team members, altering billing) are absent.

### Layer B: Host Configuration

Server is registered as `"disabled": true` in `mcp_config.json`, requiring developer action before process execution.

### Layer C: Provider Token Scoping

Tokens must be generated with the narrowest permission set:

- **Verified Required Scopes:**
  - `org:read`: Enumerate organizations and locate projects.
  - `project:read`: Access project metadata, environments, and configuration.
  - `event:read` (or `issue:read`): Access issue lists, event payloads, stack frames, and breadcrumbs.
- **Prohibited Scopes:** No admin, organization write, member management, or project deletion scopes.
- Sentry auth tokens must never be hardcoded; inject strictly via `SENTRY_AUTH_TOKEN`.

### Layer D: Data Scrubbing and PII Protection

- Server-Side Scrubbing: Upstream Sentry organizations should have data scrubbing rules enabled for headers, cookies, and common PII patterns.
- Client-Side Redaction: When receiving stack traces or event bodies:
  - Authorization headers, bearer tokens, session IDs, and database connection strings are masked.
  - Email addresses and phone numbers in exception messages are redacted before being analyzed in prompt context.
- Prompt Injection Defense: Exception strings and HTTP request bodies frequently reflect untrusted user inputs that triggered crashes. All exception messages are treated as **untrusted data** and isolated in structured code blocks.

## Audit Logging

Every Sentry tool request is logged with:

- Project and issue ID queried.
- Tool name and permission classification.
- Sanitization results if sensitive fields were scrubbed.
