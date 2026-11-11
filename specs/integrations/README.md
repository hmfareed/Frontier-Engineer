# Canonical MCP Integration Specifications

This directory contains the platform-independent canonical specifications for external integrations supported by Frontier Engineer via the Model Context Protocol (MCP).

## Overview

Frontier Engineer treats MCP integrations as external capability extensions subject to strict capability-based authorization, security boundaries, and graceful fallback behaviors. Local tools and project files remain primary; optional MCP integrations enhance capabilities when configured, but their absence never impedes normal offline development.

## Directory Structure

```text
specs/integrations/
├── README.md                      # Directory overview and index (this file)
├── integration-registry.md        # Authoritative machine-readable registry
├── github/                        # GitHub remote repository and PR management
│   ├── integration.md             # Integration metadata and lifecycle
│   ├── capabilities.md            # Tools and capability classes
│   └── security.md                # Threat model and token hygiene
├── context7/                      # Documentation and framework API reference
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
├── playwright/                    # Browser automation and E2E verification
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
├── sentry/                        # Observability and error triage
│   ├── integration.md
│   ├── capabilities.md
│   └── security.md
└── database/                      # Database schema inspection and query analysis
    ├── integration.md
    ├── capabilities.md
    └── security.md
```

## Three-Tier Specification Structure

Each integration directory contains three canonical specification documents:

1. **`integration.md`**: Declares canonical YAML frontmatter (validated against `schemas/canonical-integration.schema.json`) including provider identity, runtime transport, lifecycle state, failure modes, and platform portability.
2. **`capabilities.md`**: Exhaustively lists provided tools, parameters, outputs, agent affinities, and permission classifications.
3. **`security.md`**: Details the threat model, authentication token hygiene, data access boundaries, audit logging, and human-in-the-loop approval thresholds.

## Integration Registry

The authoritative central index is defined in [`integration-registry.md`](integration-registry.md). Platform adapters (such as `mcp_config.json` for Antigravity) are generated from canonical specifications and the central registry.
