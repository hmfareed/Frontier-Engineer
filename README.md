# Frontier Engineer

An AI software-engineering **agent system** distributed as a Google Antigravity plugin. It packages a coordinating agent, five specialist subagents, reusable skills, persistent rules, and verification tooling into one versioned, installable unit.

> **Status: Phase 2 — Specialized agent system.** Six canonical agent specifications and their generated Antigravity adapters are in place, along with the handoff contract, coordination policy, evaluation scenarios, and portability architecture. The ten skills (Phase 3), MCP integrations (Phase 5), and hooks (Phase 6) are intentionally not implemented yet.

## What this is

Frontier Engineer is a set of Markdown instructions, JSON configuration, and TypeScript validation utilities. It is **not** a web application: there is no React frontend, no backend API, and no database. Antigravity supplies the runtime, the model, the tools, and the agent loop.

The system is built around one rule: **never claim work is done without evidence**. Agents must inspect before editing, verify before reporting, distinguish assumptions from facts, and pause for human approval on consequential actions.

## The six-agent architecture

| Agent                     | Role                                                                  | Mode               |
| ------------------------- | --------------------------------------------------------------------- | ------------------ |
| `frontier-engineer`       | Lead coordinator: classify, plan, delegate, reconcile, verify, report | primary agent      |
| `architect`               | System architecture, data models, API contracts, ADRs                 | read-only subagent |
| `implementation-engineer` | Focused frontend, backend, database and integration changes           | subagent           |
| `security-auditor`        | Independent, evidence-based security review                           | read-only subagent |
| `qa-engineer`             | Test strategy, execution, and honest verification reporting           | subagent           |
| `design-engineer`         | UI/UX, accessibility, interaction states, design systems              | subagent           |

Agent intelligence lives in platform-independent canonical specs under [specs/agents/](specs/agents/). A generator produces the loader-visible Antigravity files in [agents/](agents/) from those specs, so instructions are never duplicated per platform. See [the agent specifications](docs/04-AGENT-SPECIFICATIONS.md) and [the portability architecture](docs/07-AGENT-PORTABILITY.md).

## Repository layout

| Path                                                               | Purpose                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [plugin.json](plugin.json)                                         | Antigravity plugin manifest (verified schema)                 |
| [agents/](agents/)                                                 | Generated Antigravity agent definitions (do not edit by hand) |
| [specs/agents/](specs/agents/)                                     | Canonical platform-independent agent specifications           |
| [specs/adapters/](specs/adapters/README.md)                        | Adapter registry and per-platform requirements                |
| [specs/evaluation/scenarios.json](specs/evaluation/scenarios.json) | Defined evaluation scenarios (unscored)                       |
| [skills/](skills/)                                                 | Reusable engineering skills — Phase 3                         |
| [rules/](rules/)                                                   | Always-on engineering principles — Phase 4 extends            |
| [scripts/](scripts/)                                               | TypeScript validation utilities and the agent generator       |
| [schemas/](schemas/)                                               | Local schema transcriptions and contract schemas              |
| [tests/](tests/)                                                   | Unit and integration tests                                    |
| [docs/](docs/README.md)                                            | Product documentation                                         |
| [assets/](assets/)                                                 | Plugin logo                                                   |
| [frontier-engineer-docs/](frontier-engineer-docs/fe/README.md)     | Original 26-part specification archive (unmodified reference) |

## Getting started

Requires Node.js 22.6+ (native TypeScript execution) and npm.

```bash
npm install
npm run verify
```

`npm run verify` runs the type check, full validation, unit tests, formatting check, and Markdown lint. After editing a canonical agent spec, regenerate the adapters:

```bash
npm run generate:agents
npm run generate:agents -- --check
```

To validate the plugin itself with the installed Antigravity CLI:

```bash
agy plugin validate --strict .
```

The CLI binary is `agy`. On Windows it is installed at `~/.gemini/bin/agy.exe`; if it is not on `PATH`, use the full path.

## Documentation

- [Agent specifications](docs/04-AGENT-SPECIFICATIONS.md)
- [Agent coordination](docs/05-AGENT-COORDINATION.md)
- [Agent communication](docs/06-AGENT-COMMUNICATION.md)
- [Agent portability](docs/07-AGENT-PORTABILITY.md)
- [Agent evaluation](docs/08-AGENT-EVALUATION.md)
- [Project overview](docs/01-PROJECT-OVERVIEW.md), [Technology stack](docs/02-TECHNOLOGY-STACK.md), [System architecture](docs/03-SYSTEM-ARCHITECTURE.md)
- [Engineering principles](docs/09-ENGINEERING-PRINCIPLES.md)
- [Repository structure](docs/15-REPOSITORY-STRUCTURE.md), [Official format verification](docs/24-OFFICIAL-FORMAT-VERIFICATION.md)
- [ADR-001](docs/adr/ADR-001-foundation.md), [ADR-002](docs/adr/ADR-002-agent-system.md), [Documentation index](docs/README.md)

Project policies: [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), [Changelog](CHANGELOG.md), [License](LICENSE).

## Verified vs proposed

`agy plugin validate --strict .` recognises six agents and one rule with zero findings. Everything that claims Antigravity compatibility is recorded in [the verification record](docs/24-OFFICIAL-FORMAT-VERIFICATION.md) with sources and dates.

**Runtime invocation, actual specialist delegation, and handoff round trips have not been tested.** No non-Antigravity adapter is implemented, and no evaluation score has been assigned. Installation and runtime discovery remain deliberately deferred.

## License

MIT. See [LICENSE](LICENSE).
