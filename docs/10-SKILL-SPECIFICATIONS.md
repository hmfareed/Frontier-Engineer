# Part 10 — Skill Specifications Catalog

This document details the ten canonical skills comprising Phase 3 of Frontier Engineer, their capabilities, operating workflows, and key engineering invariants.

---

## 1. Architecture (`architecture/`)

- **Role:** Design reliable, scalable, and maintainable software systems.
- **Canonical Specification:** [`specs/skills/architecture.md`](../specs/skills/architecture.md)
- **Deep Reference:** [`skills/architecture/references/trade-off-and-adr-guide.md`](../skills/architecture/references/trade-off-and-adr-guide.md)
- **Primary Capabilities:** Requirements decomposition, modular monolith vs. microservices evaluation, service boundaries, API contracts, caching architectures, queue topologies, and Architecture Decision Records (ADRs).
- **Core Workflow:** Understand requirements -> Inspect existing repository -> Identify system boundaries -> Evaluate alternatives with trade-offs -> Recommend architecture -> Define contracts & data flows -> Model security/reliability -> Author ADR.
- **Key Invariant:** Never recommend microservices or complex distributed topologies without demonstrating concrete scaling, hardware, or organizational necessity.

---

## 2. Advanced Debugging (`advanced-debugging/`)

- **Role:** Resolve complex defects through evidence-based root-cause analysis.
- **Canonical Specification:** [`specs/skills/advanced-debugging.md`](../specs/skills/advanced-debugging.md)
- **Deep Reference:** [`skills/advanced-debugging/references/root-cause-analysis-guide.md`](../skills/advanced-debugging/references/root-cause-analysis-guide.md)
- **Primary Capabilities:** Stack trace tracing, async race condition isolation, memory leak diagnosis, connection starvation analysis, hypothesis testing, minimal intervention, and regression test authoring.
- **Core Workflow:** Understand symptoms -> Establish expected invariants -> Minimal reproduction -> Collect execution traces -> Formulate falsifiable hypothesis -> Isolate root cause -> Apply minimal fix -> Author regression test -> Verify fix.
- **Key Invariant:** Never engage in trial-and-error editing across multiple unrelated files; every bug fix requires an automated regression test that failed before the fix and passes after.

---

## 3. Security Auditing (`security-audit/`)

- **Role:** Identify, classify, and remediate application security weaknesses.
- **Canonical Specification:** [`specs/skills/security-audit.md`](../specs/skills/security-audit.md)
- **Deep Reference:** [`skills/security-audit/references/vulnerability-assessment-checklist.md`](../skills/security-audit/references/vulnerability-assessment-checklist.md)
- **Primary Capabilities:** OWASP Top 10 auditing, Broken Access Control (IDOR), SQL/command injection, CSRF/XSS, SSRF, token and session management, secret scanning, and rate limiting.
- **Core Workflow:** Threat modeling -> Attack surface mapping -> Authentication & authorization inspection -> Input validation & query inspection -> Vulnerability classification (Critical to Informational) -> Remediation code authoring -> Verification.
- **Key Invariant:** Every reported security vulnerability must include exact code evidence, an actionable exploit scenario, and a tested remediation. Destructive testing on production environments is strictly prohibited.

---

## 4. Code Review (`code-review/`)

- **Role:** Perform rigorous, independent reviews of code changes.
- **Canonical Specification:** [`specs/skills/code-review.md`](../specs/skills/code-review.md)
- **Deep Reference:** [`skills/code-review/references/review-rubric-and-classification.md`](../skills/code-review/references/review-rubric-and-classification.md)
- **Primary Capabilities:** Diff analysis, behavioral correctness, security auditing, performance regressions, type safety, test adequacy, and priority-tiered feedback (P0 to P3).
- **Core Workflow:** Understand objective -> Inspect diff & surrounding context -> Identify behavioral defects -> Audit security & performance -> Review test coverage -> Classify findings -> Deliver actionable comments with concrete fixes.
- **Key Invariant:** Prioritize actual bugs and security risks over subjective stylistic tastes; reject changes where failing tests were deleted to achieve green CI.

---

## 5. Frontend Engineering (`frontend-engineering/`)

- **Role:** Build production-quality, accessible, and performant user interfaces.
- **Canonical Specification:** [`specs/skills/frontend-engineering.md`](../specs/skills/frontend-engineering.md)
- **Deep Reference:** [`skills/frontend-engineering/references/interaction-states-and-a11y-guide.md`](../skills/frontend-engineering/references/interaction-states-and-a11y-guide.md)
- **Primary Capabilities:** React, Next.js, TypeScript component architecture, responsive design (320px–1440px), form handling, the 10 interaction states, and WCAG 2.1 AA accessibility.
- **Core Workflow:** Inspect design tokens & existing components -> Author semantic HTML -> Implement state & interactions -> Handle all ten interaction states -> Verify keyboard navigation and contrast -> Test across breakpoints -> Verify visually.
- **Key Invariant:** Never set `outline: none` without a high-contrast focus indicator; all interactive elements must be keyboard-accessible and provide explicit loading, empty, and error states.

