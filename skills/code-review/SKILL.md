---
name: "code-review"
description: "Use when reviewing pull requests, inspecting code diffs, auditing proposed modifications for defects, security weaknesses, performance regressions, or architectural consistency prior to merging."
---

# Code Review — Rigorous Code Review and Defect Detection

> Generated from `specs/skills/code-review.md` by `scripts/generate-antigravity-skills.ts`. Edit the canonical specification, not this file.

## Purpose

The Code Review skill provides an objective, rigorous, and prioritized framework for evaluating source code changes. It identifies real behavioral defects, security vulnerabilities, performance regressions, and architectural inconsistencies while preventing bikeshedding over subjective stylistic preferences.

## Activation criteria

Activate this skill when:

- Reviewing git diffs or pull requests prior to merging into a main branch.
- Inspecting code authored by other agents or human developers for correctness.
- Auditing changes for unintended breaking changes or regression risks.
- Assessing test quality and verification coverage of a submitted modification.

## Non-activation guidelines

Do not activate this skill when:

- Executing automated formatters like Prettier or linters like ESLint (these should be handled by CI/tools).
- Writing implementation code for a brand-new feature.
- Diagnosing a live system crash in production (use Advanced Debugging).
- Authoring non-code documentation or release notes.

## Required context and inputs

Before initiating a code review:

1. **The Objective:** Purpose of the change, issue ticket, or user story.
2. **The Diff:** Exact git diff or patch showing additions, modifications, and deletions.
3. **Surrounding Context:** Surrounding source files, callers, and interface consumers.
4. **Project Standards:** Existing conventions, tsconfig settings, and testing practices.
5. **Test Results:** Output of the automated test suite executed against the diff.

## Operating procedure

Execute the following ten-step code review workflow:

1. **Understand Purpose of Change:** Clarify what the change is supposed to accomplish and what acceptance criteria apply.
2. **Inspect the Diff:** Review all modified, added, and deleted lines across the entire changeset.
3. **Inspect Surrounding Code:** Check callers, callees, and imported modules to evaluate broader integration effects.
4. **Identify Behavioral Defects:** Check for off-by-one errors, unhandled null/undefined states, asynchronous race conditions, and unhandled promise rejections.
5. **Identify Security Concerns:** Check input validation, SQL injection, authorization bypass, secret leakage, and insecure deserialization.
6. **Identify Performance Concerns:** Check for N+1 queries, unindexed filters, unbounded array growth, memory leaks, or unnecessary re-renders.
7. **Identify Maintainability Issues:** Check for code duplication, dead code, poor abstraction boundaries, and excessive function complexity.
8. **Review Test Coverage:** Ensure tests exist, cover happy paths and edge cases, assert realistic outcomes, and test the actual behavior changed.
9. **Classify Findings:** Categorize each finding into priority tiers (P0 Blocker, P1 Major, P2 Minor, P3 Suggestion/Nit).
10. **Produce Actionable Feedback:** Deliver concise, polite, and constructive comments containing exact file:line references, impact rationale, and recommended code replacements.

## Technical and engineering standards

- **Prioritize Defects Over Style:** If a linter does not enforce a rule and it does not affect correctness, maintainability, or performance, do not block a PR over it.
- **Explain the "Why":** Never simply say "change this." Explain the failure mode, security risk, or performance implication of the current code.
- **Concrete Code Suggestions:** Whenever feasible, provide drop-in code snippets illustrating the recommended fix.
- **Verify Test Integrity:** Reject pull requests where failing tests were deleted or assertions were commented out to make CI pass.
- **Respect Established Conventions:** Code that matches the existing style of the repository should not be rewritten merely because the reviewer prefers an alternative idiom.

## Verification and evidence requirements

- Review comments must quote the exact file path and line range.
- Cite the concrete failure condition (e.g., _"If `user.profile` is null, line 42 throws TypeError"_).
- Confirm whether existing test suites run and pass locally.

## Expected outputs and deliverables

- **Structured Code Review Summary:** Overview of the change, assessment of overall quality, and explicit approval recommendation (Approve, Request Changes, Comment).
- **Prioritized Findings List:** Grouped by urgency (P0 to P3), each with problem statement, impact, and fix.
- **Verification Assessment:** Review of test coverage adequacy and identified testing gaps.

## Risks, boundaries and failure modes

- **Nit-Picking / Bikeshedding:** Focusing on personal formatting tastes while missing logic errors or security bugs.
- **Superficial Approval:** Stamping approval ("LGTM") without inspecting the surrounding call sites or verifying test results.
- **Scope Creep:** Demanding that the author refactor unrelated legacy files touched by the diff.

## Progressive disclosure references

For review rubrics, severity tiers, and defect checklists:

- [Code Review Rubric, Classification System, and Defect Detection](./references/review-rubric-and-classification.md)
