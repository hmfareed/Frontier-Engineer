# Changelog

All notable changes to Frontier Engineer are documented here. This project follows [Semantic Versioning](https://semver.org/).

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

### Known limitations

- Antigravity installation, discovery, and runtime execution of this plugin have not been tested.
- `mcp_config.json` and `hooks.json` are intentionally absent; schemas exist so they can be validated when added.
