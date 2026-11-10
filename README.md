# Frontier Engineer

An AI software-engineering **agent system** distributed as a Google Antigravity plugin. It packages a coordinating agent, specialist subagents, reusable skills, persistent rules, and verification tooling into one versioned, installable unit.

> **Status: Phase 1 — Foundation.** The plugin manifest, toolchain, validation utilities, tests, and documentation are in place. The six agents and ten skills are intentionally not implemented yet; they belong to Phase 2 and Phase 3.

## What this is

Frontier Engineer is a set of Markdown instructions, JSON configuration, and TypeScript validation utilities. It is **not** a web application: there is no React frontend, no backend API, and no database. Antigravity supplies the runtime, the model, the tools, and the agent loop.

The system is built around one rule: **never claim work is done without evidence**. Agents must inspect before editing, verify before reporting, distinguish assumptions from facts, and pause for human approval on consequential actions.

## Repository layout

| Path                                                           | Purpose                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| [plugin.json](plugin.json)                                     | Antigravity plugin manifest (verified schema)                 |
| [agents/](agents/)                                             | Custom agents and subagents — Phase 2                         |
| [skills/](skills/)                                             | Reusable engineering skills — Phase 3                         |
| [rules/](rules/)                                               | Always-on engineering principles — Phase 4 extends            |
| [scripts/](scripts/)                                           | TypeScript validation utilities                               |
| [schemas/](schemas/)                                           | Local schema transcriptions of verified Antigravity formats   |
| [tests/](tests/)                                               | Unit and integration tests                                    |
| [docs/](docs/README.md)                                        | Product documentation                                         |
| [assets/](assets/)                                             | Plugin logo                                                   |
| [frontier-engineer-docs/](frontier-engineer-docs/fe/README.md) | Original 26-part specification archive (unmodified reference) |

## Getting started

Requires Node.js 22.6+ (native TypeScript execution) and npm.

```bash
npm install
npm run verify
```

`npm run verify` runs the type check, foundation validation, unit tests, formatting check, and Markdown lint. To validate the plugin itself with the installed Antigravity CLI:

```bash
agy plugin validate --strict .
```

The CLI binary is `agy`. On Windows it is installed at `~/.gemini/bin/agy.exe`; if it is not on `PATH`, use the full path.

## Documentation

- [Project overview](docs/01-PROJECT-OVERVIEW.md)
- [Technology stack](docs/02-TECHNOLOGY-STACK.md)
- [System architecture](docs/03-SYSTEM-ARCHITECTURE.md)
- [Engineering principles](docs/06-ENGINEERING-PRINCIPLES.md)
- [Repository structure](docs/15-REPOSITORY-STRUCTURE.md)
- [Official format verification](docs/24-OFFICIAL-FORMAT-VERIFICATION.md)
- [ADR-001: Foundation](docs/adr/ADR-001-foundation.md)
- [Documentation index](docs/README.md)

Project policies: [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), [Changelog](CHANGELOG.md), [License](LICENSE).

## Verified vs proposed

Everything in this repository that claims Antigravity compatibility is recorded in [docs/24-OFFICIAL-FORMAT-VERIFICATION.md](docs/24-OFFICIAL-FORMAT-VERIFICATION.md) with sources and dates. **Antigravity has not been shown to discover, load, or execute Frontier Engineer yet** — installation and runtime discovery are deliberately deferred to a later phase.

## License

MIT. See [LICENSE](LICENSE).
