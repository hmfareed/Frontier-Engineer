# ADR-003: Portable Engineering Skills System

- **Status:** Accepted
- **Date:** 2026-11-10
- **Phase:** 3
- **Related:** [Part 09 Skills Architecture](../09-SKILLS-ARCHITECTURE.md), [Part 10 Skill Specifications](../10-SKILL-SPECIFICATIONS.md), [ADR-001](ADR-001-foundation.md), [ADR-002](ADR-002-agent-system.md)

## Context

Phase 1 established the plugin foundation and official format verification. Phase 2 delivered the six canonical specialist agents. Phase 3 requires ten reusable, specialized engineering skills that agents can discover, load, and apply on demand across AI coding-agent platforms.

To avoid bloated agent definitions and prevent vendor lock-in, the skills system must separate agent responsibilities from technical procedures, employ progressive disclosure to save context window tokens, and maintain a canonical-first architecture.

## Decisions

### 1. Canonical specifications are the single source of truth for skills

Each of the ten skills has a platform-independent canonical specification in `specs/skills/<skill-id>.md` and a deep technical reference in `specs/skills/references/<skill-id>/`.

Canonical frontmatter requires `platformConfig: {}` and is validated against `schemas/canonical-skill.schema.json`. Every canonical skill must define all ten standard sections (`Purpose`, `Activation criteria`, `Non-activation guidelines`, `Required context and inputs`, `Operating procedure`, `Technical and engineering standards`, `Verification and evidence requirements`, `Expected outputs and deliverables`, `Risks, boundaries and failure modes`, and `Progressive disclosure references`).

**Consequence:** Skill intelligence is maintained in one place. Platform adapters translate this intelligence rather than rewriting it.

### 2. Antigravity skill adapters generated automatically

`scripts/generate-antigravity-skills.ts` reads the canonical specifications and compiles them into `skills/<skill_name>/SKILL.md` with verified frontmatter (`name` matching the folder, and `description`), and synchronizes reference files into `skills/<skill_name>/references/`.

CI validation (`npm run validate` and `npm run generate:skills -- --check`) verifies that generated skills match their canonical source with zero drift.

**Consequence:** Hand-editing of generated skills in `skills/` is prevented. `agy plugin validate --strict .` passes with `skills: 10` and zero findings.

### 3. Progressive disclosure via references directory

The primary `SKILL.md` contains the core 10-to-13 step operating workflow, technical standards, and verification requirements. Detailed checklists, ADR templates, and decision matrices live in `references/` subdirectories and are linked via relative markdown links.

**Consequence:** The agent loads the high-level workflow first and only fetches deep reference files when the specific task requires it, conserving token budget.

### 4. Behavioral evaluation scenarios defined but unscored

Nineteen agent scenarios exist from Phase 2; Phase 3 adds twenty skill evaluation scenarios (2 per skill) in `specs/evaluation/skill-scenarios.json` with a 6-dimension rubric.

Per project honesty invariants, `status` is locked to `"defined"`. No pass rate or score is claimed until empirical model runs are conducted and recorded.

**Consequence:** The project maintains absolute honesty regarding what has been structurally validated versus behaviorally tested.

### 5. Document numbering collision resolved cleanly

With the addition of Parts 09–13 (`09-SKILLS-ARCHITECTURE.md`, `10-SKILL-SPECIFICATIONS.md`, `11-SKILL-ACTIVATION.md`, `12-SKILL-AGENT-INTEGRATION.md`, and `13-SKILL-PORTABILITY.md`), the existing `docs/09-ENGINEERING-PRINCIPLES.md` was moved to `docs/14-ENGINEERING-PRINCIPLES.md`.

All incoming references across `rules/AGENTS.md`, `README.md`, `docs/README.md`, and tests were updated.

**Consequence:** Part numbers remain strictly contiguous and unique.

### 6. Version increment to 0.3.0

`plugin.json` and `package.json` versions are bumped together from `0.2.0` to `0.3.0`, marking the successful implementation of Phase 3.

## Alternatives considered

| Alternative                                            | Rejected because                                                            |
| :----------------------------------------------------- | :-------------------------------------------------------------------------- |
| Maintain skills as loose prompt snippets               | Fails progressive disclosure and lacks structure; easily ignored by agents  |
| Embed skill instructions directly inside agent prompts | Bloats agent context; creates massive instruction duplication across agents |
| Hand-author Antigravity skills directly in `skills/`   | Breaks canonical portability; couples intelligence directly to Antigravity  |
| Publish evaluation benchmark scores now                | Would be a fabricated claim; evaluations have been defined, not executed    |

## Verified in Phase 3

- All 10 canonical skill specifications and their 10 deep reference guides.
- Antigravity adapter compiler (`scripts/generate-antigravity-skills.ts`).
- Official Antigravity CLI validation (`agy plugin validate --strict .`) discovering 10 skills with 0 findings.
- Automated JSON Schema validation for canonical skills and evaluation scenarios.
- Freshness checks in CI.

## Deferred to future phases

- Phase 4: Modular rules system.
- Phase 5: Optional MCP integrations.
- Phase 6: Lifecycle hooks and guardrails.
- Real-world behavioral scoring of skills with live model runs.
