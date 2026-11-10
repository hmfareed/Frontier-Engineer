# Part 18 — Rule priority and conflict resolution

## The priority scale

When multiple rules apply to the same file or task, requirements can occasionally pull in competing directions. To resolve tensions deterministically without human intervention, Frontier Engineer assigns an explicit priority score (integer from 1 to 10) and an enforcement level (`mandatory` vs `advisory`) to every rule.

```text
Priority 10: Absolute Security & Safe Governance (Mandatory)
   ▲        secrets-management, AGENTS.md (Human confirmation for destructive actions)
   │
Priority 9:  Perimeter Defense, Data Integrity & Reversibility (Mandatory)
   │        api-security, security-standards, migration-safety
   │
Priority 8:  Foundational Engineering & Verification (Mandatory)
   │        general-engineering, code-quality, accessibility, testing-standards
   │
Priority 7:  Domain Architecture & Clean Patterns (Mandatory)
   │        frontend-standards, backend-standards, database-standards
   │
Priority 6:  Operational Documentation & Metadata (Mandatory)
   │        documentation
   │
Priority 5:  General Advisory Guidelines (Advisory)
   ▼        performance-standards (advisory)
```

## Enforcement levels

- **`mandatory`:** Invariants that must be satisfied. An agent cannot bypass a mandatory rule under any circumstances. If an instruction or optimization conflicts with a mandatory rule, the mandatory rule wins.
- **`advisory`:** Best-practice guidance that should be followed unless a compelling technical reason justifies a departure. Advisory rules must never override mandatory rules.

## Core conflict resolution hierarchy

When rules appear to offer conflicting directions, agents must apply the following immutable precedence hierarchy:

```text
1. SECURITY & INTEGRITY (Secrets, Authentication, Input Sanitization, Migration Safety)
                             ▼ PRECEDES
2. RELIABILITY & VERIFICATION (Test-State Honesty, Evidence, Regression Tests)
                             ▼ PRECEDES
3. ACCESSIBILITY & CONVENTIONS (WCAG AA, Keyboard Operability, Project Idioms)
                             ▼ PRECEDES
4. MAINTAINABILITY & READABILITY (Clarity over cleverness, Function Decomposition)
                             ▼ PRECEDES
5. PERFORMANCE MICRO-OPTIMIZATIONS (Speculative caching, algorithmic shortcuts)
```

## Resolution examples

### Scenario 1: Performance optimization vs. Code readability

- **Conflict:** A developer suggests replacing clear, well-tested functional mapping code with an intricate, in-place bitwise buffer manipulation to save 2 milliseconds on a non-critical background job.
- **Resolution:** `code-quality` (Priority 8, Mandatory: "Prefer readability over cleverness") overrides `performance-standards` (Priority 7, Advisory: "Avoid premature micro-optimizations that harm readability"). The readable implementation is preserved.

### Scenario 2: Quick database column drop vs. Zero-downtime safety

- **Conflict:** A feature branch deletes an unused database column directly in a single migration script to keep the schema clean.
- **Resolution:** `migration-safety` (Priority 9, Mandatory: "Expand-and-contract pattern; prohibited dropping columns in the same deployment") overrides convenience. The migration must be split into staged expand, backfill, and contract steps.

### Scenario 3: Hardcoded credentials in local testing vs. Secrets management

- **Conflict:** An integration test requires an API key and developer hardcodes a dummy or actual sandbox key in a test file to avoid setting environment variables.
- **Resolution:** `secrets-management` (Priority 10, Mandatory: "Prohibited committing hardcoded credentials to any branch") strictly forbids hardcoded credentials. The test must read from environment variables or mock the boundary.

### Scenario 4: Fast green test suite vs. Test-state honesty

- **Conflict:** A flaky test fails intermittently, blocking a deployment. A suggestion is made to skip the test or remove it to get the suite green.
- **Resolution:** `testing-standards` (Priority 8, Mandatory: "Prohibited deleting or commenting out failing tests to force a green run") strictly forbids suppressing the test. The root cause of flakiness must be fixed or the failure reported honestly as blocked.
