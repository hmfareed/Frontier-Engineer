---
id: "frontier-pre-tool-safety"
name: "Frontier Pre-Tool Safety Gate"
description: "Execution-time safety gate inspecting proposed tool calls for destructive filesystem operations, secret exfiltration, and prohibited database mutations."
event: "PreToolUse"
matcher: "*"
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
- **Matcher Configuration**: `*` (Global Matcher — Approach B)
  - Targets all tool invocations across the Antigravity host runtime.
  - Comprehensive coverage encompasses native file inspection (`view_file`), file creation (`write_to_file`), file content replacement (`replace_file_content`, `multi_replace_file_content`), command execution (`run_command`), legacy/subagent aliases (`read_file`, `write_file`, `edit_file`), encapsulated MCP tools (`call_mcp_tool`), and direct MCP endpoints.
  - An internal normalizer resolves heterogeneous argument field shapes (`AbsolutePath`, `TargetFile`, `Path`, `CommandLine`, `Arguments`).
  - Unknown or unrecognized tools are safely classified and never automatically approved.

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
    "name": "view_file",
    "args": {
      "AbsolutePath": "C:/Projects/Frontier-Engineer/package.json"
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
- `"force_ask"`: Forces a fresh interactive developer prompt for high-risk operations (e.g., `git clean -fdx`, `git reset --hard`, `chmod 777`, `icacls`, privilege escalation), bypassing any cached "Always Allow" permissions.
- `"ask"`: Standard interactive developer confirmation prompt.

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

Example `force_ask`:

```json
{
  "decision": "force_ask",
  "reason": "Confirmation required: Destructive git clean operations require developer review."
}
```

## Security boundaries and failure behavior

- **Security Classification**: `critical_security`
- **Failure Mode**: `fail_closed`
- **Safety Policies**:
  1. **Destructive Filesystem Operations**: Denies disk formatting (`format`, `mkfs`), recursive root removal (`rm -rf /`, `rmdir /s /q C:\`), deletion of `.git` or critical project manifests.
  2. **Secret Exposure & Exfiltration**: Denies reading, modifying, or outputting `.env`, SSH private keys (`id_rsa`, `id_ed25519`), AWS credentials, or transmitting credentials via curl/wget.
  3. **Dangerous Permissions**: Escalates unsafe privilege modifications (`chmod 777`, `takeown`, `icacls /grant Everyone:F`) to `force_ask`.
  4. **Database Mutations**: Blocks DDL and destructive SQL statements (`DROP DATABASE`, `DROP TABLE`, `TRUNCATE`).
  5. **High-Risk Git Cleanups**: Escalates untracked data loss (`git clean -fdx`, `git reset --hard`) to `force_ask` to prevent bypassing via cached permissions.
  6. **Unknown & Unvetted Tools**: Safely escalates unrecognized or ambiguous tools to `force_ask` instead of automatically approving them.
  7. **Fail-Closed Invariant**: If payload parsing fails, an unknown error occurs, or the hook crashes, it must NEVER return `allow`. It returns `deny`.

## Logging, diagnostics, and privacy

- Decision rationale and event metadata are logged to stderr and the sanitized audit store.
- Tool arguments are redacted before logging to prevent sensitive tokens from entering disk records.
- Output on `stdout` is strictly valid protocol JSON.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `PreToolUse`.
- On platforms without pre-tool hooks, policy evaluation logic is reused in pre-commit hooks, IDE extension guards, or agent behavioral rule reminders.
