# Part 11 — Skill Activation and Discovery

## Selective activation strategy

In Frontier Engineer, skills must be loaded **selectively and purposefully**.
Loading all ten skills simultaneously into every task prompt would consume context window capacity, introduce irrelevant instructions, and dilute focus.

The lead coordinator (`frontier-engineer`) and specialists inspect the incoming task, classify its complexity, and activate only the specific skill(s) that directly address the assignment.

---

## Skill activation matrix

| Skill                         | Activate When                                                                                                                                         | Do NOT Activate When                                                                                                      |
| :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **`architecture`**            | Designing new subsystems, evaluating monolith vs. microservice trade-offs, planning database schemas, API contracts, or recording ADRs.               | Fixing an isolated bug, styling CSS layouts, or updating dependencies within semver.                                      |
| **`advanced-debugging`**      | Application crashes, unhandled exceptions, intermittent/flaky tests, race conditions, memory leaks, or database pool starvation.                      | Fixing obvious compiler syntax errors, building new features, or authoring routine documentation.                         |
| **`security-audit`**          | Authoring or auditing authentication, session tokens, authorization middleware, public API routes, file uploads, or preparing for compliance reviews. | Refactoring private internal functions, designing UI animations, or adjusting component typography.                       |
| **`code-review`**             | Reviewing git diffs, evaluating pull requests, auditing subagent implementations, or assessing test completeness before merge.                        | Writing code from scratch, running automated linters/formatters, or authoring initial architecture proposals.             |
| **`frontend-engineering`**    | Creating UI components, implementing React/Next.js pages, managing frontend state, responsive styling, or auditing WCAG AA accessibility.             | Writing server-side background queues, designing database tables, or configuring network load balancers.                  |
| **`backend-engineering`**     | Implementing REST/GraphQL endpoints, domain business logic, service layer abstractions, server-side auth, or database transactions.                   | Writing client-side React components, CSS animations, or standalone command-line scripts without backend APIs.            |
| **`testing-engineering`**     | Authoring unit, integration, or E2E tests, extracting criteria, stabilizing flaky test suites, or generating verification reports.                    | Writing production feature code, performing visual styling reviews, or evaluating library whitepapers.                    |
| **`deep-research`**           | Investigating unfamiliar frameworks, checking API compatibility across runtimes, cross-referencing CVEs, or comparing library alternatives.           | Writing routine code with familiar tools, fixing local syntax typos, or answering simple questions from repository files. |
| **`database-engineering`**    | Creating or modifying database tables, adding indexes, optimizing slow queries, planning zero-downtime migrations, or configuring connection pools.   | Writing client-side CSS components, stateless domain logic, or marketing documentation.                                   |
| **`performance-engineering`** | Resolving slow API response latency (high p95/p99), optimizing frontend Core Web Vitals (LCP, INP, CLS), or profiling memory leaks.                   | Speculatively refactoring code without benchmark data, writing general unit tests, or styling visual layouts.             |

---

## Discovery mechanism

In the Antigravity plugin runtime:

1. **Directory Discovery:** When Frontier Engineer is loaded as an enabled plugin, the Antigravity agent loop inspects `skills/*/SKILL.md`.
2. **Metadata Matching:** The agent loop reads the frontmatter `description` of each discovered skill. When the user prompt or delegated task description matches a skill's trigger semantics, the skill instructions are progressively brought into context.
3. **Explicit Activation:** The coordinator or developer can explicitly trigger a skill by name (e.g. `/<skill-name>` or instructing the agent to _"use the advanced-debugging skill to isolate the race condition"_).
