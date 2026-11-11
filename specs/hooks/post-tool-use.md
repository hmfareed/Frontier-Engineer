---
id: "frontier-post-tool-audit"
name: "Frontier Post-Tool Execution Audit"
description: "Captures sanitized execution diagnostics and privacy-conscious audit trails following tool completion."
event: "PostToolUse"
matcher: "*"
handler:
  type: "command"
  command: "node scripts/hooks/runtime/dispatcher.ts --hook frontier-post-tool-audit --event PostToolUse"
  timeout: 10
securityClassification: "audit_logging"
failureMode: "fail_open"
enabled: true
platformConfig: {}
---

# Post-Tool Execution Audit (canonical specification)

## Purpose and overview

The Post-Tool Execution Audit hook (`frontier-post-tool-audit`) captures structured execution diagnostics following tool execution. It records execution timestamps, tool names, sanitized parameters, exit status, and sanitized error categories without storing sensitive developer secrets or conversation transcripts.

## Lifecycle event and matcher

- **Event Name**: `PostToolUse`
- **Execution Point**: Fires synchronously immediately after a tool call finishes execution.
- **Matcher Configuration**: `*` (Global Matcher — Approach B)
  - Targets all completed tool invocations across the Antigravity host runtime.
  - Automatically records audit entries for native file operations (`view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`), command executions (`run_command`), and MCP tools without requiring separate explicit matchers.

## Handler command and execution

- **Runtime Execution**: Handled via Node.js invocation:

  ```bash
  node scripts/hooks/runtime/dispatcher.ts --hook frontier-post-tool-audit --event PostToolUse
  ```

- **Execution Timeout**: 10 seconds.
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
  "stepIdx": 5,
  "error": "",
  "conversationId": "760106de-776e-4c05-a9a2-3836e80391bf",
  "workspacePaths": ["C:/Projects/Frontier-Engineer"]
}
```

### Stdout Output Protocol

Expects an empty JSON object `{}` as documented in the Antigravity protocol:

```json
{}
```

## Security boundaries and failure behavior

- **Security Classification**: `audit_logging`
- **Failure Mode**: `fail_open`
- **Operational Boundaries**:
  - Does NOT persist passwords, bearer tokens, private keys, or API tokens.
  - Does NOT modify user repository files.
  - Does NOT initiate network requests or communicate with cloud telemetry.
  - If disk writing fails (e.g., read-only filesystem or quota error), the handler catches the exception, logs to stderr, and emits `{}` to stdout to avoid destabilizing the agent loop.

## Logging, diagnostics, and privacy

- Audit records are stored in a bounded local JSONL log (`.frontier/audit/execution.jsonl` or local session store).
- File size is capped at 5 MB with up to 3 rotated backup files (`.jsonl.1`, `.jsonl.2`).
- All tool argument fields pass through regex redaction before disk persistence.

## Cross-platform portability and compatibility

- Supported natively on Google Antigravity via `PostToolUse`.
- On platforms lacking post-tool events, diagnostic recording can be integrated into CLI wrappers or test runners.
