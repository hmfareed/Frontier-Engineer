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
  ├── Subsystem Execution         (read-only QueryEngine, GraphTraversal, MemoryLifecycleEvaluator, EvolutionAnalyzer, SHA-256 ADR checks, batched counts)
  ├── ContentSanitizer            (SENSITIVE check, full-buffer PEM pre-slice redaction, BiDi strip, junction/symlink realpath check, fencing)
  ├── EvidenceUnifier             (conjunctive memory verification soundness; UNVERIFIED & ADR_SNAPSHOT_UNVERIFIED warnings)
  ├── RelevanceRanker             (multi-signal deterministic score + rankingReasons + verification penalties)
  ├── ContextBudgeter             (deduplication, domain quotas, true serialized JSON envelope trim, critical warning preservation)
  ├── SchemaValidator             (process-cached AJV validation + secret-redacted error diagnostics)
  └── Orchestrator                (read-only assessRetrievalEligibility, prepareDelegationHandoff, parseAndValidateHandoffBundle)
        ├── RetrievalResponse     (frontier-engineer/retrieval v1, strict per-domain schemas)
        └── FrontierHandoffPayload (frontier-engineer/handoff v1 with optional retrievalContext attachment)
```

## 3. Core Guarantees

1. **Deterministic & Reproducible:** Identical workspace snapshots, configurations, and requests yield deterministic `retrievalId` digests, ranked item ordering, and serialized output (`RetrievalFormatter.formatJson`).
2. **Read-Only By Default:** Retrieval and index-eligibility checks never mutate `engineering_memories`, `evolution_events`, active scan state, or `.frontier/` directories on unindexed workspaces (`applyLifecycle: false`, `persistEvents: false`, read-only SQLite open during eligibility check).
3. **Truthfulness & Provenance:** Every retrieved entity preserves explicit `confidenceTier` (`CONFIRMED`, `INFERRED`, `CANDIDATE`, `UNRESOLVED`), snapshot freshness (`FreshnessEvaluator` with `VALIDATING` rejection and `--no-allow-partial`), conjunctive memory verification (`VERIFIED` only when all supporting evidence verifies and zero evidence is contradictory/missing/unverified), and historical ADR SHA-256 verification with non-CONFIRMED fallback warnings.
4. **Untrusted Content Defense:** Retrieved snippets, ADR text, evolution highlights, and engineering memory payloads carry `untrustedRepositoryContent: true`, delimiter fencing (`<<<UNTRUSTED_REPO_CONTENT ...>>>`), linear-time full-buffer PEM private key & inline secret redaction, BiDi/zero-width stripping, and `PROMPT_INJECTION_SIGNAL` warnings.
5. **Sensitive Data & Containment:** Reuses `evaluateSensitivePath` and `sensitivity_status === "SAFE"`, verifies paths with `fs.realpathSync` containment inside the workspace root (including Windows NTFS junctions and POSIX symlinks), rejects cross-repository scan IDs and mismatched repository identities, and supports `AbortSignal` cancellation.
6. **Delegation Boundary:** The coordinator carries schema-validated `<<<FRONTIER_HANDOFF_JSON>>>` bundles inside `invoke_subagent` Prompts. `PreToolUse` denies `invoke_subagent` calls containing raw secret patterns or malformed `FRONTIER_HANDOFF_JSON` blocks. Live Antigravity host multi-agent invocation remains outside automated unit/integration test scope and is documented as not runtime-verified.

## 4. CLI Usage

```bash
npm run frontier -- retrieve --agent architect --task "Review auth boundaries and ADR-007" --format json
npm run frontier -- retrieve --agent implementation-engineer --task "Fix connection handling" --file scripts/storage/connection-manager.ts --max-tokens 6000
npm run frontier -- retrieve --agent security-auditor --task "Audit secrets and traversal" --format text --no-allow-partial
npm run frontier -- prepare-handoff --agent security-auditor --task-id FE-001 --task "Audit auth middleware" --format text
npm run frontier -- validate-handoff --input delegation-prompt.txt --format json
```

CLI enforces strict integer validation (`--limit`, `--max-chars`, `--max-tokens`, `--depth`, `--scan-id`, `--base-scan-id`, `--target-scan-id`), rejects contradictory flags (`--include-snippets` vs `--no-snippets`, `--allow-partial` vs `--no-allow-partial`, `--scan-id` combined with `--base-scan-id`/`--target-scan-id`), and preserves exit codes matching [Architecture Query CLI](37-ARCHITECTURE-QUERY-CLI.md): `0` success, `1` operational failure, `2` invalid command/arguments, `3` unavailable/unusable index, `4` missing scan/entity.

## 5. Related Contracts

- [Retrieval Context JSON Schema](../schemas/retrieval-context.schema.json)
- [Retrieval Workspace Config Schema](../schemas/retrieval-config.schema.json)
- [Handoff Contract Schema](../schemas/handoff.schema.json) and [Shared Handoff Contract](../specs/handoff-contract.md)
- [ADR-008: Agent Retrieval & Orchestration](adr/ADR-008-agent-retrieval-orchestration.md)
