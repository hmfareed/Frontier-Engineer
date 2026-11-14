# Frontier Engineer

An AI software-engineering **agent system** distributed as a Google Antigravity plugin. It packages a coordinating agent, five specialist subagents, ten reusable engineering skills, persistent rules, and verification tooling into one versioned, installable unit.

> **Status: Phase 7.6 — Retrieval Integrity, Handoff Enforcement & Change-Control Compliance (v0.6.3, Schema v3).** Six Antigravity lifecycle hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`) operate with global matcher `*` across native file tools, shell commands, MCP tools, and specialist delegation (`invoke_subagent`, `send_message`, and marker-bearing payloads). Phases 7.1–7.6 add a workspace-scoped embedded SQLite repository intelligence index (`.frontier/intelligence/index.sqlite`, schema version `3`), deterministic query and comparison engines, conjunctive engineering-memory verification, role-aware budgeted retrieval, fail-closed `frontier-engineer/handoff` v1 bundles, strict consumer validation, and linear-time full/unterminated PEM secret redaction. Automated unit, CLI, and dispatcher subprocess tests pass locally; live Antigravity GUI host execution (interactive `force_ask`, host PostgreSQL MCP interception, live multi-agent delegation, and `PreToolUse` `overwrite`) remains unverified outside the host IDE.

## What this is

Frontier Engineer is a set of Markdown instructions, JSON configuration, and local TypeScript intelligence, hook, and validation utilities. It is **not** a hosted web application: there is no React frontend, no remote backend API server, and no external SaaS database. Repository intelligence uses an embedded workspace-scoped SQLite index at `.frontier/intelligence/index.sqlite` (schema version `3`), accessed read-only during queries, eligibility checks, and agent retrieval. Antigravity supplies the runtime, the model, the tools, and the agent loop.

The system is built around one rule: **never claim work is done without evidence**. Agents must inspect before editing, verify before reporting, distinguish assumptions from facts, and pause for human approval on consequential actions.

## The six-agent architecture

| Agent                     | Role                                                                  | Mode               |
| ------------------------- | --------------------------------------------------------------------- | ------------------ |
| `frontier-engineer`       | Lead coordinator: classify, plan, delegate, reconcile, verify, report | primary agent      |
| `architect`               | System architecture, data models, API contracts, ADRs                 | read-only subagent |
| `implementation-engineer` | Focused frontend, backend, database and integration changes           | subagent           |
| `security-auditor`        | Independent, evidence-based security review                           | read-only subagent |
| `qa-engineer`             | Test strategy, execution, and honest verification reporting           | subagent           |
| `design-engineer`         | UI/UX, accessibility, interaction states, design systems              | subagent           |

Agent intelligence lives in platform-independent canonical specs under [specs/agents/](specs/agents/). A generator produces the loader-visible Antigravity files in [agents/](agents/) from those specs. See [the agent specifications](docs/04-AGENT-SPECIFICATIONS.md) and [the portability architecture](docs/07-AGENT-PORTABILITY.md).

## The ten engineering skills

| Skill                     | Focus                                                                          | Primary Agents                         |
| ------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `architecture`            | System decomposition, monolith vs. microservices, boundaries, ADRs             | Architect, Coordinator                 |
| `advanced-debugging`      | Root-cause analysis, async race conditions, minimal fixes, regression tests    | Implementation, QA, Coordinator        |
| `security-audit`          | OWASP Top 10, IDOR, injection, token security, secret hygiene                  | Security Auditor, Coordinator          |
| `code-review`             | Diff analysis, defect identification, P0-P3 prioritization, constructive fixes | Coordinator, Security, QA              |
| `frontend-engineering`    | React, Next.js, state, 10 interaction states, WCAG AA accessibility            | Implementation, Design, Coordinator    |
| `backend-engineering`     | REST/GraphQL APIs, server-side auth, persistence transactions, resilience      | Implementation, Architect, Coordinator |
| `testing-engineering`     | Testing pyramid, unit/integration/E2E, six test states, test isolation         | QA, Implementation, Coordinator        |
| `deep-research`           | Authoritative documentation research, source hierarchy (Tiers 1-5)             | Architect, Coordinator, Security       |
| `database-engineering`    | Relational 3NF, B-tree composite indexes, zero-downtime migrations             | Architect, Implementation, Coordinator |
| `performance-engineering` | Baseline benchmarking, Web Vitals, event loop profiling, bundle optimization   | Implementation, Architect, QA          |

Canonical skill specifications live under [specs/skills/](specs/skills/) and deep references under [specs/skills/references/](specs/skills/references/). A generator produces the loader-visible Antigravity skills in [skills/](skills/). See [skills architecture](docs/09-SKILLS-ARCHITECTURE.md) and [specifications](docs/10-SKILL-SPECIFICATIONS.md).

## The fourteen engineering rules

| Rule                    | Category    | Trigger                                 | Priority & Level        |
| :---------------------- | :---------- | :-------------------------------------- | :---------------------- |
| `AGENTS.md`             | foundation  | Always-on                               | Priority 10 · Mandatory |
| `general-engineering`   | engineering | Glob (`**/*.{ts,tsx,js,jsx,py,...}`)    | Priority 8 · Mandatory  |
| `code-quality`          | engineering | Glob (`**/*.{ts,tsx,js,jsx,py,...}`)    | Priority 8 · Mandatory  |
| `documentation`         | engineering | Glob (`**/*.{md,mdx},docs/**`)          | Priority 6 · Mandatory  |
| `frontend-standards`    | frontend    | Glob (`**/*.{tsx,jsx,vue,svelte,...}`)  | Priority 7 · Mandatory  |
| `accessibility`         | frontend    | Glob (`**/*.{tsx,jsx,vue,svelte,html}`) | Priority 8 · Mandatory  |
| `backend-standards`     | backend     | Glob (`**/*.{ts,js,py,go,java,...}`)    | Priority 7 · Mandatory  |
| `api-security`          | backend     | Model decision (API security, auth)     | Priority 9 · Mandatory  |
| `database-standards`    | database    | Glob (`**/*.{sql,prisma,schema,db}`)    | Priority 7 · Mandatory  |
| `migration-safety`      | database    | Glob (`**/migrations/**,**/*.sql`)      | Priority 9 · Mandatory  |
| `security-standards`    | security    | Model decision (Security audit, OWASP)  | Priority 9 · Mandatory  |
| `secrets-management`    | security    | Glob (`**/*.{env*,json,yaml,conf,...}`) | Priority 10 · Mandatory |
| `testing-standards`     | testing     | Glob (`**/*.{test,spec}.*,tests/**`)    | Priority 8 · Mandatory  |
| `performance-standards` | performance | Model decision (Latency, profiling)     | Priority 7 · Advisory   |

Canonical rule specifications live under [specs/rules/](specs/rules/). A generator produces the loader-visible Antigravity rules in [rules/](rules/). See [rules architecture](docs/15-RULES-ARCHITECTURE.md) and [specifications](docs/16-RULE-SPECIFICATIONS.md).

## The five MCP integrations

| Integration  | Category          | Primary Capabilities                                               | Permission Class        | Primary Agents                      |
| :----------- | :---------------- | :----------------------------------------------------------------- | :---------------------- | :---------------------------------- |
| `github`     | `repository`      | PR reviews, issue management, commit logs, branch operations       | Read-only to Destruct.  | Coordinator, Implementation, QA     |
| `context7`   | `documentation`   | Live documentation search, library versioning, API signatures      | Read-only               | Architect, Implementation, Security |
| `playwright` | `browser_testing` | Headless browser automation, accessibility trees, screenshots      | Read-only to Ext. Side  | QA, Design, Coordinator             |
| `sentry`     | `observability`   | Production crash triage, symbolicated stack traces, release health | Read-only to Rev. Write | Implementation, QA, Architect       |
| `database`   | `database`        | Relational schema introspection, EXPLAIN plans, read-only SELECT   | Read-only / Sensitive   | Architect, Implementation, Security |

Canonical integration specifications live under [specs/integrations/](specs/integrations/). A generator produces the loader-visible Antigravity MCP adapter in [mcp_config.json](mcp_config.json) (disabled by default) and [mcp_config.example.json](mcp_config.example.json). See [MCP architecture](docs/21-MCP-ARCHITECTURE.md) and [MCP security](docs/23-MCP-SECURITY.md).

## Repository layout

| Path                                                                           | Purpose                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [plugin.json](plugin.json)                                                     | Antigravity plugin manifest (verified schema)                 |
| [mcp_config.json](mcp_config.json)                                             | Generated Antigravity MCP configuration (disabled by default) |
| [mcp_config.example.json](mcp_config.example.json)                             | Example MCP environment variable setup guide                  |
| [agents/](agents/)                                                             | Generated Antigravity agent definitions (do not edit by hand) |
| [specs/agents/](specs/agents/)                                                 | Canonical platform-independent agent specifications           |
| [skills/](skills/)                                                             | Generated Antigravity skill definitions and references        |
| [specs/skills/](specs/skills/)                                                 | Canonical platform-independent skill specifications           |
| [rules/](rules/)                                                               | Generated Antigravity rules (1 global + 13 modular)           |
| [specs/rules/](specs/rules/)                                                   | Canonical platform-independent rule specifications            |
| [specs/integrations/](specs/integrations/)                                     | Canonical platform-independent MCP integration specifications |
| [specs/adapters/](specs/adapters/README.md)                                    | Adapter registry and per-platform requirements                |
| [specs/evaluation/scenarios.json](specs/evaluation/scenarios.json)             | Defined agent evaluation scenarios (unscored)                 |
| [specs/evaluation/skill-scenarios.json](specs/evaluation/skill-scenarios.json) | Defined skill evaluation scenarios (unscored)                 |
| [scripts/](scripts/)                                                           | TypeScript validation utilities and code generators           |
| [schemas/](schemas/)                                                           | Local schema transcriptions and contract schemas              |
| [tests/](tests/)                                                               | Unit and integration tests                                    |
| [docs/](docs/README.md)                                                        | Product documentation                                         |
| [assets/](assets/)                                                             | Plugin logo                                                   |
| [frontier-engineer-docs/](frontier-engineer-docs/fe/README.md)                 | Original 26-part specification archive (unmodified reference) |

## Getting started

Requires Node.js 22.6+ (native TypeScript execution) and npm.

```bash
npm install
npm run verify
npm run frontier -- --help
```

`npm run verify` runs the type check, full validation, unit tests, formatting check, and Markdown lint. `npm run frontier -- <command>` exposes the workspace intelligence and orchestration CLI (`status`, `overview`, `freshness`, `components`, `dependencies`, `cycles`, `compare`, `evolution`, `memories`, `retrieve`, `prepare-handoff`, `validate-handoff`; partial snapshots default to rejected unless `--allow-partial` is explicitly passed). After editing canonical agent, skill, or rule specs, regenerate the adapters:

```bash
npm run generate:agents
npm run generate:agents -- --check
npm run generate:skills
npm run generate:skills -- --check
npm run generate:rules
npm run generate:rules -- --check
npm run generate:integrations
npm run generate:integrations -- --check
```

To validate the plugin itself with the installed Antigravity CLI:

```bash
agy plugin validate --strict .
```

The CLI binary is `agy`. On Windows it is installed at `~/.gemini/bin/agy.exe`; if it is not on `PATH`, use the full path.

## Documentation

- **Agents:** [Specifications](docs/04-AGENT-SPECIFICATIONS.md), [Coordination](docs/05-AGENT-COORDINATION.md), [Communication](docs/06-AGENT-COMMUNICATION.md), [Portability](docs/07-AGENT-PORTABILITY.md), [Evaluation](docs/08-AGENT-EVALUATION.md)
- **Skills:** [Architecture](docs/09-SKILLS-ARCHITECTURE.md), [Specifications](docs/10-SKILL-SPECIFICATIONS.md), [Activation](docs/11-SKILL-ACTIVATION.md), [Agent integration](docs/12-SKILL-AGENT-INTEGRATION.md), [Portability](docs/13-SKILL-PORTABILITY.md)
- **Rules:** [Architecture](docs/15-RULES-ARCHITECTURE.md), [Specifications](docs/16-RULE-SPECIFICATIONS.md), [Activation](docs/17-RULE-ACTIVATION.md), [Priority and conflicts](docs/18-RULE-PRIORITY-AND-CONFLICTS.md), [Portability](docs/19-RULE-PORTABILITY.md)
- **Integrations:** [MCP architecture](docs/21-MCP-ARCHITECTURE.md), [MCP integrations](docs/22-MCP-INTEGRATIONS.md), [MCP security](docs/23-MCP-SECURITY.md), [MCP configuration](docs/24-MCP-CONFIGURATION.md), [MCP portability](docs/25-MCP-PORTABILITY.md), [MCP operations](docs/26-MCP-OPERATIONS.md)
- **Repository intelligence:** [Storage architecture](docs/34-STORAGE-ARCHITECTURE.md), [Graph engine architecture](docs/35-GRAPH-ENGINE-ARCHITECTURE.md), [Architecture intelligence](docs/36-ARCHITECTURE-INTELLIGENCE.md), [Architecture query CLI](docs/37-ARCHITECTURE-QUERY-CLI.md), [Engineering memory data model](docs/38-ENGINEERING-MEMORY-DATA-MODEL.md), [Snapshot comparator and diff engine](docs/39-SNAPSHOT-COMPARATOR-DIFF-ENGINE.md), [Agent retrieval and orchestration](docs/40-AGENT-RETRIEVAL-ORCHESTRATION.md)
- **Foundation:** [Project overview](docs/01-PROJECT-OVERVIEW.md), [Technology stack](docs/02-TECHNOLOGY-STACK.md), [System architecture](docs/03-SYSTEM-ARCHITECTURE.md), [Engineering principles](docs/14-ENGINEERING-PRINCIPLES.md), [Repository structure](docs/20-REPOSITORY-STRUCTURE.md), [Official format verification](docs/27-OFFICIAL-FORMAT-VERIFICATION.md)
- **Decisions:** [ADR-001 Foundation](docs/adr/ADR-001-foundation.md), [ADR-002 Agent system](docs/adr/ADR-002-agent-system.md), [ADR-003 Skills system](docs/adr/ADR-003-skills-system.md), [ADR-004 Rules system](docs/adr/ADR-004-rules-system.md), [ADR-005 MCP integration architecture](docs/adr/ADR-005-mcp-integration-architecture.md), [ADR-006 Lifecycle hooks architecture](docs/adr/ADR-006-lifecycle-hooks-architecture.md), [ADR-007 Storage and graph engine](docs/adr/ADR-007-storage-and-graph-engine.md), [ADR-008 Agent retrieval and orchestration](docs/adr/ADR-008-agent-retrieval-orchestration.md), [Documentation index](docs/README.md)
- **Policies:** [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), [Changelog](CHANGELOG.md), [License](LICENSE).

## Verified vs proposed

`agy plugin validate --strict .` recognises ten skills, six agents, fourteen rules, six lifecycle hooks, and five MCP servers with zero findings. Everything that claims Antigravity compatibility is recorded in [the verification record](docs/27-OFFICIAL-FORMAT-VERIFICATION.md) with sources and dates.

### Capability Status Summary (Phase 7.7)

| Capability                                                             | Status                              | Evidence / Boundary                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Deterministic scanner, AST extractor & SQLite schema v3                | **IMPLEMENTED AND VERIFIED**        | Verified across unit, integration, crash-recovery & synthetic scale benchmarks (up to 10,000 files on Windows Node v24.21.0) |
| Engineering graph, architecture/ADR analysis & comparator              | **IMPLEMENTED AND VERIFIED**        | Verified across dependency, SCC cycle, drift, debt & snapshot diff tests                                                     |
| Engineering memory lifecycle & conjunctive verification                | **IMPLEMENTED AND VERIFIED**        | Verified with SQLite immutability triggers and read-only evidence evaluation                                                 |
| Role-aware retrieval, request validation & fail-closed handoffs        | **IMPLEMENTED AND VERIFIED**        | Verified via `RetrievalEngine`, schema validation, secret redaction & `parseAndValidateHandoffBundle`                        |
| Delegation gating via `PreToolUse` & `FRONTIER_AUTO_PREPARE_HANDOFF=1` | **IMPLEMENTED, PARTIALLY VERIFIED** | Verified in handler/subprocess suites; live GUI host execution & `overwrite` payload mutation are **HOST-DEPENDENT**         |
| Live host `force_ask` UI prompts & PostgreSQL MCP interception         | **NOT VERIFIED**                    | Blocked from non-interactive CLI subshells due to headless browser OAuth constraints                                         |
| Windows unprivileged file symlink scanning                             | **IMPLEMENTED, PARTIALLY VERIFIED** | Directory traversal and containment verified; file symlink creation skipped on Windows without symlink privilege (`EPERM`)   |
| Non-Antigravity runtime adapters                                       | **DOCUMENTED BUT NOT IMPLEMENTED**  | Only Antigravity adapter artifacts are generated (`agents/`, `skills/`, `rules/`, `hooks/`, `mcp_config.json`)               |

**Runtime invocation, live specialist delegation, `PreToolUse` `overwrite` injection, skill activation, host-level PostgreSQL MCP interception, and interactive `force_ask` UI prompts in live Antigravity host user sessions have not been tested.** All verification of those paths reflects automated unit, handler, CLI, and dispatcher subprocess tests. No non-Antigravity adapter is implemented, and no evaluation score has been assigned. Installation and live host runtime discovery remain outside automated test scope.

## License

MIT. See [LICENSE](LICENSE).
