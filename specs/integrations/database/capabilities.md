# Database Integration Capabilities

This document provides complete tool specifications and parameter contracts for the PostgreSQL database integration powered by `@microsoft/postgres-mcp`.

## Permission Class Summary

| Tool Name                 | Permission Class | Target Scope                             | Human Confirmation Required | Agent Affinity                                              |
| :------------------------ | :--------------- | :--------------------------------------- | :-------------------------- | :---------------------------------------------------------- |
| `postgres_mcp_query`      | Read-only        | Database rows via read-only SQL (SELECT) | No (capped at 100 rows)     | `frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor` |
| `postgres_mcp_db_context` | Read-only        | Schema metadata, tables, views, keys     | No                          | `frontier-engineer`, `architect`, `implementation-engineer` |
| `postgres_mcp_connect`    | Read-only        | Named connection profiles & session init | No                          | `frontier-engineer`, `architect`                            |

## Excluded & Strictly Prohibited Write Tools

The official `@microsoft/postgres-mcp` package contains additional mutating tools that are **strictly excluded** from Frontier Engineer's autonomous profile:

- `postgres_mcp_modify`: Executes DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) and DML (`INSERT`, `UPDATE`, `DELETE`). Classified as `destructive` / `reversible_write`. Excluded from agent discovery to protect production state. Database schema migrations must execute exclusively through version-controlled repository migration workflows.
- `postgres_mcp_bulk_load_csv`: Executes server-side `COPY` commands from local CSV files. Classified as `external_side_effect`. Excluded from autonomous workflows.

## Tool Specifications

### `postgres_mcp_query`

- **Description:** Executes a read-only SQL query (`SELECT ...` or `EXPLAIN ...`) against the connected database, returning structured tabular records and column metadata.
- **Parameters:**
  - `query` (string, required): SQL query string (must begin with `SELECT`, `WITH`, or `EXPLAIN`).
  - `params` (array, optional): Parameterized query arguments.
- **Enforcement:** Enforces transaction-level read-only mode (`SET default_transaction_read_only = on`) and statement timeouts (5,000ms max).
- **Output:** JSON object containing column schemas, returned rows (max 100 rows), and execution metadata.

### `postgres_mcp_db_context`

- **Description:** Introspects structural database context, returning table definitions, views, column data types, foreign key constraints, primary keys, and index specifications.
- **Parameters:**
  - `schema` (string, optional): Target schema name (defaults to `public`).
  - `table` (string, optional): Specific table name to isolate.
- **Output:** Structured context tree detailing schema definitions, relations, and index architectures.

### `postgres_mcp_connect`

- **Description:** Establishes connection state to a pre-configured connection profile or active PostgreSQL endpoint.
- **Parameters:**
  - `profile_name` (string, optional): Named connection profile previously registered with `access_mode: ro`.
  - `connection_string` (string, optional): Explicit PostgreSQL connection URI (must connect using read-only credentials).
- **Output:** Confirmation of active database session, connected role identity, server version, and read-only status.
