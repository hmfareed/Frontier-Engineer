# Changelog

All notable changes to Frontier Engineer are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.5.1] - 2026-11-11

MCP Provider Verification, Correction & Runtime Hardening (Phase 5.1).

### Added

- Controlled live runtime acceptance test harness (`scripts/test-mcp-runtime.ts`) exercising MCP server subprocesses via JSON-RPC 2.0 stdio handshakes and tool discovery.
- Empirical test suite additions banning legacy deprecated packages (`@modelcontextprotocol/server-*`) from runtime arguments across all canonical integrations.
- Ten mandatory defense-in-depth database invariants (`specs/integrations/database/security.md`) and a formal PostgreSQL provisioning script enforcing least-privilege boundaries (read-only user, no schema ownership, no DDL/DML, 5,000ms timeout, connection limit 2).
- Formal 5-tier permission enforcement matrix (Server, Host, Provider/Database, Behavioral Rules, Human Approval) documented across all integration security specifications.
- Phase 5.1 Provider Corrections Addendum in `docs/adr/ADR-005-mcp-integration-architecture.md` and verification record in `docs/27-OFFICIAL-FORMAT-VERIFICATION.md`.

### Changed

- Replaced deprecated `@modelcontextprotocol/server-github` with official `github/github-mcp-server` enforcing `--read-only=true` (server-side mutating tool rejection) and `--toolsets=context,issues,pull_requests,repos`.
- Pinned Context7 integration to Upstash `@upstash/context7-mcp` with exact verified tool names `resolve-library-id` and `query-docs`; lifecycle updated to `runtime_tested` following successful live stdio JSON-RPC handshake.
- Replaced community/deprecated Playwright packages with official `@playwright/mcp@latest` enforcing `--headless` and `--isolated` (in-memory profiles with zero access to personal developer browser state); lifecycle updated to `runtime_tested` following successful live stdio JSON-RPC handshake and 25-tool discovery.
- Replaced `@modelcontextprotocol/server-sentry` with official `@sentry/mcp-server` (`https://github.com/getsentry/sentry-mcp`) requiring `SENTRY_ACCESS_TOKEN`.
- Evaluated PostgreSQL MCP alternatives (`@microsoft/postgres-mcp` vs `antonorlov/mcp-postgres-server`), standardizing on `@microsoft/postgres-mcp` with `POSTGRES_MCP_CONNECTION_STRING` under 10 strict invariants.
- Regenerated Antigravity MCP adapter `mcp_config.json` and `mcp_config.example.json` with zero drift.
- `package.json` and `plugin.json` bumped to `0.5.1`.

### Known limitations

- Live runtime invocation of GitHub, Sentry, and PostgreSQL requires external user credentials (`GITHUB_PERSONAL_ACCESS_TOKEN`, `SENTRY_ACCESS_TOKEN`, `POSTGRES_MCP_CONNECTION_STRING`) or running Docker daemon; accurately classified as `BLOCKED` with empirical evidence in the runtime test harness.

## [0.5.0] - 2026-11-10

Secure MCP integration architecture (Phase 5).

### Added

- Secure Model Context Protocol (MCP) integration subsystem connecting Frontier Engineer to external tools across 5 categories: GitHub (`repository`), Context7 (`documentation`), Playwright (`browser_testing`), Sentry (`observability`), and PostgreSQL (`database`).
- Five canonical integration specifications under `specs/integrations/` (`github`, `context7`, `playwright`, `sentry`, `database`), each with a 3-tier modular structure: `integration.md`, `capabilities.md`, and `security.md`.
- Canonical schemas: `schemas/canonical-integration.schema.json` and `schemas/integration-registry.schema.json`.
- Central machine-readable integration registry at `specs/integrations/integration-registry.md` declaring all integrations, agent mappings, optionality, and fallback behaviors.
- Five-tier capability-based permission model (`read_only`, `reversible_write`, `external_side_effect`, `destructive`, `sensitive_data_access`) with human-in-the-loop gates for destructive actions and sensitive data access.
- TypeScript generator (`scripts/generate-antigravity-integrations.ts`) compiling canonical specifications into Antigravity adapter `mcp_config.json` (disabled by default, inheriting host environment) and `mcp_config.example.json`.
- Strict drift detection in `scripts/lib/canonical-integrations.ts` ensuring config files remain in sync with canonical specs.
- Official format verification with `agy plugin validate --strict .` recognizing 10 skills, 6 agents, 14 rules, and 5 MCP servers with zero warnings or errors.
- New architecture documentation: `docs/21-MCP-ARCHITECTURE.md`, `docs/22-MCP-INTEGRATIONS.md`, `docs/23-MCP-SECURITY.md`, `docs/24-MCP-CONFIGURATION.md`, `docs/25-MCP-PORTABILITY.md`, `docs/26-MCP-OPERATIONS.md`, and `docs/adr/ADR-005-mcp-integration-architecture.md`.
- Comprehensive automated test suite: `tests/unit/canonical-integrations-schema.test.ts`, `tests/unit/canonical-integrations.test.ts`, `tests/unit/integration-registry.test.ts`, and `tests/unit/integration-security.test.ts`.

