# Database Integration Capabilities

This document provides complete tool specifications and parameter contracts for the PostgreSQL database integration.

## Permission Class Summary

| Tool Name                 | Permission Class      | Target Scope              | Human Confirmation Required | Agent Affinity                                              |
| :------------------------ | :-------------------- | :------------------------ | :-------------------------- | :---------------------------------------------------------- |
| `describe_table`          | Read-only             | Table schema              | No                          | `frontier-engineer`, `architect`, `implementation-engineer` |
| `list_tables`             | Read-only             | Database schema catalog   | No                          | `frontier-engineer`, `architect`, `implementation-engineer` |
| `show_indexes`            | Read-only             | Index catalog             | No                          | `frontier-engineer`, `architect`, `implementation-engineer` |
| `explain_query`           | Read-only             | Query planner             | No                          | `frontier-engineer`, `architect`, `implementation-engineer` |
| `execute_read_only_query` | Read-only             | Database rows (max 100)   | No                          | `frontier-engineer`, `implementation-engineer`              |
| `query_sensitive_table`   | Sensitive data access | Masked PII/Sensitive rows | Yes                         | `frontier-engineer`, `architect`, `security-auditor`        |

## Strictly Prohibited Operations

The following database operations are **never exposed** through MCP tools in Frontier Engineer:

- `execute_ddl`: `CREATE`, `ALTER`, `DROP`, `TRUNCATE` operations are prohibited. Migrations must run via repository migration pipelines.
- `execute_mutation`: `INSERT`, `UPDATE`, `DELETE` operations are prohibited. Modifying production data directly via LLM prompts violates data integrity standards.

## Tool Specifications

### `describe_table`

- **Description:** Returns column names, data types, constraints, default expressions, and foreign keys for a specific table.
- **Parameters:**
  - `table_name` (string, required): Table name to inspect.
  - `schema` (string, optional): Database schema (defaults to `public`).
- **Output:** Array of column definitions and table constraints.

### `list_tables`

- **Description:** Lists all base tables, views, and partitioned tables in the connected database.
- **Parameters:**
  - `schema` (string, optional): Database schema (defaults to `public`).
- **Output:** Array of table names and types (`BASE TABLE`, `VIEW`, `MATERIALIZED VIEW`).

### `show_indexes`

- **Description:** Lists indexes defined on a table, including composite columns, index methods (B-tree, GIN, GiST), and partial predicates.
- **Parameters:**
  - `table_name` (string, required): Table name.
- **Output:** Array of index objects with index name, definition, and uniqueness indicator.

### `explain_query`

- **Description:** Runs `EXPLAIN (FORMAT JSON)` or `EXPLAIN (ANALYZE, BUFFERS)` to evaluate query performance and index usage without modifying data.
- **Parameters:**
  - `query` (string, required): SQL SELECT query string.
  - `analyze` (boolean, optional): Include actual execution timings (defaults to false).
- **Output:** Query plan tree showing scan types, cost estimates, filter conditions, and memory usage.

### `execute_read_only_query`

- **Description:** Executes a read-only SQL query against the database. Automatically capped at 100 rows.
- **Parameters:**
  - `query` (string, required): SQL query string (must begin with `SELECT` or `WITH`).
  - `params` (array, optional): Parameterized values for query placeholders.
- **Output:** Result set rows (maximum 100 rows) and execution duration.

### `query_sensitive_table`

- **Description:** Queries tables flagged as containing sensitive PII or credentials. Columns containing sensitive values are masked before display. Requires human confirmation.
- **Parameters:**
  - `table_name` (string, required): Sensitive table name.
  - `masked_columns` (array of strings, required): Columns to hash or mask.
  - `filter_clause` (string, required): WHERE condition.
- **Output:** Masked result set.
