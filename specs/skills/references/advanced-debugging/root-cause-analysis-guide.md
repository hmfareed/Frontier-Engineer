# Advanced Debugging Playbook: Root-Cause Analysis and Hypotheses Testing

This guide details systematic failure isolation techniques for complex, concurrency, timing, and environmental defects.

## 1. The Scientific Debugging Method

Random trial-and-error edits cause regressions and obscure the actual defect. Apply the hypothesis-driven method:

```text
[ Observed Failure ] ──► [ Gather Facts & Logs ] ──► [ Formulate Falsifiable Hypothesis ]
                                                                   │
                                                                   ▼
[ Add Regression Test ] ◄── [ Isolate Minimal Fix ] ◄── [ Execute Controlled Test ]
```

### Steps

1. **Fact Gathering:** Capture exact inputs, call stacks, environment variables, timestamps, and database state.
2. **Hypothesis Formulation:** Write a statement of the form: _"If condition X occurs, then component Y fails because assumption Z is violated."_
3. **Falsification Test:** Create a targeted condition that either disproves the hypothesis or confirms it. If disproven, discard and formulate a new hypothesis.
4. **Minimal Intervention:** Modify only the code necessary to restore expected behavior.

---

## 2. Common Defect Archetypes & Diagnostics

### A. Asynchronous Race Conditions and State Mutation

- **Symptoms:** Intermittent test failures, "cannot read properties of undefined" after navigation, stale UI state.
- **Diagnostic Technique:**
  - Check whether async callbacks mutate shared state without locks or synchronization.
  - In React/frontend: inspect unhandled Promise rejections, missing cleanup in `useEffect`, or state updates after component unmount.
  - Trace ordering with timestamped structured logs.

### B. Memory Leaks and Retained References

- **Symptoms:** Process RSS climbs continuously, browser tab becomes sluggish or crashes with OOM.
- **Diagnostic Technique:**
  - Node.js: Take heap snapshots before and after repeated operations using `--inspect` and compare retained objects.
  - Common culprits: Event listeners not removed on teardown, unbounded in-memory caches without TTL/eviction, circular closures in long-lived modules.

### C. Database Connection Starvation and Lock Contention

- **Symptoms:** API response times spike under load; requests hang until gateway timeout (504).
- **Diagnostic Technique:**
  - Check active vs. idle pool connection counts.
  - Identify transactions that perform slow external network calls while holding table/row locks.
  - Ensure every transaction has an explicit timeout and all acquired connections are released in `finally` blocks.

---

## 3. The Minimal Regression Test Rule

Every bug fix is incomplete without an automated regression test that proves two things:

1. **Red Stage:** The test fails reliably on the unmodified code with the observed error.
2. **Green Stage:** The test passes reliably once the minimal fix is applied.
3. **Protection:** The test prevents future commits from silently reintroducing the defect.