### Changed

- Renumbered `docs/24-OFFICIAL-FORMAT-VERIFICATION.md` to `docs/27-OFFICIAL-FORMAT-VERIFICATION.md` to accommodate MCP architecture documentation block (Parts 21–26); updated all references across repository.
- `plugin.json` and `package.json` bumped to `0.5.0`.
- Coordinator and specialist agents updated with selective MCP capability mappings.
- Validation script and test runner updated to verify canonical integrations and drift.

### Known limitations

- External MCP servers require user installation of respective npm packages and optional API tokens.
- Integrations are shipped disabled by default (`"disabled": true`); developers must enable them selectively in `mcp_config.json`.
- Non-Antigravity adapters (Claude Code, Codex, Cursor) are specified in registry and documentation but not generated.

## [0.4.0] - 2026-11-10

Modular engineering rules system (Phase 4).

### Added

- Fourteen engineering rules: one global always-on foundation rule (`rules/AGENTS.md`) and thirteen modular rules across seven engineering categories (`engineering`, `frontend`, `backend`, `database`, `security`, `testing`, `performance`).
- Canonical platform-independent rule specifications under `specs/rules/` validated against `schemas/canonical-rule.schema.json`, each enforcing five mandatory sections (`Purpose`, `Scope and applicability`, `Core standards`, `Invariants and prohibitions`, and `Verification criteria`).
- A TypeScript generator (`scripts/generate-antigravity-rules.ts`) compiling canonical specifications into flat Antigravity-compatible files under `rules/<id>.md` and `rules/AGENTS.md`.
- Strict drift detection in `scripts/lib/canonical-rules.ts` checking frontmatter, normalized body content, and absence of unexpected or missing rule files.
- Official format verification with `agy plugin validate --strict .` recognizing 10 skills, 6 agents, and 14 rules with zero warnings or errors.
- New documentation: `docs/15-RULES-ARCHITECTURE.md`, `docs/16-RULE-SPECIFICATIONS.md`, `docs/17-RULE-ACTIVATION.md`, `docs/18-RULE-PRIORITY-AND-CONFLICTS.md`, `docs/19-RULE-PORTABILITY.md`, and `docs/adr/ADR-004-rules-system.md`.
- Comprehensive test coverage in `tests/unit/canonical-rules-schema.test.ts` and `tests/unit/canonical-rules.test.ts`.

### Changed

- `docs/15-REPOSITORY-STRUCTURE.md` moved to `docs/20-REPOSITORY-STRUCTURE.md` to cleanly accommodate the Rules System documentation block (Parts 15–19); all incoming links updated.
- `plugin.json` and `package.json` bumped to `0.4.0`.
- Validation script and test runner updated to verify canonical rules and generated adapters.

### Known limitations

- Path-triggered glob rules and model-decision rules depend on Antigravity runtime evaluation during live user sessions.
- Non-Antigravity rule adapters (Claude Code, Codex, Cursor) remain documented canonical targets but are not compiled.

## [0.3.0] - 2026-11-10

Portable engineering skills system (Phase 3).

### Added

- Ten platform-independent canonical skill specifications in `specs/skills/`, each containing ten mandatory sections, structured frontmatter, clear purpose, activation triggers, non-activation guidelines, operating procedures, engineering standards, verification requirements, and progressive disclosure references.
- Ten deep reference guides in `specs/skills/references/` providing concrete decision frameworks, trade-off matrices, vulnerability assessment checklists, code review rubrics, interaction state specifications, and benchmarking procedures.
- A TypeScript generator (`scripts/generate-antigravity-skills.ts`) that compiles canonical skills into runtime Antigravity adapters in `skills/<skill_name>/SKILL.md` with verified frontmatter (`name` and `description`) and synchronizes references.
- Twenty skill evaluation scenarios in `specs/evaluation/skill-scenarios.json` and schema `schemas/skill-evaluation-scenarios.schema.json` with a 6-dimension rubric. Status locked to `defined`; no scores claimed.
- Skill validation engine in `scripts/lib/canonical-skills.ts` enforcing schema conformity, required sections, and drift detection between canonical specs and generated adapters.
- New documentation: `docs/09-SKILLS-ARCHITECTURE.md`, `docs/10-SKILL-SPECIFICATIONS.md`, `docs/11-SKILL-ACTIVATION.md`, `docs/12-SKILL-AGENT-INTEGRATION.md`, `docs/13-SKILL-PORTABILITY.md`, and `docs/adr/ADR-003-skills-system.md`.
- Comprehensive test coverage in `tests/unit/canonical-skills-schema.test.ts`, `tests/unit/canonical-skills.test.ts`, and `tests/unit/skill-evaluation.test.ts`.

