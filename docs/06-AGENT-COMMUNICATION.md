# Part 06 — Agent communication and handoff protocol

## Design principle

The handoff contract is a **platform-independent data contract**. It is not a claim that any platform natively validates or transports it. On Antigravity the coordinator places the handoff fields in the initial prompt of a verified `invoke_subagent` call and reads the specialist's result message; elsewhere it can be carried as a sequential workflow document. See [the canonical contract](../specs/handoff-contract.md) and its [machine-readable schema](../schemas/handoff.schema.json).

Use structured JSON internally where useful. Do not force JSON into user-facing responses.

## Coordinator-to-specialist handoff

| Field                  | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `taskId`               | Stable identifier shared by every handoff and response for one task |
| `requestSummary`       | The developer's request in one or two sentences                     |
| `objective`            | What this specialist must achieve                                   |
| `repositoryContext`    | Verified facts, with assumptions labelled                           |
| `scope`                | In-scope components or files                                        |
| `constraints`          | Conventions, prohibited changes, environment limits                 |
| `relevantFiles`        | Files the specialist must inspect                                   |
| `expectedDeliverables` | Concrete outputs expected back                                      |
| `acceptanceCriteria`   | Conditions defining a satisfactory result                           |
| `risks`                | Known risks and sensitivities                                       |
| `requiredVerification` | Checks that must actually be run                                    |

The envelope also carries `contract: "frontier-engineer/handoff"` and `version: 1`. A checked example is in [specs/handoff-examples.json](../specs/handoff-examples.json).

## Specialist-to-coordinator response

| Field                 | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `taskId`              | Must match the originating handoff                      |
| `findings`            | Evidence-based observations                             |
| `workCompleted`       | Work actually performed, or recommendations if advisory |
| `filesAffected`       | Files read or changed                                   |
| `decisions`           | Decisions made with rationale                           |
| `risks`               | Risks, including anything unverified                    |
| `verification`        | `commands`, `outcomes`, `testStates`                    |
| `unresolvedQuestions` | Items needing the coordinator or developer              |
| `handoffStatus`       | `complete`, `partial`, or `blocked`                     |

The envelope carries `contract: "frontier-engineer/response"` and `version: 1`.

## Contract rules

1. A response without a matching `taskId` is rejected by the coordinator.
2. Findings must distinguish verified facts from assumptions.
3. `testStates` may only contain `not written`, `not executed`, `passed`, `failed`, `blocked`, or `not applicable`.
4. `handoffStatus: blocked` requires a reason in `risks` or `unresolvedQuestions`.
5. Specialists never route work directly to one another; all routing goes through the coordinator.
6. The coordinator reconciles conflicting responses and records the decision.
7. Never report an unexecuted check as passed and never fabricate a command outcome.

## Transport on Antigravity

Verified platform behavior: `invoke_subagent` spawns a concurrent session with a clean context; subagents can inherit, branch, or share workspaces; agents communicate by messages addressed to conversation IDs; idle subagents re-awaken on a new message; nesting is limited to 10 levels; permission requests bubble up to the main UI.

The contract is layered **on top** of these mechanisms as a convention. Antigravity does not validate the contract schema, and no runtime round trip has been tested in Phase 2.

## Validation

`npm run validate` checks both example envelopes against [the schema](../schemas/handoff.schema.json). The unit tests cover missing fields, invalid test states, and invalid `handoffStatus` values. A handoff that fails validation is a build error, so the contract cannot silently drift from its schema.
