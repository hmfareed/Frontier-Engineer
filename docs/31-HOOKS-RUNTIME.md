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

## Telemetry reading and normalization architecture (Phase 8.6B)

The telemetry reader subsystem (`scripts/telemetry/`) provides a bounded-memory, read-only interface for consuming audit events:

- **Streaming reader architecture**: Implemented in `scripts/telemetry/telemetry-reader.ts` using `node:readline` over read-only (`flags: "r"`) `node:fs` streams. Files are streamed line-by-line to prevent out-of-memory spikes regardless of log volume. Physical line counts (`totalLinesRead`) track line boundaries directly from file streams rather than yielded diagnostics or parsed items.
- **Rotated log discovery & canonical path security**: Discovers active log (`execution.jsonl`) and rotated archives (`execution.jsonl.1`..`3`). When rotated logs are included, they are traversed in strict chronological order: oldest archive `.3` → `.2` → `.1` → active `execution.jsonl`. Discovered files store verified canonical paths (`fs.realpathSync`) within the real audit directory, and reader streams open canonical targets directly to prevent candidate symlink substitution between discovery and ingestion.
- **Generation parsing & strict modern quarantine**: Implemented in `scripts/telemetry/telemetry-parser.ts`. Distinguishes `modern-v1` records (`schemaVersion: 1`, validated against `lib/audit-schema.ts`) from pre-v1 historical `legacy` records (`schemaVersion: undefined`). Valid modern records are normalized and canonicalized. Schema-invalid modern records (`schemaVersion: 1`) are strictly quarantined (emitting structured diagnostics with redacted values and line numbers, while yielding no normalized record and never falling back to legacy classification). Genuine legacy records canonicalize aliases (`event` → `eventType`, `conversationId` → `correlationId`) and extract policy decisions without fabricating identifiers.
- **Malformed-record & corruption tolerance**: Blank lines are skipped; malformed JSON or truncated lines yield structured `ParseDiagnostic` objects (`INVALID_JSON`, `SCHEMA_VIOLATION`, `UNSUPPORTED_VERSION`) without terminating the file scan or crashing caller processes.
- **Read-only & isolation guarantees**: Operates strictly read-only. Source files are never modified, re-sorted, or rewritten in place. Tests execute exclusively against disposable temporary directories.
- **Known limitations & filesystem concurrency**: Specialist `agentId`, child `executionId`, and `skillId` are supported by the schema but are not currently populated by the live Antigravity host runtime. Regarding filesystem concurrency: opening verified canonical paths eliminates candidate symlink substitution in the audit directory; however, user-space Node.js runtime operations cannot achieve kernel-level atomic path locking (e.g. Linux `openat2(..., RESOLVE_BENEATH)`), so adversaries with concurrent arbitrary write access to the underlying parent filesystem could theoretically manipulate ancestor directories.

## Telemetry query, aggregation & diagnostics architecture (Phase 8.6B-2)

The telemetry query, aggregation, diagnostics, and formatting layer (`scripts/telemetry/`) provides a reusable, deterministic query and reporting API on top of the Phase 8.6B-1 reader and normalizer:

- **Query engine & deterministic pagination (`telemetry-query.ts`)**:
  - `queryTelemetryRecords(records, query)`: filters, sorts, and paginates normalized telemetry records immutably using AND filter semantics.
  - Supported filters: event attributes (`eventType`, `eventId`, `status`, `source`, `policyDecision`, `toolName`), correlation contexts (`correlationId`, legacy `conversationId`, `executionId`, `agentId`, `skillId`), time ranges (`startTime`, `endTime`, `exactTime` with input validation against inverted or invalid dates), and generation (`modern-v1` vs `legacy`).
  - Approved text search: case-insensitive search strictly across non-sensitive metadata (`eventType`, `toolName`, `correlationId`, `reason`, `category`, `summary`, `commandBin`, `error`); arbitrary metadata or raw object properties are not exposed to text search.
  - Deterministic sorting & tie-breaking: sorts by `timestamp` (default), `eventType`, `durationMs`, or `stepIdx`. Identical primary keys are broken deterministically by `filePath` → `lineNumber` → `eventId`.
  - Bounded pagination: validated 1-based `page` and bounded `pageSize` (default 50, maximum 1000) returning structured `TelemetryPaginationMeta` (`totalMatched`, `page`, `pageSize`, `totalPages`, `hasMore`).
- **Telemetry aggregation & metrics (`telemetry-aggregator.ts`)**:
  - `aggregateTelemetry(records, diagnostics)`: calculates deterministic metrics without mutating input records.
  - Summarizes valid records, counts by event type, status, policy decision (including explicit `none`), source, tool invocations, and generations.
  - Tracks missing optional metadata (`missingPolicyDecision`, `missingSummary`, `missingToolName`, `missingAgentId`, etc.) without fabricating non-existent attributes.
  - All output object keys are sorted alphabetically for deterministic serialization.
