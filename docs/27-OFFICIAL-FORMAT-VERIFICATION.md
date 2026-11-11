# Part 27 — Official format verification

Completed during Phase 1 on **2026-11-10**. Every row records a source, a version or date, a result, and a note. Results use the specification's vocabulary: **Confirmed** (documented and tested locally), **Documented only** (official docs, not yet exercised), **Not supported**, and **Unclear** (blocked).

An earlier desk review assumed `plugin.json` was borrowed from another agent platform. Verification disproved this: Antigravity has a first-class plugin system. This record supersedes that assumption.

## Local environment

| Item                 | Finding                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| Node.js              | v22.22.2 (native TypeScript execution confirmed)                               |
| npm                  | 10.9.7                                                                         |
| Git                  | 2.55.0.windows.3                                                               |
| Antigravity CLI      | `agy` 1.5.0 at `~/.gemini/bin/agy.exe` — not on `PATH` in Git Bash             |
| CLI command          | `agy plugin validate [path] [--strict] [--json]` confirmed from local `--help` |
| Global config        | `~/.gemini/config/` with real installed plugins                                |
| Installed references | `~/.gemini/antigravity/builtin/skills/agy-customizations/docs/*.md`            |

## Checklist

| #   | Item                                       | Source consulted                                                         | Version / date     | Result                                     | Notes                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------ | ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Plugin manifest filename, location, schema | `antigravity.google/docs/build-plugins`, `docs/plugins`                  | checked 2026-11-10 | **Confirmed**                              | `plugin.json` at `<plugin-root>` or `.antigravity-plugin/plugin.json`. Official JSON Schema at `antigravity.google/schemas/v1/plugin.json`; only `name` required by the schema. A probe manifest passed `agy plugin validate --strict --json` with 0 errors and 0 warnings.                                                                   |
| 2   | Plugin root directory requirements         | `docs/build-plugins`, installed `~/.gemini/config/plugins/*/plugin.json` | checked 2026-11-10 | **Confirmed**                              | Components (`skills/`, `agents/`, `rules/`, `scripts/`, `mcp_config.json`, `hooks.json`) sit at the plugin root. Workspace install path is `.agents/plugins/<folder>/`; global is `~/.gemini/config/plugins/`.                                                                                                                                |
| 3   | Agent definition format and metadata       | `docs/subagents`, `docs/build-plugins`                                   | checked 2026-11-10 | **Confirmed**                              | Markdown `.md` with YAML frontmatter; body is the system prompt. `name` and `description` required; optional `tools`, `mainAgent`, `subagent`, `model`, `commandExecutionPolicy`, `skills`, `plugins`, `mcpServers`, `inheritMcp`, `inheritCustomizations`.                                                                                   |
| 4   | Agent discovery locations                  | `docs/subagents`, `docs/customization-discovery`                         | checked 2026-11-10 | **Confirmed**                              | `agents/<name>.md` or `agents/<name>/agent.md` inside a plugin, `.agents/agents/` (workspace), or `~/.gemini/config/agents/` (global). One-level scan; `agents.json` registers extras.                                                                                                                                                        |
| 5   | Delegation between agents                  | `docs/subagents`, `docs/plugins`                                         | checked 2026-11-10 | **Documented only**                        | `subagent: true` allows invocation via `invoke_subagent`; `agy agents` lists agents and `agy --agent <name>` selects one. Not yet exercised with this plugin's agents.                                                                                                                                                                        |
| 6   | Skill format and frontmatter               | `docs/skills`, `docs/build-plugins`, builtin `skills.md`                 | checked 2026-11-10 | **Confirmed**                              | `skills/<name>/SKILL.md`. General docs mark `name` optional (defaults to folder name); plugin docs mark it required and require it to match the folder. `description` always required. `disable-model-invocation`, `license`, `compatibility` optional.                                                                                       |
| 7   | Skill discovery and activation             | `docs/skills`, `docs/customization-discovery`                            | checked 2026-11-10 | **Confirmed**                              | Progressive disclosure: name and description loaded at startup, full `SKILL.md` on demand; `/<skill-name>` explicit invocation. Workspace `.agents/skills/`, global `~/.gemini/config/skills/`, plugin `skills/`. Plugin skills are namespaced `<plugin>:<skill>`.                                                                            |
| 8   | Rule discovery and frontmatter             | `docs/rules`, builtin `rules.md`                                         | checked 2026-11-10 | **Confirmed**                              | `AGENTS.md` / `GEMINI.md` (no frontmatter, always on), `.agents/rules/*.md`, plugin `rules/`. Named rules require `trigger`: `always_on`, `model_decision`, `glob`, `manual`. `description` required for `model_decision`; comma-separated string `globs` required for `glob`. Flat scan only; 24 KB per file, 20,000-token aggregate budget. |
| 9   | MCP configuration file and schema          | `docs/mcp`, `docs/build-plugins`, `developers.google.cn/knowledge/mcp`   | checked 2026-11-10 | **Confirmed**                              | `mcp_config.json` with `mcpServers` map. Each server needs one transport: `command` (stdio) or `serverUrl`/`url` (remote Streamable HTTP). Workspace `.agents/mcp_config.json`, global `~/.gemini/config/mcp_config.json`, plugin `<plugin-root>/mcp_config.json`. Remote `httpUrl` and legacy HTTP+SSE are unsupported.                      |
| 10  | Supported lifecycle hooks                  | `docs/hooks`, builtin `hooks.md`                                         | checked 2026-11-10 | **Confirmed**                              | `hooks.json` at plugin root (or `.agents/hooks.json`). Events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. Named hook groups; tool events use `matcher` + `hooks` wrapper; other events use flat handler arrays. Only `type: "command"` is supported.                                             |
| 11  | Supported CLI commands                     | local `agy.exe --help` and `agy.exe plugin --help`                       | v1.5.0, 2026-11-10 | **Confirmed**                              | `agy plugin list/install/uninstall/enable/disable/validate/import/link`. `validate` accepts `[path] [--strict] [--json]` and exits non-zero on errors, or warnings with `--strict`. `agy agents`, `/agents`, `/skills`, `/plugin` documented.                                                                                                 |
| 12  | Marketplace / distribution requirements    | `docs/build-plugins`, `docs/plugins`                                     | checked 2026-11-10 | **Documented only**                        | Marketplace-complete manifest needs `name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, plus `README.md` and a bundled logo. Submission goes through a partner intake form. No submission has been made.                                                                                                   |
| 13  | Persistent memory features                 | `docs/customization-discovery`, `docs/rules`                             | checked 2026-11-10 | **Not supported** (as native agent memory) | No native unlimited persistent agent memory was found. Use project-local files (ADRs, project profiles, progress logs) and rules. Antigravity's persisted state is configuration and Preferences, not engineering memory.                                                                                                                     |

## Result summary

- **Confirmed:** 10 items (1, 2, 3, 4, 6, 7, 8, 9, 10, 11).
- **Documented only:** 2 items (5, 12).
- **Not supported:** 1 item (13), with a documented fallback.
- **Unclear:** none blocking Phase 1.

## Explicitly unverified

These have **not** been tested and must not be claimed as working:

- `agy plugin install .` succeeding for this repository.
- Antigravity discovering this plugin's skills, agents, and rules at runtime.
- `invoke_subagent` delegation between Frontier Engineer agents.
- Hook execution against real tool calls (no `hooks.json` exists yet).
- MCP server connectivity for Playwright, GitHub, Context7, or Chrome DevTools.
- Marketplace acceptance or publication.

## Phase 2 additions (checked 2026-11-10)

| Item                                                                                                               | Source                                                     | Result              | Note                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoke_subagent` delegation, clean subagent context, workspace inherit/branch/share options, concurrent execution | `antigravity.google/docs/subagents`                        | **Documented only** | Verified as documented behavior, not exercised by this plugin                                                                                                                                                                                                              |
| Inter-agent messaging by conversation ID, idle re-awakening, 10-level nesting limit, permission bubbling           | `antigravity.google/docs/subagents`                        | **Documented only** | No runtime round trip performed                                                                                                                                                                                                                                            |
| `tools` allowlist default and identifiers                                                                          | `docs/subagents`, `docs/build-plugins`, `docs/permissions` | **Unclear**         | References conflict (`[]` versus all tools); permission docs use `action(target)` resources rather than tool names; the subagents reference warns that unmapped tool names can hang a subagent. No authoritative enumeration found, so allowlists are deliberately omitted |
| `model` values                                                                                                     | `docs/subagents`, `docs/build-plugins`                     | **Confirmed**       | Subagents reference lists `inherit`, `flash`, `pro`; plugin guide additionally lists `flash_lite`. Generated agents use `inherit` only                                                                                                                                     |
| `inheritMcp` / `inheritCustomizations`                                                                             | `docs/build-plugins` only                                  | **Unclear**         | Omitted from generated frontmatter; platform defaults used                                                                                                                                                                                                                 |
| Six generated agent definitions discovered                                                                         | local `agy plugin validate --strict --json .`              | **Confirmed**       | `components.agents: 6`, `findings: []`, exit 0                                                                                                                                                                                                                             |