### Changed

- `docs/09-ENGINEERING-PRINCIPLES.md` moved to `docs/14-ENGINEERING-PRINCIPLES.md` to cleanly accommodate the Skills System documentation block (Parts 09–13); all incoming links updated.
- `plugin.json` and `package.json` bumped to `0.3.0`.
- Validation script and test runner updated to verify both canonical agents and canonical skills.

### Known limitations

- Runtime skill activation and multi-agent coordination during live user sessions have not been tested.
- Non-Antigravity adapters (Claude Code, Codex, Cursor, Windsurf) are documented with requirements but remain explicitly NOT IMPLEMENTED.
- No behavioral evaluation scores have been assigned.

## [0.2.0] - 2026-11-10

Specialized agent system (Phase 2).

### Added

- Six platform-independent canonical agent specifications in `specs/agents/`, each with eleven mandatory sections and structured frontmatter.
- A TypeScript generator (`scripts/generate-antigravity-agents.ts`) that produces the six loader-visible `agents/*.md` files, with a `--check` mode enforced by `npm run validate`.
- A structured handoff and response contract: `specs/handoff-contract.md`, `specs/handoff-examples.json`, and `schemas/handoff.schema.json`.
- Nineteen evaluation scenarios and an eight-dimension rubric in `specs/evaluation/scenarios.json`, validated by `schemas/evaluation-scenarios.schema.json`. Status is locked to `defined`; no scores are assigned.
- Adapter registry and requirements documents for Antigravity (implemented) plus Claude Code, Codex, Cursor, and Windsurf (all explicitly NOT IMPLEMENTED).
- New documentation: `docs/04` through `docs/08`, plus `ADR-002`.
- Validator checks for canonical specs, generated-file freshness, adapter status claims, contract examples, evaluation definitions, and agent name/filename consistency.

### Changed

- `docs/06-ENGINEERING-PRINCIPLES.md` moved to `docs/09-ENGINEERING-PRINCIPLES.md` to free Part 06 for agent communication; all references updated.
- `plugin.json` and `package.json` bumped to `0.2.0`.

### Known limitations

- `tools` allowlists are not emitted. Official documentation conflicts on the default and warns that unmapped tool names can hang subagents; least privilege is enforced behaviourally instead.
- Runtime agent invocation, real delegation, and handoff round trips have not been tested.
- No adapter other than Antigravity is implemented or claimed to work.

## [0.1.0] - 2026-11-10

Foundation release (Phase 1). This is a development version, not the `1.0.0` product release described in the specification.

### Added

- `plugin.json` using the verified Antigravity plugin manifest schema, plus a bundled logo asset.
- Repository structure: `agents/`, `skills/`, `rules/`, `scripts/`, `schemas/`, `tests/`, `docs/`, `assets/`, `.github/workflows/`.
- Node.js/TypeScript toolchain configuration: `package.json`, `tsconfig.json`, Prettier, markdownlint-cli2, Vitest, `.gitignore`, `.gitattributes`.
- TypeScript validation utilities covering required files, JSON syntax, verified plugin/skill/agent/rule schemas, optional MCP and hooks configs, YAML frontmatter, component metadata, Markdown links, documentation indexing, config placement, and secret hygiene.
- Unit and integration tests with deliberately invalid fixtures.
- Documentation: project overview, technology stack, system architecture, engineering principles, repository structure, official format verification, and ADR-001.
- `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, and a CI validation workflow.
- A single always-on foundational rule at `rules/AGENTS.md`.

### Deferred

- The six specialized agents (Phase 2), ten skills (Phase 3), full rule set (Phase 4), MCP integrations (Phase 5), hooks (Phase 6), project intelligence and memory (Phase 7), evaluation suite (Phase 8), and release packaging (Phase 9/10).
