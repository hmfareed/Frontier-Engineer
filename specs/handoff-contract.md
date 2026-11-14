# Shared agent handoff contract

This contract is platform-independent. It defines the structured information the coordinator passes to a specialist and the structured response every specialist returns. It is a **data contract**, not a claim that any platform natively transports it. On Antigravity, the coordinator carries these fields in the initial prompt of an `invoke_subagent` call and reads them back from the specialist's result message. See [the Antigravity adapter](adapters/antigravity.md).

The machine-readable version is [schemas/handoff.schema.json](../schemas/handoff.schema.json). Use structured JSON internally where useful; do not force JSON into user-facing responses.

## Coordinator-to-specialist handoff

| Field                  | Type     | Meaning                                                                                      |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `taskId`               | string   | Stable identifier shared by every handoff and response for one task                          |
| `requestSummary`       | string   | The developer's request in one or two sentences                                              |
| `objective`            | string   | What this specific specialist must achieve                                                   |
| `repositoryContext`    | string   | Verified facts about the repository, with assumed items labelled                             |
| `scope`                | string[] | In-scope components or files                                                                 |
| `constraints`          | string[] | Conventions, prohibited changes, and time or environment limits                              |
| `relevantFiles`        | string[] | Files the specialist must inspect                                                            |
| `expectedDeliverables` | string[] | Concrete outputs expected back                                                               |
| `acceptanceCriteria`   | string[] | Conditions that define a satisfactory result                                                 |
| `risks`                | string[] | Known risks and sensitivities                                                                |
| `requiredVerification` | string[] | Checks that must actually be run                                                             |
| `retrievalContext`     | object   | Optional compact repository retrieval summary (`frontier-engineer/retrieval-attachment`, v1) |

A handoff also carries `contract: "frontier-engineer/handoff"` and `version: 1`. When present, `retrievalContext` supplies bounded, read-only, evidence-backed repository intelligence (`retrievalId`, `scanId`, `freshnessStatus`, `confidenceSummary`, `highlights`, `warnings`, and `budget`) without replacing required legacy fields (`repositoryContext`, `relevantFiles`). Coordinator delegation prompts generated via `prepare-handoff` / `prepareDelegationHandoff` wrap the JSON payload between `<<<FRONTIER_HANDOFF_JSON>>>` and `<<<END_FRONTIER_HANDOFF_JSON>>>` delimiters alongside explicit untrusted-data framing; consumers validate bundles with `validate-handoff` / `parseAndValidateHandoffBundle`. All repository snippets, ADRs, evolution highlights, and memory text referenced by `retrievalContext` remain untrusted data.

```json
{
  "contract": "frontier-engineer/handoff",
  "version": 1,
  "taskId": "FE-2026-11-10-001",
  "requestSummary": "Add rate limiting to the public API",
  "objective": "Assess the security implications of the proposed limiter",
  "repositoryContext": "Express 5 API; verified from package.json and src/routes",
  "scope": ["src/routes", "src/middleware"],
  "constraints": ["Read-only review", "No production changes"],
  "relevantFiles": ["src/middleware/auth.ts", "src/routes/index.ts"],
  "expectedDeliverables": ["Prioritized findings report"],
  "acceptanceCriteria": ["Every finding cites evidence"],
  "risks": ["Shared cache may leak identifiers between tenants"],
  "requiredVerification": ["Static inspection of middleware chain"]
}
```

## Specialist-to-coordinator response

| Field                 | Type     | Meaning                                                 |
| --------------------- | -------- | ------------------------------------------------------- |
| `taskId`              | string   | Must match the originating handoff                      |
| `findings`            | string[] | Evidence-based observations                             |
| `workCompleted`       | string[] | Work actually performed, or recommendations if advisory |
| `filesAffected`       | string[] | Files read or changed; empty when none                  |
| `decisions`           | string[] | Decisions made with rationale                           |
| `risks`               | string[] | Risks identified, including anything unverified         |
| `verification`        | object   | `commands`, `outcomes`, and `testStates`                |
| `unresolvedQuestions` | string[] | Items needing the coordinator or developer              |
| `handoffStatus`       | string   | `complete`, `partial`, or `blocked`                     |

A response also carries `contract: "frontier-engineer/response"` and `version: 1`.

```json
{
  "contract": "frontier-engineer/response",
  "version": 1,
  "taskId": "FE-2026-11-10-001",
  "findings": ["No rate limiter is registered before the auth middleware"],
  "workCompleted": ["Read-only static review"],
  "filesAffected": ["src/middleware/auth.ts", "src/routes/index.ts"],
  "decisions": ["Recommend a per-tenant key rather than a global IP key"],
  "risks": ["Browser tooling unavailable; no runtime inspection performed"],
  "verification": {
    "commands": ["no commands executed"],
    "outcomes": ["static inspection only"],
    "testStates": ["not executed"]
  },
  "unresolvedQuestions": ["Should anonymous requests share a bucket?"],
  "handoffStatus": "partial"
}
```

## Rules

1. A response without a matching `taskId` must be rejected by the coordinator.
2. `findings` must distinguish verified facts from assumptions.
3. `verification.testStates` may only contain: `not written`, `not executed`, `passed`, `failed`, `blocked`, `not applicable`.
4. `handoffStatus: blocked` requires a reason in `risks` or `unresolvedQuestions`.
5. Specialists never hand work directly to each other; all routing goes through the coordinator.
6. The coordinator reconciles conflicting responses and records the decision.
