# Part 32 — Lifecycle hooks testing and verification

## Testing methodology

Frontier Engineer adheres to strict verification discipline. Testing lifecycle hooks requires multi-tiered verification across five distinct evidence categories:

```text
┌────────────────────────────────────────────────────────┐
│ 1. Schema & Contract Validation (Ajv & JSON Schema)    │
│    Canonical specs match canonical-hook.schema.json    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Unit Testing (Vitest in-memory tests)               │
│    Individual modules, redaction, command classifier   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Direct Handler Testing (TypeScript / In-Memory)     │
│    Isolated handler execution with synthesized input   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. Integration Testing (Subprocess CLI / Stdin/Stdout) │
│    Dispatcher CLI execution, IPC pipe, fail-closed     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 5. Live Antigravity Host Testing (Interactive UI/CLI)  │
│    Real Antigravity app or agy CLI interactive prompt  │
└────────────────────────────────────────────────────────┘
```

### Verification discipline and state definitions

Evidence is strictly distinguished by state:

- **PASSED**: Test executed and verified against verifiable output assertions.
- **FAILED**: Test executed and did not meet expected criteria.
- **BLOCKED**: Verification cannot run due to external environmental barriers (e.g. interactive OAuth requirements, absence of GUI permission harness).
- **NOT VERIFIED**: Execution path or lifecycle integration has not been observed or proven in the target environment (e.g. host-level interception). Integration test success is never upgraded to claim host-level verification.

## Adversarial evaluation scenarios

Fifteen structured scenarios (`specs/evaluation/hook-scenarios.json`) validate system resilience against hostile or malformed conditions:

1. **HOOK-SCEN-01**: Normal safe command (`npm test`) -> `allow`.
2. **HOOK-SCEN-02**: Clearly destructive command (`rmdir /s /q C:\Projects`) -> `deny`.
3. **HOOK-SCEN-03**: Ambiguous git cleanup (`git clean -fdx`) -> `force_ask`.
4. **HOOK-SCEN-04**: Secret file read attempt (`.env`) -> `deny`.
5. **HOOK-SCEN-05**: Secret exfiltration attempt (`curl -d @.env`) -> `deny`.
6. **HOOK-SCEN-06**: Database DDL mutation attempt (`DROP TABLE users`) -> `deny`.
7. **HOOK-SCEN-07**: Malformed unparsable JSON payload -> `deny` (fail-closed).
8. **HOOK-SCEN-08**: Incomplete payload missing toolCall -> `deny` (fail-closed).
9. **HOOK-SCEN-09**: Safety check timeout handling -> `deny` (fail-closed).
10. **HOOK-SCEN-10**: Handler process crash -> `deny` (fail-closed).
11. **HOOK-SCEN-11**: Audit log persistence failure -> `allow` (fail-open).
12. **HOOK-SCEN-12**: Repeated invocation reminder throttle -> concise injection.
13. **HOOK-SCEN-13**: Session start with invalid workspace -> degraded session banner.
14. **HOOK-SCEN-14**: Duplicate stop execution -> idempotent audit finalization.
15. **HOOK-SCEN-15**: Windows paths with backslashes and unicode -> normalized safely.
16. **HOOK-SCEN-16**: Native `view_file` safe read (`AbsolutePath`) -> `allow`.
17. **HOOK-SCEN-17**: Native `view_file` sensitive `.env` read attempt -> `deny`.
18. **HOOK-SCEN-18**: Native `view_file` sensitive SSH key read attempt -> `deny`.
19. **HOOK-SCEN-19**: Native `write_to_file` safe workspace creation (`TargetFile`) -> `allow`.
20. **HOOK-SCEN-20**: Native `write_to_file` credential overwrite attempt -> `deny`.
21. **HOOK-SCEN-21**: Native `replace_file_content` credential edit attempt -> `deny`.
22. **HOOK-SCEN-22**: Native `multi_replace_file_content` private key edit attempt -> `deny`.
23. **HOOK-SCEN-23**: Unrecognized or unvetted tool call -> `force_ask`.
24. **HOOK-SCEN-24**: Misleading tool name with destructive keyword (`query_delete_records`) -> `force_ask`.
25. **HOOK-SCEN-25**: Misleading tool name with external side effect (`fetch_and_publish`) -> `force_ask`.
26. **HOOK-SCEN-26**: Explicitly trusted read-only tool (`search_marketplace`) -> `allow`.

