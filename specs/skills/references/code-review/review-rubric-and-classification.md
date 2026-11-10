# Code Review Rubric, Classification System, and Defect Detection

This guide defines rigorous review rubrics, finding classification tiers, and checklists for engineering code reviews.

## 1. Review Finding Classification Tiers

Review feedback must be prioritized by impact, clearly separating blocking defects from non-blocking suggestions:

| Tier   | Label                         | Definition                                                                                       | Action Required                                           |
| :----- | :---------------------------- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **P0** | **Blocker / Critical Defect** | Data loss, security vulnerability, severe performance regression, crash, or broken contract.     | Must be fixed before merge. Cannot be bypassed.           |
| **P1** | **Major Defect**              | Logic error, missing edge case, unhandled error state, missing test coverage for critical paths. | Must be fixed or formally deferred with a tracked ticket. |
| **P2** | **Minor Issue**               | Suboptimal algorithm, minor readability barrier, inconsistency with existing codebase idioms.    | Should be addressed if straightforward; non-blocking.     |
| **P3** | **Nit / Suggestion**          | Minor stylistic nuance, non-critical variable rename, optional refactoring idea.                 | Optional. The author may decline without blocking.        |

---

## 2. Review Dimensions and Checklist

### A. Correctness & Behavioral Invariants

- Does the code satisfy all functional requirements and acceptance criteria?
- Are boundary conditions handled (e.g., zero items, single item, overflow, empty strings, null/undefined)?
- Are asynchronous operations properly awaited and errors caught?

### B. Security & Validation

- Is all external input validated and sanitized before use?
- Are permissions and authorization checked server-side?
- Are any sensitive credentials, tokens, or PII logged or exposed?

### C. Architecture & Consistency

- Does the change adhere to existing project directory structures and naming conventions?
- Does it introduce circular dependencies or inappropriate couplings between modules?
- Does it introduce new npm/third-party dependencies that duplicate existing capabilities?

### D. Test Completeness & Quality

- Are new features backed by unit or integration tests?
- Do bug fixes include regression tests that reproduce the defect?
- Do tests assert meaningful behavior rather than trivial mock returns?
- Are tests deterministic, fast, and free of artificial delays/sleeps?

---

## 3. Constructive Feedback Format

Every actionable review comment should follow this structure:

```markdown
**[Tier] [File:Line]: [Concise Issue Summary]**

- **Problem:** Explain why the current implementation is problematic (impact on correctness, performance, or security).
- **Evidence / Rationale:** Cite the specific invariant or code line that leads to the defect.
- **Suggested Fix:** Provide a concrete code replacement or pattern.
```
