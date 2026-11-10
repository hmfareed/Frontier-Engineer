# Part 01 — Project overview

## Identity

| Property              | Value                                |
| --------------------- | ------------------------------------ |
| Product               | Frontier Engineer                    |
| Category              | AI software-engineering agent system |
| Distribution          | Google Antigravity plugin            |
| Execution environment | Antigravity App, CLI, or IDE         |
| Current version       | 0.2.0 (Phase 2 agent system)         |
| Target release        | 1.0.0 (Phase 10)                     |

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
- Building a React, Next.js, or database-backed application.

## Target users

Independent developers, full-stack engineers, frontend and backend engineers, technical founders, engineering teams, and developers maintaining complex production applications.

## Phase status

Phase 1 established a clean, documented, tested, secure foundation compatible with verified Antigravity conventions: the plugin manifest, repository structure, toolchain, validation utilities, tests, security policy, and architecture documentation.

Phase 2 added six platform-independent canonical agent specifications, a generator that emits their Antigravity adapters, a structured handoff contract, delegation and conflict-prevention policies, a capability matrix, nineteen unscored evaluation scenarios, and adapter requirements for four other platforms. See [Part 04](04-AGENT-SPECIFICATIONS.md).

Still deliberately deferred: the ten skills (Phase 3), the full rule set (Phase 4), MCP integrations (Phase 5), lifecycle hooks (Phase 6), project intelligence and memory (Phase 7), and release packaging (Phases 9–10).

## Current limitations

- Installation and runtime invocation of the plugin's agents inside Antigravity have not been tested, although static discovery is verified.
- Real specialist delegation and handoff round trips have not been exercised.
- `mcp_config.json` and `hooks.json` are intentionally absent. Their schemas are available for validation when the components are added.
- `tools` allowlists are not emitted; see [Part 04](04-AGENT-SPECIFICATIONS.md) for the reason.
- No adapter other than Antigravity is implemented, and no evaluation score has been assigned.
- The 85/100 quality target in the original specification is a target, not a measured score.

## Specification archive

The complete 26-part specification that this repository implements is preserved under [frontier-engineer-docs/](../frontier-engineer-docs/fe/README.md). Where this documentation and the archive disagree, [the verification record](24-OFFICIAL-FORMAT-VERIFICATION.md) and the official Antigravity documentation take precedence.
