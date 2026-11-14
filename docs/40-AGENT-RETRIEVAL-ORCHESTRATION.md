# Phase 7.6 — Agent Retrieval & Orchestration

**Specification version:** 1.0.0  
**Phase:** 7.6 — Agent Retrieval & Orchestration  
**Project Version:** 0.6.3  
**Schema Version:** 3

---

## 1. Overview

The Agent Retrieval & Orchestration subsystem connects Frontier Engineer's indexed repository intelligence (Phases 7.1–7.5) to all six canonical agents (`frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor`, `qa-engineer`, and `design-engineer`).

Agents obtain bounded, deterministic, role-aware repository context through one read-only orchestration interface rather than issuing ad-hoc raw SQL queries or consuming unbounded repository trees.

## 2. Pipeline Architecture

```text
RetrievalRequest (agentId, taskSummary, targets, scanId, limits, signal)
  ├── TaskClassifier              (11 task types incl. database_change, confidence/ambiguity, path containment)
  ├── resolveEffectivePolicy      (role policy + .frontier/retrieval.config.json + ceilings + dynamic snippet quota)
  ├── RetrievalPlanner            (deterministic ordered steps across subsystems)
  ├── Subsystem Execution         (read-only QueryEngine, GraphTraversal, MemoryLifecycleEvaluator, EvolutionAnalyzer, SHA-256 ADR checks, batched counts; allowPartial defaults to false)
  ├── ContentSanitizer            (SENSITIVE check, linear-time full-buffer & unterminated/EOF PEM private-key redaction, BiDi strip, junction/symlink realpath check, UTF-16-safe fenced bounds)
  ├── EvidenceUnifier             (conjunctive memory verification soundness; UNVERIFIED & ADR_SNAPSHOT_UNVERIFIED warnings; consistent PARTIAL/VALIDATING/FAILED rejection)
  ├── RelevanceRanker             (multi-signal deterministic score + rankingReasons + verification penalties)
  ├── ContextBudgeter             (deduplication, domain quotas, true serialized JSON envelope trim, critical warning preservation)
  ├── SchemaValidator             (process-cached AJV validation at RetrievalEngine.retrieve() return boundary + secret-redacted error diagnostics)
  └── Orchestrator                (read-only inspectWorkspaceRepositoryReadOnly & assessRetrievalEligibility, fail-closed prepareDelegationHandoff READY invariant, strict parseAndValidateHandoffBundle)
        ├── RetrievalResponse     (frontier-engineer/retrieval v1, strict per-domain schemas)
        └── FrontierHandoffPayload (frontier-engineer/handoff v1 with optional retrievalContext attachment, highlight provenance & explicit DEGRADED_UNINDEXED mode)
```

## 3. Core Guarantees

1. **Deterministic & Reproducible:** Identical workspace snapshots, configurations, and requests yield deterministic `retrievalId` digests, ranked item ordering, and serialized output (`RetrievalFormatter.formatJson`).
2. **Read-Only By Default:** Retrieval, direct memory verification, and workspace/index-eligibility checks (`inspectWorkspaceRepositoryReadOnly`, `assessRetrievalEligibility`) never mutate `engineering_memories`, `evolution_events`, active scan state, or create `.frontier/` directories on unindexed workspaces (`applyLifecycle: false`, `persistEvents: false`, read-only SQLite open).
3. **Strict Request Validation, Truthfulness & Partial-Snapshot Policy:** `RetrievalEngine.retrieve()` validates request payloads at entry (`ERR_RETRIEVAL_REQUEST_INVALID` for unknown top-level or `limits` keys, invalid `agentId`/`taskType`, malformed target arrays, non-positive scan IDs/limits, or mismatched `baseScanId`/`targetScanId`), enforces a 32-warning `WARNINGS_OVERFLOW` rollup bound so excessive warnings cannot break budget limits, and rejects `PARTIAL`, `VALIDATING`, `FAILED`, `RUNNING`, `CANCELLED`, and unknown scan statuses by default (`allowPartial = false`). All public retrieval (`RetrievalEngine`), direct memory (`EvidenceUnifier.loadAndVerifyMemories`), and query (`ArchitectureQueryEngine`) APIs preserve `COMPLETE` active snapshots against `PARTIAL` or failed-extraction runs, surface `PARTIAL_SNAPSHOT` warnings on opt-in partial reads, and validate responses against `schemas/retrieval-context.schema.json`.
4. **Fail-Closed Handoff Producer & Strict Consumer Validation:** `prepareDelegationHandoff` enforces schema bounds (`summary <= 2000` UTF-16-safe chars, `idOrPath`/`evidenceFile`/`symbolIdentity <= 512`, `warnings <= 32`) before serialization and returns `READY` only when retrieval succeeds, the handoff and prompt section exist and pass schema + consumer validation, repository identity and snapshot state match policy, and no validation check fails; otherwise it fails closed (`VALIDATION_FAILED` with `handoff: null`, `promptSection: null`). `DEGRADED_UNINDEXED` is permitted only when no usable index exists and `allowUnindexedFallback: true` is explicit (never masking `SCAN_NOT_READY` or `PARTIAL_DISALLOWED`). Consumers (`parseAndValidateHandoffBundle` and `validate-handoff`) verify workspace identity read-only, active snapshot status/ownership/staleness, highlight provenance invariants, and reject stripped `retrievalContext` unless explicitly `DEGRADED_UNINDEXED`.
5. **Untrusted Content Defense & Containment:** Retrieved snippets, ADR text, evolution highlights, and engineering memory payloads carry `untrustedRepositoryContent: true`, delimiter fencing (`<<<UNTRUSTED_REPO_CONTENT ...>>>`), linear-time complete and unterminated/short-EOF PEM private-key (`dA==`, header-only EOF, CRLF, multi-block) & inline secret redaction across scanner, self-contained extractor diagnostics, hook stdout/stderr emitters, and audit logs, BiDi/zero-width stripping, `PROMPT_INJECTION_SIGNAL` warnings, `evaluateSensitivePath` blocking, and `fs.realpathSync` containment checks.
6. **Antigravity Delegation Boundary:** `PreToolUse` validates `invoke_subagent`, `delegate_agent`, `spawn_subagent`, `send_message`, and marker-bearing tool arguments across any tool: it denies plain-text delegation to Frontier specialist roles (`architect`, `implementation-engineer`, `security-auditor`, `qa-engineer`, `design-engineer`), unknown target agents, unredacted secrets, and semantically invalid/stale/partial/stripped/wrong-repo `<<<FRONTIER_HANDOFF_JSON>>>` bundles while never auto-approving unrecognized tools (`force_ask`). With `FRONTIER_AUTO_PREPARE_HANDOFF=1`, `prepareAndGateSubagentToolCall` attaches a verified bundle via documented `PreToolUse` `overwrite` and fails closed on preparation errors. Because Antigravity `PreInvocation` receives only step counters/metadata and has no `SubagentStart` event, delegation enforcement operates in `PreToolUse`. Live Antigravity GUI host invocation and `overwrite` behavior remain outside automated unit/integration test scope and are documented as not runtime-verified.

