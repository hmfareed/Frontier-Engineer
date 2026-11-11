# Database Integration Security Policy

## Threat Model

Direct database connections carry severe risks of data breach, performance degradation, and accidental corruption. Primary threats:

1. **SQL Injection via Agent Query Construction:** Unsanitized user inputs or model-generated queries executing unintended database commands.
2. **Unauthorized Data Mutation or Deletion:** Execution of `INSERT`, `UPDATE`, `DELETE`, or `DROP TABLE` statements destroying application state.
3. **Sensitive Data Exposure (PII, Passwords, Tokens):** Plaintext extraction of password hashes, OAuth tokens, credit cards, or personal data via `SELECT` queries.
4. **Denial of Service via Unbounded Queries:** Running unbounded table scans or cartesian joins that exhaust database CPU or connection pool memory.
5. **Schema Tampering via DDL:** Bypassing repository migration workflows by executing ad-hoc `ALTER` or `CREATE` statements.

---

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
│ Dedicated NOINHERIT read-only role; REVOKE ALL; GRANT SELECT    │
│ default_transaction_read_only = on; statement_timeout = 5000ms  │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ Explicit enabledTools allowlist (8 approved tools); 5 excluded  │
│ Registered dormant ("disabled": true) in mcp_config.json        │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: MCP Server Profile Enforcement                         │
│ access_mode: ro rejects registering mutating operations         │
└─────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Complete Security Boundary (Three Independent Controls):**
>
> 1. **Antigravity Host Filtering:** Confirm allowed tools (8) are visible. Excluded mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`) and the local filesystem tool (`postgres_mcp_describe_csv`) are completely absent from the agent's available tool catalogue. Agents cannot discover or invoke excluded tools through normal MCP invocation.
> 2. **Microsoft PostgreSQL MCP Profile:** Active connection profiles enforce `access_mode: ro`.
> 3. **PostgreSQL Database Engine:** The `frontier_readonly` role rejects any mutation or DDL statement at the transaction boundary (`ERROR: cannot execute ... in a read-only transaction`).
>
> Never claim a tool is hidden merely because its operation fails at the database layer. Host filtering ensures dangerous tools are absent from the host-exposed catalogue, not merely denied after invocation.

The ten mandatory security invariants:

1. **Dedicated Read-Only User:** The agent connects exclusively as a dedicated role (`frontier_readonly`) created with `NOINHERIT`.
2. **No Schema Ownership:** The role must not own any database schemas, tables, sequences, or functions.
3. **No Superuser Privileges:** Superuser, `CREATEROLE`, `CREATEDB`, `REPLICATION`, and `BYPASSRLS` privileges are strictly prohibited.
4. **No DDL Permissions:** All `CREATE`, `ALTER`, and `DROP` privileges are revoked across all schemas and the target database.
5. **No DML Mutation Permissions:** `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` privileges are revoked across all current and future tables.
6. **Host-Level Tool Allowlist Enforcement:** Antigravity configuration explicitly restricts exposed tools via `enabledTools` to the 8 approved read-only tools.
7. **Transaction Safeguards:** Queries execute inside read-only transactions (`SET default_transaction_read_only = on`).
8. **Hard Query Timeouts:** A statement timeout (max 5,000ms) is enforced at the database role level to terminate long-running queries automatically.
9. **Strict Connection Limits:** The role is restricted to a maximum of 2 concurrent connections (`CONNECTION LIMIT 2`).
10. **Explicit Database Allowlisting:** The connection string must target an explicitly designated development, replica, or staging database. Primary production databases are blocked.

---

## Explicit Read-Only Profile Configuration

Frontier Engineer requires three independent layers of read-only enforcement:

1. **Antigravity Host Filtering (`enabledTools`):** Restricts the tool catalogue to the 8 approved tools, hiding `postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`, and `postgres_mcp_describe_csv`.
2. **MCP Profile Access Mode:** The MCP server configuration must specify read-only mode (`access_mode: ro`).
3. **PostgreSQL Role Privileges:** The database role must independently have `SELECT`-only privileges.

### Saved Keyring Profile vs Environment Variable

1. **Saved Keyring Profile (Recommended for local developer workstations):**

   ```bash
   # Add profile with read-only access mode
   npx -y @microsoft/postgres-mcp connection add dev_ro "postgresql://frontier_readonly@localhost:5432/app_dev"
   npx -y @microsoft/postgres-mcp connection set-password dev_ro
   ```

   The password is encrypted in the operating system keyring and never written to repository config files.

2. **Environment Variable (`POSTGRES_MCP_CONNECTION_STRING`):**
   When operating headless or in CI without an OS keyring:
   `POSTGRES_MCP_CONNECTION_STRING="postgresql://frontier_readonly:strong_password@localhost:5432/app_dev"`
   > [!WARNING]
   > `POSTGRES_MCP_CONNECTION_STRING` is a credential-bearing string. To avoid credential exposure, developers must ensure the credentials belong strictly to `frontier_readonly` and export it in their shell environment or ignored `.env` file, never committing it to version control.

---

## Effective-Privilege Audit: The Authorization Boundary

Merely running `REVOKE` statements against `frontier_readonly` does **not** guarantee read-only access in PostgreSQL. A rigorous security configuration must address five critical inheritance and privilege vectors:

1. **Role Inheritance (`NOINHERIT`):** In PostgreSQL, roles inherit permissions from all parent roles by default (`INHERIT`). If `frontier_readonly` is granted membership in an application role that has write permissions, it inherits write capabilities. Creating the role with `NOINHERIT` ensures it only possesses privileges directly granted to it.
2. **`PUBLIC` Pseudo-Role Grants:** All PostgreSQL roles automatically belong to `PUBLIC`. In default PostgreSQL installations:
   - `PUBLIC` possesses `CONNECT` and `TEMP` (create temporary tables) on databases.
   - `PUBLIC` had `CREATE` on schema `public` (in PostgreSQL < 15).
   - `PUBLIC` has `EXECUTE` on functions by default.
     Therefore, `CREATE` and `TEMP` must be explicitly revoked from `PUBLIC` on the target database and schema.
3. **Database Level Grants:** Granting `CONNECT` grants connection rights. `TEMP` privileges must be explicitly revoked to prevent creating temporary tables that could consume server disk space.
4. **Sequence Mutations:** In PostgreSQL, sequences (`nextval()`) are modified during query evaluation. `USAGE` and `UPDATE` on sequences must not be granted to `frontier_readonly`.
5. **Future Object Grants (`ALTER DEFAULT PRIVILEGES`):**
   Running `ALTER DEFAULT PRIVILEGES ... GRANT SELECT` as `postgres` only applies to future objects created by the `postgres` role! If application migrations are executed by an application owner role (e.g., `app_owner`), default privileges must be explicitly granted `FOR ROLE app_owner`.

---

## Audited PostgreSQL Provisioning Script

Execute the following SQL script as a database superuser on your development or staging database:

```sql
-- ============================================================================
-- FRONTIER ENGINEER: LEAST-PRIVILEGE READ-ONLY ROLE PROVISIONING SCRIPT
-- Target Database: app_dev
-- Object Owner Role: app_owner
-- Read-Only Role: frontier_readonly
-- ============================================================================

