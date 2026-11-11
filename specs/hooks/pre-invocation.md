---
id: "frontier-engineering-context"
name: "Frontier Engineering Context Injection"
description: "Injects concise engineering reminders regarding verification discipline, architecture preservation, and testing before model invocation."
event: "PreInvocation"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-engineering-context --event PreInvocation"
  timeout: 5
securityClassification: "context_injection"
failureMode: "fail_open"
enabled: true
platformConfig: {}
---

# Engineering Context Injection (canonical specification)

## Purpose and overview

The Engineering Context Injection hook (`frontier-engineering-context`) executes immediately before model invocation. It injects concise, high-priority engineering reminders to encourage systematic verification, non-destructive workflows, and evidence-based completion without consuming excessive context tokens.

## Lifecycle event and matcher

- **Event Name**: `PreInvocation`
- **Execution Point**: Fires before the model is invoked on an agent turn.
- **Matcher Configuration**: Not applicable for invocation events (flat handler array).

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-engineering-context --event PreInvocation
  ```

- **Execution Timeout**: 5 seconds.
- **Working Directory**: Plugin repository root.

## Input and output contracts

### Stdin Input Payload

```json
{
  "invocationNum": 1,
  "initialNumSteps": 0,
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"]
}
```

### Stdout Output Protocol

Emits standard Antigravity `injectSteps` structure:

```json
{
  "injectSteps": [
    {
      "systemMessage": {
        "systemMessage": "Frontier Engineering Reminder: Inspect code before editing; verify changes with tests before claiming completion; distinguish assumptions from verified facts."
      }
    }
  ],
  "terminationBehavior": ""
}
```

## Security boundaries and failure behavior

- **Security Classification**: `context_injection`
- **Failure Mode**: `fail_open`
- **Operational Boundaries**:
  - Reminders must remain concise (under 30 words) to prevent token bloat.
  - Never inject redundant large rules into every invocation turn.
  - If injection fails or times out, the handler fails open and emits an empty object `{}` so model invocation proceeds uninterrupted.

## Logging, diagnostics, and privacy

- Invocation turn numbers and injected reminder types are logged to stderr if debugging is enabled.
- No conversation transcripts or user inputs are persisted.
- Emits only valid JSON on `stdout`.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `PreInvocation`.
- On platforms without pre-invocation hooks, reminders reside within canonical rule files or system prompts.
