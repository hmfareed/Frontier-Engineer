# Part 03 — System architecture

> **Label:** Mixed. The plugin packaging layer, the six agent definitions, and the formats in [the verification record](27-OFFICIAL-FORMAT-VERIFICATION.md) are statically verified. The six-layer runtime behaviour, delegation in practice, skills, and orchestration remain **proposed and untested**. See [Part 04](04-AGENT-SPECIFICATIONS.md) for the verified/unverified split.

## Six layers

| Layer | Component                         | Responsibility                                      |
| ----- | --------------------------------- | --------------------------------------------------- |
| 1     | Developer interface               | Natural-language requests and engineering reports   |
| 2     | Coordinator (`frontier-engineer`) | Classify, inspect, plan, delegate, verify, report   |
| 3     | Five specialist agents            | Focused engineering responsibilities                |
| 4     | Ten skills and persistent rules   | Reusable procedures and standards                   |
| 5     | MCP integrations and native tools | Browser, repository, documentation, terminal, tests |
| 6     | Project environment               | Source code, terminal, browser, tests, Git          |

The distinction between layers 3 and 4 matters: **agents are responsibilities, skills are procedures**. A rule is a constraint or invariant; a skill is a multi-step workflow. Rules should be concise and must not duplicate skill content.

## Execution lifecycle

Every substantial request follows this sequence:

```text
Understand → Inspect → Classify → Plan → Approve (if needed)
    → Delegate → Implement → Verify → Review → Report
```

| Stage      | Description                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Understand | Interpret the request and constraints                                                                                             |
| Inspect    | Read project instructions, source, configuration, and Git state                                                                   |
| Classify   | Assign a category: planning, implementation, debugging, review, security, testing, research, UI/UX, maintenance, or documentation |
| Plan       | Produce a plan for non-trivial work                                                                                               |
| Approve    | Pause for human approval on consequential actions                                                                                 |
| Delegate   | Hand focused work to relevant specialists                                                                                         |
| Implement  | Make incremental, focused changes                                                                                                 |
| Verify     | Run relevant tests and checks                                                                                                     |
| Review     | Review quality and security implications                                                                                          |
| Report     | Report changes, test outcomes, and limitations honestly                                                                           |

Execution modes are workflow policies, not Antigravity APIs: **advisory** (analyze without editing), **assisted** (plan and implement with approvals), and **verification** (review, test, audit, report).

## The six agents

| Agent                     | Mission                                                               | Primary deliverables                                                    |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `frontier-engineer`       | Coordinate engineering work from understanding to verified completion | Plans, consolidated findings, verification reports                      |
| `architect`               | Design technically sound, maintainable systems                        | Architecture decisions, schemas, API contracts, ADRs                    |
| `implementation-engineer` | Translate approved requirements into working software                 | Focused frontend, backend, database, and integration changes            |
| `security-auditor`        | Identify security weaknesses and evaluate implementation safety       | Evidence-based findings with severity, attack scenario, and remediation |
| `qa-engineer`             | Establish whether implementations satisfy requirements                | Test plans, executed test results, acceptance assessments               |
| `design-engineer`         | Produce functional, accessible, polished interfaces                   | UI architecture, component systems, accessibility checks                |

### Coordinator boundaries

The coordinator owns classification, planning, delegation, conflict resolution, verification, and reporting. It must never claim completion when required verification has not occurred. It must report changed files, tests executed, actual outcomes, and unresolved limitations.

### Specialist boundaries

Specialists must not expand the scope of the developer's request or perform overlapping write operations. Security and QA reviewers should be read-only by default. Each specialist returns findings in a common shape: task, findings, evidence, recommendations, risks, unresolved questions, and completion status.

### Delegation strategy

Delegation is selective. A small CSS adjustment does not require six agents; a payment system may require architecture, implementation, and security review; a full repository audit may require all five specialists.

Phase 2 implemented all six agents. Antigravity supports file-based custom agents at `agents/<name>.md` with `subagent: true`, invoked by the primary agent through `invoke_subagent`. Each agent runs with a clean context in its own conversation, in parallel with the main conversation. The installed CLI discovers all six definitions with zero findings, but the mechanism **has not been exercised by this plugin at runtime**. Agent `tools` allowlists are deliberately omitted because the official documentation conflicts on their default and warns that misspelled tool names can hang subagents; see [ADR-002](adr/ADR-002-agent-system.md). Full delegation policy and file-ownership rules are in [Part 05](05-AGENT-COORDINATION.md).

## Communication and reporting

Specialist outputs are consolidated by the coordinator, never presented as independent conclusions. The QA agent must keep five test states distinct: not written, not executed, failed, passed, and blocked by environment. Fabricated verification claims, critical security failures, destructive actions without approval, and conflated test states are automatic evaluation failures.

## Verification architecture

Phase 1 implements a validation layer that is independent of Antigravity at runtime:

```text
npm run validate → scripts/validate.ts → six check groups → actionable findings
                                      → exit 1 on any error
agy plugin validate --strict . → official loader-equivalent validation
```

The local validator checks the repository against **verified** schemas, not against invented plugin conventions. The official CLI check remains authoritative.

## Security and human control

Least privilege is the default. Reads, dependency inspection, and safe tests are permitted within scope. File edits follow task authorization. Deletions, destructive migrations, production changes, credential rotation, force pushes, and external write operations require human confirmation stating the operation, reason, affected resources, reversibility, and risks.
