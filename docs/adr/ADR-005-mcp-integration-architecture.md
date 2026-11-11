# ADR-005: Secure MCP Integration Architecture

- **Status:** Accepted
- **Date:** 2026-11-10
- **Phase:** 5
- **Related:** [Part 21 MCP Architecture](../21-MCP-ARCHITECTURE.md), [Part 22 MCP Integrations](../22-MCP-INTEGRATIONS.md), [Part 23 MCP Security](../23-MCP-SECURITY.md), [Part 24 MCP Configuration](../24-MCP-CONFIGURATION.md), [Part 25 MCP Portability](../25-MCP-PORTABILITY.md), [Part 26 MCP Operations](../26-MCP-OPERATIONS.md), [ADR-001](ADR-001-foundation.md), [ADR-002](ADR-002-agent-system.md), [ADR-003](ADR-003-skills-system.md), [ADR-004](ADR-004-rules-system.md)

## Context

Phase 1 established the plugin foundation. Phase 2 delivered the specialized agent system. Phase 3 delivered the portable engineering skills system. Phase 4 delivered the modular engineering rules system. Phase 5 requires integrating external engineering capabilities via the Model Context Protocol (MCP) without compromising the established architectural principles.

The integration system faces distinct engineering challenges:

1. **Host Heterogeneity:** AI agent platforms differ in where and how MCP servers are declared, launched, and managed.
2. **Security & Least Privilege:** External tools expose sensitive environments (repositories, browsers, databases, production error monitors); unconstrained access risks prompt injection, data exfiltration, and destructive mutations.
3. **Offline & Zero-Credential Independence:** Frontier Engineer must remain fully operational when external tools or credentials are unavailable. Missing credentials or offline environments must never crash the plugin.
4. **Maintenance & Extensibility:** Adding integrations must follow a standardized, canonical-first specification rather than hardcoding platform-specific server definitions.

## Decisions

### 1. Canonical-first specification architecture

All integration intelligence is authored in platform-independent specifications under `specs/integrations/`:

- `specs/integrations/README.md` and `specs/integrations/integration-registry.md` provide the central registry and indexing mechanism.
- Each integration resides in a dedicated directory with three modular files:
  - `integration.md`: Metadata, provider identity, runtime transport, lifecycle state, operational behavior.
  - `capabilities.md`: Detailed tool catalog, operations, and capability classifications.
  - `security.md`: Threat model, credential requirements, prompt injection defenses, and permission boundaries.

Specifications require frontmatter validated against `schemas/canonical-integration.schema.json` and empty `platformConfig: {}`.

**Consequence:** Integration capabilities are documented and reviewed independently of any specific host's configuration format.

### 2. Five capability permission classes

Every integration capability is formally classified into one of five policy tiers:

1. **Read-only:** Non-mutating data retrieval (allowed when authorized).
2. **Reversible write:** Modifications with straightforward undo mechanisms.
3. **External side effect:** Network or third-party state mutations (e.g., creating issues/PRs, sending alerts). Requires explicit approval by default.
4. **Destructive operation:** Irreversible actions (dropping tables, force pushing, bulk deleting). Requires human confirmation stating operation, reason, resources, and risks.
5. **Sensitive data access:** Access to credentials, PII, or raw database contents. Minimum necessary scope and justification required.

**Consequence:** Clear policy boundaries exist for agents, regardless of whether the host runtime enforces capability-level permissions natively.

### 3. Five initial canonical integrations

Frontier Engineer specifies five initial integrations:

1. `github`: Repository discovery, issues, PRs, code search, and collaboration.
2. `context7`: Up-to-date framework documentation and API references.
3. `playwright`: Browser-based UI verification, DOM inspection, and accessibility snapshots.
4. `sentry`: Production exception diagnostics, stack traces, and release tracking (optional).
5. `database` (PostgreSQL): Schema inspection, query analysis, explain plans, and read-only diagnostics (optional).

### 4. Verified Antigravity runtime configuration with `disabled: true` defaults

Antigravity natively discovers MCP servers from `<plugin-root>/mcp_config.json`.
To ensure that Frontier Engineer never crashes or throws error toasts on startup when credentials are unconfigured:

- All five servers are declared in `mcp_config.json` with `"disabled": true` by default.
- Servers inherit environment variables from the agent environment without requiring hardcoded placeholders in `env`.
- `mcp_config.example.json` is generated for developers wishing to enable servers locally in workspace `.agents/mcp_config.json` or globally in `~/.gemini/config/mcp_config.json`.

