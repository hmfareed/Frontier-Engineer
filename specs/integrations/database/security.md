# Database Integration Security Policy

## Threat Model

Direct database connections carry severe risks of data breach, performance degradation, and accidental corruption. Primary threats:

1. **SQL Injection via Agent Query Construction:** Unsanitized user inputs or model-generated queries executing unintended database commands.
2. **Unauthorized Data Mutation or Deletion:** Execution of `INSERT`, `UPDATE`, `DELETE`, or `DROP TABLE` statements destroying production state.
3. **Sensitive Data Exposure (PII, Passwords, Tokens):** Plaintext extraction of password hashes, OAuth tokens, credit cards, or personal data via `SELECT` queries.
4. **Denial of Service via Unbounded Queries:** Running unbounded table scans or cartesian joins that exhaust database CPU or connection pool memory.
5. **Schema Tampering via DDL:** Bypassing repository migration workflows by executing ad-hoc `ALTER` or `CREATE` statements.

## Defense-in-Depth Requirements (The 10 Invariants)

Frontier Engineer rejects reliance on prompt instructions alone. Database security is strictly enforced at the engine, network, server, and client boundaries:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Human-in-the-Loop Approval                             │
│ Querying tables with PII requires explicit developer consent    │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Behavioral Governance (Frontier Engineer Rules System) │
│ Mandatory LIMIT 100, SELECT-only verification, statement timeout│
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Database Engine Permissions (PostgreSQL Role Level)    │
│ Dedicated read-only role; REVOKE ALL; GRANT SELECT only         │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ Registered dormant ("disabled": true) in mcp_config.json        │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: MCP Server-Side Validation                             │
│ Server validates read-only commands and enforces query limits   │
└─────────────────────────────────────────────────────────────────┘
```

The ten mandatory security invariants:

1. **Dedicated Read-Only User:** The agent connects exclusively as a dedicated read-only role (`frontier_readonly`).
2. **No Schema Ownership:** The role must not own any database schemas, tables, sequences, or functions.
3. **No Superuser Privileges:** Superuser, `CREATEROLE`, `CREATEDB`, `REPLICATION`, and `BYPASSRLS` privileges are strictly prohibited.
4. **No DDL Permissions:** All `CREATE`, `ALTER`, and `DROP` privileges are revoked on all schemas.
5. **No DML Mutation Permissions:** `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` privileges are revoked across all current and future tables.
6. **Server-Side Enforcement:** Where supported by the server implementation, read-only mode is passed as a startup flag (`PG_ALLOW_WRITE=false`).
7. **Transaction Safeguards:** Queries execute inside read-only transactions (`SET TRANSACTION READ ONLY;`).
8. **Hard Query Timeouts:** A statement timeout (max 5,000ms) is enforced at the database user level to terminate long-running queries automatically.
9. **Strict Connection Limits:** The role is restricted to a maximum of 2 concurrent connections (`ALTER ROLE frontier_readonly CONNECTION LIMIT 2;`).
10. **Explicit Database Allowlisting:** The connection string must target an explicitly designated development, replica, or staging database. Production primary databases are blocked.

## Database Provisioning Script (PostgreSQL)

```sql
-- 1. Create dedicated user
CREATE ROLE frontier_readonly WITH LOGIN PASSWORD 'strong_random_password' CONNECTION LIMIT 2;

-- 2. Restrict to specific database and schema
REVOKE ALL ON DATABASE app_dev FROM frontier_readonly;
GRANT CONNECT ON DATABASE app_dev TO frontier_readonly;

REVOKE ALL ON SCHEMA public FROM frontier_readonly;
GRANT USAGE ON SCHEMA public TO frontier_readonly;

-- 3. Grant SELECT only
GRANT SELECT ON ALL TABLES IN SCHEMA public TO frontier_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO frontier_readonly;

-- 4. Revoke mutation and DDL
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM frontier_readonly;
REVOKE CREATE ON SCHEMA public FROM frontier_readonly;

-- 5. Set session safeguards
ALTER ROLE frontier_readonly SET default_transaction_read_only = on;
ALTER ROLE frontier_readonly SET statement_timeout = '5000ms';
```

## Human Confirmation for Sensitive Tables

Tables identified as holding sensitive records (such as `users`, `accounts`, `tokens`, `sessions`, `credentials`, `payments`) cannot be queried without explicit user confirmation:
- The agent must state the table name, intended purpose, and list of columns to be masked.
- Fields containing passwords, secrets, or financial data are masked with `[REDACTED]`.

## Audit Logging

Every database query is logged with:
- Timestamp (UTC)
- Query text (with parameterized values redacted)
- Table names accessed
- Execution duration and row count returned
- Anomaly warnings if queries attempt blocked keywords
