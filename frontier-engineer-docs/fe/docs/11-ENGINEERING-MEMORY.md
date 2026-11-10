# Part 11 — Engineering Memory

Purpose: prevent repeated architectural discussions and preserve important project decisions.

## 11.1 Memory categories

1. Architecture decisions
2. Technology choices
3. Coding conventions
4. API contracts
5. Database decisions
6. Known limitations
7. Important bugs
8. Completed migrations
9. Outstanding technical debt

## 11.2 Decision records

Use Architecture Decision Records (ADRs).

```markdown
# ADR-001: Database Selection

## Status
Accepted

## Context
The application requires persistent storage.

## Decision
Use MongoDB.

## Alternatives
- PostgreSQL
- MySQL

## Consequences
- Document-oriented data modeling.
- Flexible schemas.
- Need to enforce data integrity carefully.
```

## 11.3 Memory storage

Do not assume Antigravity provides unlimited persistent agent memory. Use supported project files and documented persistence mechanisms. A possible project-local structure:

```
.frontier/
├── project-profile.md
├── decisions/
├── architecture/
├── known-issues.md
├── technical-debt.md
└── progress.md
```

Only create this structure when it is appropriate and authorized for the target repository.
