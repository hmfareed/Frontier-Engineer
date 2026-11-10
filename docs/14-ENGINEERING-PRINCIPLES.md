# Part 14 — Engineering principles

These fifteen principles are the foundation of Frontier Engineer. The concise always-on version lives in [rules/AGENTS.md](../rules/AGENTS.md); this document explains the intent behind each.

| #   | Principle                                                                  | Intent                                                               |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Inspect before implementing                                                | Read the actual repository before proposing or making changes        |
| 2   | Understand the existing architecture before modifying it                   | Identify conventions, entry points, and boundaries first             |
| 3   | Prefer existing project conventions over unnecessary rewrites              | Consistency beats personal preference                                |
| 4   | Plan complex changes before execution                                      | Decompose work and record scope, non-goals, and risks                |
| 5   | Make minimal, focused, maintainable changes                                | Preserve working behavior; avoid unrelated edits                     |
| 6   | Never claim a feature works without verification                           | Generated code is not evidence of a working feature                  |
| 7   | Run relevant tests after implementation                                    | Select tests based on what changed                                   |
| 8   | Report failed tests and unresolved issues honestly                         | Include skipped and blocked checks                                   |
| 9   | Avoid unnecessary dependencies                                             | Justify every new dependency                                         |
| 10  | Never expose secrets or credentials                                        | Use environment variables or approved secret managers                |
| 11  | Require approval for destructive operations and sensitive external actions | State reason, impact, reversibility, and risks                       |
| 12  | Preserve existing user work                                                | Do not silently remove or overwrite working functionality            |
| 13  | Distinguish assumptions from verified facts                                | Label evidence from source files, configuration, or execution output |
| 14  | Do not fabricate documentation, APIs, or tool capabilities                 | Verify formats against official sources                              |
| 15  | Document important architectural decisions                                 | Record context, decision, alternatives, and consequences             |

## How these are enforced

- Principles 1–5 and 9–12 are agent behavioral rules, carried in [rules/AGENTS.md](../rules/AGENTS.md) and applied across specialist instructions and skills.
- Principles 6–8 and 13–15 are enforced by the verification and reporting workflow, and by [SECURITY.md](../SECURITY.md).
- Principle 14 is enforced by [the verification record](24-OFFICIAL-FORMAT-VERIFICATION.md) and by the schemas in [schemas/](../schemas/).
- Automated checks cover what can be checked mechanically. They do not replace engineering judgment.

## Test-state discipline

Never conflate these states: **test not written**, **test not executed**, **test failed**, **test passed**, **test blocked by environment**, **not applicable**. A green suite achieved by deleting failing tests is an automatic failure.