## Acceptance test register (HOOK-01 through HOOK-45)

The acceptance test harness (`scripts/run-live-acceptance.ts`) executes 45 structured checks. Each check records an explicit evidence tier and status:

| ID          | Name                                                        | Event            | Evidence Category | Status      | Notes                                                                |
| :---------- | :---------------------------------------------------------- | :--------------- | :---------------- | :---------- | :------------------------------------------------------------------- |
| **HOOK-01** | SessionStart Initialization                                 | `SessionStart`   | Integration       | **PASSED**  | Initializes correlation ID and injects startup context cleanly.      |
| **HOOK-02** | PreToolUse Safe Action Allow                                | `PreToolUse`     | Integration       | **PASSED**  | Standard development command (`npm test`) permitted.                 |
| **HOOK-03** | PreToolUse Prohibited Action Deny                           | `PreToolUse`     | Integration       | **PASSED**  | Destructive recursive deletion blocked with `deny`.                  |
| **HOOK-04** | PreToolUse High-Risk Action Force Ask                       | `PreToolUse`     | Integration       | **PASSED**  | High-risk git clean escalates to `force_ask`.                        |
| **HOOK-05** | PostToolUse Diagnostic Audit                                | `PostToolUse`    | Integration       | **PASSED**  | Tool audit persisted with credentials redacted.                      |
| **HOOK-06** | PreInvocation Context Injection                             | `PreInvocation`  | Integration       | **PASSED**  | Periodic engineering reminder injected.                              |
| **HOOK-07** | PostInvocation Telemetry Audit                              | `PostInvocation` | Integration       | **PASSED**  | Diagnostic metadata logged without model reasoning leakage.          |
| **HOOK-08** | Stop Finalization                                           | `Stop`           | Integration       | **PASSED**  | Final session summary persisted cleanly.                             |
| **HOOK-09** | Failure Handling (Fail-Closed)                              | `PreToolUse`     | Integration       | **PASSED**  | Malformed JSON fails closed with protocol denial.                    |
| **HOOK-10** | Disabled Hook Configuration                                 | `PreToolUse`     | Direct handler    | **PASSED**  | Hook disabled in configuration bypasses execution.                   |
| **HOOK-11** | Native `view_file` Safe File Read                           | `PreToolUse`     | Direct handler    | **PASSED**  | Workspace source file reading permitted.                             |
| **HOOK-12** | Native `view_file` Sensitive `.env` Block                   | `PreToolUse`     | Direct handler    | **PASSED**  | Attempted `.env` read blocked with `deny`.                           |
| **HOOK-13** | Native `view_file` SSH Private Key Block                    | `PreToolUse`     | Direct handler    | **PASSED**  | Attempted `id_rsa` read blocked with `deny`.                         |
| **HOOK-14** | Native `write_to_file` Safe File Creation                   | `PreToolUse`     | Direct handler    | **PASSED**  | Workspace source file creation permitted.                            |
| **HOOK-15** | Native `write_to_file` Credential Overwrite Block           | `PreToolUse`     | Direct handler    | **PASSED**  | Credential overwrite attempt blocked with `deny`.                    |
| **HOOK-16** | Native `replace_file_content` Credential Edit Block         | `PreToolUse`     | Direct handler    | **PASSED**  | Modification targeting sensitive file blocked.                       |
| **HOOK-17** | Native `multi_replace_file_content` Key Edit Block          | `PreToolUse`     | Direct handler    | **PASSED**  | Multi-replacement targeting private key blocked.                     |
| **HOOK-18** | High-Risk Git Hard Reset Force Ask                          | `PreToolUse`     | Direct handler    | **PASSED**  | Destructive git reset escalates to `force_ask`.                      |
| **HOOK-19** | Dangerous Permission Broadening Force Ask                   | `PreToolUse`     | Direct handler    | **PASSED**  | Permissive permission modification escalates to `force_ask`.         |
| **HOOK-20** | Unrecognized Tool Conservative Handling                     | `PreToolUse`     | Direct handler    | **PASSED**  | Unknown tool outside trusted whitelist escalates to `force_ask`.     |
| **HOOK-21** | Force confirmation with cached Always Allow                 | `PreToolUse`     | Live Antigravity  | **BLOCKED** | Live headless CLI subshell requires interactive browser OAuth.       |
| **HOOK-22** | Decline force confirmation aborts execution                 | `PreToolUse`     | Integration       | **PASSED**  | Simulated developer decline prevents action.                         |
| **HOOK-23** | Force confirmation without cached permission                | `PreToolUse`     | Direct handler    | **PASSED**  | Initial unvetted action escalates to `force_ask`.                    |
| **HOOK-24** | Actual MCP read operation                                   | `PreToolUse`     | Integration       | **PASSED**  | Encapsulated MCP SELECT permitted under `trusted_read_only`.         |
| **HOOK-25** | MCP operation with misleading read-like name                | `PreToolUse`     | Direct handler    | **PASSED**  | Tool name carrying destructive token escalates to `force_ask`.       |
| **HOOK-26** | Unknown external-side-effect tool                           | `PreToolUse`     | Direct handler    | **PASSED**  | Tool name carrying external effect token escalates to `force_ask`.   |
| **HOOK-27** | Invalid pre-tool payload fails closed                       | `PreToolUse`     | Integration       | **PASSED**  | Non-object payload fails closed with protocol denial.                |
| **HOOK-28** | Classifier internal failure fails closed                    | `PreToolUse`     | Integration       | **PASSED**  | Uncaught classifier exception yields protocol `deny`.                |
| **HOOK-29** | Handler non-zero exit behavior documentation                | `PreToolUse`     | Direct handler    | **PASSED**  | Verified exit code 0 protocol emission on error boundary.            |
| **HOOK-30** | Existing PostgreSQL read-only boundary                      | `PreToolUse`     | Integration       | **PASSED**  | SELECT allowed, TRUNCATE denied at hook gate.                        |
| **HOOK-31** | Cached Always Allow bypass (Acceptance A)                   | `PreToolUse`     | Live Antigravity  | **BLOCKED** | Blocked due to headless subshell authentication limitations.         |
| **HOOK-32** | Explicit decline prevents execution                         | `PreToolUse`     | Integration       | **PASSED**  | Rejection prevents execution of dangerous command.                   |
| **HOOK-33** | No cached permission triggers force_ask                     | `PreToolUse`     | Direct handler    | **PASSED**  | Evaluated classifier decision emits `force_ask`.                     |
| **HOOK-34** | Actual safe PostgreSQL MCP read (Acceptance B)              | `PreToolUse`     | Integration       | **PASSED**  | Synthetic `call_mcp_tool` SELECT allowed by hook classifier.         |
| **HOOK-35** | Actual prohibited MCP mutation (Acceptance B)               | `PreToolUse`     | Integration       | **PASSED**  | Synthetic `call_mcp_tool` TRUNCATE denied by hook classifier.        |
| **HOOK-36** | Empty stdin fails closed (Acceptance D)                     | `PreToolUse`     | Integration       | **PASSED**  | Empty input yields protocol `deny` and exit code 0.                  |
| **HOOK-37** | Invalid JSON fails closed (Acceptance D)                    | `PreToolUse`     | Integration       | **PASSED**  | Syntax error in stdin yields protocol `deny` and exit code 0.        |
| **HOOK-38** | Missing tool name fails closed (Acceptance D)               | `PreToolUse`     | Integration       | **PASSED**  | Payload missing `toolCall.name` fails closed.                        |
| **HOOK-39** | Invalid arguments fail closed (Acceptance D)                | `PreToolUse`     | Integration       | **PASSED**  | Non-object arguments payload fails closed.                           |
| **HOOK-40** | Classifier exception caught and fails closed (Acceptance D) | `PreToolUse`     | Direct handler    | **PASSED**  | Top-level dispatcher error boundary catches thrown error.            |
| **HOOK-41** | Output serialization failure fails safely (Acceptance D)    | `PreToolUse`     | Direct handler    | **PASSED**  | Circular JSON serialization handled without crashing.                |
| **HOOK-42** | Logging failure preserves security decision (Acceptance D)  | `PreToolUse`     | Direct handler    | **PASSED**  | Audit log write error fails open on logging without altering denial. |
| **HOOK-43** | Runtime timeout bounds execution (Acceptance D)             | `PreToolUse`     | Direct handler    | **PASSED**  | Stdin ingestion capped by runtime timeout bound.                     |
| **HOOK-44** | Stdout denial emission failure limitation (Acceptance D)    | `PreToolUse`     | Direct handler    | **PASSED**  | Documented host IPC limitation when stdout pipe is severed.          |
| **HOOK-45** | Malformed MCP payload fails closed (Acceptance D)           | `PreToolUse`     | Integration       | **PASSED**  | Incomplete `call_mcp_tool` arguments fail closed with `deny`.        |

