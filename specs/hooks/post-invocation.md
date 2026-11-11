---
id: "frontier-invocation-audit"
name: "Frontier Invocation Diagnostics Audit"
description: "Captures invocation lifecycle telemetry such as turn counts, completion status, and timestamps without logging model reasoning."
event: "PostInvocation"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-invocation-audit --event PostInvocation"
  timeout: 5
securityClassification: "audit_logging"
failureMode: "fail_open"
enabled: true
platformConfig: {}
---

# Invocation Diagnostics Audit (canonical specification)

## Purpose and overview

The Invocation Diagnostics Audit hook (`frontier-invocation-audit`) records lifecycle telemetry after model execution turns. It captures turn indices, elapsed steps, and completion status without persisting model thoughts, chain-of-reasoning, or private context.

## Lifecycle event and matcher

- **Event Name**: `PostInvocation`
- **Execution Point**: Fires after model calls and tool executions in an invocation turn finish.
- **Matcher Configuration**: Not applicable for invocation events (flat handler array).

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-invocation-audit --event PostInvocation
  ```

- **Execution Timeout**: 5 seconds.
- **Working Directory**: Plugin repository root.

## Input and output contracts

### Stdin Input Payload

```json
{
  "invocationNum": 2,
  "initialNumSteps": 12,
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"]
}
```

### Stdout Output Protocol

Emits standard Antigravity post-invocation response:

```json
{
  "injectSteps": [],
  "terminationBehavior": ""
}
```

## Security boundaries and failure behavior

- **Security Classification**: `audit_logging`
- **Failure Mode**: `fail_open`
- **Operational Boundaries**:
  - Does NOT capture or store model reasoning, internal thinking, or raw output text.
  - Does NOT treat invocation completion as task completion.
  - Fails open gracefully if diagnostic logging encounters any error.

## Logging, diagnostics, and privacy

- Writes sanitized turn metrics to the local audit log (`.frontier/audit/execution.jsonl`).
- Zero secret retention; zero remote telemetry.
- Emits only valid JSON on `stdout`.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `PostInvocation`.
- On platforms lacking post-invocation hooks, invocation telemetry can be computed via wrapper CLI scripts.
