# Database Engineering: Schema Design, Indexing Trade-offs, and Migration Safety

This reference provides technical rules for schema normalization, indexing strategies, zero-downtime database migrations, and ACID transaction boundaries.

## 1. Indexing Trade-offs and Best Practices

An index speeds up reads at the direct expense of write latency, memory consumption, and disk footprint. Never add an index without justifying its access pattern:

### A. B-Tree Indexes (Default)

- **Use Case:** Equality checks (`=`), range queries (`<`, `<=`, `>`, `>=`), prefix pattern matching (`LIKE 'prefix%'`), and `ORDER BY` sorting.
- **Composite Index Column Ordering Rule:**
  - Order columns by: `[Equality Columns] -> [Range / Filter Columns] -> [Sort Columns]`.
  - Column cardinality: placing highly selective columns early in composite indexes improves index pruning.

### B. Index Anti-Patterns

- **Over-Indexing:** Indexing every column in a high-write table (e.g. telemetry, event logs) degrades insertion throughput.
- **Index Suppression via Functions:** Queries like `WHERE LOWER(email) = 'user@example.com'` ignore standard B-trees on `email`. Use an expression index (`CREATE INDEX ON users (LOWER(email))`) or normalize input upon ingestion.
- **Redundant Indexes:** An index on `(org_id, user_id)` makes a separate index on `(org_id)` redundant.

---

## 2. Zero-Downtime Safe Migration Workflow

Destructive database operations must be executed in backward-compatible phases (Expand-Contract Pattern):

### Renaming a Column Safely (3-Phase Deploy)

1. **Phase 1 (Expand):** Add the new column with a default or trigger copying from the old column. Deploy backend code that writes to both columns but reads from the old one.
2. **Phase 2 (Migrate):** Backfill historical data from old column to new column. Deploy backend code that reads from and writes to the new column.
3. **Phase 3 (Contract):** Remove legacy triggers. Drop the old column in a maintenance window.

### Non-Blocking Table Alterations (PostgreSQL Example)

- Never run `ALTER TABLE large_table ADD COLUMN col TYPE NOT NULL;` without a default, or in versions that lock the entire table during rewrite.
- Use `CREATE INDEX CONCURRENTLY` to avoid holding exclusive table locks that block live production reads and writes.
- Always set `lock_timeout` before running DDL migrations so long locks fail fast instead of queuing up live traffic behind them.

---

## 3. Database Safety Checklist

- [ ] Does the migration have an automated down/rollback step?
- [ ] Are foreign keys backed by indexes on the referencing table to prevent table locks on cascade?
- [ ] Is multi-tenant data scoped by `tenant_id` on all unique constraints (e.g. `UNIQUE (tenant_id, slug)`)?
- [ ] Are sensitive fields (passwords, auth tokens, SSNs) hashed or encrypted before storage?
