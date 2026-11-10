# Part 12 — Skill and Agent Integration

## Mapping skills to specialist roles

While any agent may load and apply any skill when justified by task context, Frontier Engineer defines primary skill alignments for each agent role:

```text
┌─────────────────────────────────┐
│       frontier-engineer         │ ──► Coordinates, activates, and reconciles all 10 skills
└────────────────┬────────────────┘
                 │
  ┌──────────────┼──────────────┬──────────────┬──────────────┐
  │              │              │              │              │
┌─▼─────────┐ ┌──▼──────────┐ ┌─▼─────────┐ ┌──▼─────────┐ ┌──▼─────────┐
│ architect │ │implementat. │ │ security- │ │qa-engineer │ │ design-   │
│           │ │  engineer   │ │  auditor  │ │            │ │ engineer  │
└─┬─────────┘ └──┬──────────┘ └─┬─────────┘ └──┬─────────┘ └──┬─────────┘
  │              │              │              │              │
  ├─ architecture├─ frontend-   ├─ security-   ├─ testing-    ├─ frontend-
  ├─ database-   │  engineering │  audit       │  engineering │  engineering
  │  engineering ├─ backend-    └─ code-review ├─ advanced-   └─ testing-
  └─ deep-       │  engineering                │  debugging      engineering
     research    ├─ advanced-                  └─ code-review
                 │  debugging
                 ├─ database-
                 │  engineering
                 └─ performance-
                    engineering
```

---

## Detailed agent-to-skill relationships

### 1. Frontier Engineer (Lead Coordinator)

- **Role in Skill System:** Evaluates incoming user requests, selects appropriate skills for the plan, delegates focused skill-guided tasks to subagents, and reconciles results.
- **Direct Skill Utilization:** Uses `architecture` during initial planning, `deep-research` when clarifying ambiguous constraints, and `code-review` when evaluating aggregated specialist outputs.

### 2. Architect

- **Primary Skills:** `architecture`, `database-engineering`, `deep-research`.
- **Operating Context:** Applies `architecture` for system decomposition and ADR authoring; applies `database-engineering` for data normalization and integrity constraints; applies `deep-research` when evaluating third-party platforms or runtime capabilities.

### 3. Implementation Engineer

- **Primary Skills:** `frontend-engineering`, `backend-engineering`, `database-engineering`, `advanced-debugging`, `performance-engineering`.
- **Operating Context:** Owns write operations across UI components, backend APIs, and database migrations. Uses `advanced-debugging` to isolate root causes before patching code, and `performance-engineering` to resolve bottlenecks.

### 4. Security Auditor

- **Primary Skills:** `security-audit`, `code-review`.
- **Operating Context:** Strictly read-only specialist. Uses `security-audit` to inspect authentication, authorization, and injection surfaces; uses `code-review` to audit pull request diffs for security vulnerabilities and secret exposures.

### 5. QA Engineer

- **Primary Skills:** `testing-engineering`, `advanced-debugging`, `code-review`.
- **Operating Context:** Guardian of verification. Uses `testing-engineering` to extract acceptance criteria and author unit/integration/E2E tests; uses `advanced-debugging` to diagnose flaky or failing test suites; uses `code-review` to verify that code changes include sufficient test coverage.

### 6. Design Engineer

- **Primary Skills:** `frontend-engineering`, `testing-engineering`.
- **Operating Context:** Bridges design and code. Uses `frontend-engineering` to implement the ten interaction states, responsive layouts, and WCAG AA accessibility standards; uses `testing-engineering` to verify component rendering and keyboard accessibility.

---

## Handoff integration

When the coordinator delegates a task to a specialist via the handoff contract ([`specs/handoff-contract.md`](../specs/handoff-contract.md)), it specifies the relevant skill in the `constraints` or `instructions` field:

```json
{
  "taskId": "FE-TASK-20261110-042",
  "requestSummary": "Isolate and fix intermittent auth token hydration crash.",
  "objective": "Diagnose root cause using the advanced-debugging skill and provide minimal fix with regression test.",
  "scope": ["src/auth/provider.tsx", "tests/unit/auth.test.ts"],
  "constraints": [
    "Follow the advanced-debugging skill operating procedure",
    "Do not modify unrelated components",
    "Author automated regression test"
  ]
}
```

This ensures that the specialist loads the appropriate skill workflow and follows its technical standards.
