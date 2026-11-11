# ADR-006: Lifecycle Hooks Architecture and Execution-Time Safeguards

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** 6
- **Related:** [Part 28 Hooks Architecture](../28-HOOKS-ARCHITECTURE.md), [Part 29 Hooks Specifications](../29-HOOKS-SPECIFICATIONS.md), [Part 30 Hooks Security](../30-HOOKS-SECURITY.md), [Part 31 Hooks Runtime](../31-HOOKS-RUNTIME.md), [Part 32 Hooks Testing](../32-HOOKS-TESTING.md), [Part 33 Hooks Portability](../33-HOOKS-PORTABILITY.md), [ADR-001](ADR-001-foundation.md), [ADR-002](ADR-002-agent-system.md), [ADR-003](ADR-003-skills-system.md), [ADR-004](ADR-004-rules-system.md), [ADR-005](ADR-005-mcp-integration-architecture.md)

## Context

Frontier Engineer's prior phases established the core plugin foundation (Phase 1), specialized agents (Phase 2), portable skills (Phase 3), modular rules (Phase 4), and secure MCP integrations (Phase 5).

However, until Phase 6, all behavioral guidelines and safety constraints operated as instructions within system prompts or Markdown rules. Natural language rules, while effective for standard model reasoning, cannot provide deterministic execution-time guarantees. For instance:

- An LLM may attempt recursive directory deletion or format commands if misled by ambiguous prompt context or adversarial inputs.
- An agent might inadvertently inspect sensitive credential files (`.env`, `id_rsa`) or emit them in unredacted terminal outputs.
- Destructive database mutations (`DROP TABLE`, `TRUNCATE`) could be triggered if an agent bypasses instruction boundaries.

To enforce engineering safeguards at the point of action, Frontier Engineer requires a deterministic execution control layer that integrates natively with Google Antigravity's lifecycle hooks.

## Decision Drivers

1. **Deterministic Enforcement:** Safeguards must evaluate tool calls at the moment of execution rather than relying solely on post-hoc review or prompt obedience.
2. **Predictable & Minimal Runtime:** Handlers must run synchronously, terminate rapidly (< 80ms), and avoid introducing background loops, daemons, external services, or cloud telemetry.
3. **Fail-Safe Integrity:** The system must define explicit failure policies per lifecycle event. Security gates (`PreToolUse`) must fail closed; audit logs and context injectors must fail open to avoid halting normal development.
4. **Canonical-First Architecture:** Behavioral rules and hook contracts must be authored platform-agnostically in `specs/hooks/` and compiled deterministically into loader-visible `hooks.json`.
5. **Data Privacy & Bound Storage:** Execution telemetry must sanitize passwords, bearer tokens, and private keys before local persistence, with bounded log files (5 MB cap).

## Decisions

### 1. Canonical-first specification architecture

All lifecycle hook policies are authored platform-independently under `specs/hooks/`:

- `hook-registry.md`: The authoritative registry of all lifecycle hooks.
- `hook-security-model.md`: The permission matrix and threat mitigation specification.
- Six canonical hook specifications: `session-start.md`, `pre-tool-use.md`, `post-tool-use.md`, `pre-invocation.md`, `post-invocation.md`, `stop.md`.

Each specification requires frontmatter validated against `schemas/canonical-hook.schema.json` and empty `platformConfig: {}`.

### 2. Antigravity code generation and drift checking

The compiler script `scripts/generate-antigravity-hooks.ts` reads the canonical specifications, validates them against JSON schemas, and emits loader-visible `<plugin-root>/hooks.json`.
Drift detection is integrated into `scripts/validate.ts` to ensure that `hooks.json` never drifts from canonical policy.

### 3. Six canonical lifecycle hooks

Frontier Engineer implements six hooks mapped to official Antigravity events:

1. `frontier-session-init` (`SessionStart`): Initializes session context, sets correlation IDs, and verifies workspace health without running intrusive background scripts.
2. `frontier-pre-tool-safety` (`PreToolUse`): Intercepts `run_command`, `read_file`, `write_file`, and `edit_file`. Classifies commands, denies destructive filesystem actions and secret exfiltration, and escalates ambiguous commands to `ask`.
3. `frontier-post-tool-audit` (`PostToolUse`): Records execution timestamps, tool names, sanitized arguments, and status in `.frontier/audit/execution.jsonl`.
4. `frontier-engineering-context` (`PreInvocation`): Injects concise engineering reminders (< 25 words) encouraging verification and testing discipline without token bloat.
5. `frontier-invocation-audit` (`PostInvocation`): Records invocation turn numbers and step counts without capturing model reasoning or context windows.
6. `frontier-session-stop` (`Stop`): Flushes pending logs and marks session termination cleanly.

