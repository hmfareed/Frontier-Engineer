---
id: "context7"
name: "Context7 Documentation"
description: "Enables fast, authoritative technical documentation lookup, library version resolution, and API reference querying."
category: "documentation"
version: "1.0.0"
lifecycle: "available"
provider:
  name: "Upstash Context7"
  documentationUrl: "https://github.com/upstash/context7"
  repositoryUrl: "https://github.com/upstash/context7"
  maintainer: "Upstash Team"
  license: "MIT"
  verificationDate: "2026-11-10"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@upstash/context7-mcp"
  envVars:
    - name: "CONTEXT7_API_KEY"
      required: false
      description: "Optional API key providing elevated rate limits for Context7 documentation queries."
      secret: true
capabilities:
  tools:
    - name: "search_docs"
      description: "Searches indexed documentation for libraries, frameworks, APIs, and SDKs."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
        - "security-auditor"
    - name: "get_library_version"
      description: "Resolves available versions, release notes, and migration guides for a specified package."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "fetch_api_signature"
      description: "Fetches exact function, type, interface, and method signatures for a package symbol."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "retrieve_code_examples"
      description: "Retrieves verified code examples and idiomatic usage snippets from documentation."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
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

The Context7 MCP integration provides Frontier Engineer with live, authoritative access to technical documentation, API specifications, and official library usage guides. AI models frequently suffer from training knowledge cutoffs or hallucinated API signatures. Context7 prevents API hallucination by querying up-to-date documentation indexes for modern libraries and SDKs.

## Provider and maintenance

- **Provider:** Upstash Context7
- **Upstream Package:** `@upstash/context7-mcp`
- **Maintainer:** Upstash Team
- **License:** MIT
- **Documentation:** [https://github.com/upstash/context7](https://github.com/upstash/context7)
- **Verification Date:** 2026-11-10

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @upstash/context7-mcp`
- **Environment Variables:**
  - `CONTEXT7_API_KEY` (optional): API key for higher query quotas; public index queries do not require a key.

## Capabilities and tool definitions

All tools provided by Context7 are strictly classified as **Read-only**:

- `search_docs`: Searches library documentation for topics or keywords.
- `get_library_version`: Checks release versions, changelogs, and deprecations.
- `fetch_api_signature`: Retrieves verified type definitions and parameter contracts.
- `retrieve_code_examples`: Fetches idiomatic code patterns.

See [`capabilities.md`](capabilities.md) for parameter details and output formats.

## Security and permission boundaries

- **Strict Read-Only Guarantee:** Context7 contains zero write, delete, or external state-altering capabilities.
- **Untrusted Documentation Defense:** Returned documentation snippets are treated as untrusted third-party text. The agent applies prompt injection filtering to ensure documentation examples do not execute unauthorized instructions.
- **No Private Data Transmission:** Context7 queries only send package names, symbol names, and search terms. No private source code, secrets, or internal identifiers are ever transmitted.

See [`security.md`](security.md) for full security controls.

## Operational behavior and failure handling

- **Graceful Fallback:** When offline or unconfigured, agents immediately fall back to local `node_modules` `.d.ts` type definitions, `package.json` manifests, and project documentation.
- **Zero Startup Blocking:** Context7 initialization failures never prevent agent startup or interrupt task execution.
- **Response Caching:** Repeated queries within the same session reuse cached documentation results.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio command. Runs out-of-the-box when enabled.
- **Claude Code:** Registered via `.mcp.json`.
- **Cursor / Codex:** Registered via standard MCP client configuration.
