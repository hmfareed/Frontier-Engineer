---
id: "context7"
name: "Context7 Documentation"
description: "Enables fast, authoritative technical documentation lookup, library version resolution, and code snippet retrieval from Context7."
category: "documentation"
version: "1.1.0"
lifecycle: "runtime_tested"
provider:
  name: "Upstash Context7"
  documentationUrl: "https://context7.com"
  repositoryUrl: "https://github.com/upstash/context7"
  maintainer: "Upstash"
  license: "MIT"
  verificationDate: "2026-11-11"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@upstash/context7-mcp@4.6.0"
  envVars:
    - name: "CONTEXT7_API_KEY"
      required: false
      description: "Optional API key providing elevated rate limits for Context7 documentation queries."
      secret: true
capabilities:
  tools:
    - name: "resolve-library-id"
      description: "Resolves a framework or package query into authoritative Context7 library identifiers, available versions, and snippet counts."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "security-auditor"
    - name: "query-docs"
      description: "Fetches targeted documentation snippets, version-specific API signatures, and idiomatic code examples for a resolved library ID."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "security-auditor"
  resources: []
  prompts: []
security:
  authenticationType: "none"
  permissionClasses:
    - "read_only"
  readOnlyAlternative: "Inspect local node_modules types, package.json dependencies, and offline documentation files."
  credentialEnvVars:
    - "CONTEXT7_API_KEY"
platformConfig: {}
---

# Context7 Documentation Integration Specification

## Purpose and overview

The Context7 MCP integration provides Frontier Engineer with live, authoritative access to technical documentation, API specifications, and official library usage guides via `@upstash/context7-mcp`. AI models frequently suffer from training knowledge cutoffs or hallucinated API signatures. Context7 prevents API hallucination by querying up-to-date documentation indexes for modern libraries and frameworks.

## Provider and maintenance

- **Provider:** Upstash Context7
- **Upstream Package:** `@upstash/context7-mcp`
- **Official Documentation:** [https://context7.com](https://context7.com)
- **Maintainer:** Upstash
- **License:** MIT
- **Documentation:** [https://github.com/upstash/context7](https://github.com/upstash/context7)
- **Verification Date:** 2026-11-11
- **Status Note:** Provider verified and retained; tools aligned with official package exports (`resolve-library-id` and `query-docs`).

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @upstash/context7-mcp@4.6.0`
- **Environment Variables:**
  - `CONTEXT7_API_KEY` (optional): API key for higher query quotas; public index queries do not require a key.

## Capabilities and tool definitions

All tools provided by Context7 are strictly classified as **Read-only**:

- `resolve-library-id`: Discovers matching library IDs (`/org/project`), available versions, and trust scores.
- `query-docs`: Retrieves targeted documentation, version-specific API signatures, and code examples.

See [`capabilities.md`](capabilities.md) for parameter details and output formats.

## Security and permission boundaries

Enforcement operates across five defensive layers:

1. **Server-Level Enforcement (Layer A):** Context7 is inherently a read-only retrieval engine with zero write or mutating capabilities.
2. **Host-Level Configuration (Layer B):** Kept disabled by default (`"disabled": true`) in `mcp_config.json`.
3. **Provider/Infrastructure Permissions (Layer C):** Operates anonymously against public indices; optional API key carries read quotas only.
4. **Behavioral Governance (Layer D):** Prompt injection filtering protects against adversarial examples embedded in third-party documentation.
5. **Human Approval (Layer E):** Standard read operation; human intervention required only if external rate limit fails.

See [`security.md`](security.md) for full security controls.

## Operational behavior and failure handling

- **Graceful Fallback:** When offline or unconfigured, agents immediately fall back to local `node_modules` `.d.ts` type definitions, `package.json` manifests, and project documentation.
- **Zero Startup Blocking:** Context7 initialization failures never prevent agent startup or interrupt task execution.
- **Response Caching:** Repeated queries within the same session reuse cached documentation results.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio command. Runs out-of-the-box when enabled.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
