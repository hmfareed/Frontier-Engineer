# Part 30 — Lifecycle hooks security

## Security philosophy and boundaries

Execution safeguards in Frontier Engineer operate under a defense-in-depth security model. While rules guide behavioral intention and MCP permissions define tool capability scope, lifecycle hooks provide execution-time validation at the exact moment tools execute.

> [!CRITICAL]
> Hooks do NOT replace operating system security boundaries, process containerization, file permission ACLs, or database user roles. They govern actions passing through the Antigravity agent execution harness.

## Permission matrix

| Operation                                       | Status         | Policy Rationale                                               |
| ----------------------------------------------- | -------------- | -------------------------------------------------------------- |
| Read hook stdin payload                         | **Allowed**    | Core execution communication mechanism.                        |
| Validate input JSON schemas                     | **Allowed**    | Ensures memory safety and payload integrity.                   |
| Write local sanitized diagnostics               | **Allowed**    | Provides non-sensitive operational observability.              |
| Inspect tool parameters (`CommandLine`, `Path`) | **Restricted** | Required for gating; arguments must not be leaked.             |
| Read project metadata (`package.json`, `.git`)  | **Restricted** | Used strictly for workspace verification at session start.     |
| Block prohibited actions (`deny`)               | **Allowed**    | Prevents execution of destructive commands.                    |
| Force fresh confirmation (`force_ask`)          | **Allowed**    | Prompts developer for high-risk actions without cached bypass. |
| Request standard confirmation (`ask`)           | **Allowed**    | Prompts developer for ambiguous actions.                       |
| Auto-approve sensitive actions (`auto_approve`) | **Prohibited** | Never bypasses developer permission gates.                     |
| Read arbitrary host files outside workspace     | **Prohibited** | Access strictly confined to project workspace roots.           |
| Exfiltrate workspace data externally            | **Prohibited** | Zero external telemetry or remote HTTP transmission.           |
| Modify project source from audit hooks          | **Prohibited** | Hooks are strictly non-mutative.                               |
| Modify database schemas or permissions          | **Prohibited** | Read-only database role verified in Phase 5 remains enforced.  |

## Fail-closed vs fail-open architecture

A single blanket failure policy is dangerous. Frontier Engineer applies event-specific failure policies:

1. **`PreToolUse` — Fail-Closed**:
   If stdin parsing fails, a payload field is invalid, or the safety hook encounters an unhandled exception, it MUST NEVER default to `allow`. It immediately returns a `deny` decision with an error explanation.
2. **`SessionStart` — Degrade Gracefully**:
   If workspace resolution fails, the hook initializes a basic session banner and allows the conversation to start.
3. **`PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop` — Fail-Open**:
   If an audit write fails (e.g. disk quota or read-only volume), the failure is caught, logged to stderr, and standard neutral responses (`{}`) are emitted to avoid stalling the developer.

## Secret redaction and data privacy

All diagnostic records pass through the `secret-redactor` engine before disk persistence. The engine uses high-performance regular expressions to redact:

- Private RSA and Ed25519 keys (`BEGIN PRIVATE KEY`).
- GitHub Personal Access Tokens (`ghp_`, `github_pat_`).
- AWS access keys (`AKIA...`).
- Sentry auth tokens (`sntrys_...`).
- Bearer tokens in headers.
- Passwords in database connection strings (`postgresql://user:pass@host`).
- Key-value pairs containing `password`, `token`, `secret`, or `apiKey`.
