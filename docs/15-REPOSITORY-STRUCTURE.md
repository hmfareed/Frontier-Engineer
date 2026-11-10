# Part 15 — Repository structure

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
├── agents/                      # Phase 2: agents/<name>.md
├── skills/                      # Phase 3: skills/<name>/SKILL.md
├── rules/
│   └── AGENTS.md                # Always-on foundation rule
├── schemas/                     # Local verified-schema transcriptions
│   ├── plugin.schema.json
│   ├── skill-frontmatter.schema.json
│   ├── agent-frontmatter.schema.json
│   ├── rule-frontmatter.schema.json
│   ├── mcp-config.schema.json
│   └── hooks.schema.json
├── scripts/
│   ├── validate.ts
│   └── lib/                     # Pure, unit-testable check functions
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                # Deliberately invalid inputs
├── docs/                        # This documentation
│   └── adr/
├── .github/workflows/
│   └── validate.yml
└── frontier-engineer-docs/      # Original specification archive (unmodified)
```

## Component paths

| Component       | Verified path                                      | Status                    |
| --------------- | -------------------------------------------------- | ------------------------- |
| Manifest        | `plugin.json` or `.antigravity-plugin/plugin.json` | Present                   |
| Skills          | `skills/<name>/SKILL.md`                           | Directory prepared; empty |
| Custom agents   | `agents/<name>.md` or `agents/<name>/agent.md`     | Directory prepared; empty |
| Always-on rule  | `rules/AGENTS.md`                                  | Present                   |
| Named rules     | `rules/<name>.md` with `trigger` frontmatter       | Phase 4                   |
| MCP servers     | `mcp_config.json`                                  | Phase 5; absent           |
| Lifecycle hooks | `hooks.json`                                       | Phase 6; absent           |
| Helper scripts  | `scripts/`                                         | Present                   |

Antigravity scans `skills/`, `rules/`, and `agents/` **one level deep**. Nested components require a discovery manifest (`skills.json`, `rules.json`, `agents.json`). The validator warns when a component is placed too deep.

## Files intentionally absent

`mcp_config.json`, `hooks.json`, `skills.json`, `rules.json`, `agents.json`, and `plugins.json` are not present. Adding an unused config file would introduce configuration that has not been verified in a real installation. Their schemas exist so they can be validated the moment they are added.

Likewise, no `.claude-plugin/`, `.cursor-plugin/`, or `hooks/hooks.json` paths exist: those belong to other agent platforms or to staged extensions. The validator flags them.

## Design notes

- `frontier-engineer-docs/` is the input specification archive. It is preserved unmodified and excluded from formatting and Markdown linting.
- `tests/fixtures/` contains intentionally invalid files. All repository-wide scanners exclude it so that negative test cases do not fail production validation.
- `schemas/` are local offline transcriptions, not the official hosted schema. See [ADR-001](adr/ADR-001-foundation.md).
- No build output is produced. Validation scripts run directly as `.ts` files.
