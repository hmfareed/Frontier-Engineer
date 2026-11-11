# Part 26 — MCP operations and failure handling

## Operational lifecycle

External integrations depend on network connectivity, remote third-party APIs, authentication tokens, and local process runtimes. In Frontier Engineer, MCP servers follow a structured operational lifecycle:

```text
[UNINITIALIZED]
       │
       ▼
[STARTUP CHECK] ──── (Missing executable / config) ────► [DISABLED / LOGICAL BYPASS]
       │
       ▼
[AUTHENTICATION CHECK] ─ (Missing / invalid token) ───► [GRACEFUL DEGRADATION]
       │
       ▼
[CONNECTION ESTABLISHED]
       │
       ├──── (Tool execution timeout / fault) ────────► [STRUCTURED ERROR REPORT]
       │
       ▼
[CLEAN SHUTDOWN]
```

---

## The twelve standard failure modes

Frontier Engineer defines twelve standardized failure modes and exact handling contracts:

| #      | Failure Mode                     | Cause                                                   | System Handling Contract                                                                              |
| :----- | :------------------------------- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- |
| **1**  | **Missing Server Configuration** | Server not declared in `mcp_config.json`                | Agent bypasses external integration; uses local tools (git, local files).                             |
| **2**  | **Missing Executable Binary**    | `npx`, `node`, or package missing                       | Logs operational warning; advises user on prerequisite installation (`npm i -g ...`). Does not crash. |
| **3**  | **Missing Credentials**          | Required env var (`GITHUB_PERSONAL_ACCESS_TOKEN`) empty | Agent reports missing credential without printing variable contents; offers manual alternative.       |
| **4**  | **Invalid Environment Values**   | Malformed URL or non-numeric port                       | Fail-fast validation error; integration disabled.                                                     |
| **5**  | **Unsupported Transport**        | Server configured with legacy SSE                       | Rejects transport; recommends Stdio bridge (`mcp-remote`).                                            |
| **6**  | **Server Startup Failure**       | Child process exit on launch                            | Captures stderr; classifies as _Server Startup Failure_; disables integration for turn.               |
| **7**  | **Connection Timeout**           | Network hang or unresponsive process                    | Enforces 15-second timeout; cancels turn request; falls back to local analysis.                       |
| **8**  | **Process Crash During Call**    | SIGSEGV or out-of-memory in server                      | Emits structured error; marks server status `unhealthy`; continues session.                           |
| **9**  | **Tool Invocation Failure**      | Remote API returned 4xx/5xx                             | Maps response to standardized error contract; does not fabricate success.                             |
| **10** | **Permission Denial**            | Scopes insufficient (e.g. 403 Forbidden)                | Informs user of missing permission scope; does not retry in tight loop.                               |
| **11** | **Malformed Tool Response**      | JSON-RPC response violates schema                       | Discards payload; flags schema violation; prevents unvalidated state change.                          |
| **12** | **Third-Party Provider Outage**  | GitHub/Sentry/Cloud service down                        | Informs user of external provider status; completes task using offline files.                         |

---

## The graceful degradation invariant

> [!IMPORTANT]
> **Core System Invariant:** Frontier Engineer must remain fully capable of performing software engineering tasks even when every external MCP integration is disabled, unconfigured, or failing.

- If **GitHub MCP** is unavailable: Agents use local `git status`, `git log`, and `git diff` via standard terminal tools.
- If **Context7 MCP** is unavailable: Agents inspect local `node_modules`, package manifests, TypeScript definitions, and local documentation.
- If **Playwright MCP** is unavailable: Agents inspect rendered markup, component unit tests, and style definitions statically.
- If **Sentry MCP** is unavailable: Agents inspect local application logs, error traces, and test output.
- If **Database MCP** is unavailable: Agents inspect local migration scripts, SQL schema definitions, and ORM models.

Under no circumstances may an agent fabricate a tool call or claim an external integration succeeded when it failed.

---

## Health checks and troubleshooting

### Diagnosing server issues in Antigravity

1. **Check CLI Discovery:**

   ```bash
   agy plugin validate --strict .
   ```

   Confirms that `mcp_config.json` matches the official Antigravity schema and that server names are valid.

2. **Inspect Process Logs:**
   Antigravity logs child process stdout and stderr in the session log directory (`~/.gemini/antigravity/logs/`).

3. **Verify Environment Variables:**
   Ensure tokens are present in your shell before launching Antigravity:

   ```bash
   echo $GITHUB_PERSONAL_ACCESS_TOKEN
   ```

4. **Test Server Startup Manually:**
   Execute the server command directly in terminal to verify Node/NPX execution:

   ```bash
   npx -y @modelcontextprotocol/server-github
   ```
