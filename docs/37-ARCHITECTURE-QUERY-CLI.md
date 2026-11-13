# Part 37: Architecture Intelligence & Query CLI

## Overview

Phase 7.4 delivers the **Architecture Intelligence & Query CLI** subsystem for Frontier Engineer. It builds upon the scanner (Phase 7.1), AST extractors (Phase 7.2), SQLite persistence layer (Phase 7.3), and graph engine (Phase 7.3) to provide deterministic, evidence-backed answers to concrete engineering questions.

### Core Engineering Principle

> **Deterministic repository evidence first. Architecture interpretation second. AI-assisted explanation only when evidence supports it.**

Frontier Engineer does not use stochastic AI text generators, vector embeddings, or ungrounded heuristics for repository intelligence. Every structural insight, component boundary, entry point, dependency path, circular cycle, test association, and architectural decision is backed by verified repository evidence.

---

## 1. Architecture Intelligence Model

### 1.1 Multi-Evidence Component Classification

Component classification evaluates multiple structural signals rather than relying solely on directory names or raw imports:

| Category     | Typical Roots                                    | Primary Required Evidence for `CONFIRMED` Status                                                                | Fallback `INFERRED` / `CANDIDATE`                                                                                              |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `frontend`   | `src/components`, `ui`, `pages`                  | JSX/TSX AST nodes, React/Vue/Svelte/Next.js imports                                                             | Directory convention without direct JSX evidence (`confidence = 0.70`)                                                         |
| `backend`    | `src/api`, `src/server`, `controllers`, `routes` | HTTP server imports (`express`, `fastify`, `hono`, `node:http`), API route handlers (`route.ts`, `route.js`)    | Directory naming without confirmed framework imports (`confidence = 0.65`)                                                     |
| `database`   | `src/db`, `schema`, `migrations`, `prisma`       | SQL migration files, Prisma schema (`schema.prisma`), or direct schema definitions                              | ORM or driver imports alone without verified migration/schema files, or directory named `db` (`confidence = 0.70`, `INFERRED`) |
| `auth`       | `src/auth`, `security`                           | Dedicated auth middleware/handler files (`middleware.ts`, `auth.ts`, `passport.ts`) implementing access control | Auth package imports alone without verified middleware/handlers, or directory named `auth` (`confidence = 0.70`, `INFERRED`)   |
| `shared_lib` | `packages/*`, `src/lib`, `common`                | Monorepo package manifests (`packages/*/package.json`) or shared library conventions                            | Directory naming without package boundary (`confidence = 0.75`)                                                                |
| `test`       | `tests`, `test`, `__tests__`                     | Verified test files (`.test.ts`, `.spec.ts`)                                                                    | Directory convention (`confidence = 1.0`)                                                                                      |
| `docs`       | `docs`, `documentation`                          | Markdown documentation or Architecture Decision Records                                                         | Directory convention (`confidence = 1.0`)                                                                                      |

#### Four-Tier Deterministic Confidence Model

The query engine and architecture analyzer assign one of four confidence ratings based on verified repository evidence:

1. **`CONFIRMED` (1.00 / 0.90+):** Verified by direct AST nodes, schema files, or explicit manifest declarations.
2. **`INFERRED` (0.70 – 0.85):** Supported by indirect structural signals, package imports without handler implementations, or standard naming conventions.
3. **`CANDIDATE` (0.50 – 0.65):** Tentative evidence such as loose folder naming without matching symbols or configuration.
4. **`UNRESOLVED` (0.00 – 0.49):** Explicitly unresolvable targets, broken references, or unconfirmed syntactic calls.

Multi-signal variance across collections is tracked separately via `isMixedConfidence: boolean` on `QueryResult<T>` rather than being conflated into a confidence tier.

#### Relationship Evidence Integrity

Edges such as `CALLS`, `AUTHENTICATES`, `AUTHORIZES`, `USES_DATABASE`, `IMPLEMENTS`, `REFERENCES`, and `EXPOSES` are strictly evidence-backed:

- **`CALLS` Relationships:** A syntactic call expression does not create a confirmed `CALLS` edge unless the target symbol can be resolved to a specific declaration. Unresolved syntactic calls are preserved separately as unconfirmed references without misrepresenting imports as function calls.
- **`USES_DATABASE` and `AUTHENTICATES`:** Importing an ORM (e.g. Prisma, TypeORM, Drizzle) or authentication library (e.g. bcrypt, jsonwebtoken, next-auth) provides candidate/inferred evidence of architectural subsystem affiliation, but does not confirm an active database or security boundary without supporting AST usage, migration files, or middleware logic.

