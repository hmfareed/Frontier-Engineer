# Part 15 — Rules architecture

## Philosophy and governance role

In Frontier Engineer, **rules** serve as the technical governance layer. While agents define _who_ acts and _how_ work is coordinated, and skills define _how_ specific engineering procedures are performed, rules define the **invariants, constraints, and non-negotiable boundaries** that all agents must respect at all times.

Rules do not duplicate complete skill instructions or procedural workflows. Instead, they act as compact, enforceable guardrails that govern:

1. **Safety and Integrity:** Preventing secret disclosure, irreversible data destruction, and unvalidated operations.
2. **Architectural Consistency:** Ensuring that code changes honor existing patterns, maintain separation of concerns, and respect domain layering.
3. **Verification Discipline:** Requiring evidence before asserting completion and enforcing test-state honesty.
4. **Contextual Compliance:** Applying specialized standards (e.g. WCAG 2.1 AA accessibility, zero-downtime database migrations, API rate limiting) whenever relevant files or tasks are touched.

```text
┌─────────────────────────────────────────────────────────────────┐
│                          AGENTS LAYER                           │
│     Who acts: Coordinator, Architect, Implementation, QA...     │
└────────────────────────────────┬────────────────────────────────┘
                                 │ invokes & applies
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                          SKILLS LAYER                           │
│   How to execute: Architecture, Debugging, Database Eng...      │
│            (Workflows, procedures, decision trees)              │
└────────────────────────────────┬────────────────────────────────┘
                                 │ constrained by
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                          RULES LAYER                            │
│   Boundaries & Invariants: Global Principles + Modular Rules    │
│            (Musts, Prohibitions, Verification Criteria)         │
└─────────────────────────────────────────────────────────────────┘
```

## Layered rules model

The rule system operates on two distinct layers:

### 1. Global foundation rule (`rules/AGENTS.md`)

The global rule is always active across all agents and all tasks. It contains the **fifteen foundational engineering principles** of Frontier Engineer (inspections before edits, architecture preservation, test-state honesty, secret protection, human confirmation for destructive actions, etc.). It contains no YAML frontmatter and applies universally.

### 2. Specialized modular rules (`rules/*.md`)

Modular rules encapsulate targeted standards for specific domains, languages, file extensions, and operations. Each modular rule defines:

- **Purpose:** Why the rule exists.
- **Scope and applicability:** When and where it activates.
- **Core standards:** Concrete requirements and idioms.
- **Invariants and prohibitions:** Explicitly forbidden patterns.
- **Verification criteria:** How compliance is verified.

## Canonical-first design and compilation pipeline

To ensure that rule intelligence remains platform-independent and reusable across other coding agent environments, Frontier Engineer uses a **canonical-first architecture**:

- **Canonical Specifications (`specs/rules/`):** Organized in a logical domain hierarchy:
  - `specs/rules/AGENTS.md` (Global foundation)
  - `specs/rules/engineering/` (`general-engineering.md`, `code-quality.md`, `documentation.md`)
  - `specs/rules/frontend/` (`frontend-standards.md`, `accessibility.md`)
  - `specs/rules/backend/` (`backend-standards.md`, `api-security.md`)
  - `specs/rules/database/` (`database-standards.md`, `migration-safety.md`)
  - `specs/rules/security/` (`security-standards.md`, `secrets-management.md`)
  - `specs/rules/testing/` (`testing-standards.md`)
  - `specs/rules/performance/` (`performance-standards.md`)

- **Rule Adapter Compiler (`scripts/generate-antigravity-rules.ts`):**
  Empirical verification showed that Google Antigravity discovers rules by scanning `rules/` **one level deep (flat scan)**. Subdirectories inside `rules/` are ignored by the loader.
  The generator maps canonical specifications from `specs/rules/<category>/<id>.md` directly to `rules/<id>.md` and copies `specs/rules/AGENTS.md` to `rules/AGENTS.md`.

```text
specs/rules/
├── AGENTS.md ───────────────► rules/AGENTS.md (always-on)
├── engineering/
│   ├── general-engineering.md ──► rules/general-engineering.md
│   ├── code-quality.md ─────────► rules/code-quality.md
│   └── documentation.md ────────► rules/documentation.md
├── frontend/
│   ├── frontend-standards.md ───► rules/frontend-standards.md
│   └── accessibility.md ────────► rules/accessibility.md
├── backend/
│   ├── backend-standards.md ────► rules/backend-standards.md
│   └── api-security.md ─────────► rules/api-security.md
├── database/
│   ├── database-standards.md ───► rules/database-standards.md
│   └── migration-safety.md ─────► rules/migration-safety.md
├── security/
│   ├── security-standards.md ───► rules/security-standards.md
│   └── secrets-management.md ───► rules/secrets-management.md
├── testing/
│   └── testing-standards.md ────► rules/testing-standards.md
└── performance/
    └── performance-standards.md ─► rules/performance-standards.md
```

## Drift prevention and validation

Drift between canonical specifications and generated Antigravity rule files is prevented by:

1. `scripts/generate-antigravity-rules.ts --check`: Validates that every file in `rules/` exactly matches the compiled output from `specs/rules/`.
2. `npm run validate`: Includes `checkGeneratedRules()` in the standard verification pipeline.
3. `tests/unit/canonical-rules.test.ts`: Verifies structural integrity, schema compliance, and frontmatter correctness.
