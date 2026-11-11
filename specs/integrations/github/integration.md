---
id: "github"
name: "GitHub Integration"
description: "Provides secure, read-only-by-default access to GitHub remote repository operations, issue tracking, and pull request inspection using GitHub's official MCP server."
category: "repository"
version: "1.1.0"
lifecycle: "blocked"
provider:
  name: "GitHub (Official)"
  documentationUrl: "https://github.com/github/github-mcp-server"
  repositoryUrl: "https://github.com/github/github-mcp-server"
  maintainer: "GitHub"
  license: "MIT"
  verificationDate: "2026-11-11"
runtime:
  transport: "stdio"
  runtime: "binary"
  executable: "docker"
  args:
    - "run"
    - "-i"
    - "--rm"
    - "-e"
    - "GITHUB_PERSONAL_ACCESS_TOKEN"
    - "ghcr.io/github/github-mcp-server:v2.1.0"
    - "--read-only"
    - "--toolsets=context,issues,pull_requests,repos"
  envVars:
    - name: "GITHUB_PERSONAL_ACCESS_TOKEN"
      required: true
      description: "GitHub personal access token with scoped repository read permissions."
      secret: true
    - name: "GITHUB_READ_ONLY"
      required: false
      description: "Enforces server-side read-only mode, disabling all write actions (default: true)."
      secret: false
    - name: "GITHUB_TOOLSETS"
      required: false
      description: "Configures active toolsets (e.g., context,issues,pull_requests,repos)."
      secret: false
capabilities:
  tools:
    - name: "get_file_contents"
      description: "Retrieves the contents of a file or directory from a remote GitHub repository."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "get_issue"
      description: "Retrieves details, discussion, and status of a GitHub issue."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "list_issues"
      description: "Lists issues in a repository filtered by state, labels, or milestones."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "get_pull_request"
      description: "Fetches metadata, review state, and diff for a pull request."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
        - "implementation-engineer"
    - name: "list_pull_requests"
      description: "Lists pull requests in a repository filtered by state or branch."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "list_commits"
      description: "Lists commits on a branch or PR in the remote repository."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "search_code"
      description: "Searches code across repositories accessible to the token."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "architect"
        - "implementation-engineer"
    - name: "search_issues"
      description: "Searches issues and pull requests by keyword or state."
      permissionClass: "read_only"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
  resources: []
  prompts: []
security:
  authenticationType: "bearer_token"
  permissionClasses:
    - "read_only"
  readOnlyAlternative: "Use local git status, log, diff, and show commands via workspace CLI."
  credentialEnvVars:
    - "GITHUB_PERSONAL_ACCESS_TOKEN"
platformConfig: {}
---

# GitHub Integration Specification

## Purpose and overview

The GitHub MCP integration connects Frontier Engineer to remote GitHub repositories using GitHub's official Model Context Protocol server (`github/github-mcp-server`). It enables agents to inspect issue reports, review pull requests, inspect commit history, and search remote code without leaving the engineering workflow. This integration is strictly an optional extension; local repository files and `git` CLI operations remain primary.

## Provider and maintenance

- **Provider:** GitHub (Official)
- **Upstream Repository:** `https://github.com/github/github-mcp-server`
- **Container Registry:** `ghcr.io/github/github-mcp-server`
- **Maintainer:** GitHub
- **License:** MIT
- **Documentation:** [https://github.com/github/github-mcp-server](https://github.com/github/github-mcp-server)
- **Verification Date:** 2026-11-11
- **Status Note:** Replaces the deprecated reference server `@modelcontextprotocol/server-github`.

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Native binary / Container runtime (Docker or pre-built binary `github-mcp-server`)
- **Execution Command (Docker):** `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server:v2.1.0 --read-only --toolsets=context,issues,pull_requests,repos`
- **Execution Command (Binary):** `github-mcp-server --read-only=true --toolsets=context,issues,pull_requests,repos`
- **Environment Variables:**
  - `GITHUB_PERSONAL_ACCESS_TOKEN`: Scoped GitHub Personal Access Token (PAT).
  - `GITHUB_READ_ONLY`: Optional boolean flag enforcing server-side read-only mode (default: `true`).
  - `GITHUB_TOOLSETS`: Comma-separated list of active toolsets (default: `context,issues,pull_requests,repos`).

## Capabilities and tool definitions

In Frontier Engineer's hardened configuration, GitHub integration operates strictly in **Read-only** mode via `--read-only=true`. All write, mutate, and administrative operations are disabled at the server boundary:

1. **Read-only tools:** `get_file_contents`, `get_issue`, `list_issues`, `get_pull_request`, `list_pull_requests`, `list_commits`, `search_code`, `search_issues`.
2. **Disabled write tools:** Repository writes, issue modifications, pull request creation, and branch deletions are permanently disabled via `--read-only=true`. Writes must be performed through verified local git commands.

See [`capabilities.md`](capabilities.md) for detailed tool schemas and invocation guidelines.

## Security and permission boundaries

Enforcement operates across five defensive layers:

1. **Server-Level Enforcement (Layer A):** `--read-only=true` disables mutation tools inside the server process itself.
2. **Host-Level Configuration (Layer B):** Antigravity `mcp_config.json` filters tool definitions via `disabledTools` or `enabledTools`.
3. **Provider/Infrastructure Permissions (Layer C):** Personal access tokens must be fine-grained and scoped strictly to `Contents: Read`, `Issues: Read`, `Pull requests: Read`.
4. **Behavioral Governance (Layer D):** Frontier Engineer rules prohibit committing or writing through external APIs when local git worktrees exist.
5. **Human Approval (Layer E):** Any external state alteration requires explicit developer confirmation.

See [`security.md`](security.md) for full threat modeling and permission policies.

## Operational behavior and failure handling

- **Offline Default:** If `GITHUB_PERSONAL_ACCESS_TOKEN` is unset or Docker/binary is unavailable, the integration remains dormant. Agents continue working using local git CLI.
- **Rate Limiting:** In case of GitHub API rate limiting (HTTP 403 / 429), the server reports rate limit timestamps and agents fall back to local git history.
- **Network Errors:** Network disconnections trigger graceful degradation without interrupting local file operations.

## Cross-platform portability

- **Antigravity:** Configured via `mcp_config.json` with stdio transport. Inherits host shell environment variables.
- **Claude Code:** Registered via `.mcp.json` using identical stdio invocation.
- **Cursor / Codex:** Registered via standard MCP client configuration.