### 1.2 Application Entrypoint Detection

Entrypoints are discovered through manifest inspection and framework conventions:

- **CLI Executables:** Declared in `package.json` under `bin` string or map (`status: "CONFIRMED"`, `confidence: 1.0`).
- **Library Roots:** Declared in `package.json` under `main` or `module` (`status: "CONFIRMED"`, `confidence: 1.0`).
- **Server Bootstrap:** Targeted by `npm start` script (`node src/server.js`) or Python WSGI/ASGI (`manage.py`, `wsgi.py`) (`status: "CONFIRMED"`, `confidence: 0.95`).
- **Browser SPA / SSR:** Next.js App Router (`app/page.tsx`, `pages/index.tsx`) or Vite (`src/main.tsx`) (`status: "CONFIRMED"`, `confidence: 0.90–0.95`).
- **Convention Roots:** Standalone `src/index.ts` with exported symbols undeclared in `package.json` are marked as `status: "INFERRED"` (`confidence: 0.75`), never falsely labeled as confirmed.

### 1.3 Tarjan's Strongly Connected Components (SCC) & Cycle Analysis

Circular import loops are identified using Tarjan's Strongly Connected Components (SCC) algorithm combined with elementary cycle path extraction:

- **Adjacency Representation:** Built from resolved internal import edges in SQLite.
- **Complexity:** $O(V + E)$ time and space complexity.
- **Deterministic Ordering:** All cycles and SCC nodes are normalized and sorted by UTF-16 code units (lexicographical order), guaranteeing identical outputs across runs.

### 1.4 Architecture Decision Record (ADR) Extraction

Architecture Decision Records located in `docs/adr/ADR-*.md` are parsed deterministically:

- Extracts ADR number, title, status (`Accepted`, `Proposed`, `Deprecated`), date, and phase.
- Extracts related document references.
- Associates ADRs with governed repository components based on explicit component path mentions.
- Retains confidence `1.0` and `status: "CONFIRMED"` with exact source file evidence.

---

## 2. Architecture Query Engine

The `ArchitectureQueryEngine` (`scripts/query/query-engine.ts`) provides a reusable, read-only API over persisted SQLite snapshots and the graph engine.

### 2.1 Public API Interface

```ts
export interface ArchitectureQueryEngineInterface {
  getStatus(): Promise<QueryResult<RepositoryStatusData>>;
  getOverview(options?: QueryOptions): Promise<QueryResult<RepositoryOverviewData>>;
  getFreshness(options?: FreshnessEvaluationOptions): Promise<QueryResult<FreshnessAssessment>>;
  listComponents(options?: QueryOptions): Promise<QueryResult<ComponentListData>>;
  getComponent(
    nameOrIdentity: string,
    options?: QueryOptions,
  ): Promise<QueryResult<ComponentDetailData>>;
  getEntrypoints(options?: QueryOptions): Promise<QueryResult<EntrypointListData>>;
  getFile(filePath: string, options?: QueryOptions): Promise<QueryResult<FileDetailData>>;
  getSymbol(name: string, options?: QueryOptions): Promise<QueryResult<SymbolSearchResult>>;
  getDependencies(
    target: string,
    options?: TraversalQueryOptions,
  ): Promise<QueryResult<DependencyTraversalData>>;
  getDependents(
    target: string,
    options?: TraversalQueryOptions,
  ): Promise<QueryResult<DependencyTraversalData>>;
  getCycles(options?: QueryOptions): Promise<QueryResult<CycleData>>;
  getTests(target?: string, options?: QueryOptions): Promise<QueryResult<TestAssociationData>>;
  getDecisions(options?: QueryOptions): Promise<QueryResult<DecisionListData>>;
  getDecision(id: string, options?: QueryOptions): Promise<QueryResult<DecisionDetailData>>;
}
```

### 2.2 Result DTO Contract

Every query result adheres to the `QueryResult<T>` contract:

```ts
export interface QueryResult<T> {
  repositoryId: number;
  repositoryIdentity: string;
  scanId: number;
  snapshotStatus: "FRESH" | "COMPLETE" | "PARTIAL" | "STALE" | "FAILED" | "NONE";
  freshness: FreshnessAssessment;
  query: {
    category: string;
    target?: string;
    parameters?: Record<string, unknown>;
  };
  data: T;
  evidence: QueryEvidence[];
  confidence: "CONFIRMED" | "INFERRED" | "CANDIDATE" | "UNRESOLVED";
  isMixedConfidence?: boolean;
  warnings: string[];
  limitsApplied: {
    depthLimit?: number;
    resultLimit?: number;
    truncated: boolean;
  };
  generatedAt: string;
}
```

