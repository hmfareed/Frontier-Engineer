# Part 37: Architecture Intelligence & Query CLI

## Overview

Phase 7.4 delivers the **Architecture Intelligence & Query CLI** subsystem for Frontier Engineer. It builds upon the scanner (Phase 7.1), AST extractors (Phase 7.2), SQLite persistence layer (Phase 7.3), and graph engine (Phase 7.3) to provide deterministic, evidence-backed answers to concrete engineering questions.

### Core Engineering Principle

> **Deterministic repository evidence first. Architecture interpretation second. AI-assisted explanation only when evidence supports it.**

Frontier Engineer does not use stochastic AI text generators, vector embeddings, or ungrounded heuristics for repository intelligence. Every structural insight, component boundary, entry point, dependency path, circular cycle, test association, and architectural decision is backed by verified repository evidence.

---

## 1. Architecture Intelligence Model

### 1.1 Multi-Evidence Component Classification

Component classification evaluates multiple structural signals rather than relying solely on directory names:

| Category     | Typical Roots                                    | Primary Required Evidence for `CONFIRMED` Status                                                                                                                       | Fallback `INFERRED` / `CANDIDATE`                                            |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `frontend`   | `src/components`, `ui`, `pages`                  | JSX/TSX AST nodes, React/Vue/Svelte/Next.js imports                                                                                                                    | Directory convention without direct JSX evidence (`confidence = 0.70`)       |
| `backend`    | `src/api`, `src/server`, `controllers`, `routes` | HTTP server imports (`express`, `fastify`, `hono`, `node:http`), API route handlers (`route.ts`, `route.js`)                                                           | Directory naming without confirmed framework imports (`confidence = 0.65`)   |
| `database`   | `src/db`, `schema`, `migrations`, `prisma`       | SQL migration files, Prisma schema (`schema.prisma`), ORM/client imports (`node:sqlite`, `pg`, `mysql2`, `@prisma/client`, `typeorm`, `drizzle-orm`, `knex`, `kysely`) | Directory named `db` without verified driver imports (`confidence = 0.70`)   |
| `auth`       | `src/auth`, `security`                           | Authentication/crypto libraries (`jsonwebtoken`, `bcrypt`, `passport`, `next-auth`, `@auth0/nextjs-auth0`, `argon2`, `lucia`)                                          | Directory named `auth` without verified crypto imports (`confidence = 0.70`) |
| `shared_lib` | `packages/*`, `src/lib`, `common`                | Monorepo package manifests (`packages/*/package.json`) or shared library conventions                                                                                   | Directory naming without package boundary (`confidence = 0.75`)              |
| `test`       | `tests`, `test`, `__tests__`                     | Verified test files (`.test.ts`, `.spec.ts`)                                                                                                                           | Directory convention (`confidence = 1.0`)                                    |
| `docs`       | `docs`, `documentation`                          | Markdown documentation or Architecture Decision Records                                                                                                                | Directory convention (`confidence = 1.0`)                                    |

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
  snapshotStatus: "COMPLETE" | "PARTIAL" | "STALE" | "FAILED" | "NONE";
  freshness: FreshnessAssessment;
  query: {
    category: string;
    target?: string;
    parameters?: Record<string, unknown>;
  };
  data: T;
  evidence: QueryEvidence[];
  confidence: "CONFIRMED" | "INFERRED" | "CANDIDATE" | "MIXED";
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

The `FreshnessEvaluator` assesses repository intelligence without mutating data:

- **`NONE`:** No active scan index exists.
- **`COMPLETE`:** Active scan succeeded and workspace files have not drifted.
- **`PARTIAL`:** Active scan was promoted under partial opt-in.
- **`STALE`:** Key configuration (`package.json`, `tsconfig.json`) or source files have modification timestamps newer than `scan_runs.started_at`.
- **`FAILED`:** Latest scan failed with preserved failure reason.

---

## 3. Intelligence Query CLI

The command-line interface is available via `frontier intelligence <subcommand>` or `npm run frontier -- intelligence <subcommand>`.

### 3.1 Command Reference

```bash
frontier intelligence status [--format text|json]
frontier intelligence overview [--format text|json]
frontier intelligence components [--format text|json] [--limit 50]
frontier intelligence component <name> [--format text|json]
frontier intelligence entrypoints [--format text|json]
frontier intelligence dependencies <target> [--depth 3] [--limit 50] [--format text|json]
frontier intelligence dependents <target> [--depth 3] [--limit 50] [--format text|json]
frontier intelligence cycles [--format text|json]
frontier intelligence file <path> [--format text|json]
frontier intelligence symbol <name> [--format text|json]
frontier intelligence tests [target] [--format text|json]
frontier intelligence decisions [--format text|json]
frontier intelligence decision <id> [--format text|json]
frontier intelligence query "<expression>" [--format text|json]
```

### 3.2 Output Formats

- **Terminal Output (`--format text`, default):** Human-readable, structured layout with status badges, aligned tables, dependency trees, and truncation indicators.
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
- **Inert Data Handling:** Repository descriptions, README text, and comments are treated strictly as inert string data and never interpreted as instructions.

---

## 6. Performance Benchmarks

Measured on synthetic repositories across small, medium, and large scales under Vitest:

| Repository Scale | Files | Extracted Symbols | Graph Nodes | Graph Edges | Ingestion Latency | Overview Query | Components Query | Dependencies (depth 3) | Cycle Analysis | Symbol Search |
| ---------------- | ----- | ----------------- | ----------- | ----------- | ----------------- | -------------- | ---------------- | ---------------------- | -------------- | ------------- |
| **Small**        | 50    | 150               | 205         | 302         | 117ms             | 68ms           | 3ms              | 13ms                   | 3ms            | 13ms          |
| **Medium**       | 200   | 600               | 805         | 1202        | 341ms             | 40ms           | 5ms              | 7ms                    | 4ms            | 4ms           |
| **Large**        | 600   | 1800              | 2405        | 3602        | 822ms             | 33ms           | 9ms              | 9ms                    | 8ms            | 4ms           |

All individual queries execute within **< 70ms** even on large synthetic repositories.
