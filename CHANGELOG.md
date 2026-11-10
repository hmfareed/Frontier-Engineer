# Changelog

All notable changes to Frontier Engineer are documented here. This project follows [Semantic Versioning](https://semver.org/).

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
