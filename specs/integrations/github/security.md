# GitHub Integration Security Policy

## Threat Model

The GitHub MCP integration bridges local agent execution with remote GitHub repositories. Primary threat vectors include:

1. **Token Exfiltration:** Compromise of `GITHUB_PERSONAL_ACCESS_TOKEN` leading to unauthorized remote repository access.
2. **Unauthorized Remote Modifications:** Agent autonomously modifying repository state, closing valid issues, merging untested pull requests, or deleting branches.
3. **Prompt Injection via Remote Content:** Malicious markdown content embedded within issue bodies, PR comments, or pull request diffs attempting to hijack agent instructions.
4. **Data Leakage in Public Comments:** Accidental inclusion of local file paths, secrets, API keys, or proprietary internal data in external payloads.

## Defense-in-Depth Enforcement Boundaries

Frontier Engineer rejects reliance on prompt instructions alone to protect repository state. Defense is enforced across five distinct layers:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Human-in-the-Loop Approval                             │
│ Any request attempting external actions requires approval       │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Behavioral Rules (Frontier Engineer Rules System)      │
│ AGENTS.md, general-engineering.md, secrets-management.md        │
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Provider / Token Scopes                                │
│ Fine-grained PAT strictly restricted to Read-only scopes        │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ mcp_config.json disabledTools list and process isolation        │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: MCP Server-Side Enforcement                            │
│ github-mcp-server --read-only=true hard-blocks all write tools  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer A: Server-Side Read-Only Flag

The official `github-mcp-server` supports `--read-only=true` (and `GITHUB_READ_ONLY=true`). When active, the server binary rejects all registration of mutating tools (`create_issue`, `close_issue`, `merge_pull_request`, `delete_branch`, etc.). Even if an agent constructs a mutation payload, the tool does not exist on the MCP endpoint.

### Layer B: Host Configuration

In Antigravity's `mcp_config.json`, servers are kept dormant (`"disabled": true`) until explicitly enabled by the developer.

### Layer C: Provider-Level Token Scoping

Developers must provision fine-grained Personal Access Tokens with the narrowest scope:

- Repository access: Specific target repositories only (never "All repositories").
- Permissions:
  - `Contents`: Read-only
  - `Issues`: Read-only
  - `Pull requests`: Read-only
  - `Metadata`: Read-only

### Layer D: Behavioral Governance

Frontier Engineer foundation rules strictly forbid bypassing local git version control to push unverified changes through remote APIs.

### Layer E: Human Approval Gates

In the event that read-only mode is temporarily relaxed for specific administrative tasks, all write, merge, close, or delete operations require human-in-the-loop authorization with explicit confirmation.

## Audit Logging

Every GitHub tool invocation is logged in the agent transcript with:

- Timestamp (ISO 8601 UTC)
- Operation name and target repository (`owner/repo`)
- Operation classification (`read_only`)
- Response status code and error details if failed
