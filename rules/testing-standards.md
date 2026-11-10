---
trigger: "glob"
globs: "**/*.{test,spec}.{ts,tsx,js,jsx,py},tests/**"
description: "Testing standards governing test pyramid balance, assertion quality, test-state honesty, regression prevention, and determinism."
---

# Testing and Verification Standards Rule

> Generated from `specs/rules/testing/testing-standards.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Testing and Verification Standards rule governs automated testing practices across all test levels. It ensures that test suites provide genuine defect detection, maintain deterministic execution, avoid brittle coupling to private implementation details, and uphold absolute honesty in reporting test outcomes.

## Scope and applicability

Applies to all test files, test fixtures, mocks, end-to-end specifications, benchmark harnesses, and test automation scripts across all languages and frameworks in the repository.

## Core standards

- **Test Behavior, Not Implementation:** Assert on public interface contracts, observable side effects, and state outcomes rather than private methods or internal state variables.
- **Pyramid Proportionality:** Balance tests across unit (fast, isolated domain logic), integration (boundary contracts, database transactions, HTTP routes), and end-to-end (critical user paths) layers.
- **Test-State Honesty:** Report test outcomes accurately using the six canonical test states: `not written`, `not executed`, `passed`, `failed`, `blocked by environment`, and `not applicable`. Never conflate unexecuted or skipped tests with passed tests.
- **Mandatory Regression Tests:** When fixing a bug, write a failing reproduction test before implementing the fix; confirm that the test fails on pre-fix code and passes cleanly after the fix.
- **Deterministic and Isolated Tests:** Tests must execute independently and produce identical results regardless of execution order, machine speed, or timezone. Mock external third-party services and control system time using fake timers.

## Invariants and prohibitions

- **Prohibited:** Deleting, commenting out, or modifying failing tests merely to force a green test suite run.
- **Prohibited:** Tautological assertions (e.g. `expect(true).toBe(true)`) that pass without verifying actual system logic.
- **Prohibited:** Sleep-based delays (`setTimeout`, `sleep`) to wait for asynchronous events instead of explicit polling or event listeners.
- **Prohibited:** Tests sharing mutable global state without guaranteed cleanup in `afterEach` or `finally` blocks.

## Verification criteria

- Verify that test suites run completely green locally and in CI without flaky or intermittent failures.
- Confirm that every bugfix includes a regression test exercising the exact failure scenario.
- Verify that code coverage thresholds are met without gaming coverage metrics via superficial assertions.
