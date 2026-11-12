# ADR-007: Storage Engine, Deterministic Graph, and Architecture Intelligence

- **Status:** Accepted
- **Date:** 2026-11-12
- **Phase:** 7.3
- **Related:** [Part 14 Engineering Principles](../14-ENGINEERING-PRINCIPLES.md), [ADR-001](ADR-001-foundation.md), [ADR-005](ADR-005-mcp-integration-architecture.md), [ADR-006](ADR-006-lifecycle-hooks-architecture.md), [Storage Architecture](../34-STORAGE-ARCHITECTURE.md), [Graph Engine Architecture](../35-GRAPH-ENGINE-ARCHITECTURE.md), [Architecture Intelligence](../36-ARCHITECTURE-INTELLIGENCE.md)

## Context

Phases 7.1 and 7.2 established the foundational repository scanner and structural extractors for Frontier Engineer. These subsystems operate purely in memory:

- Phase 7.1 discovers, classifies, filters, hashes, and orders repository files deterministically, enforcing strict exclusions for sensitive content and vendor directories (`node_modules`, `.git`, `.frontier`).
- Phase 7.2 parses source files into ASTs, extracts exported/local symbols with stable content fingerprints, resolves module imports, and collects source evidence.

However, in-memory representations cannot support cross-session queries, incremental indexing, complex dependency traversals, or holistic architecture intelligence. Frontier Engineer requires a durable local database and a queryable engineering graph to answer structural questions (e.g., component boundaries, entrypoint topology, downstream dependents, test coverage associations) with verified repository evidence.

## Decision Drivers

1. **Zero Runtime Dependencies & Plugin Packaging Integrity:** The Antigravity plugin distribution model requires self-contained packaging without relying on runtime `node_modules` or host compilation toolchains (`node-gyp`, Python, C++ compilers).
2. **Deterministic & Verifiable Operations:** Database queries, graph construction, and architecture classifications must produce identical results given identical inputs, without stochastic AI generation or ungrounded heuristics.
3. **Transactional Snapshot Safety:** A failed or interrupted scan must never corrupt or replace an existing active index. Snapshots must be staged, validated, and atomically promoted.
4. **Relational Integrity & Foreign-Key Isolation:** Entities must be strictly scoped to a repository and scan run. Composite foreign keys must prevent cross-repository or cross-scan leakage at the database engine level.
5. **Cross-Platform Compatibility:** Must run seamlessly on Windows x64, Linux, and macOS without platform-specific binary dependencies or path delimiter fragility.
6. **Data Privacy & Security:** Sensitive content, raw source files, extracted credentials, and unhashed sensitive contents must never be persisted.

## Evaluated Alternatives

### 1. `better-sqlite3`

- _Pros:_ High-performance synchronous SQLite driver widely used in Node.js ecosystem.
- _Cons:_ Native C++ addon requiring node-gyp compilation or prebuilt binary downloads. Distribution in sandboxed or isolated plugin environments often fails when prebuilt binaries mismatch the host Node ABI or libc. Violates the zero-dependency distribution requirement.

### 2. `sqlite3` (node-sqlite3)

- _Pros:_ Legacy standard SQLite driver for Node.js.
- _Cons:_ Asynchronous callback-heavy API; heavy native build dependencies; well-known build failures on Windows; suboptimal performance for batch structural persistence.

### 3. WASM-based SQLite (`sql.js` / `@sqlite.org/sqlite-wasm`)

- _Pros:_ Pure WebAssembly; no native compilation required.
- _Cons:_ Incurs significant memory overhead (entire database in memory or virtual filesystem); lacks robust native OS file locking, WAL mode, and standard file-descriptor durability.

### 4. Built-in `node:sqlite` (`DatabaseSync`) — Selected

- _Pros:_ Built directly into Node.js core (experimental in 22.5.0, unflagged in 22.13.0, stable/RC in 24.x). Zero external npm packages, zero native compilation, zero prebuild downloads. C-speed native SQLite engine bundled inside Node. Supports WAL mode, PRAGMA foreign keys, prepared statements, and immediate transactions.
- _Cons:_ Synchronous API; requires careful batching to avoid blocking the event loop during large batch inserts. Requires Node.js >= 22.13.0 (satisfied by the host environment: Node v24.21.0).

## Decisions

### 1. SQLite Driver Selection: `node:sqlite` (`DatabaseSync`)