- **Structural integrity diagnostics (`telemetry-diagnostics.ts`)**:
  - `analyzeTelemetryIntegrity(records, diagnostics)`: inspects normalized records and ingest diagnostics, categorizing findings into:
    - _Structural errors_: unparseable records, schema violations, unsupported schema versions, invalid ISO timestamps.
    - _Consistency warnings_: duplicate `eventId` instances, non-monotonic timestamps within a session, step-index discontinuities (`stepIdx` gaps), incomplete session correlations, and suspected unredacted credential patterns.
    - _Informational observations_: presence of legacy records, unpopulated specialist host fields, empty audit logs.
  - Non-tampering invariants: clock skew, subagent concurrency, and non-monotonic timestamps are reported as warnings, never as proof of tampering.
  - Explicit integrity limitations: clearly documents that structural diagnostics do not provide cryptographic non-repudiation or tamper-proofing; cryptographic hash chains are not implemented in Phase 8.6B.
- **Deterministic output formatters (`telemetry-formatter.ts`)**:
  - `formatTelemetryJson(data, options)`: serializes telemetry data with canonical alphabetical key ordering, circular reference protection (`"[Circular]"`), and secret redaction.
  - `formatTelemetryMarkdown(data, options)`: formats query results, aggregations, and integrity reports into clean GitHub-flavored Markdown tables. Escapes cell delimiters (`|`, `\r`, `\n`), enforces cell width limits, includes pagination footers, and redacts sensitive strings.
- **Phase separation**: These modules constitute library APIs. CLI integration is implemented in Phase 8.6B-3 (`scripts/cli/telemetry-command.ts`, `scripts/cli/frontier-cli.ts`).

## Telemetry & audit CLI interface (Phase 8.6B-3)

The CLI layer exposes the telemetry subsystem through the unified `frontier-cli` entrypoint without requiring SQLite database initialization or write privileges:

- **CLI commands & alias parity**:
  - `frontier telemetry [action] [options]`: Primary telemetry query, aggregation, and integrity verification command.
  - `frontier audit [action] [options]`: Full alias for `frontier telemetry`.
  - Supported actions:
    - `list` (default): Query and paginate normalized audit telemetry records in tabular format.
    - `summary` / `aggregate`: Compute aggregate metrics, generation breakdown, and tool/policy distributions.
    - `verify` / `diagnostics`: Run structural schema and session continuity integrity analysis.
    - `show <event_id>`: Query and display a single record matching the given unique event ID.
- **Output formats**:
  - `--format text` / `--format markdown` (default): Renders formatted GitHub-flavored Markdown tables.
  - `--format json`: Emits canonical, deterministic JSON with key sorting, circular reference protection, and secret redaction.
- **Strict query & filter controls**:
  - Filtering by `--event-type`, `--event-id`, `--decision`, `--tool`, `--status`, `--source`, `--correlation-id`, `--conversation-id`, `--execution-id`, `--agent-id`, `--skill-id`, `--generation` (`modern-v1` | `legacy`), and approved `--text` search.
  - Bounded time ranges via `--start-time`, `--end-time`, and `--exact-time` with input validation against inverted or malformed timestamps.
  - Deterministic sorting via `--sort-by <timestamp|eventType|durationMs|stepIdx>` and `--sort-order <asc|desc>`.
  - Bounded pagination via `--page` (positive int) and `--page-size` (1..1000).
- **Log discovery & rotation controls**:
  - `--audit-dir <path>`: Allows querying arbitrary workspace or evaluation audit directories.
  - `--include-rotated`: Scans rotated archive logs (`execution.jsonl.1`..`3`) in strict chronological order.
  - `--max-lines <n>`: Enforces total physical line reading limits across all scanned files.
- **Deterministic exit codes**:
  - `0`: Success (query, summary, diagnostics, or show command succeeded).
  - `1`: Operational failure (unhandled read or parsing exception).
  - `2`: Invalid arguments, validation failure, unknown action, or flag conflict.
  - `3`: Audit directory unavailable or no audit log files discovered.
  - `4`: Target entity not found (requested `eventId` does not exist in logs).
- **Isolation and security**:
  - Strictly read-only: Zero writes or modifications to `.frontier/audit/execution.jsonl` or workspace files.
  - Completely decoupled from SQLite database storage: Does not open or mutate `.frontier/intelligence/index.sqlite`.
  - Flag isolation: Rejects telemetry options on intelligence subcommands and rejects intelligence options on telemetry commands.