-- 1. Create dedicated role with NOINHERIT and connection limits
CREATE ROLE frontier_readonly WITH
    LOGIN
    NOINHERIT
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS
    CONNECTION LIMIT 2
    PASSWORD 'replace_with_strong_random_password';

-- 2. Restrict Database-level permissions
-- Revoke all permissions (including TEMP) from PUBLIC and the user
REVOKE ALL ON DATABASE app_dev FROM PUBLIC;
REVOKE ALL ON DATABASE app_dev FROM frontier_readonly;
-- Explicitly grant CONNECT only
GRANT CONNECT ON DATABASE app_dev TO frontier_readonly;

-- 3. Restrict Schema-level permissions
-- Prevent arbitrary object creation in public schema
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM frontier_readonly;
-- Grant USAGE only so tables can be resolved
GRANT USAGE ON SCHEMA public TO frontier_readonly;

-- 4. Grant SELECT on existing tables and views
GRANT SELECT ON ALL TABLES IN SCHEMA public TO frontier_readonly;

-- 5. Revoke sequence mutation permissions (nextval, setval)
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM frontier_readonly;

-- 6. Configure future objects for all relevant creator roles
-- Ensures tables created by migrations/app_owner automatically grant SELECT
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO frontier_readonly;

-- Explicitly ensure default privileges revoke mutations on future tables
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES FROM frontier_readonly;

