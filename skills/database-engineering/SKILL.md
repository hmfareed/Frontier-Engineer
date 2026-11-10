---
name: "database-engineering"
description: "Use when designing database schemas, modeling relational or document entities, writing or optimizing SQL queries, planning zero-downtime database migrations, adding composite indexes, or debugging connection pooling."
---

# Database Engineering — Database Schema Design, Query Optimization, and Migration Safety

> Generated from `specs/skills/database-engineering.md` by `scripts/generate-antigravity-skills.ts`. Edit the canonical specification, not this file.

## Purpose

The Database Engineering skill provides a rigorous methodology for designing, maintaining, and optimizing relational and document database systems. It ensures that data structures enforce referential integrity, queries operate efficiently at scale, indexes are balanced against write penalties, and schema migrations are deployed without production downtime or data loss.

## Activation criteria

Activate this skill when:

- Designing new entity models, relational schemas, or document schemas.
- Modifying existing database tables, adding columns, or altering data types.
- Diagnosing and optimizing slow queries, missing indexes, or table scans.
- Planning zero-downtime database migrations or data backfilling procedures.
- Configuring database connection pools, transaction isolation levels, or replication.

## Non-activation guidelines

Do not activate this skill when:

- Writing pure UI layout code or frontend state management.
- Writing unit tests for stateless utility functions.
- Configuring third-party API webhook endpoints without database access.
- Deploying static HTML websites or documentation.

## Required context and inputs

Before modifying database schemas or queries:

1. **Database Engine & Version:** PostgreSQL, MySQL, SQLite, MongoDB, DynamoDB, and specific version features.
2. **Existing Schema & Migration History:** Current DDL files, migration logs, existing tables, indexes, and constraints.
3. **Query Access Patterns:** Read-to-write ratio, expected query volume, filtering criteria, and join topologies.
4. **Data Volume Projections:** Row counts, monthly growth rate, retention rules, and archiving strategy.

## Operating procedure

Execute the following eleven-step database engineering workflow:

1. **Identify Database Technology:** Verify the exact persistence engine, version, and supported feature set from repository configuration.
2. **Understand Data Requirements:** Analyze business entities, relationships (one-to-one, one-to-many, many-to-many), and query access paths.
3. **Inspect Current Schemas:** Review existing tables, foreign keys, index definitions, and migration files. Never assume a column exists without verification.
4. **Identify Access Patterns:** Map primary read filters (`WHERE`, `ORDER BY`, `GROUP BY`) and write frequency.
5. **Design or Review the Schema:** Normalize entities to 3NF for OLTP workloads (or justify deliberate denormalization for OLAP/caching). Ensure strict data typing and NOT NULL constraints where appropriate.
6. **Define Constraints and Indexes:** Establish foreign key constraints, unique constraints, and composite indexes based on access patterns.
7. **Evaluate Query Performance:** Inspect execution plans (`EXPLAIN ANALYZE` in SQL) to verify that queries leverage index scans instead of sequential table scans.
8. **Plan Migrations:** Author reversible, non-blocking migration scripts. Separate schema changes from data transformations.
9. **Assess Backward Compatibility:** Use the Expand-Contract pattern for renaming or removing columns so running application code does not crash during rolling deploys.
10. **Verify Data Integrity:** Author integration tests that verify constraints, cascade rules, and transaction rollbacks on failure.
11. **Document Rollback and Recovery Considerations:** Explicitly provide down-migration procedures and recovery strategies.

## Technical and engineering standards

- **Human Approval for Destructive Actions:** Never execute `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` without explicit human confirmation detailing risks and reversibility.
- **Index Selectivity Rule:** Index columns that are frequently filtered or joined. Do not create single-column indexes on low-cardinality boolean fields.
- **Transaction Atomicity:** Multi-record write workflows must execute inside an explicit database transaction (`BEGIN ... COMMIT`) to prevent partial writes.
- **Non-Blocking DDL:** Avoid long table-exclusive locks. In PostgreSQL, use `CREATE INDEX CONCURRENTLY` and set explicit `lock_timeout`.
- **Foreign Key Indexing:** In relational databases, always index foreign key columns on child tables to prevent full table locks during parent updates or deletes.
- **Tenant Scoping:** In multi-tenant systems, all unique constraints and queries must include the tenant identifier (`tenant_id`).

## Verification and evidence requirements

- Provide the generated migration file and its corresponding rollback / down migration.
- Provide query execution plans (`EXPLAIN ANALYZE` or equivalent) demonstrating that the designed indexes are utilized.
- Verify that automated tests execute migrations cleanly on a blank database and roll back without errors.

## Expected outputs and deliverables

- **Schema Definition / Migration Files:** Version-controlled DDL migration scripts (Up and Down).
- **ORM / Entity Models:** Updated domain models with explicit relationships and type safety.
- **Query Optimization Report:** Analysis of query execution plans before and after indexing.
- **Data Integrity Tests:** Automated test cases proving constraint enforcement and rollback safety.

## Risks, boundaries and failure modes

- **Production Table Locking:** Running an unverified `ALTER TABLE` that rewrites a 10M-row table will lock production traffic and cause an outage.
- **Over-Indexing Write Penalty:** Adding ten indexes to an event-ingestion table degrades write throughput by 5-10x.
- **Unbounded Transactions:** Keeping a database transaction open while waiting for an external HTTP API call exhausts connection pools.

## Progressive disclosure references

For index composite ordering, zero-downtime migration workflows, and checklist:

- [Database Engineering: Schema Design, Indexing Trade-offs, and Migration Safety](./references/schema-design-and-migration-guide.md)
