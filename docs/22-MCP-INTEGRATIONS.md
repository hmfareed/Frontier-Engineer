# Part 22 — MCP integrations catalog

## Catalog summary

Frontier Engineer defines five canonical integrations across five core software-engineering domains.

| ID           | Domain Category   | Provider / Package                         | Default Transport | Lifecycle   | Optional | Primary Agent Roles                     |
| :----------- | :---------------- | :----------------------------------------- | :---------------- | :---------- | :------- | :-------------------------------------- |
| `github`     | `repository`      | `@modelcontextprotocol/server-github`      | `stdio` (`npx`)   | `available` | Yes      | Coordinator, Architect, Security        |
| `context7`   | `documentation`   | `@upstash/context7-mcp`                    | `stdio` (`npx`)   | `available` | Yes      | Architect, Implementation, QA, Security |
| `playwright` | `browser_testing` | `@executeautomation/playwright-mcp-server` | `stdio` (`npx`)   | `available` | Yes      | Design, Implementation, QA              |
| `sentry`     | `observability`   | `@modelcontextprotocol/server-sentry`      | `stdio` (`npx`)   | `available` | Yes      | Security, Coordinator, Implementation   |
| `database`   | `database`        | `@modelcontextprotocol/server-postgres`    | `stdio` (`npx`)   | `available` | Yes      | Architect, Implementation, Security     |

---

## Detailed integration specifications

### 1. GitHub MCP (`github`)

- **Domain:** Repository, issue tracking, pull requests, and collaborative code review.
- **Provider:** Model Context Protocol Official (`@modelcontextprotocol/server-github`).
- **Transport & Command:** `stdio` via `npx -y @modelcontextprotocol/server-github`.
- **Environment Requirements:** `GITHUB_PERSONAL_ACCESS_TOKEN` (Fine-grained PAT with minimum scopes: Contents `read`, Issues `read`, Pull Requests `read`, Metadata `read`).
- **Primary Capabilities:**
  - `get_file_contents`: Retrieve file content across branches/tags.
  - `list_directory_contents`: Inspect remote directory tree.
  - `list_issues` / `get_issue`: Query issue tracking metadata and descriptions.
  - `list_pull_requests` / `get_pull_request`: Inspect PR diffs, commits, and comments.
  - `search_code`: Search remote repositories for symbol definitions and usages.
  - `create_pull_request` / `create_issue`: Author proposals (classified as _External side effect_).
- **Security Boundaries:**
  - Default permissions are strictly read-only.
  - Modifying branches, creating PRs, or authoring comments requires explicit human approval.
  - Local git commands remain primary for local workspace modifications; GitHub MCP does not replace local Git.

### 2. Context7 MCP (`context7`)

- **Domain:** Framework documentation, library identification, and verified API references.
- **Provider:** Upstash (`@upstash/context7-mcp`).
- **Transport & Command:** `stdio` via `npx -y @upstash/context7-mcp`.
- **Environment Requirements:** `CONTEXT7_API_KEY` (Optional for basic queries; token required for high-rate search).
- **Primary Capabilities:**
  - `resolve_library_id`: Matches package names (e.g. `zod`, `vitest`, `react`) to official documentation identifiers.
  - `get_library_docs`: Fetches version-pinned technical documentation, API signatures, and migration guides.
  - `query_documentation`: Semantic search over indexed official open-source documentation.
- **Security Boundaries:**
  - Strictly read-only operations.
  - Retrieved documentation is treated as external input and must not override core safety rules or execute arbitrary commands.
  - All research outputs must preserve source attribution and version indicators.

### 3. Playwright MCP (`playwright`)

- **Domain:** Headless browser automation, end-to-end user journey verification, DOM inspection, and accessibility checks.
- **Provider:** ExecuteAutomation Community (`@executeautomation/playwright-mcp-server`).
- **Transport & Command:** `stdio` via `npx -y @executeautomation/playwright-mcp-server`.
- **Runtime Requirements:** Node.js 22+, Chromium browser binaries installed (`npx playwright install chromium`).
- **Primary Capabilities:**
  - `navigate`: Navigate browser session to local development URL (`http://localhost:...`).
  - `screenshot`: Capture visual page snapshot for layout and responsive inspection.
  - `click` / `fill` / `hover`: Simulate user interaction with form controls and buttons.
  - `get_dom` / `get_accessibility_tree`: Inspect rendered DOM structure and WCAG accessibility tree.
  - `get_console_logs`: Inspect browser runtime errors and warning logs.
- **Security Boundaries:**
  - Webpage content is treated as untrusted; scripts embedded in external pages cannot execute agent tool calls.
  - Navigations are restricted to local/staging environments (`localhost`, `127.0.0.1`, or approved staging hosts).
  - Form submissions involving financial payments, authentication credentials, or external API mutations are classified as _Destructive/External Side Effect_ and require explicit confirmation.

### 4. Sentry MCP (`sentry`)

- **Domain:** Production telemetry, error tracking, unhandled exceptions, and release health diagnostics.
- **Provider:** Model Context Protocol Official (`@modelcontextprotocol/server-sentry`).
- **Transport & Command:** `stdio` via `npx -y @modelcontextprotocol/server-sentry`.
- **Environment Requirements:** `SENTRY_AUTH_TOKEN` (Read-only integration token with `project:read`, `event:read`, `org:read`).
- **Primary Capabilities:**
  - `list_projects`: Discover configured Sentry projects.
  - `list_issues`: Query active production exceptions, frequencies, and user impacts.
  - `get_issue_details`: Retrieve full stack traces, breadcrumbs, tags, and runtime context.
  - `list_events`: Retrieve individual exception instances and device metadata.
- **Security Boundaries:**
  - Strictly read-only default. Modifying issue status (`resolved`, `ignored`, `archived`) requires explicit approval.
  - Exception payloads must be scrubbed of PII and authentication tokens before presentation in reports.
  - Sentry integration is strictly optional.

### 5. Database MCP (`database` / PostgreSQL)

- **Domain:** Relational database inspection, schema analysis, query optimization, and explain plans.
- **Provider:** Model Context Protocol Official (`@modelcontextprotocol/server-postgres`).
- **Transport & Command:** `stdio` via `npx -y @modelcontextprotocol/server-postgres`.
- **Environment Requirements:** `DATABASE_URL` (Connection URI; must point to a read-only role or isolated development database).
- **Primary Capabilities:**
  - `list_tables`: Enumerate tables and views in the active schema.
  - `describe_table`: Inspect column types, nullability, defaults, primary keys, and foreign keys.
  - `list_indexes`: Inspect B-tree, GIN, and composite index configurations.
  - `query`: Execute read-only SQL queries (`SELECT ...`).
  - `explain_query`: Generate query execution plans (`EXPLAIN (ANALYZE, BUFFERS) ...`).
- **Security Boundaries:**
  - Mandatory read-only connection configuration (`SET default_transaction_read_only = on`).
  - Prohibited: Executing DDL (`CREATE`, `ALTER`, `DROP`) or DML (`INSERT`, `UPDATE`, `DELETE`) via generic query tools without explicit, staged human approval.
  - Production database credentials must never be committed or logged.