-- 7. Configure session-level defense-in-depth settings
ALTER ROLE frontier_readonly SET default_transaction_read_only = on;
ALTER ROLE frontier_readonly SET statement_timeout = '5000ms';

-- ============================================================================
-- VERIFICATION QUERIES (Run to verify effective permissions)
-- ============================================================================
-- Check role attributes:
-- SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolconnlimit
-- FROM pg_roles WHERE rolname = 'frontier_readonly';

-- Check table-level permissions:
-- SELECT grantee, table_schema, table_name, privilege_type
-- FROM information_schema.role_table_grants WHERE grantee = 'frontier_readonly';
```

---

## Database Acceptance-Test Matrix

Every proposed security constraint must be verified against an actual database engine:

| #      | Test Scenario                        | Operation Tested                                     | Expected Outcome | Engine Rejection Reason                                            |
| :----- | :----------------------------------- | :--------------------------------------------------- | :--------------- | :----------------------------------------------------------------- |
| **1**  | Permitted Table Read                 | `SELECT * FROM products`                             | **Allowed**      | Valid SELECT on permitted schema table                             |
| **2**  | Permitted View Read                  | `SELECT * FROM active_products`                      | **Allowed**      | Valid SELECT on permitted view                                     |
| **3**  | Unauthorized Schema Access           | `SELECT * FROM sales.invoices`                       | **Denied**       | `permission denied for schema sales`                               |
| **4**  | Table Row Insertion                  | `INSERT INTO products (name, price) VALUES ('x', 1)` | **Denied**       | `permission denied for table products`                             |
| **5**  | Table Row Modification               | `UPDATE products SET price = 0 WHERE id = 1`         | **Denied**       | `permission denied for table products`                             |
| **6**  | Table Row Deletion                   | `DELETE FROM products WHERE id = 1`                  | **Denied**       | `permission denied for table products`                             |
| **7**  | Table Truncation                     | `TRUNCATE products`                                  | **Denied**       | `permission denied for table products`                             |
| **8**  | DDL Table Creation                   | `CREATE TABLE evil (id int)`                         | **Denied**       | `permission denied for schema public`                              |
| **9**  | DDL Table Alteration                 | `ALTER TABLE products ADD COLUMN leak text`          | **Denied**       | `must be owner of table products`                                  |
| **10** | DDL Table Dropping                   | `DROP TABLE products`                                | **Denied**       | `must be owner of table products`                                  |
| **11** | DDL Schema Creation                  | `CREATE SCHEMA evil_schema`                          | **Denied**       | `permission denied for database app_dev`                           |
| **12** | Function Creation                    | `CREATE FUNCTION evil() RETURNS void ...`            | **Denied**       | `permission denied for schema public`                              |
| **13** | Sequence Mutation                    | `SELECT nextval('products_id_seq')`                  | **Denied**       | `permission denied for sequence products_id_seq`                   |
| **14** | Multi-Statement Mutation             | `SELECT 1; INSERT INTO products ...`                 | **Denied**       | `permission denied for table products`                             |
| **15** | Transaction Read-Write Override      | `SET TRANSACTION READ WRITE; INSERT ...`             | **Denied**       | Role-level REVOKE prevents mutation regardless of transaction mode |
| **16** | Privilege Escalation / SET ROLE      | `SET ROLE postgres`                                  | **Denied**       | `permission denied to set role "postgres"`                         |
| **17** | Query Timeout Termination            | `SELECT pg_sleep(10)`                                | **Terminated**   | `canceling statement due to statement timeout` (exceeded 5,000ms)  |
| **18** | Security-Definer Function Invocation | `SELECT dangerous_mutate()`                          | **Denied**       | `permission denied for function dangerous_mutate`                  |