### 4. Event-specific failure handling

Failure behavior is explicitly defined per lifecycle event:

- `PreToolUse`: **Fail-closed**. If stdin parsing fails, a payload field is invalid, or the handler crashes, it returns `decision: "deny"`. It never silently converts an error into `allow`.
- `SessionStart`: **Degrade gracefully**. If workspace paths are missing or inaccessible, it provides a degraded session banner.
- `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`: **Fail-open**. Logging or injection errors log a warning to stderr and return valid neutral protocol responses (`{}`).

### 5. Node.js runtime and Windows x64 compatibility

Handlers are implemented in modular TypeScript executed via Node.js (>= 22.6.0). All paths use standard Node.js path normalization (`path.resolve`, `path.relative`). No bash, WSL, Python, or external CLI dependencies are required.

## Consequences

### Positive

- Crucial destructive actions (recursive deletion, drive formatting, secret file dumps, destructive database mutations) are blocked deterministically before execution.
- High-risk operations (git clean, hard reset, privilege changes) require explicit developer consent via `ask`.
- Complete execution audit trails are maintained locally with strict secret redaction.
- Zero extra dependencies, daemons, or background services.

### Negative & Neutral

- Pre-tool inspection introduces a small latency overhead (typically 30–70ms per tool invocation), well within the 15-second timeout budget.
- Substring and regex classification cannot achieve 100% semantic coverage of all arbitrary shell commands; ambiguous commands must be escalated to `ask` rather than silently permitted.
- Hooks govern actions passing through the Antigravity agent harness; they do not replace operating system or database user security boundaries.

## Addendum: Phase 6.1 Corrective Architecture — Global Tool Coverage & Permission Enforcement (`force_ask`)

- **Date:** 2026-11-11
- **Status:** Accepted

### Problem Statement

Independent review of Phase 6 identified two execution safeguard compatibility gaps:

1. **Tool Name Mismatch & Missing Native Operations:** `PreToolUse` and `PostToolUse` matchers explicitly specified `run_command|read_file|write_file|edit_file`. However, the official Antigravity host runtime exposes native file operations (`view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) with differing parameter structures (`AbsolutePath`, `TargetFile`). Any tool call using these native names bypassed the hook entirely.
2. **Permission Caching Bypass Risk (`ask` vs `force_ask`):** High-risk operations (such as `git clean -fdx`, `git reset --hard`, `chmod 777`) emitted `"decision": "ask"`. In Antigravity, the `ask` decision respects cached "Always Allow" permissions, allowing subsequent destructive runs without developer confirmation.

### Architectural Decisions

1. **Approach B Adoption (Global Matcher `*`):**
   - Configured `matcher: "*"` in `specs/hooks/pre-tool-use.md`, `specs/hooks/post-tool-use.md`, and loader-visible `hooks.json`.
   - Every host tool invocation is intercepted and classified by the internal dispatcher.
   - Eliminates blind spots from explicit alias lists and ensures forward compatibility with future native tools and MCP plugins.

2. **Normalized Internal Tool Representation:**
   - Implemented `normalizeToolCall` in `scripts/hooks/lib/event-context.ts` to map heterogeneous tool argument shapes (`AbsolutePath`, `TargetFile`, `Path`, `CommandLine`, `Arguments`) into a consistent structure.
   - File reading tools (`view_file`, `read_file`), creation tools (`write_to_file`, `write_file`), and modification tools (`replace_file_content`, `multi_replace_file_content`, `edit_file`) are classified uniformly.

3. **Permission Enforcement via `force_ask`:**
   - Transitioned all high-risk commands and unvetted tools from `ask` to `force_ask`.
   - `force_ask` guarantees an interactive developer prompt on every execution, strictly bypassing any cached permissions.

4. **Conservative Classification for Unrecognized Tools:**
   - Unknown tools that do not match recognized read patterns (`read_*`, `view_*`, `get_*`, `list_*`, `fetch_*`) are never automatically approved; they escalate to `force_ask` with an explanatory diagnostic.

5. **Bidirectional Credential Protection:**
   - Prohibits reading, writing, and editing sensitive credential files (`.env`, private keys, certificates, password stores).
