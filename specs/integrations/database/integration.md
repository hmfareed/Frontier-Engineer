---
id: "database"
name: "PostgreSQL Database Inspection"
description: "Enables schema inspection, index analysis, execution plan generation, and safe read-only queries for PostgreSQL using @microsoft/postgres-mcp."
category: "database"
version: "1.1.0"
lifecycle: "provider_verified"
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
    - "@microsoft/postgres-mcp"
    - "run"
  envVars:
    - name: "POSTGRES_MCP_CONNECTION_STRING"
      required: true
      description: "PostgreSQL connection string with read-only credentials (e.g., postgresql://readonly_user:pass@host:5432/dbname)."
      secret: true
    - name: "DATABASE_URL"
      required: false
      description: "Alternative PostgreSQL connection URI fallback."
      secret: true
capabilities:
  tools:
    - name: "describe_table"
      description: "Retrieves column names, types, default values, nullability, and foreign key constraints."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "list_tables"
      description: "Lists all tables, views, and materialized views within the target schema."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "show_indexes"
      description: "Lists all indexes, index types, uniqueness constraints, and column definitions."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "explain_query"
      description: "Generates EXPLAIN (ANALYZE, BUFFERS) query execution plans without altering data."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "execute_read_only_query"
      description: "Executes a SELECT query capped at a maximum of 100 rows for debugging and schema verification."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "query_sensitive_table"
      description: "Executes a masked/anonymized query against sensitive tables. Requires explicit human approval."
      permissionClass: "sensitive_data_access"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "security-auditor"
  resources: []
  prompts: []
security:
  authenticationType: "connection_string"
  permissionClasses:
    - "read_only"
    - "sensitive_data_access"
  readOnlyAlternative: "Inspect local migration files, schema definitions, and local SQLite/PostgreSQL test fixtures."
  credentialEnvVars:
    - "POSTGRES_MCP_CONNECTION_STRING"
    - "DATABASE_URL"
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
- **Execution Command:** `npx -y @microsoft/postgres-mcp run`
- **Environment Variables:**
  - `POSTGRES_MCP_CONNECTION_STRING`: Standard PostgreSQL connection URI connecting as a strictly read-only role.
  - `DATABASE_URL`: Fallback connection string variable.

## Capabilities and tool definitions

The integration exposes tools categorized across two permission classes:
1. **Read-only tools:** `describe_table`, `list_tables`, `show_indexes`, `explain_query`, `execute_read_only_query`.
2. **Sensitive data access tools:** `query_sensitive_table` (requires explicit human approval and data masking).

### Prohibited Operations

- **DDL Execution:** `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` are strictly prohibited via MCP. All database schema migrations must execute through standard version-controlled migration scripts (`npm run migrate`, Alembic, Prisma, etc.), never ad-hoc MCP commands.
- **DML Mutation:** `INSERT`, `UPDATE`, `DELETE` operations are strictly blocked.

See [`capabilities.md`](capabilities.md) for full tool schemas.

## Security and permission boundaries

Database security does not rely on natural language instructions alone. Defense is enforced across five layers:

1. **Database Role Privileges (Layer C):** Dedicated database user with read-only privileges (`GRANT SELECT` only; all `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` revoked). No superuser or schema ownership privileges.
2. **Server-Level Enforcement (Layer A):** Server parses queries and rejects mutation statements.
3. **Host-Level Configuration (Layer B):** Registered dormant (`"disabled": true`) in `mcp_config.json`.
4. **Behavioral Governance (Layer D):** Hard statement timeout (5,000ms), row limit caps (max 100 rows), and SELECT-only validation.
5. **Human Approval (Layer E):** Querying sensitive tables requires explicit developer confirmation.

See [`security.md`](security.md) for full defense-in-depth specifications.

## Operational behavior and failure handling

- **Offline Default:** If `POSTGRES_MCP_CONNECTION_STRING` is unset or database connection fails, the integration is disabled. Agents fall back to local migration files (`migrations/*.sql`) and ORM models.
- **Connection Pooling:** Connects with minimal pool sizes (max 2 connections) to prevent resource starvation on target database servers.
- **Read-Only Enforcers:** If a query contains non-SELECT statements, the query is rejected locally before transmission.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
