---
trigger: "glob"
globs: "**/*.{sql,prisma,schema,db}"
description: "Relational and NoSQL database modeling standards, index strategies, query optimization, and connection pool management."
---

# Database Standards Rule

> Generated from `specs/rules/database/database-standards.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Database Standards rule establishes engineering discipline for persistent data modeling, query construction, indexing strategies, and connection hygiene. It ensures high data integrity, sub-second query latency, and reliable scalability under concurrent read/write loads.

## Scope and applicability

Applies to all database schemas, ORM definitions (Prisma, TypeORM, Drizzle, SQLAlchemy, etc.), SQL scripts, view definitions, and query builder logic across relational and non-relational data stores.

## Core standards

- **Referential Integrity and Constraints:** Model relationships with explicit foreign keys, primary keys, non-null constraints, and check constraints rather than relying solely on application-layer integrity checks.
- **Strategic Indexing:** Index columns frequently used in `WHERE`, `JOIN`, `ORDER BY`, and unique lookup clauses. Create composite indexes matching exact filter order; verify index coverage using query execution plans (`EXPLAIN ANALYZE`).
- **N+1 Query Elimination:** Always batch or eager-load relational child records using joins or dataloaders instead of querying within loops.
- **Explicit Projection:** Select only explicitly required columns (`SELECT id, name, email`) rather than querying wildcards (`SELECT *`) to avoid excessive memory allocation and unintended column leakage.
- **Connection Pool Tuning:** Configure minimum, maximum, and idle connection limits alongside explicit connect/query timeout limits to prevent database connection exhaustion.

## Invariants and prohibitions

- **Prohibited:** Missing indexes on foreign key columns in relational engines that trigger full table scans during joins or cascades.
- **Prohibited:** Storing unstructured JSON blobs for relational entities that require frequent querying, filtering, or referential integrity.
- **Prohibited:** Query executions without timeouts, allowing hung queries to lock resources indefinitely.
- **Prohibited:** Executing unindexed `LIKE '%query%'` operations over large text tables without full-text search indexing.

## Verification criteria

- Verify query execution plans using `EXPLAIN` to ensure indexed lookups rather than sequential scans on high-cardinality tables.
- Confirm zero N+1 query patterns in data access methods through integration test query counts.
- Verify that foreign key cascades and deletion constraints operate safely according to domain lifecycle specifications.
