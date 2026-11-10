# Part 01 — Project overview

## Identity

| Property              | Value                                |
| --------------------- | ------------------------------------ |
| Product               | Frontier Engineer                    |
| Category              | AI software-engineering agent system |
| Distribution          | Google Antigravity plugin            |
| Execution environment | Antigravity App, CLI, or IDE         |
| Current version       | 0.1.0 (Phase 1 foundation)           |
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

## Phase 1 scope

Phase 1 establishes a clean, documented, tested, secure foundation that is compatible with verified Antigravity conventions. It creates the plugin manifest, repository structure, toolchain, validation utilities, tests, security policy, and architecture documentation.

It deliberately does **not** implement the six agents, ten skills, MCP integrations, lifecycle hooks, project intelligence, or the evaluation suite. Those belong to Phases 2 through 9.

## Current limitations

- Installation, discovery, and runtime execution of the plugin inside Antigravity have not been tested.
- `mcp_config.json` and `hooks.json` are intentionally absent. Their schemas are available for validation when the components are added.
- The 85/100 quality target in the original specification is a target, not a measured score.

## Specification archive

The complete 26-part specification that this repository implements is preserved under [frontier-engineer-docs/](../frontier-engineer-docs/fe/README.md). Where this documentation and the archive disagree, [the verification record](24-OFFICIAL-FORMAT-VERIFICATION.md) and the official Antigravity documentation take precedence.