The omission of `tools` is a deliberate, documented decision in [ADR-002](adr/ADR-002-agent-system.md), not an oversight.

## Phase 3 additions (checked 2026-11-10)

| Item                                                    | Source                                                           | Result                           | Note                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ten generated skill definitions discovered              | local `agy plugin validate --strict --json .`                    | **Confirmed**                    | `components.skills: 10`, `findings: []`, exit 0                                                    |
| Progressive disclosure via `references/` subdirectory   | builtin `skills.md` (`agy-customizations`), local CLI validation | **Confirmed**                    | Relative markdown links resolve cleanly; validated by official CLI and local link checker          |
| Canonical-first skills generation and drift check       | `scripts/generate-antigravity-skills.ts`, local test suite       | **Confirmed**                    | Compiles 10 canonical specs into 10 `SKILL.md` files + 10 reference guides; CI enforces zero drift |
| Skill evaluation scenarios defined (20 scenarios)       | `specs/evaluation/skill-scenarios.json`                          | **Confirmed** (schema validated) | Status locked to `defined`; no empirical scores assigned                                           |
| Runtime skill activation during live agent conversation | Antigravity agent runtime                                        | **Documented only**              | Verified by official discovery docs, not yet exercised in a recorded live user session             |

## Phase 4 additions (checked 2026-11-10)

