---
id: testing-engineering
name: Testing Engineering
title: Systematic Software Verification and Quality Assurance
version: 1
summary: Designs and executes meaningful software verification across unit, integration, end-to-end, and regression levels. Enforces strict test-state discipline, test data isolation, failure diagnosis, and accurate verification reporting.
description: Use when designing test strategies, authoring unit/integration/E2E tests, analyzing test failures, setting up test fixtures, measuring meaningful coverage, or producing verification reports.
requiredCapabilities:
  - repository-inspection
  - test-design
  - test-execution
  - verification-reporting
  - debugging
primaryAgents:
  - qa-engineer
  - implementation-engineer
  - frontier-engineer
activationTriggers:
  - authoring automated unit, integration, or E2E test suites
  - verifying new feature implementations against acceptance criteria
  - diagnosing failing test suites or flaky tests
  - establishing test coverage for legacy or untested codebases
  - verifying bug fixes with deterministic regression tests
nonActivationGuidelines:
  - implementing application business logic or backend endpoints
  - designing visual UI tokens and CSS stylesheets
  - performing architectural system decomposition
  - writing high-level non-technical project summaries
platformConfig: {}
---

# Testing Engineering (canonical specification)

## Purpose

The Testing Engineering skill provides a disciplined, rigorous methodology for verifying that software functions correctly, reliably, and securely. It establishes testing across all levels of the testing pyramid, eliminates flaky or vacuous assertions, and enforces uncompromising test-state honesty so developers and coordinators receive factual verification reports rather than false assurances.

## Activation criteria

Activate this skill when:

- Designing test plans or extracting testable criteria from requirements.
- Writing unit, integration, end-to-end (E2E), or regression test suites.
- Investigating failing, flaky, or blocked automated tests.
- Auditing code changes for missing test coverage or untestable architecture.
- Preparing verification reports to demonstrate that acceptance criteria have been satisfied.

## Non-activation guidelines

Do not activate this skill when:

- Writing feature implementation source code (use Implementation Engineer).
- Reviewing PR diffs for architectural patterns without test authoring (use Code Review).
- Performing high-level technology evaluations or reading whitepapers (use Deep Research).
- Changing styling or color schemes without behavioral verification requirements.

## Required context and inputs

Before designing or executing tests:

1. **Acceptance Criteria:** Explicit functional and non-functional requirements that must be validated.
2. **Existing Test Framework:** Test runner (Vitest, Jest, Mocha, PyTest, Go test), assertion libraries, and runner configuration.
3. **Execution Environment:** Available test runners, database access, network sandbox restrictions, and mocking utilities.
4. **Target Source Files:** Component, service, or API files undergoing verification.

## Operating procedure

Execute the following ten-step testing workflow:

1. **Understand Acceptance Criteria:** Break down requirements into unambiguous, testable assertions with explicit inputs and expected outputs.
2. **Inspect Existing Tests:** Survey current test suites, directory layouts (`tests/unit/`, `tests/integration/`), helpers, and fixtures.
3. **Identify Coverage Gaps:** Determine which critical user paths, boundary conditions, and error branches lack verification.
4. **Select Suitable Test Level:** Assign tests to the appropriate level of the pyramid (Unit for isolated logic, Integration for component boundaries, E2E for customer journeys).
5. **Design Meaningful Test Cases:** Structure tests using the Arrange-Act-Assert (AAA) or Given-When-Then pattern. Cover happy paths, boundary extremes, and error conditions.
6. **Implement Tests:** Author clean, deterministic test code using existing project test utilities. Avoid sleep timers; use explicit waiting or polling on predicates.
7. **Execute Tests:** Run test commands in the environment and capture real execution output (exit code, durations, passing/failing assertions).
8. **Analyze Failures:** If tests fail, diagnose the failure. Distinguish between defective implementation code, bad test setup, and environmental blockers.
9. **Verify Fixes:** Re-run failed tests after code corrections to confirm they transition from red to green without weakening assertions.
10. **Report Results Accurately:** Provide an honest verification summary classifying every test into one of the six canonical states.

## Technical and engineering standards

- **Strict Test States:** Maintain the six canonical states: `not written`, `not executed`, `passed`, `failed`, `blocked by environment`, `not applicable`. Never report an unexecuted test as passed.
- **No Assertion Weakening:** Never modify expected values, comment out assertions, or delete failing tests simply to achieve a green test run.
- **Determinism:** Tests must produce the same result regardless of execution order, time of day, or operating system. Avoid `Math.random()` or unseeded pseudorandom data.
- **Fast Execution:** Unit tests must execute in milliseconds without disk or network I/O.
- **Test Isolation:** Every test must set up its own state and clean up after itself. Never allow test pollution between test cases.
- **Meaningful Assertions:** Assert specific values, states, or thrown exception types. Avoid vacuous assertions like `expect(result).toBeDefined()` when checking complex logic.

## Verification and evidence requirements

- Provide the exact CLI command executed to run the test suite.
- Quote the terminal output showing passing tests, run duration, and test file counts.
- For bug fixes, provide terminal output demonstrating that the test failed before the fix and passed after it.

## Expected outputs and deliverables

- **Automated Test Files:** Maintainable, readable test files matching the project's testing conventions.
- **Test Fixtures & Helpers:** Reusable mock data generators or fake implementations.
- **Verification Report:** Table or summary listing tests executed, actual outcomes, and explicit identification of any blocked or skipped checks.

## Risks, boundaries and failure modes

- **Testing Implementation Details:** Asserting on internal private variables or specific internal function call counts makes tests brittle and blocks refactoring.
- **Artificial Sleeps:** Using `setTimeout(resolve, 2000)` causes slow, flaky test suites; always wait for explicit DOM elements or state changes.
- **False Green Assurance:** Claiming code works because tests passed, when the tests actually asserted nothing meaningful or skipped critical branches.

## Progressive disclosure references

For test state definitions, testing pyramid architecture, and fixture isolation patterns:

- [Testing Engineering: Verification Test States and Test Strategy Guide](./references/testing-engineering/test-state-matrix-and-patterns.md)
