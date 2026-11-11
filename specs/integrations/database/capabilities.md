# Database Integration Capabilities

This document provides complete tool specifications and parameter contracts for the PostgreSQL database integration powered by `@microsoft/postgres-mcp@0.3.0`.

## Verified Tool Catalogue Summary

The official `@microsoft/postgres-mcp@0.3.0` server exposes 13 distinct tools over stdio JSON-RPC. Frontier Engineer strictly filters these tools through Antigravity host-level allowlisting (`enabledTools`), exposing only 8 approved read-only tools and excluding all 5 dangerous or out-of-scope tools:

### Approved & Host-Allowlisted Tools (8 Tools)

| Tool Name                               | Permission Class | Target Scope                             | Human Confirmation Required | Agent Affinity                                                                  |
| :-------------------------------------- | :--------------- | :--------------------------------------- | :-------------------------- | :------------------------------------------------------------------------------ |
| `postgres_mcp_query`                    | Read-only        | Database rows via read-only SQL (SELECT) | No (capped at 10,000 rows)  | `frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor` |
| `postgres_mcp_db_context`               | Read-only        | Schema metadata, tables, views, keys     | No                          | `frontier-engineer`, `architect`, `implementation-engineer`                     |
| `postgres_mcp_connect`                  | Read-only        | Named connection profiles & session init | No                          | `frontier-engineer`, `architect`                                                |
| `postgres_mcp_disconnect`               | Read-only        | Connection termination                   | No                          | `frontier-engineer`, `architect`                                                |
| `postgres_mcp_list_connection_profiles` | Read-only        | Available connection profile discovery   | No                          | `frontier-engineer`, `architect`                                                |
| `postgres_mcp_list_databases`           | Read-only        | Enumeration of databases on server       | No                          | `frontier-engineer`, `architect`                                                |
| `postgres_mcp_get_server_capabilities`  | Read-only        | Diagnostic probe & metric groups         | No                          | `frontier-engineer`, `architect`, `implementation-engineer`                     |
| `postgres_mcp_get_metrics_group`        | Read-only        | Performance metrics & health telemetry   | No                          | `frontier-engineer`, `architect`, `implementation-engineer`                     |

---

## Excluded Tools: Local Filesystem Access Evaluation

### `postgres_mcp_describe_csv` Evaluation

- **Tool Name:** `postgres_mcp_describe_csv`
- **Reported Capability:** Analyzes CSV file headers and data types on a given file path.
- **Parameters:** `{ "csvPath": string }`
- **Security & Filesystem Implications:**
  1. **Arbitrary Local Filesystem Read:** The `@microsoft/postgres-mcp` server executes locally as a child process of the host. When supplied with an arbitrary `csvPath` (e.g. `C:\Users\...\credentials.json`, `/etc/passwd`, or project `.env` files), `postgres_mcp_describe_csv` opens and reads the file using standard Node.js/Rust filesystem APIs without operating system chroot, workspace boundary checks, or path traversal safeguards.
  2. **Bulk Load Companion Tool:** Upstream `@microsoft/postgres-mcp` documentation specifies that `postgres_mcp_describe_csv` exists exclusively to preview CSV files prior to invoking `postgres_mcp_bulk_load_csv`. Because `postgres_mcp_bulk_load_csv` is strictly prohibited and excluded from Frontier Engineer, `postgres_mcp_describe_csv` serves no legitimate role in query inspection or schema analysis.
  3. **Least-Privilege Determination:** To prevent arbitrary local file probing and preserve least privilege, `postgres_mcp_describe_csv` is **strictly excluded** from the Antigravity `enabledTools` allowlist.

---

## Strictly Prohibited & Excluded Mutating / Administrative Tools (4 Tools)

The following mutating and administrative tools in `@microsoft/postgres-mcp` are **strictly excluded** from Frontier Engineer's host-exposed tool catalogue:

1. **`postgres_mcp_modify`:**
   - **Risk Classification:** `destructive` / `reversible_write`.
   - **Operations:** Executes arbitrary DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) and DML (`INSERT`, `UPDATE`, `DELETE`).
   - **Policy:** Strictly excluded from agent access. Database schema migrations must execute exclusively through version-controlled repository migration workflows (e.g. Prisma, Flyway, Alembic, raw migration SQL files), never via ad-hoc AI MCP commands.
