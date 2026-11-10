# ADR-002: Canonical-first agent system

- **Status:** Accepted
- **Date:** 2026-11-10
- **Phase:** 2
- **Related:** [Part 04](../04-AGENT-SPECIFICATIONS.md), [Part 07](../07-AGENT-PORTABILITY.md), [ADR-001](ADR-001-foundation.md)

## Context

Phase 2 must deliver six specialist agents as a coherent engineering team, while the specification requires portability across Antigravity, Claude Code, Codex, Cursor, and Windsurf. Writing six platform-specific prompt files would couple the system's intelligence to one vendor and make future adapters require six more copies of the same instructions.

## Decisions

### 1. Canonical specifications are the single source of truth

Each agent has a platform-neutral Markdown specification in `specs/agents/` with eleven mandatory sections and structured frontmatter. `platformConfig` is required and must be an empty object; the validator rejects any other value. Platform configuration lives only in adapters and generated output.

**Consequence:** every platform adapter is a translation, not a rewrite. Adding a platform never duplicates agent instructions.

### 2. Generated Antigravity agents, not hand-maintained files

`scripts/generate-antigravity-agents.ts` produces all six files in `agents/`. Generated files carry a "do not edit" notice. `npm run generate:agents -- --check` and `npm run validate` compare generated content with the canonical source (semantic comparison, tolerant of formatting-only drift).

**Consequence:** the six loader-visible files cannot drift from their specifications without failing CI.

### 3. Only verified frontmatter fields are emitted

Generated frontmatter uses `name`, `description`, `mainAgent`, `subagent`, `model`, and `commandExecutionPolicy`. The coordinator is `mainAgent: true, subagent: false`; specialists are `mainAgent: false, subagent: true`. `agy plugin validate --strict .` reports `components.agents: 6` with zero findings.

**Consequence:** the plugin loader recognises all six agents, but runtime invocation remains untested.

### 4. `tools` allowlists are deliberately omitted

The official custom subagents reference lists `tools` with a default of `[]`, while the plugin guide states the default is all tools. Both warn that an unmapped or misspelled tool name may hang a subagent, and no authoritative enumeration of tool identifiers was found. Emitting an unverified allowlist could silently break delegation.

**Consequence:** least privilege is enforced behaviourally through `commandExecutionPolicy: sandbox`, read-only role restrictions, explicit file ownership, and human approval gates. Per-agent capability requirements are recorded in canonical frontmatter and [Part 05](../05-AGENT-COORDINATION.md). Verified tool allowlists are deferred until the identifiers can be confirmed locally. This is a known limitation, not a claim of equivalence.

### 5. The handoff contract is a convention, not a platform API

A structured JSON contract with a schema covers both directions of communication. On Antigravity the coordinator carries it in the `invoke_subagent` prompt and reads the result message; the platform does not validate it.

**Consequence:** no claim is made that Antigravity natively enforces the contract. Both example envelopes are schema-validated in CI.

### 6. Evaluation scenarios are defined but unscored

Nineteen scenarios and an eight-dimension rubric exist in `specs/evaluation/scenarios.json`. `status` is locked to `defined` by the validator.

**Consequence:** no performance score can be published until evaluations are actually executed and recorded.

### 7. Document numbering collision resolved by renumbering

Phase 1 created `docs/06-ENGINEERING-PRINCIPLES.md`. Phase 2 requires `docs/06-AGENT-COMMUNICATION.md`. The principles document was moved to `docs/09-ENGINEERING-PRINCIPLES.md` and all references updated, so each part number is unique.

**Consequence:** no duplicate part numbers; the original specification archive remains untouched.

### 8. Version bumped to 0.2.0

`plugin.json` and `package.json` move together from 0.1.0 to 0.2.0, matching the phase increment. An integration test enforces that the two versions stay in sync.

## Alternatives considered

| Alternative                                      | Rejected because                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Six standalone Antigravity prompt files          | Couples intelligence to one platform; no portability                   |
| Duplicate instructions per platform adapter      | Six times the maintenance and guaranteed drift                         |
| Emit `tools` allowlists from documented examples | Official docs conflict on defaults and warn of hangs on unmapped names |
| Claim native handoff validation                  | Antigravity transports messages but does not validate our schema       |
| Publish evaluation scores now                    | No evaluation was executed; would be a fabricated result               |
| Keep two Part 06 documents                       | Confusing documentation index                                          |

## Verified

Plugin manifest and component discovery (`agents: 6`), agent frontmatter schema, `invoke_subagent` delegation semantics, clean subagent context, concurrent execution, message-based inter-agent communication, nesting limit, and `agy plugin validate --strict .` behaviour. Sources in [Part 24](../24-OFFICIAL-FORMAT-VERIFICATION.md).

## Not verified

Runtime agent invocation, real specialist delegation, handoff round trips, tool allowlist identifiers, and any non-Antigravity adapter.