### 2.3 Freshness & Staleness Assessment

The `FreshnessEvaluator` (`scripts/query/freshness-evaluator.ts`) verifies repository intelligence without mutating data or executing repository code:

- **`FRESH`:** Active scan completed successfully, all manifests and indexed source files match workspace disk state, and no unindexed source additions or deletions exist.
- **`COMPLETE`:** Legacy alias for fresh active scan.
- **`PARTIAL`:** Active scan was promoted under partial opt-in mode. Emits prominent `[PARTIAL SNAPSHOT]` warning banner.
- **`STALE`:** Drift detected between workspace disk files and active snapshot metadata.
- **`FAILED`:** Latest scan failed, superseding older active snapshots until re-indexed; or repository root missing/inaccessible.
- **`NONE`:** No active scan run exists for the repository.

#### Metadata-Verified vs. Content-Verified Distinction

Freshness verification operates under an explicit two-tier strategy:

1. **`INVENTORY_METADATA` (Default):**
   - Checks inventory membership, file existence, file sizes, and filesystem timestamps.
   - Bounded cost: avoids re-parsing ASTs or hashing entire repository trees during standard queries.
   - **Explicit Disclosure:** Metadata evaluation discloses that same-size content changes with preserved timestamps within tolerance cannot be detected without content hashing.
2. **`CONTENT_HASH` (Explicit via `--verify-content`):**
   - Computes cryptographic SHA-256 digests of workspace files and compares against indexed `content_hash` records.
   - Reports complete content verification only when all applicable indexed files are hash-verified.
   - Discloses limitations if sensitive files are excluded (to prevent secret leaks) or if any unreadable paths were skipped.

#### Timestamp Tolerance Rationale

The evaluator applies a **1,000 ms tolerance window** when comparing filesystem `mtimeMs` against indexed modification timestamps:

- **Filesystem Granularity Differences:** FAT32 filesystems enforce 2-second timestamp precision; older UNIX ext2/ext3 and HFS+ filesystems enforce 1-second precision.
- **Tooling Jitter:** ZIP archives, `tar` extractions, and Git checkouts frequently truncate sub-second components, rounding timestamps to the nearest second.
- **Scan Ingestion Window:** Files touched during the start second of a scan run could otherwise appear slightly ahead of `scan_runs.started_at`.
- **Integrity Rule:** Changes occurring within the 1,000 ms window with unchanged sizes are recognized as undetected by metadata checks and are disclosed in `disclosures[]`. When cryptographic assurance is required, `--verify-content` detects them via SHA-256 mismatch.

#### Missing vs. Inaccessible Root Distinction

- **Missing Root:** When the directory does not exist (`!fs.existsSync(rootPath)`), returns `FAILED` with `staleReason: Repository root path does not exist: <path>`.
- **Inaccessible Root:** When the directory exists but read access is denied (`fs.accessSync(..., R_OK)` throws EACCES), returns `FAILED` with `staleReason: Repository root path exists but is inaccessible: <path>`.

### 2.4 Authoritative Active Snapshot Contract & Historical Scans

- **Source of Truth:** The authoritative active snapshot pointer is `repositories.active_scan_id`. `scan_runs.is_active` is maintained in atomic synchronization by `promoteScan()`.
- **Unindexed State:** When `repositories.active_scan_id` is null, commands requiring an index return exit code 3 (`Repository index is unavailable`).
- **Failure Preservation:** If a subsequent scan run fails, `repositories.active_scan_id` remains unchanged (preserving the older stable snapshot), but the `FreshnessEvaluator` marks the index `STALE` with notice of the failed latest scan.
- **Historical Query Isolation:** Explicit `--scan-id <id>` queries inspect historical snapshots without modifying `repositories.active_scan_id`. Requesting an unrecorded scan ID safely rejects with exit code 4.
- **Snapshot Diffs:** Historical snapshot comparisons and deterministic diffing are implemented in Phase 7.5 Stage 3 via `SnapshotComparator` and the `frontier intelligence compare` CLI command (see [Part 39](39-SNAPSHOT-COMPARATOR-DIFF-ENGINE.md)).

### 2.5 Evidence Integrity & Secret Safety

