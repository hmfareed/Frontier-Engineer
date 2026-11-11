# Part 20 — Repository structure

## Layout decision

The **repository root is the plugin root**. This is not a compromise: Antigravity's plugin format places component directories at `<plugin-root>`, which is exactly the logical organization the specification proposed.

There are two different customization scopes, and confusing them is the most common layout error:

| Scope                    | Where components live                                                                         | Used for                                |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| Workspace customizations | `<workspace>/.agents/skills/`, `.agents/rules/`, `.agents/agents/`, `.agents/mcp_config.json` | Customizations belonging to one project |
| Plugin                   | `<plugin-root>/skills/`, `rules/`, `agents/`, `mcp_config.json`, `hooks.json`, `plugin.json`  | A versioned, distributable bundle       |

Frontier Engineer is distributed as a plugin, so it uses the second layout. `.agents/` is **not** required inside this repository. To use the plugin in a project, install it with `agy plugin install <path>`, or place the plugin folder in `.agents/plugins/` (workspace) or `~/.gemini/config/plugins/` (global).

## Current tree

```text
frontier-engineer/
├── plugin.json                  # Required manifest
├── mcp_config.json              # Antigravity MCP server adapter (disabled by default)
├── mcp_config.example.json      # Example MCP environment variable setup guide
├── README.md                    # Pre-install documentation
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── .prettierrc.json
├── .prettierignore
├── .markdownlint-cli2.jsonc
├── .gitignore
├── .gitattributes
├── assets/
│   └── logo.svg
├── agents/                      # Generated Antigravity adapters (6 files)
├── specs/                       # Platform-independent source of truth
│   ├── agents/                  # Six canonical agent specifications
│   ├── skills/                  # Ten canonical skill specifications
│   │   └── references/          # Ten progressive-disclosure reference guides
│   ├── rules/                   # Canonical rule specifications
│   │   ├── engineering/         # General engineering, code quality, documentation
│   │   ├── frontend/            # Frontend standards, accessibility
│   │   ├── backend/             # Backend standards, API security
│   │   ├── database/            # Database standards, migration safety
│   │   ├── security/            # Security standards, secrets management
│   │   ├── testing/             # Testing standards
│   │   ├── performance/         # Performance standards
│   │   └── AGENTS.md            # Global foundation rule specification
│   ├── integrations/            # Five canonical MCP integration specifications
│   │   ├── README.md
│   │   ├── integration-registry.md
│   │   ├── github/              # integration.md, capabilities.md, security.md
│   │   ├── context7/            # integration.md, capabilities.md, security.md
│   │   ├── playwright/          # integration.md, capabilities.md, security.md
│   │   ├── sentry/              # integration.md, capabilities.md, security.md
│   │   └── database/            # integration.md, capabilities.md, security.md
│   ├── adapters/                # Adapter registry and per-platform requirements
│   ├── evaluation/              # Agent and skill evaluation scenarios
│   ├── handoff-contract.md
│   └── handoff-examples.json
├── skills/                      # Ten generated Antigravity skills (SKILL.md + references)
├── rules/                       # Fourteen generated Antigravity rules (1 global + 13 modular)
├── schemas/                     # Local verified-schema transcriptions and contracts
│   ├── plugin.schema.json
│   ├── skill-frontmatter.schema.json
│   ├── agent-frontmatter.schema.json
│   ├── rule-frontmatter.schema.json
│   ├── mcp-config.schema.json
│   ├── hooks.schema.json
│   ├── canonical-agent.schema.json
│   ├── canonical-skill.schema.json
│   ├── canonical-rule.schema.json
│   ├── canonical-integration.schema.json
│   ├── integration-registry.schema.json
│   ├── handoff.schema.json
│   ├── evaluation-scenarios.schema.json
│   └── skill-evaluation-scenarios.schema.json
├── scripts/
│   ├── validate.ts
│   ├── generate-antigravity-agents.ts
│   ├── generate-antigravity-skills.ts
│   ├── generate-antigravity-rules.ts
│   ├── generate-antigravity-integrations.ts
│   └── lib/                     # Pure, unit-testable check functions
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                # Deliberately invalid inputs
├── docs/                        # Project documentation (Parts 01-27, ADRs)
│   └── adr/
├── .github/workflows/
│   └── validate.yml
└── frontier-engineer-docs/      # Original specification archive (unmodified)
```

## Component paths

| Component       | Verified path                                      | Status                                    |
| --------------- | -------------------------------------------------- | ----------------------------------------- |
| Manifest        | `plugin.json` or `.antigravity-plugin/plugin.json` | Present                                   |
| Skills          | `skills/<name>/SKILL.md`                           | Ten generated, statically discovered      |
| Custom agents   | `agents/<name>.md` or `agents/<name>/agent.md`     | Six generated, statically discovered      |
| Always-on rule  | `rules/AGENTS.md`                                  | Present                                   |
| Named rules     | `rules/<name>.md` with `trigger` frontmatter       | Thirteen generated, statically discovered |
| MCP servers     | `mcp_config.json`                                  | Present (5 servers, disabled by default)  |
| Lifecycle hooks | `hooks.json`                                       | Phase 6; absent                           |
| Helper scripts  | `scripts/`                                         | Present                                   |

Antigravity scans `skills/`, `rules/`, and `agents/` **one level deep**. Nested components require a discovery manifest (`skills.json`, `rules.json`, `agents.json`). The validator warns when a component is placed too deep.

## Files intentionally absent

`hooks.json`, `skills.json`, `rules.json`, `agents.json`, and `plugins.json` are not present. Adding an unused config file would introduce configuration that has not been verified in a real installation. Their schemas exist so they can be validated the moment they are added.

Likewise, no `.claude-plugin/`, `.cursor-plugin/`, or `hooks/hooks.json` paths exist: those belong to other agent platforms or to staged extensions. The validator flags them.

## Design notes

- `frontier-engineer-docs/` is the input specification archive. It is preserved unmodified and excluded from formatting and Markdown linting.
- `tests/fixtures/` contains intentionally invalid files. All repository-wide scanners exclude it so that negative test cases do not fail production validation.
- `schemas/` are local offline transcriptions, not the official hosted schema. See [ADR-001](adr/ADR-001-foundation.md).
- No build output is produced. Validation scripts run directly as `.ts` files.
