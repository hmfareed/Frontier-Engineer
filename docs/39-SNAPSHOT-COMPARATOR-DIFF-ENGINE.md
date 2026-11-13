# Phase 7.5 Stage 3 — Snapshot Comparator & Deterministic Diff Engine

**Specification version:** 1.0.0  
**Phase:** 7.5 — Engineering Memory & Repository Evolution Intelligence  
**Stage:** 3 — Snapshot Comparator & Deterministic Repository Diff Engine  
**Project Version:** 0.6.3  
**Schema Version:** 3

---

## 1. Executive overview

The Snapshot Comparator is Frontier Engineer's deterministic, evidence-grounded diff engine. It compares two validated, completed repository snapshots from the same repository and identifies factual changes across six domains:

1. **File inventory & content modifications**
2. **Extracted symbol identities & AST fingerprints**
3. **Module imports, exports, and target dependency resolution**
4. **Architectural components, boundaries, and member file sets**
5. **Architecture Decision Records (ADRs), status, and hashes**
6. **Snapshot-level chronology, completeness, and relational integrity**

### Engineering Principles

- **Evidence before interpretation:** The comparator establishes facts (what changed), never opinions or judgments (whether changes are good/bad, or whether architecture deteriorated).
- **Zero false changes:** Comment-only edits, whitespace variations, line shifts, and file mtime updates with matching content hashes do not trigger modifications.
- **Zero false certainty:** Ambiguous file renames or cross-file symbol relocations are never guessed; they are explicitly identified and preserved as separate additions/removals with recorded limitations.
- **Strict repository isolation:** Cross-repository snapshot comparisons are strictly prohibited and fail validation immediately.
- **Transaction-safe & idempotent persistence:** When enabled, factual evolution events are written atomically and idempotently to the `evolution_events` table without duplicate accumulation.

---

