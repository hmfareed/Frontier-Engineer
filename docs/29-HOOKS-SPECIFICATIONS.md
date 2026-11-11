# Part 29 — Lifecycle hooks specifications

## The canonical hook set

Frontier Engineer defines six canonical lifecycle hooks that govern execution lifecycle events in Google Antigravity.

| Identifier                     | Lifecycle Event  | Matcher Target                                  | Timeout | Security Classification | Default Failure Mode |
| ------------------------------ | ---------------- | ----------------------------------------------- | ------- | ----------------------- | -------------------- |
| `frontier-session-init`        | `SessionStart`   | N/A                                             | 10s     | `session_lifecycle`     | `degrade_gracefully` |
| `frontier-pre-tool-safety`     | `PreToolUse`     | `run_command\|read_file\|write_file\|edit_file` | 15s     | `critical_security`     | `fail_closed`        |
| `frontier-post-tool-audit`     | `PostToolUse`    | `run_command\|read_file\|write_file\|edit_file` | 10s     | `audit_logging`         | `fail_open`          |
| `frontier-engineering-context` | `PreInvocation`  | N/A                                             | 5s      | `context_injection`     | `fail_open`          |
| `frontier-invocation-audit`    | `PostInvocation` | N/A                                             | 5s      | `audit_logging`         | `fail_open`          |
| `frontier-session-stop`        | `Stop`           | N/A                                             | 5s      | `session_lifecycle`     | `fail_open`          |

---

## 1. `frontier-session-init` (SessionStart)

- **Purpose**: Establishes execution context when a new conversation session begins.
- **Trigger**: Once at conversation startup.
- **Input**: Common metadata payload (`conversationId`, `workspacePaths`, `transcriptPath`).
- **Output Protocol**:

  ```json
  {
    "injectSteps": [
      {
        "systemMessage": {
          "systemMessage": "Frontier Engineer session initialized. Verified workspace context: ... Canonical safeguards and execution audits are active."
        }
      }
    ]
  }
  ```

- **Boundaries**: Does not scan the entire disk, install packages, or read environment credentials.

---

## 2. `frontier-pre-tool-safety` (PreToolUse)

- **Purpose**: Safety gate inspecting tool calls before execution.
- **Matcher**: `run_command|read_file|write_file|edit_file`
- **Input**: Tool call object (`toolCall: { name, args }`), `stepIdx`, `conversationId`.
- **Output Protocol**:
  - `{"decision": "allow"}` — Safe operation proceeds.
  - `{"decision": "deny", "reason": "..."}` — Destructive or exfiltrating operation blocked.
  - `{"decision": "ask", "reason": "..."}` — High-risk command requires human confirmation.
- **Policies**:
  1. Denies drive formatting and partition tools (`format`, `mkfs`, `diskpart`).
  2. Denies recursive deletion of root or drive trees (`rmdir /s /q C:\`, `rm -rf /`).
  3. Denies reading or dumping sensitive credentials (`.env`, `id_rsa`, `id_ed25519`).
  4. Denies external credential exfiltration (`curl -d @.env`).
  5. Denies destructive database DDL mutations (`DROP TABLE`, `TRUNCATE`).
  6. Escalates ambiguous/high-risk actions (`git clean -fdx`, `git reset --hard`, `chmod 777`) to `ask`.

---

## 3. `frontier-post-tool-audit` (PostToolUse)

- **Purpose**: Captures execution telemetry following tool execution.
- **Matcher**: `run_command|read_file|write_file|edit_file`
- **Input**: Tool call metadata, `stepIdx`, `error` string.
- **Output Protocol**: `{}`
- **Storage**: Bounded JSONL log (`.frontier/audit/execution.jsonl`) with 5 MB rotation.

---

## 4. `frontier-engineering-context` (PreInvocation)

- **Purpose**: Injects high-priority engineering reminders before model invocations.
- **Input**: `invocationNum`, `initialNumSteps`, common metadata.
- **Output Protocol**:

  ```json
  {
    "injectSteps": [
      {
        "systemMessage": {
          "systemMessage": "Frontier Reminder: Inspect before editing; verify changes with tests before claiming completion; distinguish assumptions from verified facts."
        }
      }
    ],
    "terminationBehavior": ""
  }
  ```

- **Economy**: Injected only on initial or periodic turns (under 25 words).

---

## 5. `frontier-invocation-audit` (PostInvocation)

- **Purpose**: Records invocation metrics (turn number, step count).
- **Input**: `invocationNum`, `initialNumSteps`.
- **Output Protocol**: `{"injectSteps": [], "terminationBehavior": ""}`
- **Privacy**: Does not persist model reasoning or internal thoughts.

---

## 6. `frontier-session-stop` (Stop)

- **Purpose**: Finalizes session audit trails when the execution loop terminates.
- **Input**: `executionNum`, `terminationReason`, `fullyIdle`.
- **Output Protocol**: `{}`
- **Idempotency**: Prevents duplicate finalization writes.
