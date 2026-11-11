# Frontier Engineer — Hook Security Model

This document establishes the security architecture, permission matrix, trust boundaries, and failure behaviors for the Frontier Engineer Lifecycle Hooks System.

## 1. Security Philosophy & Trust Boundaries

The lifecycle hooks execute locally within the developer's development environment. They are invoked by the Antigravity agent runner through standard process communication (stdin/stdout).

Safeguards operate at the point of action to catch high-risk, destructive, or exfiltrating operations before they occur. However:

> [!CRITICAL]
> A `PreToolUse` hook does not provide an operating-system sandbox or complete virtualization barrier. Hooks only govern executions passing through the Antigravity hook mechanism. They complement—and never replace—OS user permissions, container isolation, database roles, or provider authentication barriers.

## 2. Operation Permission Classification

| Operation                                                          | Permission Tier | Rationale                                                                           |
| ------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------- |
| Read hook event input via stdin                                    | **Allowed**     | Core execution protocol requirement.                                                |
| Validate event input against schema                                | **Allowed**     | Required for robust payload processing.                                             |
| Write sanitized diagnostics to local audit log                     | **Allowed**     | Operational observability with strict secret redaction.                             |
| Read approved project metadata (`package.json`, `.git/config`)     | **Restricted**  | Permitted only for session initialization context without scanning full filesystem. |
| Inspect selected tool arguments (`CommandLine`, `Path`, `Content`) | **Restricted**  | Required for pre-tool safety gating; must never leak inspected secrets to stdout.   |
| Block a clearly prohibited tool action (`deny`)                    | **Allowed**     | Core enforcement capability for destructive commands and secret leaks.              |
| Force fresh user confirmation (`force_ask`)                        | **Allowed**     | Mandatory for high-risk operations; bypasses cached "Always Allow" permissions.     |
| Prompt standard user confirmation (`ask`)                          | **Allowed**     | Escalates ambiguous commands to the human developer.                                |
| Automatically approve user-sensitive actions (`auto_approve`)      | **Prohibited**  | Never bypasses standard human confirmation or security approvals.                   |
| Read arbitrary host files outside workspace                        | **Prohibited**  | Hooks must strictly respect workspace boundaries.                                   |
| Exfiltrate workspace information or telemetry externally           | **Prohibited**  | Zero external telemetry or remote HTTP transmission.                                |
| Modify project files from audit or lifecycle hooks                 | **Prohibited**  | Hooks are observational and protective, never mutative.                             |
| Change database privileges or execute DDL                          | **Prohibited**  | Enforced by PostgreSQL read-only role from Phase 5.                                 |
| Modify Antigravity host security settings                          | **Prohibited**  | Hooks cannot alter global host security configurations.                             |

## 3. Fail-Open vs Fail-Closed Policy

Failure behavior is defined per lifecycle event rather than by a blanket policy:

```text
+------------------------------+--------------------+-----------------------------------------------------+
| Lifecycle Event              | Failure Strategy   | Operational Behavior on Crash / Timeout / Bad Input |
+------------------------------+--------------------+-----------------------------------------------------+
| PreToolUse (Safety Gate)     | Fail-Closed        | Denies tool execution (deny) or escalates to        |
|                              |                    | `force_ask`. Never converts failure into `allow`.    |
| SessionStart (Init)          | Degrade-Gracefully | Initializes degraded session without blocking user. |
| PostToolUse (Audit)          | Fail-Open          | Skips audit write; returns `{}`; does not loop.     |
| PreInvocation (Context)      | Fail-Open          | Proceeds to model call without injecting reminders. |
| PostInvocation (Diagnostics) | Fail-Open          | Proceeds without diagnostics; does not abort loop.  |
| Stop (Finalization)          | Fail-Open          | Flushes what is possible and permits normal exit.   |
+------------------------------+--------------------+-----------------------------------------------------+
```

### Safety Gate Invariant

Under no circumstances may a runtime exception, JSON parse error, process crash, or execution timeout in `PreToolUse` result in an `allow` decision. If payload parsing fails or an unhandled exception occurs, the runtime defaults to `deny` with an explanatory error emitted to stderr and a valid protocol deny payload to stdout.

