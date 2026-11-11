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
