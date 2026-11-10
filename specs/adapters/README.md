# Platform adapter registry

Canonical agent specifications live in [specs/agents/](../agents/) and contain **no platform configuration** (`platformConfig` must be an empty object). Adapters translate those specifications into a platform's agent format.

| Platform    | Adapter document                 | Status                                         |
| ----------- | -------------------------------- | ---------------------------------------------- |
| Antigravity | [antigravity.md](antigravity.md) | **Implemented** — generated files in `agents/` |
| Claude Code | [claude-code.md](claude-code.md) | NOT IMPLEMENTED — requirements only            |
| Codex       | [codex.md](codex.md)             | NOT IMPLEMENTED — requirements only            |
| Cursor      | [cursor.md](cursor.md)           | NOT IMPLEMENTED — requirements only            |
| Windsurf    | [windsurf.md](windsurf.md)       | NOT IMPLEMENTED — requirements only            |

Only the Antigravity adapter is implemented in Phase 2, because it is the only format verified against official documentation and a locally installed CLI. No other adapter is claimed to work. Each unimplemented adapter document records the **compatibility requirements that must be verified** before an adapter is built; it deliberately does not assert unverified file paths, frontmatter keys, or delegation APIs.

## Adapter contract

An adapter must, at minimum:

1. Read every canonical specification in `specs/agents/`.
2. Emit one agent definition per specification in the target platform's verified format.
3. Preserve the canonical `summary` as the platform's delegation description.
4. Map canonical capability and approval requirements to platform-native controls where they exist, and to prompt-level restrictions where they do not.
5. Reference the shared [handoff contract](../handoff-contract.md) without duplicating the agent instructions.
6. Be reproducible and checkable in CI so generated files cannot drift from their canonical source.

The [Antigravity generator](../../scripts/generate-antigravity-agents.ts) implements this contract. Adding another platform means adding a generator that consumes the same canonical specs, not copying the six specifications.

## Generation

```bash
npm run generate:agents
npm run generate:agents -- --check
```

The `--check` mode compares generated content against the files on disk and exits non-zero if anything is stale or missing. `npm run validate` enforces the same check.
