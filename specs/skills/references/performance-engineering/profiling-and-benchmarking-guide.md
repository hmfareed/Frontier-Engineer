# Performance Engineering: Profiling, Benchmarking, and Latency Optimization Guide

This reference provides technical methodologies for baseline measurement, memory leak detection, bundle analysis, and backend latency profiling.

## 1. The Measurement-Before-Optimization Rule

Premature optimization wastes engineering effort and introduces unmaintainable complexity. Always follow the empirical performance cycle:

```text
[ Baseline Measurement ] ──► [ Profile Hotspots ] ──► [ Identify True Bottleneck ]
                                                                 │
                                                                 ▼
[ Document Gains & Trade-offs ] ◄── [ Measure Again ] ◄── [ Apply Targeted Fix ]
```

### Core Metrics to Measure

- **Frontend / Web Vitals:**
  - **LCP (Largest Contentful Paint):** < 2.5s (loading performance).
  - **INP (Interaction to Next Paint):** < 200ms (interactivity and responsiveness).
  - **CLS (Cumulative Layout Shift):** < 0.1 (visual stability).
  - **TTFB (Time to First Byte):** < 800ms.
- **Backend / API Latency:**
  - p50, p95, and p99 response times under load.
  - Throughput (Requests Per Second - RPS).
  - Error rate under concurrent load.
  - Event loop lag / thread pool utilization.
- **Database / Memory:**
  - Slow query log (> 100ms).
  - Heap allocation rate and Garbage Collection (GC) pause duration.

---

## 2. Profiling Techniques & Diagnostics

### A. Frontend Bundle & Rendering Profiling

- **Bundle Analysis:** Run `@next/bundle-analyzer` or `webpack-bundle-analyzer` to identify oversized imports (e.g., importing the entire `lodash` library instead of `lodash/debounce`).
- **React Profiler:** Inspect components re-rendering repeatedly due to unstable object references in props. Use `useMemo`, `useCallback`, or lift state appropriately.
- **Image Optimization:** Enforce modern formats (WebP, AVIF), responsive `srcset`, and explicit `width`/`height` attributes to prevent CLS.

### B. Node.js Event Loop & Memory Profiling

- **Event Loop Lag:** CPU-bound synchronous code (e.g. heavy JSON parsing, regex catastrophic backtracking, synchronous crypto) blocks the single Node.js thread, freezing all concurrent requests.
- **Heap Snapshots:** Capture heap snapshots at intervals using `v8.getHeapSnapshot()` to trace retained DOM nodes or detached objects accumulating in closures.

### C. Database Hotspot Analysis

- **N+1 Query Detection:** Inspect server query logs to catch loops issuing single queries per entity instead of `WHERE id IN (...)` batch loading.
- **Missing Index Profiling:** Inspect PostgreSQL `pg_stat_statements` to identify queries with high total execution time and frequent sequential scans.

---

## 3. Performance Improvement Reporting Template

Every performance optimization report must document verified metrics before and after:

```markdown
### Performance Optimization: [Component / Endpoint]

- **Target Metric:** [e.g., p95 API Latency, LCP, Memory Consumption]
- **Baseline (Before):** [Measured metric with evidence / tool output]
- **Observed Bottleneck:** [Identified root cause from profiling traces]
- **Targeted Change:** [Specific code / configuration modification applied]
- **Result (After):** [Measured metric under identical load with evidence]
- **Delta / Gain:** [Percentage improvement, e.g., 65% reduction in latency]
- **Trade-offs:** [Any memory, code complexity, or consistency trade-offs incurred]
```
