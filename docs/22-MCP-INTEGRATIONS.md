# Part 22 — MCP integrations catalog

## Catalog summary

Frontier Engineer defines five canonical integrations across five core software-engineering domains, fully audited and verified in v0.5.1.

| ID           | Domain Category   | Verified Provider / Package              | Default Transport         | Lifecycle           | Optional | Primary Agent Roles                              |
| :----------- | :---------------- | :--------------------------------------- | :------------------------ | :------------------ | :------- | :----------------------------------------------- |
| `github`     | `repository`      | `github/github-mcp-server`               | `stdio` (Docker / binary) | `provider_verified` | Yes      | Coordinator, Implementation, QA                  |
| `context7`   | `documentation`   | `@upstash/context7-mcp`                  | `stdio` (`npx`)           | `runtime_tested`    | Yes      | Coordinator, Architect, Implementation, Security |
| `playwright` | `browser_testing` | `@playwright/mcp@latest`                 | `stdio` (`npx`)           | `runtime_tested`    | Yes      | Coordinator, QA, Design                          |
| `sentry`     | `observability`   | `@sentry/mcp-server`                     | `stdio` (`npx`)           | `provider_verified` | Yes      | Coordinator, Security, QA                        |
| `database`   | `database`        | `@microsoft/postgres-mcp` (or community) | `stdio` (`npx`)           | `provider_verified` | Yes      | Coordinator, Architect, Database, Implementation |

---

## Detailed integration specifications

### 1. GitHub MCP (`github`)

- **Domain:** Repository, issue tracking, pull requests, and collaborative code review.
- **Provider:** GitHub Official (`github/github-mcp-server`).
- **Transport & Command:** `stdio` via Docker container (`ghcr.io/github/github-mcp-server:latest`) or native Go binary.
- **Mandatory Server Flags:** `--read-only=true` (hard server-side write tool rejection) and `--toolsets=context,issues,pull_requests,repos`.
- **Environment Requirements:** `GITHUB_PERSONAL_ACCESS_TOKEN` (Fine-grained PAT restricted to target repositories with read-only scopes for Contents, Issues, Pull Requests, and Metadata).
- **Primary Capabilities:**
  - `search_repositories`: Search repositories across GitHub organizations.
  - `get_file_contents`: Retrieve file content across branches or commit hashes.
  - `list_issues` / `get_issue`: Inspect open/closed issue threads and metadata.
  - `list_pull_requests` / `get_pull_request`: Inspect pull requests, changesets, and review comments.
- **Security Boundaries:**
  - Server-side read-only flag blocks registration of mutating tools (`create_issue`, `merge_pull_request`, `delete_branch`).
  - Human-in-the-loop approval required if read-only constraints are ever relaxed for administrative workflows.
  - Local git commands remain primary for local workspace modifications; GitHub MCP does not replace local Git.

### 2. Context7 MCP (`context7`)

- **Domain:** Version-pinned framework documentation, library resolution, and verified API references.
- **Provider:** Upstash (`@upstash/context7-mcp`).
- **Transport & Command:** `stdio` via `npx -y @upstash/context7-mcp`.
- **Environment Requirements:** `CONTEXT7_API_KEY` (Optional for basic open-source queries; token required for high-rate search).
- **Primary Capabilities:**
  - `resolve-library-id`: Resolves package names to verified Context7 documentation identifiers (`/org/project`) with trust scores.
  - `query-docs`: Retrieves targeted, version-specific documentation sections, syntax examples, and API guides.
- **Security Boundaries:**
  - Strictly read-only operations.
  - Retrieved documentation is treated as external reference data and cannot override safety rules or trigger commands.
  - All extracted documentation snippets must preserve source attribution and version markers.

### 3. Playwright MCP (`playwright`)

- **Domain:** Headless browser automation, visual regression inspection, DOM accessibility analysis, and UI verification.
- **Provider:** Microsoft / Playwright Team (`@playwright/mcp@latest`).
- **Transport & Command:** `stdio` via `npx -y @playwright/mcp@latest --headless --isolated`.
- **Mandatory Flags:**
  - `--headless`: Headless execution mode preventing disruptive window popup and background render issues.
  - `--isolated`: Enforces in-memory isolated sessions with zero access to developer cookies, sessions, or personal browser data.
- **Primary Capabilities:**
  - `browser_navigate`: Navigate browser session to local development URL (`http://localhost:...`).
  - `browser_take_screenshot`: Capture visual PNG page or element snapshots for layout and responsive inspection.
  - `browser_snapshot`: Extract WCAG-compliant accessibility snapshot trees with roles and labels.
  - `browser_click` / `browser_fill_form` / `browser_hover`: Synthetic UI interactions within local test environments.
- **Security Boundaries:**
  - Webpage content is treated as untrusted; script execution inside pages cannot escape into agent host environments.
  - Navigation restricted to `localhost`, `127.0.0.1`, and approved development hosts.
  - Zero access to personal developer browser profiles, saved passwords, or session cookies.

### 4. Sentry MCP (`sentry`)

- **Domain:** Production telemetry, error tracking, unhandled exceptions, and release health diagnostics.
- **Provider:** Sentry Official (`@sentry/mcp-server`).
- **Transport & Command:** `stdio` via `npx -y @sentry/mcp-server`.
- **Environment Requirements:** `SENTRY_ACCESS_TOKEN` / `SENTRY_AUTH_TOKEN` (Fine-grained integration token with `project:read`, `event:read`, `org:read`).
- **Primary Capabilities:**
  - `list_projects`: Discover configured Sentry organization projects.
  - `list_issues`: Query active production exceptions, frequencies, and user impacts.
  - `get_issue_details`: Retrieve full stack traces, breadcrumbs, tags, and runtime context.
- **Security Boundaries:**
  - Strictly read-only default. Modifying issue status requires explicit human approval.
  - Exception payloads must be scrubbed of PII and authentication tokens before presentation in reports.
  - Sentry integration is strictly optional.

### 5. Database MCP (`database` / PostgreSQL)

- **Domain:** Relational database inspection, schema analysis, query optimization, and explain plans.
- **Provider:** Microsoft (`@microsoft/postgres-mcp`) or community server (`antonorlov/mcp-postgres-server`).
- **Transport & Command:** `stdio` via `npx -y @microsoft/postgres-mcp`.
- **Environment Requirements:** `POSTGRES_MCP_CONNECTION_STRING` (Connection URI targeting a dedicated read-only role on a non-production database).
- **Primary Capabilities:**
  - `list_tables`: Enumerate tables and views in the active schema.
  - `describe_table`: Inspect column types, nullability, defaults, primary keys, and foreign keys.
  - `read_query`: Execute read-only SQL queries (`SELECT ...`) with query limits and statement timeouts.
- **Security Boundaries (The 10 Invariants):**
  - Dedicated read-only role (`frontier_readonly`) with no schema ownership, no superuser, and no DDL/DML permissions.
  - Hard statement timeout (5,000ms max) and connection limit (2 max).
  - Explicit allowlisting restricted to non-production dev, replica, or staging instances.
