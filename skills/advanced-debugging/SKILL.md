---
name: "advanced-debugging"
description: "Use when diagnosing complex application defects, unhandled exceptions, race conditions, memory leaks, timing bugs, or unexpected runtime failures requiring evidence-based root-cause analysis."
---

# Advanced Debugging — Systematic Failure Isolation and Root-Cause Diagnosis

> Generated from `specs/skills/advanced-debugging.md` by `scripts/generate-antigravity-skills.ts`. Edit the canonical specification, not this file.

## Purpose

The Advanced Debugging skill provides a rigorous, hypothesis-driven methodology for diagnosing and resolving complex, intermittent, or deep-seated software defects. It halts speculative trial-and-error editing and enforces evidence-based root-cause isolation, minimal interventions, and compulsory regression test coverage.

## Activation criteria

Activate this skill when:

- An application crashes, throws unhandled exceptions, or enters an error state.
- Tests fail intermittently due to timing, concurrency, or environmental variance.
- Data corruption, race conditions, or state synchronization bugs are observed.
- Performance degrades abruptly or memory leaks are detected.
- External API integrations or persistence queries fail unexpectedly.

## Non-activation guidelines

Do not activate this skill when:

- The compiler or type checker points directly to a missing variable or syntax error.
- The task is building a new feature or extending existing functionality according to a new specification.
- Changing CSS colors, typography, or spacing without underlying logic errors.
- Performing routine dependency upgrades that pass all existing test suites.

## Required context and inputs

Before beginning root-cause isolation, collect:

1. **Observed Behavior:** Exact error message, stack trace, HTTP status code, or visual anomaly.
2. **Expected Behavior:** Clear definition of what the system should have done under these inputs.
3. **Reproduction Prerequisites:** Environment parameters, operating system, runtime version, seed data, and configuration flags.
4. **Execution Evidence:** Console logs, network payloads, server-side log files, and database state snapshots.

## Operating procedure

Execute the following eleven-step debugging workflow:

1. **Understand Observed Behavior:** Record the exact symptoms, error messages, and failure conditions.
2. **Establish Expected Behavior:** Specify the correct invariants and expected outcomes.
3. **Reproduce the Issue:** Create a deterministic, minimal reproduction in a script, unit test, or automated browser test. If non-deterministic, establish conditions that increase failure probability.
4. **Gather Logs, Traces, and Evidence:** Collect runtime stack traces, query logs, variable snapshots, and execution timestamps.
5. **Identify Possible Causes:** Map the error back through the call stack to potential points of invalid state, timing discrepancies, or unhandled nullability.
6. **Form Testable Hypotheses:** State clear, falsifiable hypotheses (_"Component X receives undefined input because Provider Y resolves after Consumer Z renders"_).
7. **Isolate the Root Cause:** Devise focused experiments to test each hypothesis. Discard disproven theories; confirm the true root cause with verifiable evidence.
8. **Implement the Smallest Appropriate Fix:** Change only the code directly responsible for the defect. Avoid shotgun refactoring or touching unrelated files.
9. **Add a Regression Test:** Author an automated test that reproduces the defect and fails without the fix, then passes with it.
10. **Run Relevant Verification:** Execute the entire affected test suite and related integration tests to confirm no regressions were introduced.
11. **Report Remaining Uncertainty:** Clearly disclose if any edge conditions remain unverified or if underlying environment factors could not be reproduced locally.

## Technical and engineering standards

- **Evidence First:** Never claim a defect is resolved because a proposed edit "looks correct." Execution evidence (test output, log confirmation) is mandatory.
- **Minimal Surface Area:** A bug fix should touch the minimum number of lines and files required. Do not bundle opportunistic refactorings into a defect patch.
- **Idempotent Resource Cleanup:** When debugging resource exhaustion, ensure all file descriptors, network sockets, timers, and database connections are closed in `finally` blocks or structured teardowns.
- **Defensive Invariant Checks:** Validate assumptions at component boundaries with explicit assertions or schema validation rather than swallowing unexpected values silently.

## Verification and evidence requirements

- Provide the exact reproduction test command and terminal output showing failure before the fix.
- Provide the test command and terminal output showing clean pass after the fix.
- Inspect `git diff` to verify that zero unintended edits or extraneous whitespace modifications were made.

## Expected outputs and deliverables

- **Root Cause Analysis (RCA) Statement:** Clear explanation of why the failure occurred, what assumption was violated, and why the fix works.
- **Focused Code Patch:** Minimal, clean source modifications addressing the defect.
- **Automated Regression Test:** A permanent, reproducible test case checked into the repository.
- **Verification Log:** Terminal output proving test pass and absence of collateral damage.

## Risks, boundaries and failure modes

- **Speculative Editing:** Modifying multiple files simultaneously without proving the root cause obscures the bug and introduces new defects.
- **Masking Symptoms:** Catching and silencing exceptions (e.g., empty `catch {}` blocks or default fallback values) hides bugs rather than solving them.
- **Test Weakening:** Modifying test assertions or removing assertions to make a test suite pass is an automatic failure.

## Progressive disclosure references

For diagnostic frameworks for async race conditions, memory leaks, and connection starvation:

- [Advanced Debugging Playbook: Root-Cause Analysis and Hypotheses Testing](./references/root-cause-analysis-guide.md)