---

## 6. Backend Engineering (`backend-engineering/`)

- **Role:** Build resilient, secure, and maintainable backend services and APIs.
- **Canonical Specification:** [`specs/skills/backend-engineering.md`](../specs/skills/backend-engineering.md)
- **Deep Reference:** [`skills/backend-engineering/references/api-design-and-resilience-guide.md`](../skills/backend-engineering/references/api-design-and-resilience-guide.md)
- **Primary Capabilities:** REST/GraphQL API contracts, domain service layering, server-side authentication and authorization, database transactions, background workers, idempotency, and RFC 7807 error formatting.
- **Core Workflow:** Understand requirements -> Separate Controller/Service/Repository layers -> Enforce schema validation -> Implement business logic inside ACID transactions -> Enforce server-side authorization -> Handle errors safely -> Add structured logging -> Test.
- **Key Invariant:** Never trust client-supplied identity or role claims; multi-record mutations must execute within atomic transactions; mutation endpoints must support idempotency keys.

---

## 7. Testing Engineering (`testing-engineering/`)

- **Role:** Design and execute systematic software verification and quality assurance.
- **Canonical Specification:** [`specs/skills/testing-engineering.md`](../specs/skills/testing-engineering.md)
- **Deep Reference:** [`skills/testing-engineering/references/test-state-matrix-and-patterns.md`](../skills/testing-engineering/references/test-state-matrix-and-patterns.md)
- **Primary Capabilities:** Unit, integration, E2E, and regression test design; test data management; fixture isolation; determinism; and six-state test reporting.
- **Core Workflow:** Extract acceptance criteria -> Survey existing tests -> Select testing pyramid level -> Author AAA tests -> Execute suite -> Diagnose failures -> Verify fixes -> Report outcomes across the six canonical states.
- **Key Invariant:** Maintain strict separation between the six test states (`not written`, `not executed`, `passed`, `failed`, `blocked`, `not applicable`); never report an unexecuted test as passed.

---

## 8. Deep Research (`deep-research/`)

- **Role:** Conduct rigorous technical investigations using authoritative evidence.
- **Canonical Specification:** [`specs/skills/deep-research.md`](../specs/skills/deep-research.md)
- **Deep Reference:** [`skills/deep-research/references/evidence-synthesis-guide.md`](../skills/deep-research/references/evidence-synthesis-guide.md)
- **Primary Capabilities:** Technical documentation research, API signature verification, library compatibility analysis, CVE analysis, and temporal version anchoring.
- **Core Workflow:** Define bounded research question -> Enumerate required facts -> Prioritize Tier 1/2 official sources -> Cross-check breaking changes -> Reconcile conflicting advice -> Label facts vs. assumptions -> Synthesize report with citations.
- **Key Invariant:** Follow the strict source hierarchy (Official Docs > Repos/Changelogs > Security Standards > Tech Blogs > Forums); never hallucinate undocumented APIs or performance figures.

---

## 9. Database Engineering (`database-engineering/`)

- **Role:** Design, optimize, and maintain reliable database persistence systems.
- **Canonical Specification:** [`specs/skills/database-engineering.md`](../specs/skills/database-engineering.md)
- **Deep Reference:** [`skills/database-engineering/references/schema-design-and-migration-guide.md`](../skills/database-engineering/references/schema-design-and-migration-guide.md)
- **Primary Capabilities:** Relational 3NF modeling, document modeling, composite B-tree index design, query plan analysis (`EXPLAIN ANALYZE`), zero-downtime migrations (Expand-Contract), and referential integrity.
- **Core Workflow:** Inspect database engine & schema -> Map read/write access patterns -> Normalize schema -> Define foreign keys and composite indexes -> Evaluate execution plans -> Author reversible migration scripts -> Verify rollback.
- **Key Invariant:** Never execute destructive operations (`DROP TABLE`, `DROP COLUMN`) without explicit human confirmation; avoid table-exclusive locks during live production migrations.

---

## 10. Performance Engineering (`performance-engineering/`)

- **Role:** Identify, measure, and eliminate performance bottlenecks.
- **Canonical Specification:** [`specs/skills/performance-engineering.md`](../specs/skills/performance-engineering.md)
- **Deep Reference:** [`skills/performance-engineering/references/profiling-and-benchmarking-guide.md`](../skills/performance-engineering/references/profiling-and-benchmarking-guide.md)
- **Primary Capabilities:** Baseline benchmarking, Core Web Vitals (LCP, INP, CLS), Node.js event loop profiling, memory leak detection, bundle analysis, N+1 query batching, and cache sizing.
- **Core Workflow:** Define target metric -> Establish empirical baseline under reproducible load -> Profile system to isolate bottleneck -> Determine root cause -> Apply minimal intervention -> Measure again -> Calculate verified improvement delta.
- **Key Invariant:** Never claim an optimization was successful without providing empirical before-and-after benchmark measurements under identical test conditions.
