# ADR-008: Agent Retrieval & Orchestration Architecture

- **Status:** Accepted
- **Date:** 2026-11-13
- **Phase:** 7.6
- **Related:** [Part 14 Engineering Principles](../14-ENGINEERING-PRINCIPLES.md), [ADR-002 Canonical-first Agent System](ADR-002-agent-system.md), [ADR-006 Lifecycle Hooks Architecture](ADR-006-lifecycle-hooks-architecture.md), [ADR-007 Storage and Graph Engine](ADR-007-storage-and-graph-engine.md), [Agent Retrieval & Orchestration](../40-AGENT-RETRIEVAL-ORCHESTRATION.md)

## Context

Phases 7.1–7.5 delivered deterministic repository scanning, AST symbol extraction, SQLite relational snapshots (`schemaVersion = 3`), graph traversals, architecture analysis, snapshot diffing, evolution drift/debt analysis, and durable engineering memories. However, agents lacked a unified, budgeted, role-aware retrieval facade and a schema-validated way to attach bounded repository evidence to coordinator-to-specialist handoffs.

## Decision Drivers

1. **Deterministic Zero-LLM Orchestration:** Task classification, planning, ranking, and budgeting must execute locally without non-deterministic LLM calls or external network dependencies.
2. **Canonical Schema Stability:** Agent role policies must integrate cleanly without inventing unverified Antigravity frontmatter fields blocked by `schemas/canonical-agent.schema.json`.
3. **Handoff Backward Compatibility:** Coordinator-to-specialist handoffs carrying compact `retrievalContext` must remain optional so existing handoffs without retrieval attachments remain valid.
4. **Prompt Injection & Secret Safety:** Repository source files, ADRs, and stored memories must be treated as untrusted data with secret redaction and symlink containment.
5. **Read-Only Isolation:** Retrieval must never apply memory lifecycle mutations or write evolution events while assembling agent context.

## Evaluated Alternatives

### 1. Extend Canonical Agent Frontmatter with Retrieval Fields

- _Pros:_ Embeds policy numbers directly inside YAML frontmatter of `specs/agents/*.md`.
- _Cons:_ Breaks `schemas/canonical-agent.schema.json` (`additionalProperties: false`) and couples Antigravity adapter generation to internal query tuning parameters.

### 2. Typed Policy Registry + Canonical Markdown Policy Sections — Selected

- _Pros:_ Keeps `AGENT_RETRIEVAL_POLICIES` strictly typed and testable under `scripts/retrieval/agent-policies.ts`, validates optional `.frontier/retrieval.config.json` overrides with `schemas/retrieval-config.schema.json`, and keeps canonical `specs/agents/*.md` concise and synchronized with `agents/*.md`.
- _Cons:_ Policy budget parameters live in TypeScript rather than YAML frontmatter (mitigated by workspace override schema support).

### 3. Required Replacement of Legacy `handoff` Schema

- _Pros:_ Guarantees every handoff contains retrieved context.
- _Cons:_ Breaks backward compatibility for lightweight tasks and unindexed workspaces where `.frontier/intelligence/index.sqlite` does not exist. Instead, adding `retrievalContext` as an optional `additionalProperties: false`-preserving property on `schemas/handoff.schema.json` satisfies both modes.

## Consequences

- `scripts/retrieval/` provides a self-contained read-only pipeline (`TaskClassifier`, `RetrievalPlanner`, `ContentSanitizer`, `EvidenceUnifier`, `RelevanceRanker`, `ContextBudgeter`, `RetrievalEngine`, `RetrievalFormatter`).
- `frontier-cli.ts` exposes `retrieve` under existing exit code semantics (`0..4`).
- All 6 canonical agent specs (`specs/agents/*.md`) and generated Antigravity adapters (`agents/*.md`) stay synchronized via `npm run generate:agents`.
- Repository schema remains cleanly at `CURRENT_SCHEMA_VERSION = 3` and plugin version remains `0.6.3`.
