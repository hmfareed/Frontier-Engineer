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