## 4. Capability Classification (Phase 7.7)

- **IMPLEMENTED AND VERIFIED:** Role-aware retrieval engine, strict request/response schema validation, 32-warning `WARNINGS_OVERFLOW` cap, secret redaction across scanner/extractor/retrieval/hooks, atomic snapshot promotion and crash recovery guards, and local `frontier` CLI `retrieve`/`prepare-handoff`/`validate-handoff` execution.
- **IMPLEMENTED, HOST-DEPENDENT:** `PreToolUse` subagent delegation gating, `FRONTIER_AUTO_PREPARE_HANDOFF=1` `overwrite` injection, and strict `FRONTIER_REQUIRE_HANDOFF=1` enforcement inside a live Antigravity GUI session.
- **NOT VERIFIED:** Live Antigravity multi-agent session delegation, live host `overwrite` persistence, interactive `force_ask` UI bypass, and host-level PostgreSQL MCP interception.

## 5. CLI Usage

```bash
npm run frontier -- retrieve --agent architect --task "Review auth boundaries and ADR-007" --format json
npm run frontier -- retrieve --agent implementation-engineer --task "Fix connection handling" --file scripts/storage/connection-manager.ts --max-tokens 6000
npm run frontier -- retrieve --agent security-auditor --task "Audit secrets and traversal" --format text --allow-partial
npm run frontier -- prepare-handoff --agent security-auditor --task-id FE-001 --task "Audit auth middleware" --format text
npm run frontier -- validate-handoff --input delegation-prompt.txt --workspace . --format json
```

CLI enforces strict integer validation (`--limit`, `--max-chars`, `--max-tokens`, `--depth`, `--scan-id`, `--base-scan-id`, `--target-scan-id`), defaults to rejecting `PARTIAL` snapshots across `retrieve`, query commands, `memories`, `prepare-handoff`, and `validate-handoff` (unless `--allow-partial` is passed, and `--allow-stale` for `validate-handoff`), rejects contradictory flags (`--include-snippets` vs `--no-snippets`, `--allow-partial` vs `--no-allow-partial`, `--scan-id` combined with `--base-scan-id`/`--target-scan-id`), and preserves exit codes matching [Architecture Query CLI](37-ARCHITECTURE-QUERY-CLI.md): `0` success, `1` operational/validation failure, `2` invalid command/arguments/sensitive target/failed `validate-handoff`, `3` unavailable/unusable index or snapshot, `4` missing scan/entity.

## 6. Related Contracts

- [Retrieval Context JSON Schema](../schemas/retrieval-context.schema.json)
- [Retrieval Workspace Config Schema](../schemas/retrieval-config.schema.json)
- [Handoff Contract Schema](../schemas/handoff.schema.json) and [Shared Handoff Contract](../specs/handoff-contract.md)
- [ADR-008: Agent Retrieval & Orchestration](adr/ADR-008-agent-retrieval-orchestration.md)