- **Canonical Paths:** Evidence records use canonical repository-relative POSIX paths.
- **Valid Coordinates:** Start and end lines are verified AST coordinates.
- **Redaction of Sensitive Files:** Files flagged as sensitive in the inventory have their contents redacted (`contentHash: null`) and their symbols omitted from search results.
- **Honest Warnings:** If an evidence file was deleted or moved from disk after indexing, the query engine records an honest warning in `warnings[]` rather than fabricating file contents.

---

## 3. Intelligence Query CLI

The command-line interface is available via npm script or node invocation:

```bash
npm run frontier -- [intelligence] <command> [options]
# or directly:
node scripts/cli/frontier-cli.ts [intelligence] <command> [options]
```

_(Note: `frontier` is an npm script in `package.json`, not a globally installed standalone executable unless linked)._

### 3.1 Command Reference

The CLI supports **15 primary architecture intelligence commands** and **1 command alias** (16 command invocations total):

#### Primary Commands (15)

```bash
npm run frontier -- status [--format text|json]
npm run frontier -- overview [--format text|json]
npm run frontier -- freshness [--verify-content] [--format text|json]
npm run frontier -- components [--format text|json] [--limit 50]
npm run frontier -- component <name> [--format text|json]
npm run frontier -- entrypoints [--format text|json]
npm run frontier -- dependencies <target> [--depth 3] [--limit 50] [--format text|json]
npm run frontier -- dependents <target> [--depth 3] [--limit 50] [--format text|json]
npm run frontier -- cycles [--format text|json]
npm run frontier -- file <path> [--format text|json]
npm run frontier -- symbol <name> [--format text|json]
npm run frontier -- tests [target] [--format text|json]
npm run frontier -- decisions [--format text|json]
npm run frontier -- decision <id> [--format text|json]
npm run frontier -- query "<expression>" [--format text|json]
```

#### Command Aliases (1)

```bash
npm run frontier -- deps <target> [--depth 3] [--limit 50] [--format text|json]  # alias for dependencies
```

#### Snapshot Comparison & Evolution Analysis Commands (Phase 7.5 Stages 3 & 4)

```bash
npm run frontier -- compare <base-scan-id> <target-scan-id> [--persist-events] [--allow-partial] [--format text|json]
npm run frontier -- evolution <base-scan-id> <target-scan-id> [--persist-events] [--apply-lifecycle] [--allow-partial] [--format text|json]
npm run frontier -- drift <base-scan-id> <target-scan-id> [--allow-partial] [--format text|json]
npm run frontier -- debt <base-scan-id> <target-scan-id> [--allow-partial] [--format text|json]
npm run frontier -- memories [--scan-id <id>] [--apply-lifecycle] [--allow-partial] [--limit 50] [--format text|json]
npm run frontier -- memory <memory_key_or_id> [--format text|json]
```

- **Read-Only Default & Flag Restrictions:** `evolution`, `drift`, `debt`, and `memories` are read-only unless explicitly opted into mutations via `--persist-events` (permitted only on `compare` and `evolution`) or `--apply-lifecycle` (permitted only on `evolution` and `memories --scan-id <id>`). Misplaced mutation flags exit with code `2`.
- **Workspace Repository Ownership:** `compare`, `evolution`, `drift`, `debt`, `memories --scan-id <id>`, and `memory <id>` validate `expectedRepositoryId` against the resolved workspace repository before evaluating or persisting data. Foreign scan IDs exit with code `2`, foreign memory IDs exit with code `4` (without leaking `memory_versions` across repositories), and rejected invocations perform zero workspace database mutations even when `--persist-events` or `--apply-lifecycle` is supplied.
- All commands accept `--scan-id <id>` to target an explicit historical scan (and `memories`/`memory` preserve full repository-scoped version lookup).

### 3.2 Output Formats

- **Terminal Output (`--format text`, default):** Human-readable, structured layout with status badges, aligned tables, dependency trees, and truncation indicators. Displays `[PARTIAL SNAPSHOT]` warning banner when inspecting partial snapshots.
- **JSON Output (`--format json`):** 100% parseable JSON on `stdout` without debug pollution, suitable for tool piping and future agent integration.

### 3.3 Exit Codes Contract

