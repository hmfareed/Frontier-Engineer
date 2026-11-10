---
trigger: "model_decision"
description: "Engineering standards for system latency, memory efficiency, resource consumption, asynchronous scaling, and algorithmic complexity."
---

# Performance and Efficiency Standards Rule

> Generated from `specs/rules/performance/performance-standards.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Performance and Efficiency Standards rule establishes guidelines for creating fast, scalable, and resource-efficient software. It ensures that systems meet responsiveness latency targets, minimize memory consumption, avoid computational waste, and scale smoothly under load.

## Scope and applicability

Applies to high-traffic API routes, data-intensive batch pipelines, heavy client-side computations, database querying, caching layers, and background processing workers.

## Core standards

- **Measure Before Optimizing:** Base performance decisions on empirical profiling data, flame graphs, and benchmarks rather than speculative assumptions or premature micro-optimizations that harm readability.
- **Algorithmic Efficiency:** Guard against unintentional $O(n^2)$ or higher computational complexity in nested loops, lookups, and serialization routines. Prefer $O(1)$ hash lookups or $O(n \log n)$ sorted pipelines for large collections.
- **Controlled Caching with Invalidation:** Implement caching for expensive, read-heavy operations with explicit TTL (time-to-live) boundaries, cache invalidation hooks on mutations, and protection against cache stampedes (dogpiling).
- **Memory Hygiene and Leak Prevention:** Release event listeners, timers, file handles, and stream connections when components unmount or operations terminate. Avoid holding long-lived references to transient objects in global scopes.
- **Asynchronous Non-Blocking Execution:** Keep main execution threads (Node.js event loop, browser UI thread) unblocked; offload heavy CPU-bound computations to worker threads, background queues, or native extensions.

## Invariants and prohibitions

- **Prohibited:** Executing heavy computational algorithms or synchronous disk I/O on the primary event loop.
- **Prohibited:** Unbounded in-memory collections or caches without eviction policies (e.g. LRU) or size caps.
- **Prohibited:** Premature micro-optimizations that obfuscate business logic without demonstrable benchmark gains.
- **Prohibited:** Polling loops without exponential backoff and jitter when awaiting asynchronous state changes.

## Verification criteria

- Execute performance profiling or load tests to confirm latency stays within agreed SLA budgets (e.g. p95 < 200ms).
- Verify memory stability across long-running or repeated test executions to confirm zero progressive memory leaks.
- Confirm cache hit ratios and TTL expiration behavior under test environments.