## 2. Architecture & Subsystem Boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│                       Frontier CLI                          │
│         frontier intelligence compare <base> <target>       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     SnapshotComparator                      │
│                                                             │
│   1. SnapshotValidator                                      │
│      ├── Repository identity verification                   │
│      ├── Snapshot completeness & existence checks           │
│      └── Strict chronology enforcement (target >= base)     │
│                                                             │
│   2. Domain Diff Engines                                    │
│      ├── FileDiffEngine (SHA-256 hash, rename heuristic)    │
│      ├── SymbolDiffEngine (AST fingerprint, relocation)     │
│      ├── DependencyDiffEngine (specifier & target status)   │
│      ├── ComponentDiffEngine (membership delta)             │
│      └── AdrDiffEngine (ADR ID, status, content hash)       │
│                                                             │
│   3. Summary Derivation & Provenance Assembler              │
│      ├── ComparisonSummaryDeriver (reconciled counts)       │
│      └── Deduplicated & sorted evidence collection          │
│                                                             │
│   4. Output & Persistence                                   │
│      ├── ComparisonSerializer (deterministic JSON)          │
│      └── EventPersistenceBoundary (evolution_events write)  │
└─────────────────────────────────────────────────────────────┘
```

The comparator maintains strict architectural boundaries:

- **Scanner:** Discovers files and computes cryptographic hashes.
- **Extractor:** Extracts AST tokens, fingerprints, symbols, and imports.
- **Storage:** Persists snapshots, graph edges, components, and memories.
- **Snapshot Comparator (Stage 3):** Establishes factual differences between two snapshots.
- **Evolution Analyzer (Stage 4, Out-of-Scope):** Interprets changes and architectural trends in later stages.

---

## 3. Comparison Result Contract

The comparison engine produces a strongly typed, deterministic data transfer object (`SnapshotComparison`):

```typescript
export interface SnapshotComparison {
  comparisonId: string; // e.g. "cmp:<repoId>:<baseScanId>:<targetScanId>"
  repositoryId: number;
  repositoryIdentity: string;
  baseSnapshot: SnapshotHeader;
  targetSnapshot: SnapshotHeader;
  comparedAt: string;
  status: "COMPLETE" | "PARTIAL";
  summary: ComparisonSummary;
  files: FileDiffResult;
  symbols: SymbolDiffResult;
  dependencies: DependencyDiffResult;
  components: ComponentDiffResult;
  adrs: AdrDiffResult;
  evidence: ComparisonEvidence[];
  limitations: ComparisonLimitation[];
}
```

### Deterministic Ordering Conventions

All collections and arrays in the comparison contract have strict canonical orderings:

- **Files:** Sorted by `normalized_path ASC`.
- **Symbols:** Sorted by `symbol_identity ASC, name ASC`.
- **Dependencies:** Sorted by `source_path ASC, imported_specifier ASC, import_kind ASC`.
- **Components:** Sorted by `component_identity ASC`.
- **ADRs:** Sorted by `number ASC, adr_id ASC`.
- **Evidence:** Sorted by `evidence_id ASC`.
- **Limitations:** Sorted by `code ASC, domain ASC`.

---

## 4. Snapshot Validation Requirements

Before computing differences, `SnapshotValidator` executes strict verification rules:

1. **Distinct Identifiers:** Base scan ID and target scan ID cannot be equal (`ERR_IDENTICAL_SNAPSHOTS`).
2. **Snapshot Existence:** Both scan records must exist in `scan_runs` (`ERR_BASE_SNAPSHOT_NOT_FOUND`, `ERR_TARGET_SNAPSHOT_NOT_FOUND`).
3. **Repository Identity Match:** Both scans must belong to the exact same repository ID (`ERR_CROSS_REPOSITORY_COMPARISON`).
4. **Snapshot Completeness:**
   - Both scans must be `status === 'COMPLETE'`.
   - `RUNNING` or `VALIDATING` scans fail with `ERR_BASE_SNAPSHOT_IN_PROGRESS` or `ERR_TARGET_SNAPSHOT_IN_PROGRESS`.
   - `FAILED` or `CANCELLED` scans fail with `ERR_BASE_SNAPSHOT_INCOMPLETE` or `ERR_TARGET_SNAPSHOT_INCOMPLETE`.
   - `PARTIAL` scans fail with `ERR_BASE_SNAPSHOT_PARTIAL` or `ERR_TARGET_SNAPSHOT_PARTIAL` unless `allowPartial: true` (`--allow-partial`) is explicitly opted into. When `allowPartial: true` permits comparing a `PARTIAL` snapshot, the comparison output sets `status: "PARTIAL"` and records `LIM_PARTIAL_SNAPSHOT_COMPARISON`.
5. **Chronological Validity:**
   - Both `startedAt` timestamps must be valid ISO 8601 strings (`ERR_INVALID_SCAN_TIMESTAMP`).
   - `target.startedAt >= base.startedAt` must hold (`ERR_CHRONOLOGY_VIOLATION`).

---

## 5. Domain Diff Engine Rules

### 5.1 File Diff Engine

- Primary key: `normalized_path`.
- Matches:
  - Base absent, Target present $\rightarrow$ `ADDED`.
  - Base present, Target absent $\rightarrow$ `DELETED`.
  - Both present:
    - Safe files with hashes: If content hashes match $\rightarrow$ `UNCHANGED`. If content hashes differ $\rightarrow$ `MODIFIED`.
    - Safe files missing historical hashes: If either snapshot lacks a non-empty `contentHash` on a non-sensitive file, verified `MODIFIED`/`UNCHANGED` classification is withheld and `LIM_FILE_MISSING_HISTORICAL_HASH` is recorded.
    - Sensitive files: Secrets are never inspected or exposed; content hashes are null. Changes in file size, classification, or sensitivity status $\rightarrow$ `MODIFIED` with `isInferred: true` evidence and `LIM_SENSITIVE_FILE_CONTENT_UNINSPECTABLE` recorded.
    - Timestamp invariance: A file whose mtime changed but whose content hash is identical remains strictly `UNCHANGED`.
- Rename heuristics:
  - Exact unique content hash matching between deleted and added files (`isInferredRename: true`, `isInferred: true` evidence).
  - If multiple deleted or added files share the same content hash, rename inference is aborted to avoid false certainty and records `LIM_AMBIGUOUS_RENAME_CANDIDATES`.

### 5.2 Symbol Diff Engine

- Same-file primary key: `symbol_identity`.
- Fingerprint invariance: Token-normalized declaration fingerprints strip comments, whitespace, and line numbers.
  - Matching fingerprint $\rightarrow$ `UNCHANGED`.
  - Changed fingerprint $\rightarrow$ `MODIFIED`.
  - Line shifts without body changes are classified as `UNCHANGED`, while preserving snapshot-specific line ranges (`baseLines` vs `targetLines`).
- Relocation heuristics:
  - When a symbol is deleted from one file and added to another:
  - Evaluated on semantic key: `name + "::" + kind + "::" + scope + "::" + fingerprint`.
  - If the match is unique across all candidate additions and deletions $\rightarrow$ `RELOCATED` (`isInferred: true` evidence).
  - If multiple candidates exist $\rightarrow$ preserved as individual `REMOVED` and `ADDED` records marked with `isAmbiguous: true`, `ambiguityReason`, and `LIM_AMBIGUOUS_SYMBOL_RELOCATION`.

### 5.3 Dependency Diff Engine

- Primary key: `source_path + "::" + specifier + "::" + import_kind`.
- Classifications:
  - Target only (`RESOLVED`) $\rightarrow$ `ADDED`.
  - Target only (`UNRESOLVED`) $\rightarrow$ `UNRESOLVED` (counted strictly under `unresolved`, not double-counted as `added`).
  - Base only $\rightarrow$ `REMOVED`.
  - Both present with changed target file or resolution status $\rightarrow$ `MODIFIED`.
  - Persistent unresolved imports $\rightarrow$ strictly preserved as `UNRESOLVED` in both summary counts and detail collections, never falsely resolved or treated as removed without evidence.
  - Identical resolved specifier and target $\rightarrow$ `UNCHANGED`.

### 5.4 Component Diff Engine

- Primary key: `component_identity` (e.g. `comp:src/api`).
- Evaluates:
  - Added member files, removed member files, unchanged member files.
  - Boundary category, name, or confidence status (`CONFIRMED`, `INFERRED`, `CANDIDATE`) changes.
  - Any member file addition/removal or attribute/status change classifies the component as `MODIFIED`.
  - New components $\rightarrow$ `ADDED`; retired components $\rightarrow$ `REMOVED`.

### 5.5 ADR Diff Engine

- Primary key: ADR identifier (`ADR-xxx`) and number.
- Historical verification & fallback:
  - Disk markdown content is parsed ONLY when a file path is verified inside the workspace AND its SHA-256 hash matches the snapshot's indexed `content_hash`.
  - When disk content is missing, unreadable, or fails SHA-256 verification against the historical snapshot, `AdrDiffEngine` uses indexed path and content hash only without reading stale disk state, omits unverified `status` instead of fabricating a synthetic status, marks the item with `isFallback: true` / `isInferred: true`, and records `LIM_ADR_HISTORICAL_CONTENT_FALLBACK`.
  - When either snapshot lacks a historical `contentHash`, verified `MODIFIED`/`UNCHANGED` classification is withheld and `LIM_ADR_MISSING_HISTORICAL_HASH` is recorded.
- Evaluates:
  - Content hash, verified status, title, and path changes $\rightarrow$ `MODIFIED`.
  - Scope invariant: Stage 3 establishes factual ADR additions, removals, and modifications; architectural drift analysis, ADR contradiction detection, and engineering-debt interpretation are explicitly deferred to Stage 4.

---

## 6. Comparison Summary Derivation

All summary metrics are derived directly from the diff result collections via `ComparisonSummaryDeriver`:

- No independent counters are maintained.
- Summary counts must strictly reconcile with detail lists.
- Counts are non-negative integers ($\ge 0$).

---

## 7. Evolution Event Persistence Boundary

When `persistEvents: true` is enabled, the comparator writes factual change records to the `evolution_events` table created in Migration 003:

### Schema Invariant Compliance

- `repository_id`: Scoped strictly to the repository.
- `base_scan_id` & `target_scan_id`: Foreign keys to `scan_runs(repository_id, id)` with composite constraint enforcement.
- `category`: Checked against `('file', 'symbol', 'dependency', 'architecture', 'decision', 'debt')`.
- `severity`: Factual changes are persisted with `INFO` (or `LOW` for unresolved imports).
- `confidence_tier`: `CONFIRMED` for hash/AST-verified diffs, `INFERRED` for renames, relocations, sensitive metadata diffs, and fallback ADR events, and `CANDIDATE` for candidate component boundaries.

### Idempotency Guarantee

Inside an immediate transaction (`BEGIN IMMEDIATE`), `EventPersistenceBoundary` first verifies snapshot existence, repository ownership matching, and `SnapshotValidator` validity (`ERR_*` rejection rolls back before any mutation). It then deletes prior factual events strictly scoped to `(repository_id, base_scan_id, target_scan_id)` prior to inserting the replacement event set.

---

## 8. CLI Integration Reference

Command syntax:

```bash
npm run frontier -- [intelligence] compare <base-scan-id> <target-scan-id> [options]
node scripts/cli/frontier-cli.ts [intelligence] compare <base-scan-id> <target-scan-id> [options]
```

### Options

- `--format <text|json>`: Output format (default: text).
- `--workspace <path>`: Repository workspace directory.
- `--persist-events`: Persist factual change events to `evolution_events`.
- `--allow-partial`: Allow comparing `PARTIAL` snapshots (propagates `status: "PARTIAL"` and `LIM_PARTIAL_SNAPSHOT_COMPARISON`).

### Exit Codes

- `0`: Success (valid comparison produced).
- `2`: Validation error, chronology violation, cross-repository comparison, or missing arguments.
- `3`: Repository or database unavailable.
- `4`: Base or target snapshot record not found.
- `1`: Operational failure.

---

## 9. Performance Characteristics

Synthetic repository scaling benchmarks on Node.js / SQLite:

| Metric                    | Small (100 files, 300 symbols) | Medium (1,000 files, 3,000 symbols) | Large (5,000 files, 15,000 symbols) |
| ------------------------- | ------------------------------ | ----------------------------------- | ----------------------------------- |
| **Snapshot Validation**   | 0.33 ms                        | 0.10 ms                             | 0.11 ms                             |
| **File Diff Time**        | 14.11 ms                       | 15.43 ms                            | 43.68 ms                            |
| **Symbol Diff Time**      | 2.97 ms                        | 22.96 ms                            | 104.64 ms                           |
| **Dependency Diff Time**  | 1.80 ms                        | 9.01 ms                             | 62.29 ms                            |
| **Component Diff Time**   | 2.23 ms                        | 7.92 ms                             | 41.26 ms                            |
| **ADR Diff Time**         | 1.29 ms                        | 1.36 ms                             | 4.45 ms                             |
| **Serialization Time**    | 0.62 ms (7.5 KB)               | 2.38 ms (63.3 KB)                   | 5.90 ms (314.5 KB)                  |
| **Total Comparison Time** | **12.37 ms**                   | **50.57 ms**                        | **248.44 ms**                       |
| **Peak Heap Allocated**   | 16.64 MB                       | 22.56 MB                            | 83.78 MB                            |

Total comparison time scales linearly ($O(N)$ with hash lookups), remaining well under 250 milliseconds for a 5,000-file repository snapshot.

---

## 10. Known Limitations

1. **Syntactic Rename Scope:** Rename detection is limited to exact SHA-256 content matches. Heuristic partial renames (fuzzy edits) are intentionally rejected to maintain zero false certainty.
2. **Filesystem Dependency for Historical ADR Markdown:** Because SQLite `files` stores normalized paths and SHA-256 `content_hash` values without raw file bodies, historical ADR title/status extraction from disk runs only when the on-disk file's SHA-256 matches the indexed snapshot hash. When a historical file is missing from disk or has been modified in a newer revision, `AdrDiffEngine` falls back to indexed path/hash metadata with `LIM_ADR_HISTORICAL_CONTENT_FALLBACK` and omits unverified status fields.
3. **Partial Snapshot Completeness:** Comparisons invoked with `--allow-partial` / `allowPartial: true` surface `status: "PARTIAL"` and `LIM_PARTIAL_SNAPSHOT_COMPARISON`; missing files or symbols in incomplete scans are excluded from verified change claims.
4. **Sensitive File Inspection:** Secrets are never read or diffed; sensitive files are compared strictly on filesystem metadata (`isInferred: true` evidence and `LIM_SENSITIVE_FILE_CONTENT_UNINSPECTABLE`).
5. **Stage 3 Scope Boundary (Deferred to Stage 4):** Stage 3 implements deterministic snapshot validation, multi-domain diffing, evidence/limitation reporting, and idempotent factual event persistence. Architectural drift interpretation, ADR contradiction detection, memory staleness/contradiction evaluation, and engineering-debt scoring remain deferred to Stage 4.
