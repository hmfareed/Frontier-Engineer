---
version: "0.6.3"
lastUpdated: "2026-11-11"
hooks:
  - id: "frontier-session-init"
    name: "Frontier Session Initialization"
    event: "SessionStart"
    securityClassification: "session_lifecycle"
    failureMode: "degrade_gracefully"
    enabled: true
    specPath: "specs/hooks/session-start.md"
    handlerPath: "scripts/hooks/handlers/session-start.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
  - id: "frontier-pre-tool-safety"
    name: "Frontier Pre-Tool Safety Gate"
    event: "PreToolUse"
    matcher: "*"
    securityClassification: "critical_security"
    failureMode: "fail_closed"
    enabled: true
    specPath: "specs/hooks/pre-tool-use.md"
    handlerPath: "scripts/hooks/handlers/pre-tool-use.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
  - id: "frontier-post-tool-audit"
    name: "Frontier Post-Tool Execution Audit"
    event: "PostToolUse"
    matcher: "*"
    securityClassification: "audit_logging"
    failureMode: "fail_open"
    enabled: true
    specPath: "specs/hooks/post-tool-use.md"
    handlerPath: "scripts/hooks/handlers/post-tool-use.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
  - id: "frontier-engineering-context"
    name: "Frontier Engineering Context Injection"
    event: "PreInvocation"
    securityClassification: "context_injection"
    failureMode: "fail_open"
    enabled: true
    specPath: "specs/hooks/pre-invocation.md"
    handlerPath: "scripts/hooks/handlers/pre-invocation.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
  - id: "frontier-invocation-audit"
    name: "Frontier Invocation Diagnostics Audit"
    event: "PostInvocation"
    securityClassification: "audit_logging"
    failureMode: "fail_open"
    enabled: true
    specPath: "specs/hooks/post-invocation.md"
    handlerPath: "scripts/hooks/handlers/post-invocation.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
  - id: "frontier-session-stop"
    name: "Frontier Session Stop Finalization"
    event: "Stop"
    securityClassification: "session_lifecycle"
    failureMode: "fail_open"
    enabled: true
    specPath: "specs/hooks/stop.md"
    handlerPath: "scripts/hooks/handlers/stop.ts"
    compatibility:
      antigravity: "supported"
      claude_code: "planned"
      cursor: "planned"
      codex: "planned"
---

# Canonical Hook Registry

The canonical hook registry documents the authoritative lifecycle hooks implemented by Frontier Engineer. Each entry maps an execution-time hook to its formal event, security tier, operational failure mode, canonical specification, and cross-platform compatibility mapping.

## Registry Table

| Identifier                     | Lifecycle Event  | Matcher Target | Security Classification | Default Failure Mode | Activation State |
| ------------------------------ | ---------------- | -------------- | ----------------------- | -------------------- | ---------------- |
| `frontier-session-init`        | `SessionStart`   | N/A            | `session_lifecycle`     | `degrade_gracefully` | `enabled`        |
| `frontier-pre-tool-safety`     | `PreToolUse`     | `*`            | `critical_security`     | `fail_closed`        | `enabled`        |
| `frontier-post-tool-audit`     | `PostToolUse`    | `*`            | `audit_logging`         | `fail_open`          | `enabled`        |
| `frontier-engineering-context` | `PreInvocation`  | N/A            | `context_injection`     | `fail_open`          | `enabled`        |
| `frontier-invocation-audit`    | `PostInvocation` | N/A            | `audit_logging`         | `fail_open`          | `enabled`        |
| `frontier-session-stop`        | `Stop`           | N/A            | `session_lifecycle`     | `fail_open`          | `enabled`        |

## Lifecycle Event Summary

1. **`SessionStart`**: Runs once at conversation start to establish correlation identifiers and ensure workspace availability without invasive repository modifications.
2. **`PreToolUse`**: Acts as an execution-time safeguard to intercept proposed tool executions before execution, enforcing security policies and gating destructive actions across all native and MCP tools.
3. **`PostToolUse`**: Captures sanitized diagnostics following tool execution to provide non-sensitive execution audit trails across all tool calls.
4. **`PreInvocation`**: Injects concise engineering reminders to promote rigorous verification, testing discipline, and boundary respect.
5. **`PostInvocation`**: Records invocation lifecycle diagnostics without capturing model reasoning or full context windows.
6. **`Stop`**: Flushes diagnostic logs and records session finalization when execution terminates.
