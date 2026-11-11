# Database Integration Security Policy

## Threat Model

Direct database connections carry significant risks of data breach, performance degradation, and accidental corruption. Primary threats include:

1. **SQL Injection via Agent Query Construction:** Unsanitized user inputs or model-generated queries executing unintended database commands.
2. **Unauthorized Data Mutation or Deletion:** Accidental execution of `UPDATE` or `DROP TABLE` statements destroying production state.
3. **Sensitive Data Exposure (PII, Passwords, Tokens):** Plaintext extraction of password hashes, OAuth tokens, credit cards, or user personal data via `SELECT` queries.
4. **Denial of Service via Unbounded Queries:** Running unbounded table scans or cartesian joins that exhaust database CPU or connection pool memory.

## Database Role Enforcement

The connection string provided via `DATABASE_URL` must connect using a **dedicated read-only role**:

- The role must not own any database tables.
- `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, and `DROP` privileges must be revoked.
- Example PostgreSQL configuration:

  ```sql
  CREATE ROLE frontier_readonly WITH LOGIN PASSWORD 'strong_password';
  GRANT CONNECT ON DATABASE target_db TO frontier_readonly;
  GRANT USAGE ON SCHEMA public TO frontier_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO frontier_readonly;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO frontier_readonly;
  ALTER ROLE frontier_readonly SET statement_timeout = '5000ms';
  ```

## Query Restrictions and Limits

- **SELECT-Only Enforcement:** Queries passed to `execute_read_only_query` must strictly start with `SELECT` or `WITH`. Any statement containing keywords `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXECUTE`, or `GRANT` is rejected before dispatch.
- **Mandatory Row Cap:** All queries automatically append `LIMIT 100` if no smaller limit is explicitly provided.
- **Statement Timeout:** A hard 5-second statement timeout is enforced on all connections.

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