**Consequence:** `agy plugin validate --strict .` passes with `mcpServers: 5` and zero warnings, while preserving complete offline independence.

### 5. Selective agent routing and capability mapping

Integrations are mapped deliberately to agent roles:

- Primary coordinator (`frontier-engineer`): Discovers and selectively routes integration tasks.
- `architect`: Context7, Database, GitHub.
- `implementation-engineer`: Context7, Playwright, Database.
- `security-auditor`: Sentry, GitHub, Database.
- `qa-engineer`: Playwright, Context7.
- `design-engineer`: Playwright.

Universal, unrestricted tool access across all agents is prohibited.

### 6. Document numbering reorganization

To accommodate the six MCP architecture documents (Parts 21–26), the existing `docs/24-OFFICIAL-FORMAT-VERIFICATION.md` was moved to `docs/27-OFFICIAL-FORMAT-VERIFICATION.md`. All incoming links were updated across the repository.

---

### Addendum: Phase 5.1 Provider Verification, Correction & Hardening (v0.5.1)

#### 1. Retirement of Deprecated Reference Packages

Technical audit revealed that several `@modelcontextprotocol/server-*` packages were reference implementations or deprecated prototypes. In v0.5.1, all five providers were upgraded to officially maintained, production-grade servers:

- **GitHub:** Upgraded to official `github/github-mcp-server` (Go binary / Docker `ghcr.io/github/github-mcp-server`). Enforces `--read-only=true` server-side to reject mutating tool registration.
- **Context7:** Pinned to Upstash `@upstash/context7-mcp` with exact verified tool names `resolve-library-id` and `query-docs`.
- **Playwright:** Upgraded to official `@playwright/mcp@latest` with `--headless` and `--isolated` flags, ensuring in-memory sessions that never touch personal browser profiles or cookies.
- **Sentry:** Upgraded to official `@sentry/mcp-server` with `SENTRY_ACCESS_TOKEN` auth and fine-grained read-only project scopes.
- **Database (PostgreSQL):** Selected `@microsoft/postgres-mcp` as primary enterprise provider with `POSTGRES_MCP_CONNECTION_STRING`, evaluated against `antonorlov/mcp-postgres-server` (`PG_ALLOW_WRITE=false`).

#### 2. Defense-in-Depth Database Invariants

Direct database connectivity enforces 10 strict invariants across engine, network, server, and client boundaries:

