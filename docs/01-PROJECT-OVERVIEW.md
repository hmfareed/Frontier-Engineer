# Part 01 — Project overview

## Identity

| Property              | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Product               | Frontier Engineer                                                                                 |
| Category              | AI software-engineering agent system                                                              |
| Distribution          | Google Antigravity plugin                                                                         |
| Execution environment | Antigravity App, CLI, or IDE                                                                      |
| Current version       | 0.6.3 (Phase 7.6 Retrieval Integrity, Handoff Enforcement & Change-Control Compliance; Schema v3) |
| Target release        | 1.0.0 (Phase 10)                                                                                  |

## Vision

Frontier Engineer turns a general-purpose coding agent into a disciplined engineering team. Instead of one agent doing everything, work is organized across a coordinating agent and five specialists, each with defined responsibilities, procedures, quality standards, and boundaries. A shared set of reusable skills supplies repeatable procedures, while persistent rules supply invariants.

The system should eventually be able to understand unfamiliar codebases, design architectures, plan complex projects, implement frontend and backend features, debug failures, audit security, review code, write and run tests, analyze performance, research unfamiliar technology, inspect rendered interfaces, and produce technical documentation.

## Core philosophy

1. **Engineering before code generation.** Understand requirements and existing architecture before modifying files.
2. **Evidence before assumptions.** Inspect actual source, configuration, dependencies, and execution results.
3. **Verification before completion.** Generated code is not an implemented feature.
4. **Security by default.** Authentication, authorization, validation, and secret handling are considered throughout.
5. **Maintainability over shortcuts.** Prefer clear architecture and separation of concerns.
6. **Human control.** Developers retain control over destructive operations, deployments, and consequential decisions.
7. **Continuous improvement.** Evaluate results and improve instructions and quality standards.

The first of these is the defining characteristic: the system's value comes from constraining an agent as much as from empowering it.

## Non-goals

- Changing model weights.
- Guaranteeing that every generated implementation is correct.
- Replacing human engineering judgment.
- Automatically deploying to production.
- Executing unrestricted shell commands.
- Depending on a custom SaaS backend for core functionality.
- Building a hosted React, Next.js, or remote SaaS database-backed web application (local repository intelligence uses an embedded workspace-scoped SQLite index at `.frontier/intelligence/index.sqlite`, schema version `3`).

## Target users

Independent developers, full-stack engineers, frontend and backend engineers, technical founders, engineering teams, and developers maintaining complex production applications.

## Phase status

Phase 1 established a clean, documented, tested, secure foundation compatible with verified Antigravity conventions: the plugin manifest, repository structure, toolchain, validation utilities, tests, security policy, and architecture documentation.

Phase 2 added six platform-independent canonical agent specifications, a generator that emits their Antigravity adapters, a structured handoff contract, delegation and conflict-prevention policies, a capability matrix, nineteen unscored evaluation scenarios, and adapter requirements for four other platforms. See [Part 04](04-AGENT-SPECIFICATIONS.md).

Phase 3 implemented ten platform-independent canonical skill specifications under `specs/skills/`, twenty deep technical reference guides under `specs/skills/references/`, a compiler emitting Antigravity skill adapters under `skills/`, twenty defined skill evaluation scenarios, and comprehensive validation tooling. See [Part 09](09-SKILLS-ARCHITECTURE.md) and [Part 10](10-SKILL-SPECIFICATIONS.md).

Phase 4 implemented the modular engineering rules system: one global foundation rule and thirteen specialized modular rules across seven categories, canonical specifications under `specs/rules/`, an adapter compiler emitting flat files under `rules/`, strict drift detection, and full Antigravity CLI discovery verification (14 rules). See [Part 15](15-RULES-ARCHITECTURE.md) and [Part 16](16-RULE-SPECIFICATIONS.md).

Phase 5 implemented the secure Model Context Protocol (MCP) integration architecture: five canonical integration specifications under `specs/integrations/` (GitHub, Context7, Playwright, Sentry, PostgreSQL) with 3-tier modular documents (`integration.md`, `capabilities.md`, `security.md`), a central integration registry, 5-tier capability-based permission model, a generator producing Antigravity adapters (`mcp_config.json`, disabled by default), and full CLI verification (5 MCP servers). See [Part 21](21-MCP-ARCHITECTURE.md) and [Part 22](22-MCP-INTEGRATIONS.md).

