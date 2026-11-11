# Part 22 — MCP integrations catalog

## Catalog summary

Frontier Engineer defines five canonical integrations across five core software-engineering domains, fully audited and verified in v0.5.2.

| ID           | Domain Category   | Pinned Provider / Package                 | Default Transport         | Lifecycle        | Optional | Primary Agent Roles                              |
| :----------- | :---------------- | :---------------------------------------- | :------------------------ | :--------------- | :------- | :----------------------------------------------- |
| `github`     | `repository`      | `ghcr.io/github/github-mcp-server:v2.1.0` | `stdio` (Docker / binary) | `blocked`        | Yes      | Coordinator, Implementation, QA                  |
| `context7`   | `documentation`   | `@upstash/context7-mcp@4.6.0`             | `stdio` (`npx`)           | `runtime_tested` | Yes      | Coordinator, Architect, Implementation, Security |
| `playwright` | `browser_testing` | `@playwright/mcp@0.0.85`                  | `stdio` (`npx`)           | `runtime_tested` | Yes      | Coordinator, QA, Design                          |
| `sentry`     | `observability`   | `@sentry/mcp-server@0.49.0`               | `stdio` (`npx`)           | `blocked`        | Yes      | Coordinator, Security, QA                        |
| `database`   | `database`        | `@microsoft/postgres-mcp@0.3.0`           | `stdio` (`npx`)           | `runtime_tested` | Yes      | Coordinator, Architect, Database, Implementation |

---

## Detailed integration specifications

### 1. GitHub MCP (`github`)

- **Domain:** Repository, issue tracking, pull requests, and collaborative code review.
- **Provider:** GitHub Official (`github/github-mcp-server`).
- **Transport & Command:** `stdio` via Docker container (`ghcr.io/github/github-mcp-server:v2.1.0`) or native Go binary.
- **Mandatory Server Flags:** `--read-only` (hard server-side write tool rejection) and `--toolsets=context,issues,pull_requests,repos`.
- **Environment Requirements:** `GITHUB_PERSONAL_ACCESS_TOKEN` (Fine-grained PAT restricted to target repositories with read-only scopes for Contents, Issues, Pull Requests, and Metadata).
- **Lifecycle:** `blocked` when external user token or active Docker daemon is unavailable.
- **Primary Capabilities:**
  - `get_file_contents`: Retrieve file content across branches or commit hashes.
  - `list_issues` / `get_issue`: Inspect open/closed issue threads and metadata.
  - `list_pull_requests` / `get_pull_request`: Inspect pull requests, changesets, and review comments.
  - `list_commits`: Inspect commit history.
  - `search_code` / `search_issues`: Query code and issue threads.
- **Security Boundaries:**
  - Server-side read-only flag blocks registration of mutating tools (`create_issue`, `merge_pull_request`, `delete_branch`).
  - Human-in-the-loop approval required if read-only constraints are ever relaxed for administrative workflows.
  - Local git commands remain primary for local workspace modifications; GitHub MCP does not replace local Git.

### 2. Context7 MCP (`context7`)

- **Domain:** Version-pinned framework documentation, library resolution, and verified API references.
- **Provider:** Upstash (`@upstash/context7-mcp@4.6.0`).
- **Transport & Command:** `stdio` via `npx -y @upstash/context7-mcp@4.6.0`.
- **Environment Requirements:** `CONTEXT7_API_KEY` (Optional for basic open-source queries; token required for high-rate search).
- **Lifecycle:** `runtime_tested` (JSON-RPC handshake passed over stdio).
- **Primary Capabilities:**
  - `resolve-library-id`: Resolves package names to verified Context7 documentation identifiers (`/org/project`) with trust scores.
  - `query-docs`: Retrieves targeted, version-specific documentation sections, syntax examples, and API guides.
- **Security Boundaries:**
  - Strictly read-only operations.
  - Retrieved documentation is treated as external reference data and cannot override safety rules or trigger commands.
  - All extracted documentation snippets must preserve source attribution and version markers.

