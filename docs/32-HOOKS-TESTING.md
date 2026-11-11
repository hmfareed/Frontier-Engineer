# Part 32 — Lifecycle hooks testing and verification

## Testing methodology

Frontier Engineer adheres to strict verification discipline. Testing lifecycle hooks requires multi-tiered verification across four distinct evidence categories:

```text
┌────────────────────────────────────────────────────────┐
│ 1. Schema Validation (Ajv & Canonical Schemas)        │
│    Canonical specs match canonical-hook.schema.json    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Unit Testing (Vitest)                               │
│    Individual modules, redaction, command classifier   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Integration Testing (Vitest & Subprocesses)        │
│    Dispatcher CLI, stdin/stdout pipelines, fallbacks  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. Live Runtime Acceptance (Disposable Workspace)     │
│    HOOK-01 through HOOK-10 in actual Antigravity host  │
└────────────────────────────────────────────────────────┘
```

## Adversarial evaluation scenarios

Fifteen structured scenarios (`specs/evaluation/hook-scenarios.json`) validate system resilience against hostile or malformed conditions:

1. **HOOK-SCEN-01**: Normal safe command (`npm test`) -> `allow`.
2. **HOOK-SCEN-02**: Clearly destructive command (`rmdir /s /q C:\Projects`) -> `deny`.
3. **HOOK-SCEN-03**: Ambiguous git cleanup (`git clean -fdx`) -> `ask`.
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

## Live acceptance tests (HOOK-01 – HOOK-10)

- **HOOK-01 (SessionStart)**: Session initializes once with correlation ID and clean workspace status.
- **HOOK-02 (PreToolUse allow)**: Safe development commands execute without interruption.
- **HOOK-03 (PreToolUse deny)**: Prohibited destructive commands are hard blocked before execution.
- **HOOK-04 (PreToolUse ask)**: High-risk operations require explicit human confirmation.
- **HOOK-05 (PostToolUse)**: Post-execution diagnostics are recorded with credentials redacted.
- **HOOK-06 (PreInvocation)**: High-priority engineering reminder injected concisely.
- **HOOK-07 (PostInvocation)**: Invocation turn count and metrics recorded without leaking model reasoning.
- **HOOK-08 (Stop)**: Finalization executes cleanly and flushes logs.
- **HOOK-09 (Failure handling)**: Malformed JSON fails closed on safety gates.
- **HOOK-10 (Disabled hook)**: Disabling a hook via `"enabled": false` is verified.
