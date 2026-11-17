# Part 31 — Lifecycle hooks runtime architecture

## Runtime modules and responsibilities

The Frontier Engineer hooks runtime is implemented in TypeScript for Node.js (>= 22.6.0). It avoids external runtime dependencies and executes directly without compilation steps.

```text
scripts/hooks/
├── runtime/
│   ├── dispatcher.ts          # Central CLI entrypoint and event router
│   ├── input.ts               # Bounded stdin reader and safe JSON parser
│   ├── output.ts              # Strict stdout JSON emitter and stderr logger
│   ├── logger.ts              # Bounded JSONL audit logger with file rotation
│   ├── validation.ts          # Event-specific payload schema validators
│   └── security.ts            # Fail-closed and fail-open policy resolvers
├── handlers/
│   ├── session-start.ts       # Session initialization handler
│   ├── pre-tool-use.ts        # Pre-tool safety gating handler
│   ├── post-tool-use.ts       # Post-tool audit record handler
│   ├── pre-invocation.ts      # Engineering context reminder handler
│   ├── post-invocation.ts     # Invocation telemetry handler
│   └── stop.ts                # Session termination and flush handler
└── lib/
    ├── audit-schema.ts        # Versioned v1 audit-event validator and safe summary builder
    ├── command-classifier.ts  # Lexical command and tool argument classifier
    ├── workspace-validator.ts # Workspace directory and boundary inspector
    ├── secret-redactor.ts     # Regex credential redaction engine
    └── event-context.ts       # Event payload typing and normalizer
```

## Process communication protocol

1. **Stdin Ingestion**:
   - `input.ts` reads stdin with an upper bound of 10 MB to prevent memory exhaustion.
   - Input is parsed as JSON safely. If EOF is delayed, a 4-second timeout prevents deadlock.
2. **Execution & Policy Routing**:
   - `dispatcher.ts` maps `--event` or `--hook` arguments to the appropriate handler.
   - If payload validation fails, `security.ts` selects the safe fallback.
3. **Stdout Emission**:
   - `output.ts` emits strictly valid JSON to `stdout` (`{"decision":"allow"}` or `{}`).
   - `stdout` is never used for debugging, warnings, or unstructured text.
4. **Stderr Diagnostics**:
   - Errors, warnings, and diagnostic traces are formatted as `[FRONTIER_HOOK ...]` and sent to `stderr`.

## Windows compatibility

The runtime is designed for cross-platform portability with first-class Windows x64 support:

- Command invocations in `hooks.json` use standard Node.js scripts (`node scripts/hooks/...`).
- Windows path separators (`\` vs `/`), drive letters (`C:`), and UNC paths are normalized via `path.resolve` and `path.relative`.
- Avoids shell-specific syntax (`&&`, `|`, bash builtins) in hook commands.
- Compatible with Windows `cmd /c` execution environment used by Antigravity.

## Latency and performance budget

- In-process lexical classification executes in < 5ms.
- Full process lifecycle (Node startup, stdin parse, evaluation, stdout emit) completes in 30–80ms.
- Handlers run well within Antigravity's bounded timeouts (5–15s).

## Audit telemetry contract and versioning

Execution telemetry written by `runtime/logger.ts` to `.frontier/audit/execution.jsonl` (or `${PLUGIN_DATA}/audit/execution.jsonl`) conforms to `schemas/audit-event.schema.json` (`schemaVersion: 1`), enforced before disk persistence via `lib/audit-schema.ts`:

- **Required v1 core fields**: `schemaVersion`, `eventId`, `timestamp` (ISO-8601), `eventType` (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`, `SafeFallback`, `Diagnostic`), `hookId`, `source` (`production`, `evaluation`, `test`), `correlationId`, and `status`.
- **Optional structured fields & alias consistency**: `executionId`, `parentExecutionId`, `agentId`, `skillId`, `stepIdx` (non-negative integer), `invocationNum` (non-negative integer), `toolName`, `durationMs`, `normalizedSummary` (bounded redacted summary only — never raw secrets or raw command payloads), `policyDecision`, `evalContext`, `error`, and `metadata`. Legacy aliases `event` and `conversationId` are supported for backward compatibility; when both modern and legacy aliases are supplied, they must agree (`event === eventType` and `conversationId === correlationId`), otherwise events are rejected. Note that while `event`/`eventType` enum agreement is represented in the JSON Schema `anyOf`, cross-property equality between `conversationId` and `correlationId` is enforced by the dedicated runtime validator (`lib/audit-schema.ts`) rather than generic JSON Schema validation to avoid non-standard `$data` extensions that break standard Draft-07 JSON Schema validators.
- **Telemetry provenance & precedence policy**:
  1. `FRONTIER_AUDIT_SOURCE`: If explicitly set to a valid source (`production`, `evaluation`, `test`), it takes precedence. Invalid values emit diagnostics and are rejected. If set to `production` while `evalContext` is present, the event is rejected (evalContext must never coexist with production source).
  2. Evaluation context: If `evalContext` or `FRONTIER_EVAL_RUN_ID` / `FRONTIER_EVAL_SCENARIO_ID` is present without explicit source, source resolves to `evaluation`.
  3. Automated testing: If running under verified test execution (`VITEST === "true"` or `NODE_TEST_CONTEXT` defined), source resolves to `test`. Standalone processes with `NODE_ENV === "test"` alone are never misclassified as test telemetry.
  4. Default: Resolves to `production`.
- **Versioning & compatibility policy**: Breaking changes (removing required fields or narrowing existing enum meanings) require incrementing `schemaVersion` (`2+`). Optional additive properties must preserve `additionalProperties: false` explicitly in `schemas/audit-event.schema.json` and `AUDIT_ALLOWED_TOP_LEVEL_KEYS` in `lib/audit-schema.ts`; unit tests assert exact parity between the runtime validator and the JSON Schema.
- **Safety invariants**: Optional correlation/identity fields (`executionId`, `parentExecutionId`, `agentId`, `skillId`, `evalContext`) are emitted only when genuinely known and never fabricated. Leading command environment assignments (`VAR=val`) are skipped during executable identification and never exposed in `commandBin` or summaries. All string fields are bounded after credential redaction so secret expansion never breaks length limits. When no explicit workspace or `PLUGIN_DATA` directory exists, telemetry skips disk writes rather than falling back to `process.cwd()`. Telemetry failures fail open without weakening `PreToolUse` `deny`/`force_ask` decisions.
