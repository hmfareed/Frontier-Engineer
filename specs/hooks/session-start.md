---
id: "frontier-session-init"
name: "Frontier Session Initialization"
description: "Initializes Frontier Engineer session context, establishes correlation IDs, checks workspace availability, and injects startup context."
event: "SessionStart"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-session-init --event SessionStart"
  timeout: 10
securityClassification: "session_lifecycle"
failureMode: "degrade_gracefully"
enabled: true
platformConfig: {}
---

# Session Initialization (canonical specification)

## Purpose and overview

The Session Initialization hook (`frontier-session-init`) runs exactly once when a new Antigravity conversation session begins. Its purpose is to initialize execution context, register correlation identifiers, verify that workspace root directories are accessible, and inject a concise session startup reminder for the agent.

## Lifecycle event and matcher

- **Event Name**: `SessionStart`
- **Execution Point**: Fires once at the initialization of a new agent conversation session.
- **Matcher Configuration**: Not applicable for `SessionStart` events (flat handler array in `hooks.json`).

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-session-init --event SessionStart
  ```

- **Execution Timeout**: 10 seconds.
- **Working Directory**: Resolved to the plugin repository root where `hooks.json` resides.

## Input and output contracts

### Stdin Input Payload

Receives common Antigravity session metadata via stdin:

```json
{
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"],
  "transcriptPath": "C:/Projects/Frontier-Engineer/.gemini/antigravity/transcript.jsonl",
  "artifactDirectoryPath": "C:/Projects/Frontier-Engineer/.gemini/antigravity/artifacts",
  "modelName": "auto",
  "lastUserInput": "Start session"
}
```

### Stdout Output Protocol

Emits a standard `injectSteps` structure containing a concise system message:

```json
{
  "injectSteps": [
    {
      "systemMessage": {
        "systemMessage": "Frontier Engineer session initialized. Workspace context: C:/Projects/Frontier-Engineer. Disciplined engineering safeguards and audit logging active."
      }
    }
  ]
}
```

## Security boundaries and failure behavior

- **Security Classification**: `session_lifecycle`
- **Failure Mode**: `degrade_gracefully`
- **Operational Boundaries**:
  - Does NOT scan the entire filesystem.
  - Does NOT read sensitive `.env` files or credentials.
  - Does NOT modify any project files or run background scripts.
  - If workspace paths are missing or malformed, falls back to initializing a degraded session rather than blocking conversation startup.

## Logging, diagnostics, and privacy

- Diagnostic information is written to `stderr` or local session audit logs with all user tokens redacted.
- No network requests or external telemetry transmissions are made.
- Emits only valid JSON on `stdout`.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `SessionStart`.
- On platforms lacking a native `SessionStart` event (such as Claude Code or Cursor), session initialization can be adapted as an initial preamble prompt or workspace configuration hook.