| Item                                                    | Source                                                           | Result        | Note                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| Fourteen rule definitions discovered                    | local `agy plugin validate --strict --json .`                    | **Confirmed** | `components.rules: 14`, `findings: []`, exit 0                                                     |
| Flat scan discovery constraint for `rules/`             | local CLI validation & builtin `rules.md` (`agy-customizations`) | **Confirmed** | Antigravity scans `rules/*.md` one level deep; nested subdirectories ignored; flat output required |
| Always-on rule format (`rules/AGENTS.md`)               | local CLI validation & builtin `rules.md`                        | **Confirmed** | Rule without YAML frontmatter discovered as always-on rule                                         |
| Named rule frontmatter (`trigger: glob/model_decision`) | local CLI validation & `rule-frontmatter.schema.json`            | **Confirmed** | Glob patterns string and model decision descriptions validated cleanly                             |
| Canonical-first rules generation and drift check        | `scripts/generate-antigravity-rules.ts`, local test suite        | **Confirmed** | Compiles 13 modular specs + 1 global rule into 14 flat `rules/*.md` files; CI enforces zero drift  |

## Phase 5 additions (checked 2026-11-10)

| Item                                                  | Source                                                           | Result        | Note                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Five bundled MCP servers discovered                   | local `agy plugin validate --strict --json .`                    | **Confirmed** | `components.mcpServers: 5`, `findings: []`, exit 0                                                                              |
| Bundled MCP configuration location and format         | `mcp_config.json` at plugin root, local CLI validation           | **Confirmed** | Formatted as `mcpServers` object with `command` (stdio) and `args` array                                                        |
| Stdio environment variable inheritance                | local CLI strict mode validation                                 | **Confirmed** | Stdio servers inherit host process environment automatically; omitting undeclared variables from `env` prevents strict warnings |
| Default disabled state (`"disabled": true`)           | local CLI validation & `mcp_config.json`                         | **Confirmed** | Validated as active servers by CLI while remaining safely dormant until developer opts in                                       |
| Canonical-first integrations compiler and drift check | `scripts/generate-antigravity-integrations.ts`, local test suite | **Confirmed** | Compiles 5 canonical specs into `mcp_config.json` and `mcp_config.example.json`; CI enforces zero drift                         |

## Rules for future phases

1. Record the exact URL and date checked for any new format claim.
2. Prefer official Antigravity documentation and the installed built-in reference skill over third-party guides.
3. If an item is **Not supported**, implement the fallback through a documented workflow or validation script, and do not invent an API.
4. Re-run `agy plugin validate --strict .` after every phase that adds a component.
