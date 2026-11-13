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
RetrievalRequest (agentId, taskSummary, targets, scanId, limits)
  ├── TaskClassifier              (zero-LLM intent & entity extraction + path containment)
  ├── resolveEffectivePolicy      (role policy + optional .frontier/retrieval.config.json + ceilings)
  ├── RetrievalPlanner            (deterministic ordered steps across subsystems)
  ├── Subsystem Execution         (read-only QueryEngine, GraphTraversal, MemoryLifecycleEvaluator, EvolutionAnalyzer)
  ├── ContentSanitizer            (SENSITIVE check, secret redaction, realpath containment, untrusted fencing)
  ├── RelevanceRanker             (multi-signal deterministic score + rankingReasons + stable tie-breaks)
  └── ContextBudgeter             (maxItems, maxTotalChars, maxTokens + critical warning preservation)
        ├── RetrievalResponse     (frontier-engineer/retrieval v1)
        └── HandoffRetrievalContext (optional bounded handoff attachment v1)
```

## 3. Core Guarantees

1. **Deterministic & Reproducible:** Identical workspace snapshots, configurations, and requests yield deterministic `retrievalId` digests, ranked item ordering, and serialized output (`RetrievalFormatter.formatJson`).
2. **Read-Only By Default:** Retrieval never mutates `engineering_memories`, `evolution_events`, or active scan state (`applyLifecycle: false`, `persistEvents: false`).
3. **Truthfulness & Provenance:** Every retrieved entity preserves explicit `confidenceTier` (`CONFIRMED`, `INFERRED`, `CANDIDATE`, `UNRESOLVED`), snapshot freshness (`FreshnessEvaluator`), and memory verification state (`VERIFIED`, `STALE`, `DISPUTED`, `MISSING`, `UNVERIFIED`, `SUPERSEDED`, `ARCHIVED`).
4. **Untrusted Content Defense:** Retrieved snippets, ADR text, and engineering memory payloads carry `untrustedRepositoryContent: true`, delimiter fencing (`<<<UNTRUSTED_REPO_CONTENT ...>>>`), secret redaction via `scanBufferForSecrets`, and `PROMPT_INJECTION_SIGNAL` warnings without obeying embedded text.
5. **Sensitive Data & Containment:** Reuses `evaluateSensitivePath` and `sensitivity_status === "SAFE"`, verifies paths with `fs.realpathSync` containment inside the workspace root, and rejects external symlinks and cross-repository scan IDs.

## 4. CLI Usage

```bash
npm run frontier -- retrieve --agent architect --task "Review auth boundaries and ADR-007" --format json
npm run frontier -- retrieve --agent implementation-engineer --task "Fix connection handling" --file scripts/storage/connection-manager.ts
npm run frontier -- retrieve --agent security-auditor --task "Audit secrets and traversal" --format text
```

Exit codes match [Architecture Query CLI](37-ARCHITECTURE-QUERY-CLI.md): `0` success, `1` operational failure, `2` invalid command/arguments, `3` unavailable index, `4` missing scan/entity.

## 5. Related Contracts

- [Retrieval Context JSON Schema](../schemas/retrieval-context.schema.json)
- [Retrieval Workspace Config Schema](../schemas/retrieval-config.schema.json)
- [Handoff Contract Schema](../schemas/handoff.schema.json) and [Shared Handoff Contract](../specs/handoff-contract.md)
- [ADR-008: Agent Retrieval & Orchestration](adr/ADR-008-agent-retrieval-orchestration.md)