1. Dedicated read-only role (`frontier_readonly`).
2. No schema ownership.
3. No superuser or administrative privileges.
4. All DDL privileges revoked (`CREATE`, `ALTER`, `DROP`).
5. All DML mutation privileges revoked (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`).
6. Server-side read-only flags passed at process startup.
7. Read-only transaction enforcement (`SET TRANSACTION READ ONLY`).
8. Hard statement timeout (5,000ms max).
9. Strict connection limit (maximum 2 concurrent connections).
10. Target allowlisting restricted to non-production dev, replica, or staging instances.

#### 3. Empirical Runtime Acceptance Testing

A dedicated runtime test harness (`scripts/test-mcp-runtime.ts`) executes controlled stdio JSON-RPC handshakes:

- **Playwright & Context7:** Classified as `PASSED` after successful process execution, protocol handshake, and tool discovery.
- **GitHub, Sentry, & PostgreSQL:** Classified as `BLOCKED` with empirical evidence documenting missing tokens, inactive Docker daemon, or unauthenticated database endpoints. Strict verification discipline prohibits conflating `BLOCKED` with `PASSED` or `FAILED`.

---

### Addendum: Phase 5.1.1 Live Verification, Tool Discovery, and Hardening Remediation (v0.5.2)

#### 1. Live Database Acceptance & Runtime MCP Verification

- **18/18 SQL Acceptance Tests Passed:** An ephemeral PostgreSQL 18.6 cluster was spun up and provisioned with the dedicated `frontier_readonly` role (`NOINHERIT`, `CONNECTION LIMIT 2`, `REVOKE ALL`, `GRANT SELECT`, `SET default_transaction_read_only = on`, `statement_timeout = '2000ms'`). All 18 assertions passed, demonstrating that PostgreSQL engine rules enforce read-only isolation, timeout termination, and schema boundaries independently of LLM prompt compliance.
- **MCP Server Stdio Runtime Verification:** `@microsoft/postgres-mcp@0.3.0 run` was launched against the active ephemeral database. The server completed protocol initialization (`2024-11-05`), discovered 13 actual tools, connected using `frontier_readonly`, successfully executed a permitted read query (`SELECT count(*) FROM public.products` -> `count 2`), and rejected mutating statements (`INSERT`, `CREATE TABLE`) with `"cannot execute ... in a read-only transaction"`. PostgreSQL integration lifecycle was updated from `blocked` to `runtime_tested`.
- **Launch Command Correction:** Verified that `@microsoft/postgres-mcp` requires the `run` argument to start stdio JSON-RPC MCP mode (`npx -y @microsoft/postgres-mcp@0.3.0 run`).

#### 2. Sentry Authentication Canonicalization

- Upgraded Sentry specification and configuration to use the documented `SENTRY_AUTH_TOKEN` environment variable. The deprecated variable `SENTRY_ACCESS_TOKEN` was removed across all specifications, tests, and configuration templates.
- Sentry integration remains accurately marked as `BLOCKED` pending developer environment token injection.

#### 3. Playwright Security Specification Precision

- Playwright integration documentation was corrected to explicitly articulate the distinction between browser profile isolation and host operating system sandboxing across the six technical security dimensions.
- The `--isolated` flag guarantees a pristine in-memory `BrowserContext` (no persistent cookies or access to personal browser profiles), but does not restrict host Node.js process syscalls or filesystem capabilities.

#### 4. GitHub Read-Only Boundary and Scope Hardening

- Verified `--read-only` server-side enforcement on `ghcr.io/github/github-mcp-server:v2.1.0`.
- Documented least-privilege fine-grained PAT requirements scoped strictly to read-only access on target repositories (`Contents: Read`, `Issues: Read`, `Pull requests: Read`, `Metadata: Read`). Lifecycle remains `BLOCKED` in the absence of a token and container runtime.

#### 5. Strict Version Pinning & Reproducible Update Strategy

- All 5 canonical integrations enforce exact pinned package and image versions (`ghcr.io/github/github-mcp-server:v2.1.0`, `@upstash/context7-mcp@4.6.0`, `@playwright/mcp@0.0.85`, `@sentry/mcp-server@0.49.0`, `@microsoft/postgres-mcp@0.3.0`).
- Established an empirical verification protocol for future updates, requiring stdio handshake testing and regression checks before version increments.

---

### Addendum: Phase 5.1.2 Antigravity Tool Allowlisting & Three-Tier Boundary (v0.5.3)

#### 1. Explicit Antigravity Host Filtering (`enabledTools`)

- **Host-Level Control:** Upstream `@microsoft/postgres-mcp@0.3.0` advertises 13 tools by default over stdio `tools/list`, including mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`) and local file inspection tools (`postgres_mcp_describe_csv`).
- **Approved Allowlist (8 Tools):** Generated deterministically from canonical specifications (`toolFiltering: "allowlist"`), the Antigravity adapter `mcp_config.json` restricts exposed tools via `enabledTools` to:
  1. `postgres_mcp_query`
  2. `postgres_mcp_db_context`
  3. `postgres_mcp_connect`
  4. `postgres_mcp_disconnect`
  5. `postgres_mcp_list_connection_profiles`
  6. `postgres_mcp_list_databases`
  7. `postgres_mcp_get_server_capabilities`
  8. `postgres_mcp_get_metrics_group`
- **Isolation of Other Integrations:** Verified that other canonical integrations (`github`, `context7`, `playwright`, `sentry`) do not inherit `enabledTools`, preserving their individual toolset and scoping models.

#### 2. Local Filesystem Access Evaluation (`postgres_mcp_describe_csv`)

- **Risk Assessment:** Evaluated `postgres_mcp_describe_csv` independently. Because it accepts an unconstrained host file path (`csvPath`) and executes without path containment or chroot boundaries, exposing it introduces arbitrary local filesystem file read / path traversal risks.
- **Decision:** Because `postgres_mcp_bulk_load_csv` is prohibited, CSV description serves no legitimate role in relational query inspection. `postgres_mcp_describe_csv` is strictly excluded from `enabledTools`.

#### 3. Complete Three-Tier Defense-in-Depth Verification

- **Tier 1 (Antigravity Host Filtering):** Excluded dangerous tools (5 tools) are absent from the host-exposed catalogue; host-level invocation blocks any attempt to dispatch them.
- **Tier 2 (MCP Profile Mode):** The active connection profile configures read-only access mode (`access_mode: ro`).
- **Tier 3 (PostgreSQL Database Engine):** The `frontier_readonly` role independently enforces `default_transaction_read_only = on` and revokes all DDL/DML, rejecting mutations with error code `25006` even if tiers 1 and 2 were bypassed.
