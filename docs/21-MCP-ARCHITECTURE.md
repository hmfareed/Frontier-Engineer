# Part 21 — MCP architecture

## Purpose and role of MCP

The **Model Context Protocol (MCP)** is an open standard that allows AI agents to securely connect to external tools, data sources, and operational environments. In Frontier Engineer, MCP integrations extend the agent's capabilities beyond local file manipulation and terminal commands by providing structured access to:

- Remote version control platforms (GitHub).
- Live technical documentation systems (Context7).
- Headless browser automation and UI testing engines (Playwright).
- Production observability and error monitoring systems (Sentry).
- Relational database management systems (PostgreSQL).

MCP integrations are strictly **extensions** of the engineering system, not substitutes for core engineering discipline:

- Local tools (git, linters, compilers, test runners) remain primary.
- Inability to connect to an external MCP server must never stall local engineering tasks.
- Tools exposed by MCP servers are treated as untrusted boundaries subject to capability-based security policies.

```text
┌─────────────────────────────────────────────────────────────────┐
│                      AGENT SYSTEM LAYER                         │
│       Coordinator selectively routes tasks to specialists       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INTEGRATION ROUTING LAYER                    │
│   Evaluates: Task relevance, configuration, auth, capabilities   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP INTEGRATION SUBSYSTEM                    │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────┐ ┌──────┐  │
│  │  GitHub   │ │ Context7  │ │Playwright │ │ Sentry │ │  DB  │  │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └───┬────┘ └───┬──┘  │
└────────┼─────────────┼─────────────┼───────────┼──────────┼─────┘
         │ (stdio)     │ (stdio)     │ (stdio)   │ (stdio)  │ (stdio)
         ▼             ▼             ▼           ▼          ▼
   Remote GitHub   Upstash Docs   Browser DOM  Sentry API  PostgreSQL
```

## Canonical-first integration architecture

To maintain platform neutrality and prevent vendor lock-in, all integration definitions, tool catalogs, and security policies are maintained in platform-independent canonical specifications under `specs/integrations/`:

```text
specs/integrations/
├── README.md                      # Directory overview and index
├── integration-registry.md        # Authoritative central registry
├── github/
│   ├── integration.md             # Provider, transport, lifecycle, metadata
│   ├── capabilities.md            # Tool definitions and operation classes
│   └── security.md                # Threat model, token hygiene, permissions
├── context7/
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
├── playwright/
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
├── sentry/
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
└── database/
    ├── integration.md
    ├── capabilities.md
    └── security.md
```

### Three-tier integration specification

Every canonical integration is specified using three modular files:

1. **`integration.md`:** Contains formal YAML frontmatter validated against `schemas/canonical-integration.schema.json`, declaring integration ID, category, lifecycle state, official provider details, runtime transport requirements, and high-level operational behavior.
2. **`capabilities.md`:** Details the exact tools provided by the server, input parameters, expected outputs, and their capability classifications (Read-only, Reversible write, External side effect, Destructive, Sensitive data access).
3. **`security.md`:** Defines the threat model, required credentials, prompt injection defenses, log sanitization rules, and permission approval requirements.

## Central integration registry

The central registry at `specs/integrations/integration-registry.md` serves as the single source of truth for all supported integrations. Each entry tracks:

- **`id`:** Unique lowercase identifier (`github`, `context7`, `playwright`, `sentry`, `database`).
- **`category`:** Domain classification (`repository`, `documentation`, `browser_testing`, `observability`, `database`).
- **`lifecycle`:** Lifecycle state (`proposed`, `documented`, `verified`, `available`, `deprecated`, `disabled`).
- **`optional`:** Boolean flag ensuring that optional integrations never block core workflows.
- **`provider`:** Authoritative maintainer reference and documentation URL.
- **`specPaths`:** Relative paths to `integration.md`, `capabilities.md`, and `security.md`.
- **`compatibility`:** Status matrix across supported agent platforms (Antigravity, Claude Code, Cursor, Codex).

### Lifecycle states

| State               | Definition                                          | Runtime Status                            |
| :------------------ | :-------------------------------------------------- | :---------------------------------------- |
| `proposed`          | Conceptual integration under architectural design   | Not executable; no adapter generated      |
| `documented`        | Canonical specification and tools documented        | Specification review only                 |
| `provider_verified` | Provider package, repository, and security verified | Formats and schema checked                |
| `runtime_tested`    | Verified via live JSON-RPC handshake and tools list | Verified in live runtime test harness     |
| `available`         | Ready for operational activation when configured    | Shipped with adapter in `mcp_config.json` |
| `deprecated`        | Superseded by an alternative integration            | Maintained for backward compatibility     |
| `disabled`          | Temporarily or permanently deactivated              | Present in registry but inactive          |

## Integration lifecycle

```text
1. DISCOVERY
   Coordinator classifies task and determines if an external tool is needed.
      │
2. HEALTH & CREDENTIAL CHECK
   Checks if server is configured and required environment variables exist.
      │
3. ROUTING & ACCESS CONTROL
   Maps task to authorized specialist agent with minimum necessary permissions.
      │
4. CAPABILITY INVOCATION
   Agent invokes tool; side-effecting/destructive actions require confirmation.
      │
5. RESPONSE SANITIZATION & LOGGING
   Tool output is validated; errors logged contextually without leaking tokens.
```
