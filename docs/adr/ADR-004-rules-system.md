# ADR-004: Modular Engineering Rules System Architecture

- **Status:** Accepted
- **Date:** 2026-11-10
- **Phase:** 4
- **Related:** [Part 15 Rules Architecture](../15-RULES-ARCHITECTURE.md), [Part 16 Rule Specifications](../16-RULE-SPECIFICATIONS.md), [Part 17 Rule Activation](../17-RULE-ACTIVATION.md), [Part 18 Rule Priority and Conflicts](../18-RULE-PRIORITY-AND-CONFLICTS.md), [Part 19 Rule Portability](../19-RULE-PORTABILITY.md), [ADR-001](ADR-001-foundation.md), [ADR-002](ADR-002-agent-system.md), [ADR-003](ADR-003-skills-system.md)

## Context

Phase 1 established the plugin foundation. Phase 2 delivered the specialist agent system. Phase 3 delivered the portable engineering skills system. Phase 4 requires a modular engineering rules system that consistently governs engineering behavior across tasks, repositories, file types, and languages without duplicating full skill instructions.

The system must satisfy two opposing constraints:

1. **Portability and Logical Categorization:** Rules should be categorized by domain (`engineering`, `frontend`, `backend`, `database`, `security`, `testing`, `performance`) to maintain clear ownership and platform independence.
2. **Antigravity Loader Discovery:** Official testing of Google Antigravity's loader revealed that `rules/` is discovered strictly via a flat directory scan (one level deep). Files placed inside subdirectories of `rules/` (e.g. `rules/engineering/code-quality.md`) are ignored by the loader and fail strict validation.

## Decisions

### 1. Canonical specifications are the single source of truth for rules

Canonical rule specifications are authored under `specs/rules/` in a domain-categorized directory structure:

- `specs/rules/AGENTS.md` (Global foundation rule)
- `specs/rules/engineering/` (`general-engineering.md`, `code-quality.md`, `documentation.md`)
- `specs/rules/frontend/` (`frontend-standards.md`, `accessibility.md`)
- `specs/rules/backend/` (`backend-standards.md`, `api-security.md`)
- `specs/rules/database/` (`database-standards.md`, `migration-safety.md`)
- `specs/rules/security/` (`security-standards.md`, `secrets-management.md`)
- `specs/rules/testing/` (`testing-standards.md`)
- `specs/rules/performance/` (`performance-standards.md`)

Each modular rule requires frontmatter validated against `schemas/canonical-rule.schema.json` with required fields `id`, `name`, `category`, `triggerType`, `priority`, `enforcementLevel`, and empty `platformConfig: {}`. Each rule must define the five standard sections: `## Purpose`, `## Scope and applicability`, `## Core standards`, `## Invariants and prohibitions`, and `## Verification criteria`.

**Consequence:** Engineering standards remain modular, categorized, and reusable across other coding agent environments.

### 2. Antigravity rule adapters compiled to a flat directory

`scripts/generate-antigravity-rules.ts` reads the canonical specifications in `specs/rules/` and compiles them into flat files directly under `rules/<id>.md`, along with `rules/AGENTS.md`.

The generator translates canonical trigger types into verified Antigravity frontmatter (`trigger: "glob"` with `globs: "..."`, or `trigger: "model_decision"` with `description: "..."`), while `rules/AGENTS.md` is emitted without frontmatter as an always-on rule.

**Consequence:** The official CLI command `agy plugin validate --strict .` cleanly discovers and validates all fourteen rules (`rules: 14`) with zero warnings or errors.

### 3. Strict drift prevention and validator integration

`scripts/lib/canonical-rules.ts` implements `checkGeneratedRules(root)` which compares every generated file in `rules/` with its canonical specification, checking frontmatter equality, normalized body content, and flagging any unexpected or missing rule files.

This check is integrated directly into `scripts/validate.ts` and automated test suites.

**Consequence:** Developers cannot hand-edit generated rule files without failing local validation and CI checks.

### 4. Explicit priority scale and conflict resolution hierarchy

Every rule specifies a numeric priority (1 to 10) and an enforcement level (`mandatory` vs `advisory`).

A formal conflict precedence hierarchy is codified:

1. Security & Integrity (Priority 9–10, Mandatory)
2. Reliability & Verification (Priority 8, Mandatory)
3. Accessibility & Conventions (Priority 7–8, Mandatory)
4. Maintainability & Readability (Priority 8, Mandatory)
5. Performance Micro-Optimizations (Priority 7, Advisory)

**Consequence:** Competing recommendations (e.g. premature optimization vs readability) are resolved unambiguously and deterministically.

### 5. Document numbering reorganization

To accommodate the rules architecture documentation in the core numerical sequence (Parts 15–19), the existing `docs/15-REPOSITORY-STRUCTURE.md` was moved to `docs/20-REPOSITORY-STRUCTURE.md`.

All incoming references across `README.md`, `docs/README.md`, `scripts/lib/required-files.ts`, and test suites were updated.