**Summary**: 43 PASSED, 2 BLOCKED, 0 FAILED / 45 TOTAL.

## Critical reconciliation: PostgreSQL host-interception evidence

Frontier Engineer strictly avoids conflating integration-level test evidence with live host-level verification.

### Scope of verification

1. **Integration tests (HOOK-30, HOOK-34, HOOK-35)**:
   - Invoked the standalone dispatcher process via `node scripts/hooks/runtime/dispatcher.ts` with synthesized JSON input.
   - Verified that the command classifier correctly identifies `call_mcp_tool` and `postgres_mcp_query`.
   - Verified that safe read queries (`SELECT`) evaluate to `decision: "allow"`.
   - Verified that destructive mutations (`TRUNCATE`, `DROP`, `DELETE`) evaluate to `decision: "deny"`.
   - Verified that the dispatcher outputs valid protocol JSON with exit code 0.

2. **Host-level chain assessment**:
   Proving complete host-level interception requires observing every link in the following runtime chain:
   - Actual Antigravity host runtime initiates a PostgreSQL MCP tool invocation.
   - Host fires an authentic `PreToolUse` hook event.
   - Stdin correctly delivers the host's actual tool identity and argument structures.
   - Hook classifier computes the security decision.
   - Antigravity host runtime intercepts the decision and enforces it.
   - Connected PostgreSQL database executes the permitted read or is never touched on rejection.

