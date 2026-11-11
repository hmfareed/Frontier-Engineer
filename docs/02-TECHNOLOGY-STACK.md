# Part 02 — Technology stack

## Runtime

| Technology         | Role                                           |
| ------------------ | ---------------------------------------------- |
| Google Antigravity | Agent runtime, model access, tools, agent loop |
| Gemini models      | Underlying model, selected by Antigravity      |
| `agy` CLI          | Plugin validation, installation, agent listing |

Locally verified: `agy` 1.5.0 at `~/.gemini/bin/agy.exe` on Windows. See [the verification record](27-OFFICIAL-FORMAT-VERIFICATION.md).

## Authoring formats

| Format           | Used for                                                       |
| ---------------- | -------------------------------------------------------------- |
| Markdown         | Agent system prompts, skill instructions, rules, documentation |
| YAML frontmatter | Agent, skill, and rule metadata                                |
| JSON             | `plugin.json`, `mcp_config.json`, `hooks.json`, local schemas  |

Markdown and YAML are the native authoring formats for Antigravity customizations. They are inspectable, version-controllable, portable, and directly readable by the agent. TypeScript is **not** used to define agents or skills.

## Development toolchain

| Tool              | Purpose                                          |
| ----------------- | ------------------------------------------------ |
| Node.js 22 LTS    | Runtime for validation scripts                   |
| npm               | Dependency management and lockfile               |
| TypeScript        | Static type checking of supporting scripts       |
| Vitest            | Unit and integration tests                       |
| Ajv               | JSON Schema validation of manifests and metadata |
| `yaml`            | YAML and frontmatter parsing                     |
| Prettier          | Formatting                                       |
| markdownlint-cli2 | Markdown quality checks                          |
| Git               | Version control                                  |

Node.js 22.6+ executes `.ts` files directly through native type stripping, so no bundler, transpiler, or runtime TypeScript dependency is required. `tsc` is used only for `--noEmit` static checking.

## Schema transcriptions

The schemas in [schemas/](../schemas/) are local draft-07 transcriptions of the constraints documented by Antigravity. They exist so validation works offline and in CI without network access. They are **not** the official hosted schema. `agy plugin validate --strict .` is authoritative.

## Explicitly excluded

- Next.js, React, or any frontend framework.
- Backend APIs and databases.
- A custom plugin runtime or agent orchestrator.
- Runtime npm dependencies.

Antigravity already provides the runtime, tool execution, delegation, and model access. Reimplementing any of them would add complexity without adding capability.

## Optional integrations (Phase 5)

Playwright MCP, GitHub MCP, Context7, and Chrome DevTools MCP remain optional and independently configurable. They are not part of the foundation and no integration is enabled by default.
