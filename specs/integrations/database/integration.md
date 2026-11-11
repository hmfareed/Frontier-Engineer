---
id: "database"
name: "PostgreSQL Database Inspection"
description: "Enables schema inspection, index analysis, execution plan generation, and safe read-only queries for relational databases."
category: "database"
version: "1.0.0"
lifecycle: "available"
provider:
  name: "Model Context Protocol Official"
  documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres"
  repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  maintainer: "Anthropic / MCP Working Group"
  license: "MIT"
  verificationDate: "2026-11-10"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@modelcontextprotocol/server-postgres"
  envVars:
    - name: "DATABASE_URL"
      required: true
      description: "PostgreSQL connection string with read-only credentials (e.g., postgresql://readonly_user:pass@host:5432/dbname)."
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
    - "DATABASE_URL"
platformConfig: {}
---

# PostgreSQL Database Integration Specification

## Purpose and overview

The PostgreSQL database MCP integration enables Frontier Engineer specialist agents—such as `architect`, `implementation-engineer`, and `security-auditor`—to inspect database schemas, verify foreign key relationships, generate query execution plans (`EXPLAIN`), and execute strictly controlled read-only queries. It bridges the gap between static schema files and runtime database state during debugging.

## Provider and maintenance

- **Provider:** Model Context Protocol Official Reference Servers
- **Upstream Package:** `@modelcontextprotocol/server-postgres`
- **Maintainer:** Anthropic / MCP Working Group
- **License:** MIT
- **Documentation:** [https://github.com/modelcontextprotocol/servers/tree/main/src/postgres](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres)
- **Verification Date:** 2026-11-10

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @modelcontextprotocol/server-postgres`
- **Environment Variables:**
  - `DATABASE_URL`: Standard PostgreSQL connection URI. Must connect as a read-only role.

## Capabilities and tool definitions

The integration exposes tools categorized across two permission classes:

1. **Read-only tools:** `describe_table`, `list_tables`, `show_indexes`, `explain_query`, `execute_read_only_query`.
2. **Sensitive data access tools:** `query_sensitive_table` (requires explicit human approval and data masking).

### Prohibited Operations

- **DDL Execution:** `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` are strictly prohibited via MCP. All database schema migrations must execute through standard version-controlled migration scripts (`npm run migrate`, Alembic, Prisma, etc.), never ad-hoc MCP commands.
- **DML Mutation:** `INSERT`, `UPDATE`, `DELETE` operations are strictly blocked.

See [`capabilities.md`](capabilities.md) for full tool schemas.

## Security and permission boundaries

- **Read-Only Credentials:** The database user configured in `DATABASE_URL` must have `SELECT` privileges only (`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM readonly_user; GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;`).
- **Query Limits:** Every `execute_read_only_query` call enforces a hard `LIMIT 100` and a statement timeout of 5,000ms.
- **Sensitive Table Protection:** Tables containing user credentials, tokens, or PII require masking and explicit human authorization before query execution.

See [`security.md`](security.md) for database security controls.

## Operational behavior and failure handling

- **Offline Default:** If `DATABASE_URL` is unset or database connection fails, the integration is disabled. Agents fall back to local migration files (`migrations/*.sql`) and ORM models.
- **Connection Pooling:** Connects with minimal pool sizes (max 2 connections) to prevent resource starvation on target database servers.
- **Read-Only Enforcers:** If a query contains non-SELECT statements, the query is rejected locally before transmission.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