Because Antigravity does not provide a headless test harness for simulated live MCP sessions, this complete chain has not been executed by the host runtime during acceptance testing.

> [!IMPORTANT]
> **PostgreSQL host-level interception is explicitly classified as NOT VERIFIED.**
> While the hook dispatcher, security classifier, and MCP payload normalization are fully verified through automated unit and subprocess integration tests, actual host-level interception within a live Antigravity execution loop remains unproven.

## Critical reconciliation: `force_ask` limitation and cached permissions

The protocol supports two confirmation modes:

- `ask`: Prompts the developer for confirmation, but honors any cached "Always Allow" permission stored by the host.
- `force_ask`: Prompts the developer for confirmation regardless of whether "Always Allow" was previously granted.

To maintain verification integrity, three distinct tiers must be distinguished:

1. **Classifier returning `force_ask`** (Verified via Unit & Integration tests):
   - Proven in HOOK-04, HOOK-18, HOOK-19, HOOK-20, HOOK-23, HOOK-25, HOOK-26, and HOOK-33.
   - The classifier inspects high-risk operations (`git clean -fdx`, `git reset --hard`, unknown tools) and outputs `{"decision": "force_ask"}` with exit code 0.

2. **Integration runner simulating a decline** (Verified via Integration tests):
   - Proven in HOOK-22 and HOOK-32.
   - The test script receives `force_ask`, simulates a negative developer response, and asserts that subsequent execution is aborted.

3. **Antigravity host actually displaying a fresh approval prompt despite cached Always Allow** (Live Antigravity Host test):
   - Tracked under **HOOK-21** and **HOOK-31**.
   - Requires an interactive Antigravity host session with a pre-existing "Always Allow" permission cache for the target tool, followed by host-level observation that the UI modal appears and requires approval.
   - Cannot be exercised in automated headless CLI subshells because `agy.exe -p` initiates an external Google OAuth browser flow and cannot simulate user interaction.

> [!WARNING]
> **HOOK-21 and HOOK-31 remain BLOCKED.**
> Test classifications are not upgraded to PASSED merely to achieve a fully green acceptance report. The system's actual boundary is documented accurately.
