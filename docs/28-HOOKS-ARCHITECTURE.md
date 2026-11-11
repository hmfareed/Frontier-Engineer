# Part 28 — Lifecycle hooks architecture

## Purpose and role of lifecycle hooks

Frontier Engineer adopts the principle that engineering safeguards should operate at the point of action rather than relying solely on instructions in natural language prompt files.

The **Lifecycle Hooks System** introduces execution-time control points into Google Antigravity's agent loop. It allows Frontier Engineer to:

1. Initialize session context and verify workspace availability at startup (`SessionStart`).
2. Intercept proposed tool calls and enforce execution safeguards before execution occurs (`PreToolUse`).
3. Capture structured, sanitized diagnostic and audit evidence following tool completion (`PostToolUse`).
4. Inject concise engineering reminders before model calls without token bloat (`PreInvocation`).
5. Capture invocation turn metrics and step completion data (`PostInvocation`).
6. Finalize session audit trails cleanly when execution concludes (`Stop`).

```text
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION START (SessionStart)                 │
│      Initialize correlation ID, verify workspace environment    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  MODEL TURN PREPARATION (PreInvocation)         │
│          Inject concise engineering reminder (non-bloated)      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TOOL GATING (PreToolUse)                     │
│    Allow safe actions / Deny destructive actions / Ask approval │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (tool executes safely)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TOOL AUDIT (PostToolUse)                     │
│           Record sanitized, privacy-conscious audit entry       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              INVOCATION AUDIT (PostInvocation)                  │
│               Record turn index and step metrics                │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION STOP (Stop)                          │
│          Flush diagnostics and finalize session records         │
└─────────────────────────────────────────────────────────────────┘
```

## Integration with existing components

The Lifecycle Hooks System integrates seamlessly with Frontier Engineer's existing architecture:

- **Six Specialists**: Gating applies uniformly across all agents (`frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor`, `qa-engineer`, `design-engineer`). Specialists have zero bypass permissions.
- **Ten Skills**: Tool operations triggered while applying engineering skills are inspected by the pre-tool safety gate.
- **Fourteen Rules**: Hook safeguards complement behavioral rules (e.g. `api-security`, `security-standards`) by enforcing boundaries at execution time.
- **Five MCP Integrations**: Prohibited mutating database tools (`postgres_mcp_modify`) and destructive queries (`DROP`, `TRUNCATE`) are blocked by the pre-tool hook.
- **Canonical-First Architecture**: Canonical hook specifications in `specs/hooks/` compile deterministically into `hooks.json` via `scripts/generate-antigravity-hooks.ts`.

## Explicit non-goals

The Lifecycle Hooks System strictly avoids:

- Introducing autonomous background loops or daemon processes.
- Introducing a secondary orchestration engine or external microservice.
- Requiring cloud telemetry, third-party tracing services, or external databases.
- Auto-approving risky or destructive operations.
- Claiming to replace OS user permissions or container virtualization boundaries.
