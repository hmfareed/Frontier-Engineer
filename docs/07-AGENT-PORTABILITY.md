# Part 07 — Portability and adapter architecture

## Separation of concerns

| Layer                   | Location                                                                                                                         | Contains                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical specification | [specs/agents/](../specs/agents/)                                                                                                | Identity, purpose, responsibilities, instructions, inputs, outputs, decision procedures, handoff protocol, tool requirements, deliverables, restrictions |
| Shared contracts        | [specs/handoff-contract.md](../specs/handoff-contract.md), [specs/evaluation/scenarios.json](../specs/evaluation/scenarios.json) | Communication and evaluation definitions independent of any platform                                                                                     |
| Adapter registry        | [specs/adapters/README.md](../specs/adapters/README.md)                                                                          | Per-platform status and the adapter contract                                                                                                             |
| Platform adapter        | [specs/adapters/antigravity.md](../specs/adapters/antigravity.md)                                                                | Verified format mapping, deliberate omissions, delegation notes                                                                                          |
| Generated output        | [agents/](../agents/)                                                                                                            | Loader-visible Antigravity agent definitions                                                                                                             |

Canonical frontmatter requires `platformConfig: {}` and the validator rejects any other value. An adapter is a **translation**, never a second copy of the agent instructions.

## Adapter contract

Every adapter must read all six canonical specs, emit one agent definition per spec in the target platform's verified format, preserve the canonical `summary` as the delegation description, map capability and approval requirements to native controls where they exist and to prompt-level restrictions where they do not, reference the shared handoff contract without duplicating instructions, and be reproducible and checkable in CI.

The [Antigravity generator](../scripts/generate-antigravity-agents.ts) implements this. `npm run generate:agents` writes the files; `npm run generate:agents -- --check` verifies they are current. `npm run validate` enforces the same freshness check.

## Adapter status

| Platform    | Status                                                           | Document                                           |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Antigravity | **Implemented** (format verified; runtime invocation not tested) | [antigravity.md](../specs/adapters/antigravity.md) |
| Claude Code | **NOT IMPLEMENTED**                                              | [claude-code.md](../specs/adapters/claude-code.md) |
| Codex       | **NOT IMPLEMENTED**                                              | [codex.md](../specs/adapters/codex.md)             |
| Cursor      | **NOT IMPLEMENTED**                                              | [cursor.md](../specs/adapters/cursor.md)           |
| Windsurf    | **NOT IMPLEMENTED**                                              | [windsurf.md](../specs/adapters/windsurf.md)       |

The four unimplemented documents record the compatibility requirements that must be verified — agent definition location, definition format, delegation primitive, tool restriction syntax, context isolation, rules and skills discovery, and handoff transport. They deliberately do **not** assert unverified file paths, frontmatter keys, or APIs. The validator fails the build if any unimplemented adapter loses its `NOT IMPLEMENTED` label.

## Features that may not translate directly

- The `mainAgent` / `subagent` role split and the `invoke_subagent` lifecycle.
- Concurrent specialists with clean contexts and independent model tiers.
- `commandExecutionPolicy: sandbox` semantics.
- Parent-controlled cancellation, idle re-awakening, and the 10-level nesting limit.
- Plugin-level namespacing of skills and MCP servers inside one distributable bundle.
- Message-based peer communication between specialists.

Where a platform has no native delegation primitive, the documented fallback is a **sequential role workflow** in which the coordinator carries the handoff contract explicitly. That fallback must be labelled a workflow, never native orchestration.

## Rules

1. Do not assume formats from other agent platforms are compatible.
2. Do not claim an adapter works before it is implemented and tested locally.
3. Do not copy the six canonical specifications into a platform folder.
4. Verify exact file names, frontmatter keys, and delegation APIs against official documentation first.
5. Record the source URL, version, and date for every format claim in [Part 24](24-OFFICIAL-FORMAT-VERIFICATION.md).
