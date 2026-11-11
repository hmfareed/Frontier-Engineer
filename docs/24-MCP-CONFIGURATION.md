# Part 24 — MCP configuration guide

## Verified Antigravity configuration mechanics

Google Antigravity discovers and configures MCP servers using `mcp_config.json`. The host supports two distinct customization scopes:

```text
1. PLUGIN-LEVEL CONFIGURATION (<plugin-root>/mcp_config.json)
   Bundled with the Frontier Engineer plugin.
   Active across all sessions when the plugin is enabled.
   Default policy: All servers ship with "disabled": true to prevent
   unwanted startup crashes and preserve offline independence.

2. WORKSPACE-LEVEL CONFIGURATION (<workspace>/.agents/mcp_config.json)
   Project-specific overrides and local tool registrations.
   Ideal for project-specific databases, staging Playwright URLs, and local services.

3. GLOBAL-LEVEL CONFIGURATION (~/.gemini/config/mcp_config.json)
   Machine-wide servers active across all projects and conversations.
   Ideal for developer-wide GitHub PATs, Sentry tokens, and shared credentials.
```

## Transport mechanisms

Antigravity supports two transports:

### 1. Stdio transport (Local)

Spawns a local executable or command-line process and communicates over standard input/output (`stdin`/`stdout`).

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "disabled": false
    }
  }
}
```

- **`command`** (string, required): Executable name or path (`npx`, `node`, `python3`, `docker`).
- **`args`** (array of strings, optional): Command-line arguments.
- **`env`** (object, optional): Explicit environment variables.
- **`disabled`** (boolean, optional): Set to `true` to keep the server registered in the UI but unlaunched.

> [!IMPORTANT]
> In Antigravity, stdio server processes **automatically inherit the environment variables of the running agent process**. Therefore, sensitive tokens (such as `GITHUB_PERSONAL_ACCESS_TOKEN`) should be exported in the user's environment or `.env` file rather than hardcoded in `env`. If `${VAR}` syntax is used in `env`, it must be declared in the server's `"variables"` array.

### 2. Streamable HTTP transport (Remote)

Connects to a remote server endpoint speaking the Streamable HTTP transport.

```json
{
  "mcpServers": {
    "remote-docs": {
      "url": "https://mcp.internal.example.com/mcp"
    }
  }
}
```

- **`url`** (string, required): Endpoint URL (typically `/mcp`). The legacy key `serverUrl` is also accepted.
- Legacy HTTP+SSE (MCP spec 2024-11-05) is **not supported**. For servers speaking legacy SSE, use a stdio bridge such as `mcp-remote`.

---

## Plugin configuration vs developer template

### Bundled plugin configuration (`mcp_config.json`)

Frontier Engineer ships with an authoritative `mcp_config.json` registering the five canonical servers. Each server declares `"disabled": true` so that:

- Antigravity's CLI validator discovers all five servers (`mcpServers: 5`).
- No processes are spawned on startup without user configuration.
- The plugin remains 100% operational offline without third-party credentials.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "disabled": true
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "disabled": true
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"],
      "disabled": true
    },
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "disabled": true
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "disabled": true
    }
  }
}
```

---

## Step-by-step developer activation guide

To enable any integration for your project or machine:

### Option A: Enable via Antigravity UI

1. Open Antigravity and navigate to **Additional Options (...) > MCP Servers**.
2. Locate the Frontier Engineer server you wish to activate (e.g. `frontier-engineer:github`).
3. Toggle the server to **Enabled**.
4. If prompted, supply the required token or ensure the corresponding environment variable is exported in your shell.

### Option B: Configure in workspace (`.agents/mcp_config.json`)

Create or edit `.agents/mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    },
    "database": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://readonly_user:password@localhost:5432/mydb"
      ]
    }
  }
}
```

### Environment variables checklist

| Server       | Environment Variable           | Recommended Scope                                               |
| :----------- | :----------------------------- | :-------------------------------------------------------------- |
| `github`     | `GITHUB_PERSONAL_ACCESS_TOKEN` | Fine-grained PAT: repo content read, issues read, PR read       |
| `context7`   | `CONTEXT7_API_KEY`             | Optional; default public rate tier available                    |
| `playwright` | _None_                         | Local node/chromium binary (`npx playwright install chromium`)  |
| `sentry`     | `SENTRY_AUTH_TOKEN`            | Read-only auth token (`org:read`, `project:read`, `event:read`) |
| `database`   | `DATABASE_URL`                 | Dedicated read-only development connection string               |