2. **`postgres_mcp_bulk_load_csv`:**
   - **Risk Classification:** `external_side_effect` / `destructive`.
   - **Operations:** Executes server-side `COPY` commands from local CSV files into target tables.
   - **Policy:** Excluded from autonomous workflows to prevent data tampering.
3. **`postgres_mcp_add_connection`:**
   - **Risk Classification:** `sensitive_data_access`.
   - **Operations:** Adds new connection profiles to `~/.postgres-mcp/connections.yaml`.
   - **Policy:** Profile management must occur out-of-band by the developer using the CLI (`npx -y @microsoft/postgres-mcp connection add ...`).
4. **`postgres_mcp_remove_connection`:**
   - **Risk Classification:** `destructive`.
   - **Operations:** Deletes connection profiles.
   - **Policy:** Excluded from agent workflows.

---

## Verified Tool Specifications

### `postgres_mcp_query`

- **Description:** Runs a formatted read-only SQL query (`SELECT ...` or `EXPLAIN ...`) against an active connection session.
- **Parameters:**
  - `connectionId` (string, required): Active connection ID formatted as `postgres-mcp/{profile_id}[/{database}]`.
  - `query` (string, required): Single, well-formatted read-only SQL statement.
  - `maxResultRows` (integer, optional): Maximum rows returned in response (default: 10,000).
  - `validationQueries` (array of objects, optional): Optional validation checks for literal values.
- **Enforcement:** Enforces transaction-level read-only mode (`SET default_transaction_read_only = on`) and statement timeouts (`statement_timeout = '2000ms'`).
- **Output:** Structured JSON object containing `results` table and `errorMessage` (null on success).

### `postgres_mcp_db_context`

- **Description:** Retrieves structural CREATE scripts and metadata for database objects.
- **Parameters:**
  - `connectionId` (string, required): Active connection ID.
  - `objectType` (string, required): Target object type. Permitted values: `"tables"`, `"indexes"`, `"functions"`, `"sequences"`, `"ownership"`, `"default_privileges"`, `"fdw"`, `"all"`.
  - `schemaName` (string, optional): Specific schema to inspect (defaults to all schemas).
- **Output:** Comprehensive SQL definition scripts for requested database objects.

### `postgres_mcp_connect`

- **Description:** Establishes an active database session to a pre-configured profile or environment profile.
- **Parameters:**
  - `profileId` (string, required): Profile ID retrieved via `postgres_mcp_list_connection_profiles`.
  - `database` (string, optional): Target database name override (defaults to profile's default database).
- **Output:** Connection ID and success confirmation (`{"connectionId": "postgres-mcp/...", "success": true}`).

### `postgres_mcp_list_connection_profiles`

- **Description:** Lists all available PostgreSQL connection profiles (both saved keyring profiles and environment profile).
- **Parameters:** None.
- **Output:** JSON array of profiles containing `profileId`, `profileName`, `hostName`, and `defaultDatabase`.

### `postgres_mcp_list_databases`

- **Description:** Enumerates all databases available on the connected server instance.
- **Parameters:**
  - `connectionId` (string, required): Active connection ID.
- **Output:** List of database names accessible on the instance.

### `postgres_mcp_get_server_capabilities`

- **Description:** Probes the database instance for diagnostic extensions, server version, Azure detection, and supported metrics.
- **Parameters:**
  - `connectionId` (string, required): Active connection ID.
- **Output:** Capabilities object listing available diagnostic groups.

### `postgres_mcp_get_metrics_group`

- **Description:** Collects pre-correlated performance and diagnostic telemetry (CPU, memory, storage, locks, throughput).
- **Parameters:**
  - `connectionId` (string, required): Active connection ID.
  - `groups` (array of strings, required): Metric groups to collect (e.g., `core_health`, `saturation`, `throughput`, `lock_contention`).
  - `granularity` (string, optional): Metric resolution (default: `PT5M`).
  - `outputFormat` (string, optional): `"json"` or `"csv"`.
- **Output:** Performance diagnostic dataset.

### `postgres_mcp_disconnect`

- **Description:** Closes an open connection session and releases pooled client resources.
- **Parameters:**
  - `connectionId` (string, required): Active connection ID to terminate.
- **Output:** Disconnection confirmation.