Frontier Engineer adopts Node.js built-in `node:sqlite` (`DatabaseSync`) as its canonical persistence engine. This enables 100% self-contained operation without external runtime dependencies.

### 2. Project-Local Storage Location

Databases are persisted in the workspace's local `.frontier` directory:

```text
.frontier/
  intelligence/
    index.sqlite
    index.sqlite-wal
    index.sqlite-shm
    metadata.json
    backups/
```

- `.frontier/` is strictly excluded from scanner discovery and git tracking.
- Database access is bounded to the project workspace; path traversal attempts outside the workspace root are rejected.

### 3. Repository Identity & Workspace Verification

To prevent database cross-contamination across workspaces, moved folders, or cloned copies:

- A stable repository identity is derived from repository metadata and persisted in both `.frontier/intelligence/metadata.json` and the `repositories` database table.
- On initialization, the connection manager verifies workspace root paths and repository identities. If a mismatch is detected (e.g. database copied to another project), the database reports a workspace mismatch diagnostic and requires explicit re-initialization rather than silently merging data.

### 4. Normalized Schema & Migration System

- Schema versioning is managed via a dedicated `schema_migrations` table.
- Migrations are sequential, transactional, and strictly forward-versioned (e.g., `001-initial-schema.sql`).
- Foreign keys (`PRAGMA foreign_keys = ON;`) and WAL journal mode (`PRAGMA journal_mode = WAL;`) are enforced on every database connection.
- Composite foreign keys enforce that files, symbols, imports, exports, evidence, graph nodes, and graph edges cannot cross repository or scan boundaries.

### 5. Transactional Snapshot Persistence & Atomic Promotion

- Scan runs follow strict lifecycle statuses: `RUNNING` -> `VALIDATING` -> `COMPLETE` (or `PARTIAL`, `CANCELLED`, `FAILED`).
- All inventory, structural extractions, and graph entities are written under the staging `scan_id`.
- Referential integrity and completeness are verified _before_ promotion.
- Atomic promotion updates `repositories.active_scan_id = new_scan_id` in an immediate transaction.
- If a scan fails or is cancelled, the existing `active_scan_id` remains unchanged. The previous last-known-good snapshot is preserved.
- Interrupted scans (`RUNNING` status on restart) are flagged as `FAILED` during crash recovery without destroying valid prior snapshots.

### 6. Deterministic Graph Engine

- **Nodes:** Typed entities with deterministic IDs (`repo:<id>`, `dir:<path>`, `file:<path>`, `sym:<file>#<name>`, `pkg:<name>`, `mod:<specifier>`, `test:<path>`, `comp:<name>`, `adr:<id>`).
- **Edges:** Explicit directed relationships (`CONTAINS`, `DEFINES`, `IMPORTS`, `EXPORTS`, `DEPENDS_ON`, `TESTS`, `DOCUMENTS`, `DECIDED_BY`).
- **Provenance:** Every edge references structural evidence (`source_evidence`) and confidence (`CONFIRMED` vs `INFERRED`).
- **Unresolved Imports:** Retained explicitly with status `UNRESOLVED` to prevent silent omissions.
- **Safety:** Graph traversals are cycle-safe (visited set tracking) and bounded by a configurable `maxDepth`.

### 7. Evidence-Based Architecture Intelligence

- Entrypoint detection, component classification, dependency topology, and test associations are derived purely from deterministic code and configuration evidence (e.g. package manifests, export roots, import graphs).
- Classifications are never hallucinated or AI-generated; they include confidence scores, evidence traces, and explicit distinction between `CONFIRMED` and `INFERRED`.

## Consequences

### Positive

- Fully self-contained Antigravity plugin without native compilation or dependency installation steps.
- Complete snapshot isolation: indexing crashes or failures never compromise the last-known-good index.
- Fast local queries (< 5ms) for symbol lookups, module dependencies, and architecture queries.
- Zero credential or raw source code storage; privacy guarantees of Phase 7.1 and 7.2 are fully preserved.

### Trade-offs & Mitigations

- **Minimum Node Version:** Requires Node.js >= 22.13.0 for `node:sqlite`. Mitigated: Project requires Node >= 22.6.0 for hooks; host runtime is verified Node 24.21.0.
- **Synchronous SQLite Execution:** Large batch writes could block the Node.js event loop if unbounded. Mitigated: Writes use prepared statements and bounded batch transactions (chunks of 500-1000 items).
