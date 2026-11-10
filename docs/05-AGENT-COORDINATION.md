# Part 05 — Agent coordination and conflict prevention

## Delegation policy

The coordinator delegates selectively. Delegating every request to every agent is explicitly prohibited; specialists are used only when their independent expertise materially improves the outcome.

| Request type                     | Specialists involved                                 | Reason                                         |
| -------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Small CSS adjustment             | none                                                 | Delegation costs more than it returns          |
| Database architecture            | Architect, optionally Security Auditor               | Design plus access-control scrutiny            |
| Complex frontend redesign        | Design Engineer, Implementation Engineer             | Visual specification plus owned implementation |
| Production authentication change | Architect, Implementation Engineer, Security Auditor | High-risk, security-sensitive                  |
| Bug fix                          | Implementation Engineer, QA Engineer                 | Root cause plus regression coverage            |
| Security incident                | Security Auditor first                               | Domain priority                                |
| Full repository audit            | all five specialists                                 | Independent evidence across domains            |

The coordinator classifies complexity and risk before selecting specialists, then assigns a **single owner for every file to be written**. It sequences dependent work and permits parallel analysis only when no agent writes to a file another agent may touch.

## Conflict prevention

1. No two agents edit the same file in the same task.
2. Implementation tasks have one explicit owner; other agents return recommendations.
3. QA Engineer owns test files; Implementation Engineer owns source files; Design Engineer owns design tokens and styling files when the coordinator assigns them.
4. Read-only specialists (Architect, Security Auditor) never write source files.
5. Dependent work runs sequentially; independent analysis may run in parallel.
6. Conflicting specialist recommendations are reconciled by the coordinator, which cites both positions, decides with reasoning, and records the decision.
7. Specialists may not silently expand their assigned scope; a discovery that invalidates the plan goes back to the coordinator.
8. High-risk actions require explicit human approval before execution.
9. The developer is kept informed of important decisions.
10. The coordinator remains accountable for the final result.

## Capability matrix

Capability values come from the canonical frontmatter under [specs/agents/](../specs/agents/); this table is their documentation rendering. `tools` identifiers are deliberately not asserted — see [Part 04](04-AGENT-SPECIFICATIONS.md).

| Agent                   | Required capabilities                                                                                     | Optional capabilities                                          | Recommended MCP             | File       | Browser  | Terminal | Approval requirements                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------- | ---------- | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| Frontier Engineer       | repository-inspection, requirements-analysis, planning, delegation, verification-reporting, documentation | code-editing, test-execution, browser-inspection               | GitHub, Context7            | read-write | optional | required | destructive files, migrations, production deploys, external writes, credential rotation, force push |
| Architect               | repository-inspection, architecture-analysis, data-modeling, api-design, documentation                    | dependency-analysis, performance-analysis                      | Context7                    | read       | none     | optional | any write action requires coordinator authorisation                                                 |
| Implementation Engineer | repository-inspection, code-editing, refactoring, debugging, test-execution, documentation                | browser-inspection, performance-analysis                       | Context7, GitHub            | read-write | optional | required | destructive files, new dependencies, schema migrations, production deploys                          |
| Security Auditor        | repository-inspection, security-review, threat-modeling, dependency-analysis, documentation               | test-execution                                                 | GitHub, Context7            | read       | none     | optional | invasive testing, production changes                                                                |
| QA Engineer             | repository-inspection, test-design, test-execution, verification-reporting                                | browser-inspection, accessibility-review, performance-analysis | Playwright, GitHub          | read-write | optional | required | dependency installation, CI changes                                                                 |
| Design Engineer         | repository-inspection, ui-inspection, accessibility-review, documentation                                 | browser-inspection, code-editing                               | Playwright, Chrome DevTools | read-write | optional | optional | shared design token or component changes                                                            |

All recommended MCP servers are **optional and unconfigured**; they belong to Phase 5. No agent is assumed to have browser, terminal, or MCP access on every platform.

## Execution modes and sequencing

Execution modes (advisory, assisted, verification) are workflow policies, not platform APIs. A typical complex task runs:

```text
Coordinator classifies and plans
  → parallel read-only analysis (Architect, Security Auditor, Design Engineer where relevant)
  → coordinator reconciles findings and assigns file ownership
  → Implementation Engineer writes owned files
  → QA Engineer writes and runs tests
  → Security Auditor re-reviews security-sensitive changes
  → coordinator verifies and reports
```

The user approves before any destructive, production, or consequential external action. Where native orchestration is unavailable, this sequence is a **documented workflow**, not a claim of platform-enforced execution.

## Coordinator escalation

Escalate to the developer when a decision is consequential, irreversible, or outside the authorized scope; when acceptance criteria are missing or untestable; when an environment blocks verification; or when two specialists disagree on a security-critical conclusion.
