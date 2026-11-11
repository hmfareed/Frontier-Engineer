# Part 25 — MCP portability

## Cross-platform MCP ecosystem

While the Model Context Protocol defines standard JSON-RPC 2.0 messages over Stdio and Streamable HTTP, how host agent platforms register and discover servers differs significantly across tools:

| Platform                  | Configuration Location                                                                                         | Discovery Scope           | Variable Interpolation                      | Transport Support                      |
| :------------------------ | :------------------------------------------------------------------------------------------------------------- | :------------------------ | :------------------------------------------ | :------------------------------------- |
| **Google Antigravity**    | `<plugin-root>/mcp_config.json`<br>`<workspace>/.agents/mcp_config.json`<br>`~/.gemini/config/mcp_config.json` | Plugin, Workspace, Global | Environment inheritance + `variables` array | Stdio, Streamable HTTP (no legacy SSE) |
| **Anthropic Claude Code** | `~/.claude.json`<br>`.claude/mcp.json`                                                                         | User-level, Project       | `${VAR}` shell expansion                    | Stdio, SSE (legacy), Streamable HTTP   |
| **Cursor IDE**            | `~/.cursor/mcp.json`<br>Settings UI                                                                            | Global, Workspace         | Environment variable injection              | Stdio, SSE                             |
| **OpenAI Codex / CLI**    | Host CLI settings or custom wrapper                                                                            | Session / Environment     | Environment inheritance                     | Stdio                                  |
| **Windsurf IDE**          | `~/.codeium/windsurf/mcp_config.json`                                                                          | Global                    | Process environment                         | Stdio                                  |

---

## Canonical specifications as the translation baseline

To prevent vendor lock-in, Frontier Engineer authors all MCP integrations under `specs/integrations/<id>/`.

The canonical specification declares the **semantic contract**:

- What tool capability exists.
- What CLI package or binary runs it.
- What environment variables are required.
- What permission tier is assigned.
- What risk level is associated with tool calls.

From this single source of truth, platform adapters are compiled without altering the core capability definitions.

---

## Platform mapping matrix

### 1. Google Antigravity (Implemented & Verified)

- **Status:** **Implemented & Verified** (v0.5.0).
- **Format:** `mcp_config.json` with `mcpServers` object.
- **Transports:** `command` (stdio) and `url` (streamable HTTP).
- **Environment Handling:** Processes inherit host environment variables automatically. Unconfigured servers ship with `"disabled": true`.

### 2. Anthropic Claude Code (Documented Only)

- **Status:** **Documented Only** (Adapter not compiled).
- **Mapping:**

  ```json
  {
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
        }
      }
    }
  }
  ```

- **Notes:** Claude Code supports `${VAR}` string interpolation in `env`.

### 3. Cursor IDE (Documented Only)

- **Status:** **Documented Only** (Adapter not compiled).
- **Mapping:** Stdio configuration maps directly into Cursor's `~/.cursor/mcp.json` or `.cursor/mcp.json`.
- **Notes:** Requires manual UI registration or JSON editing in Cursor settings.

### 4. OpenAI Codex & Others (Documented Only)

- **Status:** **Documented Only**.
- **Mapping:** Wrapped via CLI invocation or environment configuration.

---

## Unsupported or unverified platform features

The following platform-specific features are explicitly **unsupported or unverified** in Frontier Engineer:

- **Legacy HTTP+SSE Transport:** Antigravity does not support the 2024-11-05 SSE specification. Remote servers must speak Streamable HTTP (`/mcp`).
- **Dynamic In-Session Server Installation:** Antigravity does not support npm-installing new MCP server binaries inside an active turn without host process restart or reloading.
- **Protocol-Level Permission Enforcement:** MCP JSON-RPC 2.0 does not specify capability-level permission checks (Read-only vs Destructive). Enforcement is governed at the Frontier Engineer agent policy layer.