## 4. Threat Matrix and Mitigations

### 4.1 Destructive Filesystem Operations

- **Threat**: Agent runs recursive directory deletion (`rmdir /s /q`, `rm -rf /`, `Remove-Item -Recurse -Force`) targeting project root, `.git`, system roots, or core files.
- **Mitigation**: Lexical command classifier inspects command syntax and path arguments across native file tools (`view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) and shell commands (`run_command`). Prohibited commands are denied immediately. High-risk git cleanup (`git clean -fdx`, `git reset --hard`) returns `force_ask` requiring fresh, un-cached developer confirmation.

### 4.2 Secret Exposure and Exfiltration

- **Threat**: Agent reads, edits, prints, or exfiltrates `.env`, SSH private keys (`id_rsa`, `id_ed25519`), AWS credentials, or sends secret keys via `curl`/`wget`.
- **Mitigation**: Pre-tool checks intercept reading, writing, or editing sensitive credential filenames across all native file operations (`view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `read_file`, `write_file`, `edit_file`) and deny shell commands that attempt to output or exfiltrate private tokens. Post-tool audit redacts all credential patterns using bounded regular expressions.

### 4.3 Database Mutation Safeguards

- **Threat**: Agent attempts destructive SQL queries (`DROP TABLE`, `TRUNCATE`, `DROP DATABASE`, `ALTER TABLE ... DROP`).
- **Mitigation**: Database operations are governed primarily by the PostgreSQL read-only user role verified in Phase 5. In addition, `PreToolUse` inspects SQL statements passed to database tools and immediately denies DDL/destructive mutations.

### 4.4 Audit Log Storage Bounds & Denial-of-Service

- **Threat**: Excessive tool calls fill developer disk storage or crash logging systems.
- **Mitigation**: Audit logging enforces a maximum file size (5 MB), rotates up to 3 archive files, and truncates overly long records. All file writes catch exceptions and fail open without causing infinite retry loops.

## 5. Security Testing Requirements

Every release must verify:

1. Malformed JSON handling without process crash.
2. Missing or null payload fields.
3. Unexpected or unknown tool names (defaults to `force_ask` with `semanticClass: "unknown"` requiring confirmation; never automatically approves unknown operations).
4. Payloads exceeding standard size limits (bounded read buffer up to 10 MB).
5. Unicode and non-ASCII character handling.
6. Path traversal attempts (`../../etc/passwd`, `C:\Windows\System32`).
7. Secret redaction effectiveness across standard credential formats.
8. Timeout behavior (handlers complete within strictly bounded milliseconds).
9. Windows path parsing (backslashes, drive letters, spaces, UNC).

## 6. Evidence Classification and Host Verification Boundaries

To prevent unfounded claims, verification evidence is classified across five explicit tiers:

1. **Automated Unit Tests**: Vitest in-memory tests verifying modular logic, schema adherence, and redaction patterns.
2. **Direct Handler Tests**: Standalone in-memory execution of handler functions against mock inputs.
3. **Integration Tests**: Standalone execution of the dispatcher CLI (`dispatcher.ts`) via Node.js subprocesses processing synthesized JSON payloads over stdin/stdout.
4. **Live Antigravity Host Tests**: Actual tool interception and UI prompt display within a live Antigravity host session.
5. **Blocked Tests**: Tests where host or environmental constraints (such as non-interactive OAuth) prevent automated execution.

### Verification Status of Critical Boundaries

- **PostgreSQL MCP Host Interception**: **NOT VERIFIED**. Subprocess integration tests (HOOK-30, HOOK-34, HOOK-35) confirm that the classifier and dispatcher parse and evaluate `call_mcp_tool` and `postgres_mcp_query` synthetic payloads. However, the end-to-end chain within an authentic Antigravity host runtime has not been observed.
- **`force_ask` Confirmation & Cache Bypass**: **BLOCKED** (HOOK-21, HOOK-31). Emitting `force_ask` from the classifier and simulating declines in integration tests is verified. However, confirming that the Antigravity UI displays a fresh confirmation modal despite cached "Always Allow" permissions remains unverified at the host UI level due to headless OAuth constraints.
