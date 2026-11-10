---
id: migration-safety
name: Migration Safety Standards
category: database
triggerType: glob
globs: "**/migrations/**,**/*.sql"
description: Zero-downtime database migration rules, backward compatibility, lock minimization, and rollback safeguards.
priority: 9
enforcementLevel: mandatory
platformConfig: {}
---

# Migration Safety Standards Rule

## Purpose

The Migration Safety Standards rule prevents production outages, data loss, and locking deadlocks caused by database schema migrations. It mandates backward-compatible schema evolutions, non-blocking DDL operations, and explicit rollback strategies.

## Scope and applicability

Applies to all database migration scripts, DDL statements, schema evolution definitions, and data backfill procedures.

## Core standards

- **Expand-and-Contract Pattern:** Execute breaking changes (renaming columns, dropping fields, changing types) over multiple distinct releases:
  1. _Expand:_ Add new column or table without removing old structures; write to both.
  2. _Backfill:_ Populate historical data into new structures asynchronously in batches.
  3. _Contract:_ Transition all readers and writers to new structures; deprecate old structures.
  4. _Cleanup:_ Drop deprecated structures only after verifying no active application version references them.
- **Lock Minimization:** Avoid statements that acquire exclusive table locks for prolonged periods. Use concurrent index creation (`CREATE INDEX CONCURRENTLY` in PostgreSQL), set lock timeouts (`SET lock_timeout = '2s'`), and avoid default column additions that rewrite tables.
- **Idempotence and Transactional DDL:** Structure migration steps to be safe for re-execution where possible; execute DDL within transactions on supporting engines to prevent half-applied migration states.
- **Documented Rollback Strategy:** Every forward migration script must possess a verified rollback counterpart or an unambiguous forward recovery plan.

## Invariants and prohibitions

- **Prohibited:** Dropping a table, column, or foreign key in the same deployment where application code removes the corresponding field references.
- **Prohibited:** Adding non-nullable columns without a safe default or staged backfill sequence.
- **Prohibited:** Renaming database columns directly in active production schemas without backward-compatible view aliases or phased transitions.
- **Prohibited:** Running long-running data backfill transactions that block write traffic on production tables.

## Verification criteria

- Verify migrations against a populated test database to measure lock duration and migration runtime.
- Test rollback execution on migrated databases to confirm clean return to previous schema versions.
- Confirm backward compatibility by running the previous application version against the newly migrated schema.
