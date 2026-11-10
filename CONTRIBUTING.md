# Contributing

## Principles

Frontier Engineer is a specification-driven plugin. Before changing anything:

1. Read the relevant documentation in [docs/](docs/README.md).
2. Distinguish verified Antigravity behavior from proposed design.
3. Never invent manifest fields, metadata keys, hook events, or CLI commands.
4. Preserve the original specification archive under `frontier-engineer-docs/` unmodified.

## Development setup

```bash
npm install
npm run verify
```

Node.js 22.6+ is required because validation scripts are executed directly as `.ts` files using Node's native type stripping. TypeScript is used for static checking only (`npm run typecheck`); no build output is produced.

## Before opening a change

Run, in order:

```bash
npm run typecheck
npm run validate
npm run test
npm run format:check
npm run lint:md
agy plugin validate --strict .
```

`npm run validate` exits non-zero on any **error**. Warnings and notes are reported but do not fail the command.

## Adding a component

| Component            | Location                 | Required metadata                                    |
| -------------------- | ------------------------ | ---------------------------------------------------- |
| Agent                | `agents/<name>.md`       | Generated — do not edit directly                     |
| Canonical agent spec | `specs/agents/<name>.md` | Canonical frontmatter plus eleven mandatory sections |
| Skill                | `skills/<name>/SKILL.md` | `name` matching the folder, `description`            |
| Rule                 | `rules/<name>.md`        | `trigger` plus conditional fields                    |
| Always-on rule       | `rules/AGENTS.md`        | No frontmatter                                       |

**Agent work starts in `specs/agents/`, never in `agents/`.** Edit a canonical specification, then regenerate:

```bash
npm run generate:agents
npm run generate:agents -- --check
```

Generated files are compared semantically against their canonical source, so formatting-only drift is tolerated but instruction drift fails validation. To add a new platform, add an adapter under `specs/adapters/` that consumes the same canonical specs; do not copy agent instructions. See [the portability guide](docs/07-AGENT-PORTABILITY.md).

The exact verified field sets and their sources are in [docs/24-OFFICIAL-FORMAT-VERIFICATION.md](docs/24-OFFICIAL-FORMAT-VERIFICATION.md). The schemas in [schemas/](schemas/) are local draft-07 transcriptions used for offline validation; `agy plugin validate --strict` remains authoritative.

Antigravity scans these directories one level deep. Nested components require a discovery manifest (`skills.json`, `rules.json`, or `agents.json`).

## Adding documentation

Every new file under `docs/` must be linked from [docs/README.md](docs/README.md). The validator enforces this.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.
