---
id: "database"
name: "PostgreSQL Database Inspection"
description: "Enables schema inspection, index analysis, execution plan generation, and safe read-only queries for PostgreSQL using @microsoft/postgres-mcp."
category: "database"
version: "1.1.0"
lifecycle: "runtime_tested"
provider:
  name: "Microsoft (Official / microsoft)"
  documentationUrl: "https://github.com/microsoft/postgres-mcp"
  repositoryUrl: "https://github.com/microsoft/postgres-mcp"
  maintainer: "Microsoft"
  license: "MIT"
  verificationDate: "2026-11-11"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@microsoft/postgres-mcp@0.3.0"
    - "run"
  envVars:
    - name: "POSTGRES_MCP_CONNECTION_STRING"
      required: true
      description: "PostgreSQL connection string with read-only credentials (e.g., postgresql://frontier_readonly:pass@host:5432/dbname)."
      secret: true
    - name: "DATABASE_URL"
      required: false
      description: "Alternative PostgreSQL connection URI fallback."
      secret: true
capabilities:
  tools:
    - name: "postgres_mcp_query"
      description: "Executes a read-only SQL query (SELECT ...) with result sets and column metadata."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "security-auditor"
    - name: "postgres_mcp_db_context"
      description: "Retrieves structural context including schemas, tables, views, columns, keys, and foreign relationships."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "postgres_mcp_connect"
      description: "Establishes or switches the active connection session to an authorized read-only profile."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
    - name: "postgres_mcp_list_connection_profiles"
      description: "Lists all available PostgreSQL connection profiles with ID, name, host, and database."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
    - name: "postgres_mcp_list_databases"
      description: "Lists all databases available on the connected PostgreSQL server."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
    - name: "postgres_mcp_get_server_capabilities"
      description: "Discovers available diagnostic capabilities, PostgreSQL version, and metric groups."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "postgres_mcp_get_metrics_group"
      description: "Collects performance and diagnostic metrics groups for server and query performance."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "postgres_mcp_disconnect"
      description: "Disconnects an active database connection session."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
  resources: []
  prompts: []
security:
  authenticationType: "connection_string"
  permissionClasses:
    - "read_only"
  readOnlyAlternative: "Inspect local migration files, schema definitions, and local SQLite/PostgreSQL test fixtures."
  credentialEnvVars:
    - "POSTGRES_MCP_CONNECTION_STRING"
    - "DATABASE_URL"
  toolFiltering: "allowlist"
platformConfig: {}
---

# PostgreSQL Database Integration Specification

## Purpose and overview

The PostgreSQL database MCP integration enables Frontier Engineer specialist agents—such as `architect`, `implementation-engineer`, and `security-auditor`—to inspect database schemas, verify foreign key relationships, generate query execution plans (`EXPLAIN`), and execute strictly controlled read-only queries. It bridges the gap between static schema files and runtime database state during debugging.

## Provider and maintenance

- **Primary Provider:** Microsoft (`@microsoft/postgres-mcp`)
- **Upstream Repository:** [https://github.com/microsoft/postgres-mcp](https://github.com/microsoft/postgres-mcp)
- **Maintainer:** Microsoft
- **License:** MIT
- **Verification Date:** 2026-11-11
- **Status Note:** Replaces the archived reference server `@modelcontextprotocol/server-postgres`. Evaluated against community alternative `antonorlov/mcp-postgres-server` (`PG_ALLOW_WRITE=false`).

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v22.0.0 or higher) executing pre-compiled Rust wrapper
- **Executable:** `npx`
- **Execution Command:** `npx -y @microsoft/postgres-mcp@0.3.0 run`
- **Environment Variables:**
  - `POSTGRES_MCP_CONNECTION_STRING`: Standard PostgreSQL connection URI connecting as a strictly read-only role (`frontier_readonly`).
  - `DATABASE_URL`: Fallback connection string variable.

## Capabilities and tool definitions

The integration exposes 8 verified and approved read-only tools through Antigravity host-level allowlisting (`enabledTools`):

1. **`postgres_mcp_query`:** Read-only query execution (`SELECT ...` or `EXPLAIN ...`) with row limits and timeout enforcement.
2. **`postgres_mcp_db_context`:** Structural introspection for schemas, tables, views, columns, and foreign keys.
3. **`postgres_mcp_connect`:** Connection profile selection and session initialization.
4. **`postgres_mcp_disconnect`:** Explicit session termination and resource release.
5. **`postgres_mcp_list_connection_profiles`:** Enumeration of configured read-only connection profiles.
6. **`postgres_mcp_list_databases`:** Enumeration of accessible databases on the server.
7. **`postgres_mcp_get_server_capabilities`:** Diagnostic and feature capability probe.
8. **`postgres_mcp_get_metrics_group`:** Performance and operational metric collection.

### Prohibited Operations & Excluded Tools (5 Tools)

- **Excluded Mutating Tools:** The `@microsoft/postgres-mcp` package contains mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`). These are classified as `destructive` / `external_side_effect` and are **strictly excluded** from Frontier Engineer's host-exposed tool catalogue.
- **Excluded Local Filesystem Tool:** `postgres_mcp_describe_csv` is excluded from the Antigravity `enabledTools` allowlist to eliminate arbitrary local filesystem path-traversal exposure, as CSV import preparation is unnecessary when `postgres_mcp_bulk_load_csv` is prohibited.
- **DDL Execution:** `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` are strictly prohibited via MCP. All database schema migrations must execute through standard version-controlled migration scripts (`npm run migrate`, Alembic, Prisma, etc.), never ad-hoc MCP commands.
- **DML Mutation:** `INSERT`, `UPDATE`, `DELETE` operations are strictly blocked by host-level filtering, profile mode, role permissions, and transaction settings.

See [`capabilities.md`](capabilities.md) for full tool schemas and exclusions.

## Security and permission boundaries

Database security does not rely on natural language instructions alone. Defense is enforced across three independent, verifiable layers:

1. **Host-Level Filtering (Antigravity `enabledTools`):** Antigravity's MCP client explicitly filters server-advertised tools using the `enabledTools` allowlist. Unapproved mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`) and the local filesystem inspection tool (`postgres_mcp_describe_csv`) are completely absent from the agent's available tool catalogue.
2. **MCP Server Profile Enforcement (`access_mode: ro`):** The active connection profile configures read-only access mode, preventing write tools from functioning even if invoked.
3. **Database Engine Permissions (PostgreSQL Role Level):** Dedicated database user (`frontier_readonly`) with read-only privileges (`GRANT SELECT` only; all `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` revoked; `default_transaction_read_only = on`; `statement_timeout = 5000`; `CONNECTION LIMIT 2`). The database engine independently rejects mutation attempts with code `25006` regardless of client state.

See [`security.md`](security.md) for full defense-in-depth specifications.

## Operational behavior and failure handling

- **Offline Default:** If `POSTGRES_MCP_CONNECTION_STRING` is unset or database connection fails, the integration is disabled. Agents fall back to local migration files (`migrations/*.sql`) and ORM models.
- **Connection Pooling:** Connects with minimal pool sizes (max 2 connections) to prevent resource starvation on target database servers.
- **Read-Only Enforcers:** If a query contains non-SELECT statements, the query is rejected locally before transmission.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
