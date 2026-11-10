# Part 25 — Templates Reference (supplementary)

Consolidated templates used across the specification. Copies belong in `templates/` of the repository.

## Specialist Report
See `04-AGENT-SPECIFICATIONS.md`, section 4.7.

## Project Intelligence Report
See `10-PROJECT-INTELLIGENCE.md`, section 10.3.

## Architecture Decision Record
See `11-ENGINEERING-MEMORY.md`, section 11.2.

## Verification Report
See `13-TESTING-AND-QUALITY.md`, section 13.3.

## Human Approval Request

```markdown
# Approval Request

## Operation
What will occur?

## Reason
Why is it necessary?

## Affected Resources
Files, tables, services, environments.

## Reversibility
Reversible / Partially reversible / Irreversible (and how to roll back)

## Risks
What could go wrong?

## Decision
- [ ] Approved
- [ ] Rejected
```

## Security Finding

```markdown
# Finding: <title>

- Severity: Critical | High | Medium | Low | Informational
- Affected file/component:
- Evidence:
- Attack scenario:
- Impact:
- Recommended remediation:
```

## Known Issue / Technical Debt Entry

```markdown
## <ID>: <title>
- Status: Open | In progress | Resolved
- Area:
- Description:
- Impact:
- Proposed resolution:
- Date recorded:
```

## Diagnostic Report
See `20-TROUBLESHOOTING.md`, section 20.1 for required fields.
