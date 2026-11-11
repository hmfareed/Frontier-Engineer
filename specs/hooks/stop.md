---
id: "frontier-session-stop"
name: "Frontier Session Stop Finalization"
description: "Finalizes execution audit records, flushes diagnostic logs, and records session termination cleanly."
event: "Stop"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-session-stop --event Stop"
  timeout: 5
securityClassification: "session_lifecycle"
failureMode: "fail_open"
enabled: true
platformConfig: {}
---

# Session Stop Finalization (canonical specification)

## Purpose and overview

The Session Stop Finalization hook (`frontier-session-stop`) executes when the agent execution loop terminates. It flushes buffered diagnostic writes, logs the final session termination status, and closes the session lifecycle record cleanly.

## Lifecycle event and matcher

- **Event Name**: `Stop`
- **Execution Point**: Fires when the Antigravity agent execution loop terminates.
- **Matcher Configuration**: Not applicable for `Stop` events (flat handler array).

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-session-stop --event Stop
  ```

- **Execution Timeout**: 5 seconds.
- **Working Directory**: Plugin repository root.

## Input and output contracts

### Stdin Input Payload

```json
{
  "executionNum": 1,
  "terminationReason": "NO_TOOL_CALL",
  "error": "",
  "fullyIdle": true,
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"]
}
```

### Stdout Output Protocol

Emits standard Antigravity stop response:

```json
{}
```

_(Note: Emitting an empty object or any decision other than `"continue"` permits the agent to stop normally.)_

## Security boundaries and failure behavior

- **Security Classification**: `session_lifecycle`
- **Failure Mode**: `fail_open`
- **Operational Boundaries**:
  - Does NOT modify repository files during finalization.
  - Does NOT automatically commit git changes or publish artifacts.
  - Prevents duplicate finalization writes.
  - If finalization fails, catches all exceptions, logs to stderr, and emits `{}` to permit clean termination.

## Logging, diagnostics, and privacy

- Writes a final termination entry to `.frontier/audit/execution.jsonl`.
- Flushes all pending diagnostic streams.
- Zero network transmission.
- Emits only valid JSON on `stdout`.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `Stop`.
- On platforms lacking a stop event, cleanup is achieved via process exit handlers or trap signals.
