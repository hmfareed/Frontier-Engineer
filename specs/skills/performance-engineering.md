---
id: performance-engineering
name: Performance Engineering
title: Performance Profiling, Bottleneck Elimination, and Latency Optimization
version: 1
summary: Identifies, measures, and eliminates performance bottlenecks across frontend, backend, and persistence layers. Profiles memory, network latency, database queries, and bundle sizes; enforces baseline measurement before optimization.
description: Use when investigating latency spikes, optimizing frontend rendering/bundle sizes, resolving database query bottlenecks, profiling memory leaks or event loop lag, or load testing services.
requiredCapabilities:
  - repository-inspection
  - performance-analysis
  - code-editing
  - architecture-analysis
  - test-execution
primaryAgents:
  - implementation-engineer
  - architect
  - qa-engineer
activationTriggers:
  - high response latency or slow API endpoints (high p95/p99)
  - frontend bundle size inflation or slow page loads (poor Core Web Vitals)
  - database connection contention or slow query execution
  - high CPU utilization, event loop lag, or memory leakage
  - preparing an application for high-traffic events or load testing
nonActivationGuidelines:
  - speculative code restructuring without baseline performance measurements
  - cosmetic visual design and color styling changes
  - general unit test authoring without performance implications
  - routine documentation updates
platformConfig: {}
---

# Performance Engineering (canonical specification)

## Purpose

The Performance Engineering skill provides a disciplined, measurement-driven methodology for diagnosing and resolving performance bottlenecks across web applications, APIs, and persistence layers. It eliminates premature optimization and speculative code modifications by enforcing empirical baselining, targeted profiling, focused interventions, and post-change measurement verification.

## Activation criteria

Activate this skill when:

- An API endpoint or backend service exceeds latency budgets (e.g., p95 > 500ms).
- A frontend web application suffers from poor Core Web Vitals (LCP > 2.5s, INP > 200ms, CLS > 0.1).
- Database queries cause sequential table scans or hold locks under concurrent load.
- Memory consumption increases monotonically (memory leak) or CPU spikes cause event loop starvation.
- Preparing a service for scale through stress testing, load testing, or caching.

## Non-activation guidelines

Do not activate this skill when:

- Writing initial features where functional correctness and domain logic have not yet been established.
- Refactoring code purely for readability or adherence to style preferences without latency concerns.
- Optimizing code paths that execute rarely (e.g., one-time startup scripts or administrative batch jobs).
- Answering theoretical questions about algorithm big-O complexity without profiling data.

## Required context and inputs

Before initiating performance optimization:

1. **Performance Objective:** Quantifiable target metric (e.g., _"Reduce checkout API p95 latency from 1.2s to <300ms at 500 RPS"_).
2. **System Baseline:** Historical or measured latency distributions (p50, p95, p99), memory usage profiles, or Lighthouse/Web Vitals scores.
3. **Environment Parameters:** Hardware specifications, network topography, runtime versions, and production-like dataset sizes.
4. **Profiling Tools:** Available APM tools, CPU profilers, heap analyzers, query explain utilities, or bundle analyzers.

## Operating procedure

Execute the following ten-step performance optimization workflow:

1. **Understand Performance Objective:** Establish clear, quantifiable target metrics and operational constraints.
2. **Establish a Baseline:** Measure current performance under realistic, reproducible load. Capture p50, p95, p99 latency, throughput, and resource utilization.
3. **Measure the Affected System:** Run profiling tools (Node.js `--inspect`, Chrome DevTools, `EXPLAIN ANALYZE`, bundle analyzers) to capture execution breakdown.
4. **Identify Bottlenecks:** Locate the critical path (e.g., synchronous blocking I/O, N+1 query loop, uncompressed 5MB hero image, inefficient regex).
5. **Determine Root Cause:** Formulate a technical explanation supported by profiling data showing why the hotspot consumes disproportionate resources.
6. **Propose Optimizations:** Evaluate alternative remediations (caching, query indexing, batching, pagination, code splitting, memoization) and assess trade-offs.
7. **Implement Focused Changes:** Apply the minimal code or configuration modification that directly addresses the isolated bottleneck. Avoid extraneous refactorings.
8. **Measure Again:** Re-run the identical baseline benchmark under identical test conditions.
9. **Compare Results:** Calculate the precise delta (percentage latency reduction, memory saved, throughput gain).
10. **Report Improvements and Trade-offs:** Document baseline vs. final metrics, citing profiling evidence and disclosing any complexity or memory trade-offs.

## Technical and engineering standards

- **Measurement Over Intuition:** Never claim a performance optimization was successful without providing before-and-after empirical measurements.
- **Do Not Sacrifice Correctness:** A fast algorithm that produces incorrect output or drops transactions is a critical failure.
- **Protect the Event Loop:** In Node.js / single-threaded runtimes, never perform heavy synchronous CPU computations (e.g. `fs.readFileSync`, long synchronous loops, heavy crypto) inside request handlers.
- **Batching Over Loops:** Eliminate N+1 queries by using `dataloader`, SQL `IN (...)` queries, or proper joins.
- **Resource Constraints:** When introducing caches (Redis, in-memory LRU), always enforce maximum memory bounds, eviction policies, and time-to-live (TTL).

## Verification and evidence requirements

- Provide the baseline benchmark output showing latency, throughput, or bundle size before the change.
- Provide profiling traces or explain plans identifying the exact bottleneck.
- Provide post-optimization benchmark output demonstrating measurable improvement under identical load.

## Expected outputs and deliverables

- **Performance Optimization Report:** Detailed document containing baseline metrics, profile analysis, applied fixes, and verified post-change metrics.
- **Focused Code Patch:** Minimal, clean source modifications eliminating the hotspot.
- **Benchmark Script / Test Case:** Reproducible test harness or load script used to measure the improvement.
- **Trade-off Analysis:** Assessment of memory footprint, cache invalidation complexity, or maintenance costs.

## Risks, boundaries and failure modes

- **Premature Optimization:** Complicating code with unreadable micro-optimizations for paths that consume <1% of runtime.
- **Inconsistent Benchmark Environments:** Measuring baseline on a local laptop and post-change on a cloud server invalidates comparison.
- **Cache Stale Data Risk:** Introducing aggressive caching without an invalidation mechanism causes clients to read corrupted or obsolete state.

## Progressive disclosure references

For profiling guides, Web Vitals metrics, and reporting templates:

- [Performance Engineering: Profiling, Benchmarking, and Latency Optimization Guide](./references/performance-engineering/profiling-and-benchmarking-guide.md)