Phase 5.1 conducted an empirical technical audit, verified provider packages, retired deprecated reference servers, enforced server-side read-only boundaries (`github-mcp-server --read-only=true`, `@playwright/mcp --headless --isolated`), defined 10 mandatory defense-in-depth database invariants, and implemented a live runtime acceptance test harness (`scripts/test-mcp-runtime.ts`).

Phase 6 implemented the Antigravity lifecycle hooks architecture across six events (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`), generated `hooks.json`, unified file and command interception under a global matcher (`*`), hardened dispatcher fail-closed error boundaries, implemented semantic capability categorization, registered trusted MCP capabilities, and established an extensive 45-test acceptance suite. Phase 6.1.3 reconciled all verification evidence, strictly classifying host-level PostgreSQL MCP interception as NOT VERIFIED, maintaining interactive `force_ask` confirmation bypass as BLOCKED, and confirming strict CLI validation with CLI v1.5.0.

Phase 7 (Phases 7.1–7.7) implemented deterministic repository scanning, AST/symbol extraction, embedded SQLite intelligence persistence (`schemaVersion = 3`), dependency graph traversal and cycle detection, architecture and ADR verification, the `frontier` query/evolution CLI, snapshot comparison, drift/debt tracking, durable engineering memories with conjunctive evidence verification, Phase 7.6 role-aware retrieval orchestration and fail-closed `frontier-engineer/handoff` v1 delegation gating, and Phase 7.7 cross-subsystem hardening (strict `RetrievalEngine` request validation and bounded warnings, self-contained extractor secret redaction, hook output redaction, atomic `promoteScan`/staging crash cleanup, expanded `validateIntegrity`, and synthetic scale/stress verification up to 10,000 files). Version remains `0.6.3` (`0.7.0` reserved pending formal acceptance).

Still deliberately deferred: workflows (Phase 8) and release packaging (Phases 9–10).

## Current limitations

- Live IDE installation and interactive runtime invocation of the plugin's agents, skills, specialist delegation, and `PreToolUse` `overwrite` payload modification inside Antigravity GUI sessions have not been executed in live user sessions; automated coverage rests on unit, direct handler, CLI, and dispatcher subprocess tests plus `agy plugin validate --strict .`.
- Plain-text delegation to specialist subagents can bypass retrieval unless `PreToolUse` gating with `FRONTIER_REQUIRE_HANDOFF=1` or `FRONTIER_AUTO_PREPARE_HANDOFF=1` is active in the host runtime.
- While `mcp_config.json` and `hooks.json` are generated and strictly validated, live host-level interception of PostgreSQL MCP operations has not been verified within an authentic Antigravity session.
- `PreInvocation` host payloads provide invocation step counters and metadata without structured incoming subagent tool arguments, and Antigravity exposes no `SubagentStart` hook event; delegation inspection runs in `PreToolUse`.
- Live host UI evaluation of `force_ask` fresh prompts bypassing cached Always Allow permissions is BLOCKED due to headless OAuth constraints.
- On Windows without Developer Mode or explicit `SeCreateSymbolicLinkPrivilege`, automated symlink filesystem-boundary assertions skip the file-symlink subtest (`EPERM`); full POSIX symlink verification remains recommended on Linux/macOS CI.
- `tools` allowlists are not emitted; see [Part 04](04-AGENT-SPECIFICATIONS.md) for the reason.
- No adapter other than Antigravity is implemented, and no evaluation score has been assigned.
- The 85/100 quality target in the original specification is a target, not a measured score.

## Specification archive

The complete 26-part specification that this repository implements is preserved under [frontier-engineer-docs/](../frontier-engineer-docs/fe/README.md). Where this documentation and the archive disagree, [the verification record](27-OFFICIAL-FORMAT-VERIFICATION.md) and the official Antigravity documentation take precedence.
