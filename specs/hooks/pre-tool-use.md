---
id: "frontier-pre-tool-safety"
name: "Frontier Pre-Tool Safety Gate"
description: "Execution-time safety gate inspecting proposed tool calls for destructive filesystem operations, secret exfiltration, and prohibited database mutations."
event: "PreToolUse"
matcher: "run_command|read_file|write_file|edit_file"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-pre-tool-safety --event PreToolUse"
  timeout: 15
securityClassification: "critical_security"
failureMode: "fail_closed"
enabled: true
platformConfig: {}
---

# Pre-Tool Safety Gate (canonical specification)

## Purpose and overview

The Pre-Tool Safety Gate hook (`frontier-pre-tool-safety`) intercepts tool calls before execution. It acts as an execution-time safeguard to detect and prevent clearly destructive commands, unvetted secret exposures, dangerous privilege changes, and destructive database operations.

## Lifecycle event and matcher

- **Event Name**: `PreToolUse`
- **Execution Point**: Fires synchronously immediately before a tool call executes.
- **Matcher Configuration**: `run_command|read_file|write_file|edit_file`
  - Targets shell commands (`run_command`), sensitive file reads (`read_file`), and filesystem modifications (`write_file`, `edit_file`).

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-pre-tool-safety --event PreToolUse
  ```

- **Execution Timeout**: 15 seconds.
- **Working Directory**: Plugin repository root.

## Input and output contracts

### Stdin Input Payload

```json
{
  "toolCall": {
    "name": "run_command",
    "args": {
      "CommandLine": "git status"
    }
  },
  "stepIdx": 4,
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"]
}
```

### Stdout Output Protocol

Emits one of the documented Antigravity decision values:

- `"allow"`: Safe operations proceed directly.
- `"deny"`: Hard blocks destructive or exfiltrating operations.
- `"ask"`: Prompts the developer for interactive confirmation on ambiguous or high-risk actions.

Example `allow`:

```json
{
  "decision": "allow"
}
```

Example `deny`:

```json
{
  "decision": "deny",
  "reason": "Execution blocked: Recursive directory deletion targeting project root or system directories is prohibited."
}
```

Example `ask`:

```json
{
  "decision": "ask",
  "reason": "Destructive git operation detected (git clean -fdx). Developer confirmation required."
}
```

## Security boundaries and failure behavior

- **Security Classification**: `critical_security`
- **Failure Mode**: `fail_closed`
- **Safety Policies**:
  1. **Destructive Filesystem Operations**: Denies disk formatting (`format`, `mkfs`), recursive root removal (`rm -rf /`, `rmdir /s /q C:\`), deletion of `.git` or critical project manifests.
  2. **Secret Exposure & Exfiltration**: Denies reading or printing `.env`, SSH private keys (`id_rsa`, `id_ed25519`), AWS credentials, or transmitting credentials via curl/wget.
  3. **Dangerous Permissions**: Escalates or blocks unsafe privilege modifications (`chmod 777`, `takeown`, `icacls /grant Everyone:F`).
  4. **Database Mutations**: Blocks DDL and destructive SQL statements (`DROP DATABASE`, `DROP TABLE`, `TRUNCATE`).
  5. **Fail-Closed Invariant**: If payload parsing fails, an unknown error occurs, or the hook crashes, it must NEVER return `allow`. It returns `deny` or `ask`.

## Logging, diagnostics, and privacy

- Decision rationale and event metadata are logged to stderr and the sanitized audit store.
- Tool arguments are redacted before logging to prevent sensitive tokens from entering disk records.
- Output on `stdout` is strictly valid protocol JSON.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `PreToolUse`.
- On platforms without pre-tool hooks, policy evaluation logic is reused in pre-commit hooks, IDE extension guards, or agent behavioral rule reminders.
