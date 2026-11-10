# Part 05 — Skills System

Skills provide reusable instructions for specific engineering activities. Unlike agents, which represent **responsibilities**, skills represent **procedures and expertise**. Frontier Engineer begins with ten skills.

## 5.1 Architecture Engineering
**Purpose:** Design reliable application architecture.
**Covers:** requirements decomposition, architecture selection, system boundaries, database design, API design, service communication, scalability, reliability, trade-offs, technical documentation.
**Expected output:** an implementation-ready architecture proposal.

## 5.2 Advanced Debugging
**Purpose:** Diagnose and resolve application failures.

Procedure:

1. Reproduce the failure
2. Identify expected behavior
3. Identify actual behavior
4. Inspect error messages
5. Trace the execution path
6. Identify likely root causes
7. Validate the root cause
8. Implement a minimal fix
9. Add regression coverage
10. Verify the result

Avoid random changes and speculative fixes.

## 5.3 Security Auditing
**Purpose:** Perform systematic security reviews.
**Covers:** OWASP guidance, authentication, authorization, API security, database permissions, session management, secret handling, input validation, dependency security, infrastructure configuration.
Findings must be evidence-based.

## 5.4 Code Review
**Purpose:** Evaluate code quality before changes are merged.
**Reviews:** correctness, maintainability, security, performance, error handling, type safety, test coverage, compatibility, regression risk.
Prioritize actionable findings over stylistic preferences.

## 5.5 Frontend Engineering
**Purpose:** Build modern, production-quality interfaces.
**Covers:** component architecture, responsive layouts, state management, form handling, accessibility, design systems, performance, loading and error states, API integration, browser verification.

## 5.6 Backend Engineering
**Purpose:** Build robust backend services.
**Covers:** API architecture, request validation, business logic, authentication, authorization, database access, error handling, logging, rate limiting, background jobs, integration testing.

## 5.7 Testing Engineering
**Purpose:** Establish systematic software verification.
**Covers:** unit tests, integration tests, end-to-end tests, contract tests, regression tests, performance tests, security tests, test data management, CI integration.

## 5.8 Deep Technical Research
**Purpose:** Investigate unfamiliar technologies and technical problems.

Procedure:

1. Clarify the research question
2. Identify authoritative sources
3. Prefer official documentation
4. Verify current versions
5. Compare alternatives
6. Identify compatibility concerns
7. Explain trade-offs
8. Provide references
9. Distinguish verified facts from assumptions

## 5.9 Database Engineering
**Purpose:** Design and maintain reliable database systems.
**Covers:** relational modeling, document modeling, schema design, indexing, query optimization, transactions, constraints, migrations, backup strategy, data integrity, access controls.

## 5.10 Performance Engineering
**Purpose:** Identify and eliminate performance bottlenecks.
**Covers:** frontend rendering, API latency, database query performance, caching, bundle optimization, image optimization, network requests, memory usage, load testing, performance monitoring.

## 5.11 Skill structure

Each skill is a separate directory:

```
skills/
└── debugging/
    ├── SKILL.md
    └── references/
        ├── root-cause-analysis.md
        ├── debugging-checklist.md
        └── regression-testing.md
```

A skill has focused metadata and instructions, using the actual Antigravity-supported skill format. Conceptual frontmatter:

```yaml
---
name: advanced-debugging
description: Systematically diagnose, reproduce, investigate and resolve software defects.
---
```

The exact metadata requirements must be checked against the official format.
