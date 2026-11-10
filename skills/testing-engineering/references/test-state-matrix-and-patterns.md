# Testing Engineering: Verification Test States and Test Strategy Guide

This reference defines the strict test-state discipline, testing pyramids, fixture management, and test anti-patterns.

## 1. The Six Canonical Test States

Frontier Engineer strictly forbids conflating test states. Every test report must categorize verification into one of these six mutually exclusive states:

| State                 | Definition                                                                                  | Example / Criteria                                                               |
| :-------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------- |
| **1. Not Written**    | A requirement or edge case has been identified, but no automated test exists yet.           | Acceptance criterion noted in requirements; no corresponding `it()` block.       |
| **2. Not Executed**   | The test exists in source code, but was not run in the current verification session.        | Test skipped via `--testNamePattern` filter or skipped due to suite timeout.     |
| **3. Passed**         | The test was executed against real code, ran all assertions, and completed without failure. | Vitest/Jest output: `✓ should validate password complexity (45ms)`.              |
| **4. Failed**         | The test was executed and threw an assertion failure or uncaught runtime error.             | Expected status 200, received 500; `AssertionError: expected false to be true`.  |
| **5. Blocked**        | The test cannot be executed because external prerequisites or environment are unavailable.  | Missing Docker daemon, unavailable third-party staging credentials, OS mismatch. |
| **6. Not Applicable** | The test or check does not apply to this platform, configuration, or environment.           | Windows-specific path tests executed on Linux; browser tests in CLI-only mode.   |

> **Critical Rule:** Never remove or weaken a failing test simply to report a 100% passing suite. A failing test is valuable evidence; deleting it is falsification.

---

## 2. The Verification Pyramid

Structure test suites across three distinct levels to optimize speed, confidence, and maintainability:

```text
          / \
         / E2E \       <- Few: Full browser / workflow journeys (Slow, fragile, high confidence)
        /───────\
       / Integr. \     <- Moderate: API endpoints, DB queries, service boundaries (Medium speed)
      /───────────\
     /    Unit     \   <- Many: Pure functions, business logic, state reducers (Fast, isolated)
    /───────────────\
```

1. **Unit Tests (70–80% of tests):**
   - Pure, deterministic, zero network or disk I/O.
   - Run in milliseconds.
   - Test domain logic, edge cases, validation rules, state machines.
2. **Integration Tests (15–25% of tests):**
   - Test interactions between components (e.g. Service + Database, Controller + Middleware).
   - Use test databases (in-memory, ephemeral containers) with clean transactions per test.
3. **End-to-End Tests (5–10% of tests):**
   - Test critical customer journeys end-to-end (e.g. signup -> checkout -> receipt).
   - Driven via Playwright or headless browser.
   - Retries allowed only with jitter and diagnostic failure recordings (screenshots, traces).

---

## 3. Test Fixture Management and Isolation

- **Independent Tests:** Every test must be completely independent. Test B must never rely on data seeded by Test A.
- **Transactional Rollback:** For database integration tests, wrap each test case in a database transaction and roll it back in `afterEach()` or truncate tables.
- **No Global Mutexes:** Avoid mutating global variables or `process.env` without restoring original values in `afterEach()`.
- **Fakes vs. Mocks:** Prefer in-memory fakes (e.g. `FakeUserRepository`) over brittle deep function mocks (`jest.spyOn().mockReturnValue()`). Deep mocks couple tests to internal implementation details.
