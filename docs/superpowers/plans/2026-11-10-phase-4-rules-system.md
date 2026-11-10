# Frontier Engineer — Phase 4: Modular Engineering Rules System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

Implement Phase 4 of Frontier Engineer: a comprehensive, modular engineering rules system that establishes clear technical governance across all engineering activities. The system combines an always-on global rule entry point (`rules/AGENTS.md`) with 13 modular rules across 7 domains (general engineering, code quality, documentation, frontend, backend, database, security, testing, performance). Canonical rule specifications are maintained in `specs/rules/` and compiled into loader-visible Antigravity adapters in `rules/` with verified triggers (`glob`, `model_decision`, `always_on`).

## Architecture & Layout

### Canonical Specifications (`specs/rules/`)

Structured by domain and verified against `schemas/canonical-rule.schema.json`:

- `specs/rules/AGENTS.md`: Always-on global principles (15 foundational rules).
- `specs/rules/engineering/general-engineering.md`
- `specs/rules/engineering/code-quality.md`
- `specs/rules/engineering/documentation.md`
- `specs/rules/frontend/frontend-standards.md`
- `specs/rules/frontend/accessibility.md`
- `specs/rules/backend/backend-standards.md`
- `specs/rules/backend/api-security.md`
- `specs/rules/database/database-standards.md`
- `specs/rules/database/migration-safety.md`
- `specs/rules/security/security-standards.md`
- `specs/rules/security/secrets-management.md`
- `specs/rules/testing/testing-standards.md`
- `specs/rules/performance/performance-standards.md`

### Generated Antigravity Adapters (`rules/`)

Flat directory structure matching Antigravity's one-level rule scan:

- `rules/AGENTS.md` (always-on, no frontmatter)
- `rules/general-engineering.md`
- `rules/code-quality.md`
- `rules/documentation.md`
- `rules/frontend-standards.md`
- `rules/accessibility.md`
- `rules/backend-standards.md`
- `rules/api-security.md`
- `rules/database-standards.md`
- `rules/migration-safety.md`
- `rules/security-standards.md`
- `rules/secrets-management.md`
- `rules/testing-standards.md`
- `rules/performance-standards.md`

### Tooling, Schemas & Validation

- `schemas/canonical-rule.schema.json`: Schema for canonical rule frontmatter (`id`, `name`, `category`, `triggerType`, `globs`, `description`, `priority`, `enforcementLevel`, `platformConfig`).
- `scripts/lib/canonical-rules.ts`: Parser, schema validator, required section checker, adapter compiler, and drift detector.
- `scripts/generate-antigravity-rules.ts`: Script compiling `specs/rules/` into `rules/`.
- `scripts/lib/required-files.ts`: Updates to track Phase 4 files and docs.
- `scripts/validate.ts`: Integration of canonical rule checks.

### Documentation (Parts 15-19 & ADR-004)

- `docs/15-RULES-ARCHITECTURE.md` (renumber existing 15-REPOSITORY-STRUCTURE to 20-REPOSITORY-STRUCTURE)
- `docs/16-RULE-SPECIFICATIONS.md`
- `docs/17-RULE-ACTIVATION.md`
- `docs/18-RULE-PRIORITY-AND-CONFLICTS.md`
- `docs/19-RULE-PORTABILITY.md`
- `docs/20-REPOSITORY-STRUCTURE.md` (renumbered from 15)
- `docs/adr/ADR-004-rules-system.md`
- Update `docs/README.md`, `README.md`, `CHANGELOG.md`, `docs/24-OFFICIAL-FORMAT-VERIFICATION.md`, `docs/01-PROJECT-OVERVIEW.md`.

---

## Tasks

### Task 1: Schemas & Validation Core for Rules

- [ ] Create `schemas/canonical-rule.schema.json`.
- [ ] Create `scripts/lib/canonical-rules.ts` with canonical rule loading, schema validation, section checking, and adapter generation.
- [ ] Create `scripts/generate-antigravity-rules.ts`.
- [ ] Author unit tests in `tests/unit/canonical-rules-schema.test.ts`.

### Task 2: Implement Canonical Global & Modular Rules (14 Rules)

- [ ] Author `specs/rules/AGENTS.md` (15 foundational principles).
- [ ] Author `specs/rules/engineering/general-engineering.md`.
- [ ] Author `specs/rules/engineering/code-quality.md`.
- [ ] Author `specs/rules/engineering/documentation.md`.
- [ ] Author `specs/rules/frontend/frontend-standards.md`.
- [ ] Author `specs/rules/frontend/accessibility.md`.
- [ ] Author `specs/rules/backend/backend-standards.md`.
- [ ] Author `specs/rules/backend/api-security.md`.
- [ ] Author `specs/rules/database/database-standards.md`.
- [ ] Author `specs/rules/database/migration-safety.md`.
- [ ] Author `specs/rules/security/security-standards.md`.
- [ ] Author `specs/rules/security/secrets-management.md`.
- [ ] Author `specs/rules/testing/testing-standards.md`.
- [ ] Author `specs/rules/performance/performance-standards.md`.

### Task 3: Generate Antigravity Adapters & Verify with CLI

- [ ] Run `node scripts/generate-antigravity-rules.ts` to produce `rules/*.md` and `rules/AGENTS.md`.
- [ ] Verify with `agy plugin validate --strict .` to confirm all 14 rules (1 global + 13 modular) are recognized with 0 findings.

### Task 4: Evaluation Scenarios, Validator Integration & Tests

- [ ] Update `scripts/lib/required-files.ts` to include Phase 4 rules, schemas, scripts, and docs.
- [ ] Update `scripts/validate.ts` to include canonical rule checks.
- [ ] Update `package.json` with `generate:rules` script and bump version to `0.4.0`.
- [ ] Update `plugin.json` to version `0.4.0`.
- [ ] Author unit tests in `tests/unit/canonical-rules.test.ts`.
- [ ] Update `tests/integration/repository.test.ts` for Phase 4 coverage.

### Task 5: Documentation Renumbering, New Docs & ADR-004

- [ ] Move `docs/15-REPOSITORY-STRUCTURE.md` to `docs/20-REPOSITORY-STRUCTURE.md` and update references across repo.
- [ ] Author `docs/15-RULES-ARCHITECTURE.md`.
- [ ] Author `docs/16-RULE-SPECIFICATIONS.md`.
- [ ] Author `docs/17-RULE-ACTIVATION.md`.
- [ ] Author `docs/18-RULE-PRIORITY-AND-CONFLICTS.md`.
- [ ] Author `docs/19-RULE-PORTABILITY.md`.
- [ ] Author `docs/adr/ADR-004-rules-system.md`.
- [ ] Update `docs/README.md`, `README.md`, `CHANGELOG.md`, `docs/24-OFFICIAL-FORMAT-VERIFICATION.md`, `docs/01-PROJECT-OVERVIEW.md`.

### Task 6: Full Verification & Final Audit

- [ ] Run `npm run verify` (`tsc`, `validate`, `test`, `prettier`, `markdownlint`).
- [ ] Run `agy plugin validate --strict .`.
- [ ] Audit all deliverables against Phase 4 Definition of Done.