### 3. Playwright MCP (`playwright`)

- **Domain:** Headless browser automation, visual regression inspection, DOM accessibility analysis, and UI verification.
- **Provider:** Microsoft / Playwright Team (`@playwright/mcp@0.0.85`).
- **Transport & Command:** `stdio` via `npx -y @playwright/mcp@0.0.85 --headless --isolated`.
- **Lifecycle:** `runtime_tested` (JSON-RPC handshake passed over stdio; 25 discovered tools).
- **Mandatory Flags:**
  - `--headless`: Headless execution mode preventing window popup and background rendering issues.
  - `--isolated`: Enforces an in-memory `BrowserContext` with zero persistence of cookies, localStorage, or auth tokens, preventing access to personal browser profiles. Note that `--isolated` governs browser profile state only and does not provide an operating system sandbox or host process containment.
- **Primary Capabilities (Exposed to Agents):**
  - `browser_navigate`: Navigate browser session to local development URL (`http://localhost:...`).
  - `browser_take_screenshot`: Capture visual PNG page or element snapshots for layout and responsive inspection.
  - `browser_snapshot`: Extract WCAG-compliant accessibility snapshot trees with roles and labels.
  - `browser_click` / `browser_fill_form` / `browser_hover` / `browser_select_option`: Synthetic UI interactions within local test environments.
- **Security Boundaries:**
  - Webpage content is treated as untrusted; script execution inside pages cannot escape into agent host environments.
  - Navigation restricted to `localhost`, `127.0.0.1`, and approved development hosts.
  - Zero access to personal developer browser profiles, saved passwords, or session cookies.
  - Host process executes with developer user privileges; OS sandboxing requires external containerization.

### 4. Sentry MCP (`sentry`)

- **Domain:** Production telemetry, error tracking, unhandled exceptions, and release health diagnostics.
- **Provider:** Sentry Official (`@sentry/mcp-server@0.49.0`).
- **Transport & Command:** `stdio` via `npx -y @sentry/mcp-server@0.49.0`.
- **Environment Requirements:** `SENTRY_AUTH_TOKEN` (Official user token with `project:read`, `event:read`, `org:read` scopes. The legacy `SENTRY_ACCESS_TOKEN` is officially deprecated upstream).
- **Lifecycle:** `blocked` when `SENTRY_AUTH_TOKEN` is unset in the environment.
- **Primary Capabilities:**
  - `list_issues`: Query active production exceptions, frequencies, and user impacts.
  - `get_issue`: Retrieve full issue metadata, culprit, and status.
  - `list_events` / `get_event`: Retrieve symbolicated stack traces, breadcrumbs, tags, and runtime context.
  - `search_issues`: Search issues by error message or tag.
- **Security Boundaries:**
  - Strictly read-only default. Modifying issue status requires explicit human approval.
  - Exception payloads must be scrubbed of PII and authentication tokens before presentation in reports.
  - Sentry integration is strictly optional.

### 5. Database MCP (`database` / PostgreSQL)

- **Domain:** Relational database inspection, schema analysis, query optimization, and explain plans.
- **Provider:** Microsoft (`@microsoft/postgres-mcp@0.3.0`).
- **Transport & Command:** `stdio` via `npx -y @microsoft/postgres-mcp@0.3.0 run` (the `run` subcommand is required to start stdio MCP mode).
- **Environment Requirements:** `POSTGRES_MCP_CONNECTION_STRING` (Connection URI targeting a dedicated read-only role on a non-production database).
- **Lifecycle:** `runtime_tested` (Live stdio JSON-RPC initialized, 13 actual tools discovered, 8 tools exposed via Antigravity `enabledTools`, 5 tools excluded, connected under restricted role `frontier_readonly`, permitted read verified, mutations denied, and 18/18 database security assertions passed against PostgreSQL 18.6).
- **Three-Tier Security Boundary:**
  1. _Layer 1 (Host Allowlisting):_ Antigravity `enabledTools` restricts the exposed tool catalogue to exactly 8 approved read-only tools. Excluded tools are absent from the host catalogue and blocked from agent invocation.
  2. _Layer 2 (MCP Profile Mode):_ Active connection profiles enforce `access_mode: ro`.
  3. _Layer 3 (Database Role Privileges):_ Restricted role `frontier_readonly` (`NOINHERIT`, `REVOKE ALL`, `default_transaction_read_only = on`, `statement_timeout = 5000`) independently rejects mutations at the transaction boundary.
