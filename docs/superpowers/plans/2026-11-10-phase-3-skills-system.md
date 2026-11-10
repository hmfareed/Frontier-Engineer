# Frontier Engineer — Phase 3: Portable Engineering Skills System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

Implement Phase 3 of Frontier Engineer: a complete, canonical-first reusable engineering skills system comprising ten specialized, deeply technical engineering skills with progressive disclosure references, validation tooling, Antigravity adapters, agent integration mappings, portability specifications, comprehensive tests, and updated documentation.

## Proposed Changes

### Schemas & Validation Tooling

- `schemas/canonical-skill.schema.json`: JSON schema for canonical skill frontmatter.
- `scripts/lib/canonical-skills.ts`: Parser, schema validator, section checker, Antigravity adapter generator, and freshness checker for skills.
- `scripts/generate-antigravity-skills.ts`: CLI script to compile `specs/skills/` into `skills/`.
- `scripts/lib/required-files.ts`: Update required files and directories for Phase 3.
- `scripts/validate.ts`: Integrate skill validation checks.
- `package.json` & `plugin.json`: Version bump to `0.3.0`, add `generate:skills` script.

### Canonical Skills (`specs/skills/` & `specs/skills/references/`)

1. `architecture.md` + `references/architecture/trade-off-and-adr-guide.md`
2. `advanced-debugging.md` + `references/advanced-debugging/root-cause-analysis-guide.md`
3. `security-audit.md` + `references/security-audit/vulnerability-assessment-checklist.md`
4. `code-review.md` + `references/code-review/review-rubric-and-classification.md`
5. `frontend-engineering.md` + `references/frontend-engineering/interaction-states-and-a11y-guide.md`
6. `backend-engineering.md` + `references/backend-engineering/api-design-and-resilience-guide.md`
7. `testing-engineering.md` + `references/testing-engineering/test-state-matrix-and-patterns.md`
8. `deep-research.md` + `references/deep-research/evidence-synthesis-guide.md`
9. `database-engineering.md` + `references/database-engineering/schema-design-and-migration-guide.md`
10. `performance-engineering.md` + `references/performance-engineering/profiling-and-benchmarking-guide.md`

### Generated Antigravity Adapters (`skills/`)

- `skills/<skill_name>/SKILL.md` (with verified Antigravity frontmatter: `name` matching folder and `description`)
- `skills/<skill_name>/references/<guide>.md`

### Evaluation Scenarios

- `specs/evaluation/skill-scenarios.json`: Defined evaluation scenarios for all 10 skills.
- `schemas/skill-evaluation-scenarios.schema.json`: Schema for skill evaluation scenarios.

### Documentation & Renumbering

- Move `docs/09-ENGINEERING-PRINCIPLES.md` to `docs/14-ENGINEERING-PRINCIPLES.md` and update all incoming references.
- `docs/09-SKILLS-ARCHITECTURE.md`
- `docs/10-SKILL-SPECIFICATIONS.md`
- `docs/11-SKILL-ACTIVATION.md`
- `docs/12-SKILL-AGENT-INTEGRATION.md`
- `docs/13-SKILL-PORTABILITY.md`
- `docs/adr/ADR-003-skills-system.md`
- Update `docs/README.md`, `README.md`, `CHANGELOG.md`, `docs/24-OFFICIAL-FORMAT-VERIFICATION.md`.

### Tests

- `tests/unit/canonical-skills-schema.test.ts`: JSON schema tests.
- `tests/unit/canonical-skills.test.ts`: Canonical skill loading and drift checks.
- `tests/unit/skill-evaluation.test.ts`: Evaluation scenarios validation.
- `tests/integration/repository.test.ts`: Updated integration test covering 10 skills and new docs.

---

## Tasks

### Task 1: Schemas & Validation Core for Skills

- [ ] Create `schemas/canonical-skill.schema.json` defining canonical skill metadata.
- [ ] Create `schemas/skill-evaluation-scenarios.schema.json`.
- [ ] Create `scripts/lib/canonical-skills.ts` with skill loading, schema validation, section verification, and adapter generation.
- [ ] Create `scripts/generate-antigravity-skills.ts`.
- [ ] Add unit test `tests/unit/canonical-skills-schema.test.ts`.

### Task 2: Implement 10 Canonical Skills & Reference Guides

- [ ] Author `specs/skills/architecture.md` and reference guide.
- [ ] Author `specs/skills/advanced-debugging.md` and reference guide.
- [ ] Author `specs/skills/security-audit.md` and reference guide.
- [ ] Author `specs/skills/code-review.md` and reference guide.
- [ ] Author `specs/skills/frontend-engineering.md` and reference guide.
- [ ] Author `specs/skills/backend-engineering.md` and reference guide.
- [ ] Author `specs/skills/testing-engineering.md` and reference guide.
- [ ] Author `specs/skills/deep-research.md` and reference guide.
- [ ] Author `specs/skills/database-engineering.md` and reference guide.
- [ ] Author `specs/skills/performance-engineering.md` and reference guide.

### Task 3: Generate Antigravity Adapters & Verify with CLI

- [ ] Execute `node scripts/generate-antigravity-skills.ts` to produce `skills/<skill_name>/SKILL.md` and references.
- [ ] Run `agy plugin validate --strict .` to confirm all 10 skills are recognized with 0 findings.

### Task 4: Evaluation Scenarios, Validator Integration & Tests

- [ ] Author `specs/evaluation/skill-scenarios.json` with realistic scenarios for all 10 skills.
- [ ] Update `scripts/lib/required-files.ts` with Phase 3 required files/directories.
- [ ] Update `scripts/validate.ts` to include skill validation checks.
- [ ] Update `package.json` with `generate:skills` script and bump version to `0.3.0`.
- [ ] Update `plugin.json` to version `0.3.0`.
- [ ] Author unit tests in `tests/unit/canonical-skills.test.ts` and `tests/unit/skill-evaluation.test.ts`.
- [ ] Update `tests/integration/repository.test.ts`.

### Task 5: Documentation Renumbering, New Docs & ADR-003

- [ ] Move `docs/09-ENGINEERING-PRINCIPLES.md` to `docs/14-ENGINEERING-PRINCIPLES.md` and update references across repo.
- [ ] Author `docs/09-SKILLS-ARCHITECTURE.md`.
- [ ] Author `docs/10-SKILL-SPECIFICATIONS.md`.
- [ ] Author `docs/11-SKILL-ACTIVATION.md`.
- [ ] Author `docs/12-SKILL-AGENT-INTEGRATION.md`.
- [ ] Author `docs/13-SKILL-PORTABILITY.md`.
- [ ] Author `docs/adr/ADR-003-skills-system.md`.
- [ ] Update `docs/README.md`, `README.md`, `CHANGELOG.md`, `docs/24-OFFICIAL-FORMAT-VERIFICATION.md`.

### Task 6: Full Verification & Final Audit

- [ ] Run `npm run verify` (`tsc`, `validate`, `test`, `prettier`, `markdownlint`).
- [ ] Run `agy plugin validate --strict .`.
- [ ] Audit all deliverables against Phase 3 Definition of Done.