| Exit Code | Meaning                            | Condition                                                                 |
| --------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `0`       | **Success**                        | Query executed cleanly and returned matching data.                        |
| `1`       | **Operational Failure**            | Database read error, unexpected crash, or filesystem failure.             |
| `2`       | **Invalid Command / Arguments**    | Unrecognized subcommand, missing required argument, or malformed flag.    |
| `3`       | **Repository / Index Unavailable** | Workspace root missing, database not found, or active scan not available. |
| `4`       | **Target Not Found**               | Specified component, file, symbol, or ADR not found in active index.      |

---

## 4. Deterministic Natural Query Grammar

The `QueryGrammar` parser translates English-like questions into structured queries without LLM calls:

| Natural Query Expression                          | Mapped Subcommand       |
| ------------------------------------------------- | ----------------------- |
| `what does this repository contain?`              | `overview`              |
| `what is the status of the index?`                | `status`                |
| `is the index fresh?`                             | `freshness`             |
| `check freshness`                                 | `freshness`             |
| `what are the architectural components?`          | `components`            |
| `inspect component <name>`                        | `component <name>`      |
| `which files are responsible for authentication?` | `component auth`        |
| `where is database?`                              | `component database`    |
| `what are the entry points?`                      | `entrypoints`           |
| `what does <target> depend on?`                   | `dependencies <target>` |
| `what depends on <target>?`                       | `dependents <target>`   |
| `are there circular dependencies?`                | `cycles`                |
| `which tests cover <target>?`                     | `tests <target>`        |
| `what architectural decisions are documented?`    | `decisions`             |
| `inspect decision <id>`                           | `decision <id>`         |
| `inspect file <path>`                             | `file <path>`           |
| `find symbol <name>`                              | `symbol <name>`         |

---

## 5. Security & Privacy Implementation

- **Read-Only Operations:** The query engine and CLI execute read-only queries (`SELECT`). No writes to repository source code, active snapshots, or package managers.
- **Parameterized SQL:** All user inputs and targets are parameterized (`?` placeholders). No string concatenation into SQL statements.
- **Filesystem Sandbox Bounding:** Target paths are resolved and verified against the workspace root. Symlinks resolving outside the root and path traversal attempts (`../../`) are rejected.
- **Zero Raw Source Persistence:** Source code bodies, secret values, and environment credentials are never persisted in the intelligence database.
- **Sensitive File Protection:** Sensitive files have their content hashes redacted and symbols suppressed from public query output.
- **Inert Data Handling:** Repository descriptions, README text, and comments are treated strictly as inert string data and never interpreted as instructions.

---

## 6. Performance Benchmarks & Platform Disclosures

### 6.1 Test Environment Disclosures

- **Host Environment:** Windows 11 x64, Intel Core i7, Node.js v22.14.0, SQLite (via `node:sqlite`).
- **Bounded Test Concurrency:** `vitest.config.ts` constrains Vitest worker concurrency with `maxWorkers: 4` (and `testTimeout: 15000`) to avoid worker IPC starvation and timeouts under full-suite execution on Windows hosts.
- **Cross-Platform Qualifications:** Internally, path handling and query normalizers enforce canonical POSIX paths (`/`). Actual automated tests were executed exclusively on the verified Windows 11 host environment. Platform compatibility for Linux or macOS is limited to path normalization logic; host-level execution on other platforms is subject to platform-specific CI pipelines.
- **Scope Limitation:** Benchmark fixtures represent synthetic repositories of 50, 200, and 600 files. 600 files represents a synthetic scaling test sample, not a claim of universal suitability for multi-million-line monorepos. Measured results under synthetic fixtures do not constitute a contractual SLA across arbitrary host hardware.

### 6.2 Measured Benchmark Results

Measured on synthetic repositories across small, medium, and large scales under Vitest:

| Repository Scale | Files | Extracted Symbols | Graph Nodes | Graph Edges | Ingestion Latency | Overview Query | Components Query | Dependencies (depth 3) | Cycle Analysis | Symbol Search |
| ---------------- | ----- | ----------------- | ----------- | ----------- | ----------------- | -------------- | ---------------- | ---------------------- | -------------- | ------------- |
| **Small**        | 50    | 150               | 205         | 302         | 117ms             | 68ms           | 3ms              | 13ms                   | 3ms            | 13ms          |
| **Medium**       | 200   | 600               | 805         | 1202        | 341ms             | 40ms           | 5ms              | 7ms                    | 4ms            | 4ms           |
| **Large**        | 600   | 1800              | 2405        | 3602        | 822ms             | 33ms           | 9ms              | 9ms                    | 8ms            | 4ms           |

Observed query latencies across all synthetic benchmark fixtures remain under **70ms** under the tested environment.