- **Approved Tools (8 Tools in `enabledTools`):**
  - `postgres_mcp_query`: Execute read-only SQL queries (`SELECT ...`, `EXPLAIN ...`) with timeout and row caps.
  - `postgres_mcp_db_context`: Introspect table schemas, indexes, views, foreign keys, and constraints.
  - `postgres_mcp_connect`: Connect to authorized read-only profiles (`access_mode: ro`).
  - `postgres_mcp_disconnect`: Terminate active connection sessions and release pooled resources.
  - `postgres_mcp_list_connection_profiles` / `postgres_mcp_list_databases`: Discover available databases and profiles.
  - `postgres_mcp_get_server_capabilities` / `postgres_mcp_get_metrics_group`: Probe diagnostic capabilities and performance metrics.
- **Excluded Dangerous & Filesystem Tools (5 Tools):**
  - Mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`) are strictly excluded from the host tool surface.
  - Filesystem tool (`postgres_mcp_describe_csv`) is excluded to prevent arbitrary local filesystem path-traversal exposure, as bulk import preparation is unnecessary when `bulk_load_csv` is prohibited.
- **Security Boundaries (The 10 Invariants):**
  - Dedicated read-only role (`frontier_readonly`) with `NOINHERIT`, no schema ownership, no superuser, and no DDL/DML permissions.
  - Hard statement timeout (`statement_timeout = '5000ms'`) and connection limit (2 max).
  - Explicit allowlisting restricted to non-production dev, replica, or staging instances.

---

## Pinned Provider Versions & Reproducible Update Strategy

All five canonical integrations enforce strict version pinning across container tags and package registries to eliminate supply-chain drift:

| Integration  | Pinned Identifier                         | Registry / Source | Pinned Version |
| :----------- | :---------------------------------------- | :---------------- | :------------- |
| `github`     | `ghcr.io/github/github-mcp-server:v2.1.0` | GitHub Container  | `v2.1.0`       |
| `context7`   | `@upstash/context7-mcp@4.6.0`             | npm Registry      | `4.6.0`        |
| `playwright` | `@playwright/mcp@0.0.85`                  | npm Registry      | `0.0.85`       |
| `sentry`     | `@sentry/mcp-server@0.49.0`               | npm Registry      | `0.49.0`       |
| `database`   | `@microsoft/postgres-mcp@0.3.0`           | npm Registry      | `0.3.0`        |

### Reproducible Update Protocol

1. **Floating Tags Prohibited:** Unpinned tags (`@latest`, `:latest`, `^`, `~`) are prohibited in canonical specifications and generated configurations.
2. **Review Cadence:** Provider packages undergo evaluation on quarterly plugin release cycles or immediately upon upstream security advisories.
3. **Verification Gate:**
   - Verify upstream repository maintainer, release signatures/digests, and license compatibility (MIT/Apache-2.0).
   - Execute stdio JSON-RPC handshake, protocol negotiation, and tool discovery using `scripts/test-mcp-runtime.ts`.
   - Ensure tool catalogue does not introduce unclassified mutating tools without defensive controls.
   - For PostgreSQL database updates, run the 18-point database security test matrix against the ephemeral cluster.
4. **Adapter Synchronization:**
   - Update `specs/integrations/<id>/integration.md`.
   - Run `npm run generate:integrations` to synchronize `mcp_config.json` and `mcp_config.example.json`.
   - Run `npm run verify` and `agy plugin validate --strict .` to confirm zero drift and schema conformance.
