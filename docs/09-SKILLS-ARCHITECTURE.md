# Part 09 — Skills Architecture

## System role and philosophy

In Frontier Engineer, **agents represent responsibilities, while skills represent procedures and specialized capabilities**.
An agent is an actor in the engineering process (e.g., the Architect, the QA Engineer); a skill is a reusable, step-by-step procedure (e.g., Advanced Debugging, Security Auditing) that any authorized agent can discover, load, and execute.

This separation prevents instruction bloat inside agent prompts. Rather than burdening every agent definition with hundreds of lines of domain-specific checklists, agents maintain focused identities and load specialized skills on demand.

## Canonical-first architecture

Following the same model established for agents in [ADR-002](adr/ADR-002-agent-system.md), the skills system is architected **canonical-first**:

```text
[ specs/skills/<skill-id>.md ] (Platform-independent canonical specifications)
  │
  ├─► scripts/generate-antigravity-skills.ts
  │     └─► skills/<skill-id>/SKILL.md (Antigravity plugin runtime format)
  │     └─► skills/<skill-id>/references/* (Progressive disclosure guides)
  │
  └─► Future Platform Adapters (Claude Code, Codex, Cursor, Windsurf)
```

1. **Source of Truth:** Canonical skill intelligence is authored exclusively in `specs/skills/<skill-id>.md` and validated against `schemas/canonical-skill.schema.json`.
2. **Platform Neutrality:** Canonical frontmatter strictly enforces `platformConfig: {}`. Platform-specific quirks are prohibited in the canonical source.
3. **Automated Generation:** The Antigravity adapter compiler (`scripts/generate-antigravity-skills.ts`) parses the canonical specifications and emits runtime-discoverable `skills/<skill_name>/SKILL.md` files matching official Antigravity plugin conventions.
4. **Drift Prevention:** CI validation (`npm run validate` and `npm run generate:skills -- --check`) compares generated files against canonical specifications and fails if any manual edit or drift is detected.

## Progressive disclosure

To optimize token efficiency and prevent context-window saturation, Frontier Engineer employs **progressive disclosure**:

- **Level 1 (Discovery):** At startup, Antigravity parses only the skill folder name and frontmatter `description`. Agents scan descriptions to decide whether to activate a skill for a given task.
- **Level 2 (Active Execution):** When an agent invokes a skill, the main `SKILL.md` body is loaded into context, supplying the core 10-step operating procedure, standards, and verification requirements.
- **Level 3 (Deep Reference):** Detailed decision matrices, vulnerability checklists, and ADR templates are housed in separate files within `references/`. The agent traverses these reference files via relative links only when the specific subtask demands that depth.

## The ten core engineering skills

| #   | Skill ID                  | Title                                                                   | Primary Focus                                                                          |
| :-- | :------------------------ | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| 1   | `architecture`            | System Architecture and Technical Design                                | Decomposition, monolith vs. microservices, service boundaries, API contracts, ADRs     |
| 2   | `advanced-debugging`      | Systematic Failure Isolation and Root-Cause Diagnosis                   | Hypothesis-driven debugging, stack traces, async race conditions, regression tests     |
| 3   | `security-audit`          | Application Security Review and Vulnerability Assessment                | OWASP Top 10, IDOR, input sanitization, token security, safe secrets                   |
| 4   | `code-review`             | Rigorous Code Review and Defect Detection                               | Diff analysis, defect identification, P0-P3 prioritization, constructive fixes         |
| 5   | `frontend-engineering`    | Production Frontend Development and Component Architecture              | React/Next.js/TypeScript, state, routing, 10 interaction states, WCAG AA accessibility |
| 6   | `backend-engineering`     | Resilient Backend Services, APIs, and Business Logic                    | REST/GraphQL APIs, server-side auth, persistence transactions, error handling          |
| 7   | `testing-engineering`     | Systematic Software Verification and Quality Assurance                  | Testing pyramid, unit/integration/E2E tests, six canonical test states, isolation      |
| 8   | `deep-research`           | Technical Investigation and Authoritative Evidence Synthesis            | Documentation research, source hierarchy (Tiers 1-5), temporal version anchoring       |
| 9   | `database-engineering`    | Database Schema Design, Query Optimization, and Migration Safety        | Relational/document modeling, composite B-tree indexes, zero-downtime migrations       |
| 10  | `performance-engineering` | Performance Profiling, Bottleneck Elimination, and Latency Optimization | Baseline metrics, Web Vitals, event loop profiling, bundle optimization                |

## Verification and evidence standards

Structural validation is strictly separated from behavioral evaluation:

- **Structural Validation:** Automated JSON Schema validation, markdown link checking, required section verification, and generator freshness checks ensure the plugin package is valid and syntactically sound.
- **Behavioral Evaluation:** Defined in `specs/evaluation/skill-scenarios.json`. Represents realistic engineering benchmarks. In accordance with Frontier Engineer honesty principles, skills are marked as `status: "defined"` until model evaluation traces are recorded.
