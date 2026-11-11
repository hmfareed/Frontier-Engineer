---
id: "github"
name: "GitHub Integration"
description: "Provides secure access to GitHub remote repository operations, issue tracking, pull request inspection, and CI workflow status."
category: "repository"
version: "1.0.0"
lifecycle: "available"
provider:
  name: "Model Context Protocol Official"
  documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github"
  repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  maintainer: "Anthropic / MCP Working Group"
  license: "MIT"
  verificationDate: "2026-11-10"
runtime:
  transport: "stdio"
  runtime: "node"
  executable: "npx"
  args:
    - "-y"
    - "@modelcontextprotocol/server-github"
  envVars:
    - name: "GITHUB_PERSONAL_ACCESS_TOKEN"
      required: true
      description: "GitHub personal access token with scoped repository read/write permissions."
      secret: true
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
    - name: "create_issue"
      description: "Opens a new issue in the target repository."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "qa-engineer"
    - name: "add_issue_comment"
      description: "Adds a comment to an existing issue or pull request."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
        - "qa-engineer"
    - name: "create_pull_request"
      description: "Creates a new pull request from a branch."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "update_pull_request_branch"
      description: "Updates a pull request branch with changes from base."
      permissionClass: "reversible_write"
      agentAffinity:
        - "frontier-engineer"
        - "implementation-engineer"
    - name: "close_issue"
      description: "Closes an existing issue in the remote repository."
      permissionClass: "external_side_effect"
      agentAffinity:
        - "frontier-engineer"
    - name: "merge_pull_request"
      description: "Merges a pull request into the base branch."
      permissionClass: "external_side_effect"
      agentAffinity:
        - "frontier-engineer"
    - name: "delete_branch"
      description: "Deletes a remote branch from the repository."
      permissionClass: "destructive"
      agentAffinity:
        - "frontier-engineer"
  resources: []
  prompts: []
security:
  authenticationType: "bearer_token"
  permissionClasses:
    - "read_only"
    - "reversible_write"
    - "external_side_effect"
    - "destructive"
  readOnlyAlternative: "Use local git status, log, diff, and show commands via workspace CLI."
  credentialEnvVars:
    - "GITHUB_PERSONAL_ACCESS_TOKEN"
platformConfig: {}
---

# GitHub Integration Specification

## Purpose and overview

The GitHub MCP integration connects Frontier Engineer to remote GitHub repositories. It enables agents to inspect issue reports, read pull request reviews, check CI workflow runs, and post progress updates without leaving the development workflow. This integration is strictly an extension; local repository files and `git` CLI operations remain primary.

## Provider and maintenance

- **Provider:** Model Context Protocol Official Reference Servers
- **Upstream Package:** `@modelcontextprotocol/server-github`
- **Maintainer:** Anthropic / MCP Working Group
- **License:** MIT
- **Documentation:** [https://github.com/modelcontextprotocol/servers/tree/main/src/github](https://github.com/modelcontextprotocol/servers/tree/main/src/github)
- **Verification Date:** 2026-11-10

## Runtime requirements and transport

- **Transport:** Standard input/output (`stdio`)
- **Runtime:** Node.js (v18.0.0 or higher)
- **Executable:** `npx`
- **Execution Command:** `npx -y @modelcontextprotocol/server-github`
- **Environment Variables:**
  - `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub Personal Access Token (classic or fine-grained) with scoped repository access.

## Capabilities and tool definitions

The integration exposes tools categorized across four permission classes:

1. **Read-only tools:** `get_file_contents`, `get_issue`, `list_issues`, `get_pull_request`, `list_pull_requests`, `list_commits`.
2. **Reversible write tools:** `create_issue`, `add_issue_comment`, `create_pull_request`, `update_pull_request_branch`.
3. **External side effect tools:** `close_issue`, `merge_pull_request`.
4. **Destructive tools:** `delete_branch`.

See [`capabilities.md`](capabilities.md) for detailed tool schemas, parameters, and invocation guidelines.

## Security and permission boundaries

- **Token Scoping:** Fine-grained personal access tokens must be restricted to specific target repositories with minimal required permissions (`Issues: Read and write`, `Pull requests: Read and write`, `Contents: Read`).
- **Human Approval Requirements:** Merging pull requests, closing external issues, and deleting remote branches require explicit human confirmation.
- **Redaction:** Secrets, tokens, and sensitive workspace paths are sanitized before being sent in issue or PR comments.

See [`security.md`](security.md) for threat modeling and security policies.

## Operational behavior and failure handling

- **Offline Default:** If `GITHUB_PERSONAL_ACCESS_TOKEN` is unset or invalid, the integration remains inactive. Agents continue working using local git CLI.
- **Rate Limiting:** In case of GitHub API rate limiting (HTTP 403 / 429), the integration logs the retry-after timestamp and falls back to local git history.
- **Network Errors:** Network disconnections trigger graceful retries with exponential backoff before reporting degraded connectivity.

## Cross-platform portability

The canonical specification defines platform-independent behavior. Supported adapters:

- **Antigravity:** Configured via `mcp_config.json` with stdio command. Environment variables inherit from host.
- **Claude Code:** Configured via `.mcp.json` using identical stdio invocation.
- **Cursor / Codex:** Registered via standard MCP client configuration.
