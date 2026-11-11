/**
 * Command and tool call classification engine for PreToolUse safety gating.
 * Evaluates proposed tool executions against Frontier Engineer security boundaries.
 * Implements explicit conceptual semantic classes:
 *  - trusted_read_only: Explicitly reviewed operation with known read-only semantics.
 *  - workspace_read: Read-only operation restricted to permitted workspace paths.
 *  - workspace_write: Reversible or ordinary project-file modification.
 *  - external_side_effect: Network, deployment, messaging, payment, or external action.
 *  - destructive: Irreversible or potentially destructive operation.
 *  - unknown: Unrecognized or unverified operation.
 */

import { normalizeToolCall } from "./event-context.ts";

export type ToolDecision = "allow" | "deny" | "force_ask" | "ask";

export type ToolSemanticClass =
  | "trusted_read_only"
  | "workspace_read"
  | "workspace_write"
  | "external_side_effect"
  | "destructive"
  | "unknown";

export interface ClassificationResult {
  decision: ToolDecision;
  semanticClass: ToolSemanticClass;
  reason?: string;
  category?:
    | "safe"
    | "destructive_filesystem"
    | "secret_exposure"
    | "dangerous_permissions"
    | "database_mutation"
    | "high_risk_git"
    | "external_side_effect"
    | "ambiguous";
}

export interface TrustedMcpToolRegistration {
  serverName: string;
  toolName: string;
  expectedClass: ToolSemanticClass;
}

/** Authoritative registry binding trusted MCP tools to their expected MCP server. */
export const TRUSTED_MCP_TOOLS: TrustedMcpToolRegistration[] = [
  {
    serverName: "database",
    toolName: "postgres_mcp_query",
    expectedClass: "trusted_read_only",
  },
  {
    serverName: "science_biomolecular_structure_viewer_mcp",
    toolName: "get_state",
    expectedClass: "trusted_read_only",
  },
];

/** Explicitly reviewed native host tools with verified read-only semantics. */
export const TRUSTED_READ_ONLY_TOOLS = new Set<string>([
  "get_state",
  "list_resources",
  "read_resource",
  "list_plugin_accounts",
  "search_marketplace",
  "search_web",
]);

/** Patterns that immediately deny tool execution due to destructive filesystem impact. */
const PROHIBITED_DESTRUCTIVE_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  // Formatting drives or partitions
  {
    pattern: /\b(?:format\s+[a-zA-Z]:|mkfs(?:\.[a-z0-9]+)?\b|diskpart\b)/i,
    reason: "Drive formatting and partition manipulation are strictly prohibited.",
  },
  // Recursive deletion of root or drive roots
  {
    pattern: /\brm\s+-(?:r|rf|fr|r\s+-f)\s+(?:\/|\/\*|~|\.\.|\*)/i,
    reason: "Recursive deletion of filesystem root, home, or wildcards is strictly prohibited.",
  },
  // Windows recursive deletion of root or core system folders
  {
    pattern:
      /\b(?:rmdir|rd)\s+(?:\/s\s+\/q|\/q\s+\/s)\s+(?:[a-zA-Z]:\\|\/|\\|\.\.|\bC:\\Windows\b|\bC:\\Projects\b)/i,
    reason: "Recursive removal of root or parent directory trees is prohibited.",
  },
  // PowerShell Remove-Item recursive root deletion
  {
    pattern: /\bRemove-Item\b.*-(?:Recurse|r)\b.*-(?:Force|f)\b.*(?:[a-zA-Z]:\\|\/|\\|\.\.)/i,
    reason: "PowerShell recursive root deletion is prohibited.",
  },
  // Deletion of essential VCS metadata
  {
    pattern: /\b(?:rm|del|rmdir|rd|Remove-Item)\b.*(?:\.git\b|\.git[\/\\])/i,
    reason: "Direct deletion of git repository metadata (.git) is prohibited.",
  },
  // Deleting critical project descriptors
  {
    pattern: /\b(?:rm|del|Remove-Item)\s+.*(?:package\.json|plugin\.json|tsconfig\.json)\b/i,
    reason: "Direct deletion of critical repository configuration manifests is prohibited.",
  },
];

/** Patterns indicating sensitive secret file access or transmission. */
const SENSITIVE_FILE_NAMES = [
  /\.env(?:\.[a-z0-9]+)?$/i,
  /\bid_rsa(?:\.pub)?$/i,
  /\bid_ed25519(?:\.pub)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\bcredentials\.json$/i,
  /\/etc\/(?:shadow|passwd)$/i,
];

/** Shell commands attempting to read or dump sensitive credentials. */
const PROHIBITED_SECRET_PRINT_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:cat|type|Get-Content|gc|head|tail|more|less)\s+.*(?:\.env|\.git-credentials|id_rsa|id_ed25519|credentials\.json)\b/i,
    reason: "Directly printing or outputting secret credential files is prohibited.",
  },
  // Exfiltration via curl/wget with secret file payload
  {
    pattern:
      /\b(?:curl|wget|Invoke-RestMethod|Invoke-WebRequest)\b.*(?:--data|-d|--post-file)\s*[@'"]?.*(?:\.env|id_rsa|id_ed25519|credentials\.json)\b/i,
    reason: "Transmitting sensitive credential files to external endpoints is prohibited.",
  },
];

/** Destructive SQL mutations that violate read-only database policy. */
const PROHIBITED_DATABASE_MUTATIONS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:DROP\s+DATABASE|DROP\s+SCHEMA|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?|DELETE\s+FROM|ALTER\s+TABLE\s+.*\bDROP\s+COLUMN)\b/i,
    reason:
      "Destructive database mutations (DROP, TRUNCATE, DELETE) violate read-only database policy.",
  },
];

/** Commands that require human developer review (escalate to 'force_ask'). */
const HIGH_RISK_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  // Git operations with untracked/uncommitted data loss
  {
    pattern: /\bgit\s+clean\s+-(?:[a-z]*f[a-z]*d|[a-z]*d[a-z]*f|fdx|f)/i,
    reason: "Destructive git clean operations require developer review.",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Hard git reset discards uncommitted work and requires developer confirmation.",
  },
  // Dangerous privilege escalation or permission broadening
  {
    pattern: /\b(?:chmod\s+(?:-R\s+)?(?:777|666)|icacls\s+.*\/grant\s+.*Everyone:F)\b/i,
    reason:
      "Broadening filesystem permissions (777 / Everyone:Full) requires developer confirmation.",
  },
  {
    pattern: /\b(?:sudo\b|takeown\b|Set-MpPreference\b)/i,
    reason: "Administrative privilege escalation requires developer confirmation.",
  },
];

/** Patterns in tool names or operations indicating destructive operations regardless of prefix. */
const DESTRUCTIVE_TOOL_NAME_PATTERN =
  /(?:^|[_-])(?:delete|drop|truncate|format|rmdir|remove|purge|wipe|destroy|kill|execute|eval|exec)(?:[_-]|$)/i;

/** Patterns in tool names indicating external side effects (network, messaging, payment). */
const EXTERNAL_SIDE_EFFECT_PATTERN =
  /(?:^|[_-])(?:publish|deploy|broadcast|notify|upload|push|send|post|payment|charge|transfer)(?:[_-]|$)/i;

/** Classifies a shell command string. */
export function classifyCommandLine(commandLine: string): ClassificationResult {
  if (!commandLine || typeof commandLine !== "string") {
    return { decision: "allow", semanticClass: "workspace_read", category: "safe" };
  }

  const trimmed = commandLine.trim();

  // 1. Check prohibited destructive filesystem operations
  for (const { pattern, reason } of PROHIBITED_DESTRUCTIVE_COMMANDS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${reason}`,
        category: "destructive_filesystem",
      };
    }
  }

  // 2. Check secret exposure and exfiltration
  for (const { pattern, reason } of PROHIBITED_SECRET_PRINT_COMMANDS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${reason}`,
        category: "secret_exposure",
      };
    }
  }

  // 3. Check destructive database mutations
  for (const { pattern, reason } of PROHIBITED_DATABASE_MUTATIONS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${reason}`,
        category: "database_mutation",
      };
    }
  }

  // 4. Check high risk operations requiring fresh confirmation ('force_ask')
  for (const { pattern, reason } of HIGH_RISK_COMMANDS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "force_ask",
        semanticClass: "destructive",
        reason: `Confirmation required: ${reason}`,
        category: /git/i.test(reason) ? "high_risk_git" : "dangerous_permissions",
      };
    }
  }

  return { decision: "allow", semanticClass: "workspace_read", category: "safe" };
}

/** Classifies a file access or modification path. */
export function classifyFilePath(
  targetPath: string,
  operation: "read" | "write" | "edit",
): ClassificationResult {
  if (!targetPath || typeof targetPath !== "string") {
    return {
      decision: "allow",
      semanticClass: operation === "read" ? "workspace_read" : "workspace_write",
      category: "safe",
    };
  }

  // Normalize path separators
  const normalized = targetPath.replace(/\\/g, "/");

  // Prohibit reading, writing, or editing private credential files
  for (const pattern of SENSITIVE_FILE_NAMES) {
    if (pattern.test(normalized)) {
      const actionWord = operation === "read" ? "Access to" : "Modification of";
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${actionWord} sensitive credential file (${pathBasename(normalized)}) is prohibited.`,
        category: "secret_exposure",
      };
    }
  }

  // Prohibit overwriting essential repository manifests or .git files directly
  if (operation === "write" || operation === "edit") {
    if (/(?:^|\/)\.git(?:\/|$)/i.test(normalized)) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: "Blocked: Direct modification of internal .git structures is prohibited.",
        category: "destructive_filesystem",
      };
    }
  }

  return {
    decision: "allow",
    semanticClass: operation === "read" ? "workspace_read" : "workspace_write",
    category: "safe",
  };
}

function pathBasename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

/**
 * General classifier for any Antigravity tool call.
 * Uses explicit semantic capability verification rather than blind prefix-based trust.
 */
export function classifyToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ClassificationResult {
  if (!toolName || typeof toolName !== "string" || toolName.trim() === "") {
    return {
      decision: "deny",
      semanticClass: "unknown",
      reason: "Blocked: Missing tool name in toolCall payload.",
    };
  }

  const norm = normalizeToolCall(toolName, args);

  // 1. Command execution
  if (toolName === "run_command") {
    return classifyCommandLine(norm.commandLine ?? "");
  }

  // 2. Native file inspection / reading (workspace_read)
  if (toolName === "view_file" || toolName === "read_file") {
    return classifyFilePath(norm.filePath ?? "", "read");
  }

  // 3. Native file creation / writing (workspace_write)
  if (toolName === "write_to_file" || toolName === "write_file") {
    return classifyFilePath(norm.filePath ?? "", "write");
  }

  // 4. Native file modification / replacement (workspace_write)
  if (
    toolName === "replace_file_content" ||
    toolName === "multi_replace_file_content" ||
    toolName === "edit_file"
  ) {
    return classifyFilePath(norm.filePath ?? "", "edit");
  }

  // 5. Encapsulated MCP calls via call_mcp_tool
  if (toolName === "call_mcp_tool") {
    // 5a. Payload structural validation (HOOK-45)
    if (
      !norm.mcpToolName ||
      typeof norm.mcpToolName !== "string" ||
      norm.mcpToolName.trim() === ""
    ) {
      return {
        decision: "deny",
        semanticClass: "unknown",
        reason: "Blocked: Malformed MCP toolCall payload: missing or empty ToolName.",
        category: "ambiguous",
      };
    }

    if (
      args.Arguments !== undefined &&
      (typeof args.Arguments !== "object" ||
        args.Arguments === null ||
        Array.isArray(args.Arguments))
    ) {
      return {
        decision: "deny",
        semanticClass: "unknown",
        reason: "Blocked: Malformed MCP toolCall payload: Arguments must be an object if provided.",
        category: "ambiguous",
      };
    }

    if (args.ServerName !== undefined && typeof args.ServerName !== "string") {
      return {
        decision: "deny",
        semanticClass: "unknown",
        reason: "Blocked: Malformed MCP toolCall payload: ServerName must be a string if provided.",
        category: "ambiguous",
      };
    }

    const tool = norm.mcpToolName.trim();
    const server = norm.mcpServerName?.trim();
    const toolArgs = norm.mcpArguments ?? {};

    // 5b. Database inspection tool: strictly bind to 'database' server and inspect SQL arguments
    if (tool === "postgres_mcp_query" || tool === "query") {
      // If server is explicitly provided, verify it binds to the expected 'database' provider
      if (server !== undefined && server !== "database") {
        return {
          decision: "force_ask",
          semanticClass: "unknown",
          reason: `Confirmation required: Tool "${tool}" registered under unexpected MCP server "${server}" requires developer confirmation.`,
          category: "ambiguous",
        };
      }

      const sql = typeof toolArgs.query === "string" ? toolArgs.query : "";
      for (const { pattern, reason } of PROHIBITED_DATABASE_MUTATIONS) {
        if (pattern.test(sql)) {
          return {
            decision: "deny",
            semanticClass: "destructive",
            reason: `Blocked: ${reason}`,
            category: "database_mutation",
          };
        }
      }
      return { decision: "allow", semanticClass: "trusted_read_only", category: "safe" };
    }

    // 5c. Prohibited mutating database tools
    if (tool === "postgres_mcp_modify" || tool === "postgres_mcp_bulk_load_csv") {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: Prohibited mutating database tool "${tool}" is not allowed.`,
        category: "database_mutation",
      };
    }

    // 5d. Check if tool has destructive tokens (e.g. query_delete_records, read_and_execute, list_and_remove)
    if (DESTRUCTIVE_TOOL_NAME_PATTERN.test(tool)) {
      return {
        decision: "force_ask",
        semanticClass: "destructive",
        reason: `Confirmation required: Destructive operation detected in MCP tool "${tool}".`,
        category: "ambiguous",
      };
    }

    // 5e. Check if tool has external side effects (e.g. fetch_and_publish, search_then_upload)
    if (EXTERNAL_SIDE_EFFECT_PATTERN.test(tool)) {
      return {
        decision: "force_ask",
        semanticClass: "external_side_effect",
        reason: `Confirmation required: External side effect (network/publishing/messaging) detected in MCP tool "${tool}".`,
        category: "external_side_effect",
      };
    }

    // 5f. Explicitly trusted MCP tools bound to expected server
    if (tool === "get_state") {
      if (server !== undefined && server !== "science_biomolecular_structure_viewer_mcp") {
        return {
          decision: "force_ask",
          semanticClass: "unknown",
          reason: `Confirmation required: Tool "${tool}" registered under unexpected MCP server "${server}" requires developer confirmation.`,
          category: "ambiguous",
        };
      }
      return { decision: "allow", semanticClass: "trusted_read_only", category: "safe" };
    }

    // 5g. Unvetted or unknown MCP tool
    return {
      decision: "force_ask",
      semanticClass: "unknown",
      reason: `Confirmation required: Unrecognized or unvetted MCP tool "${tool}" requires developer confirmation.`,
      category: "ambiguous",
    };
  }

  // 6. Direct MCP tools (e.g. postgres_mcp_query or mcp_database_postgres_mcp_query)
  const resolvedToolName = toolName.startsWith("mcp_")
    ? toolName.replace(/^mcp_[^_]+_/, "")
    : toolName;

  if (resolvedToolName === "postgres_mcp_query") {
    const sql = typeof args.query === "string" ? args.query : "";
    for (const { pattern, reason } of PROHIBITED_DATABASE_MUTATIONS) {
      if (pattern.test(sql)) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: ${reason}`,
          category: "database_mutation",
        };
      }
    }
    return { decision: "allow", semanticClass: "trusted_read_only", category: "safe" };
  }

  if (
    resolvedToolName === "postgres_mcp_modify" ||
    resolvedToolName === "postgres_mcp_bulk_load_csv"
  ) {
    return {
      decision: "deny",
      semanticClass: "destructive",
      reason: `Blocked: Prohibited mutating database tool "${toolName}" is not allowed.`,
      category: "database_mutation",
    };
  }

  // 7. Explicitly trusted read-only tools
  if (TRUSTED_READ_ONLY_TOOLS.has(toolName)) {
    return { decision: "allow", semanticClass: "trusted_read_only", category: "safe" };
  }

  // 8. Misleading tool names: check for destructive tokens regardless of prefix
  if (DESTRUCTIVE_TOOL_NAME_PATTERN.test(toolName)) {
    return {
      decision: "force_ask",
      semanticClass: "destructive",
      reason: `Confirmation required: Destructive action detected in tool "${toolName}".`,
      category: "ambiguous",
    };
  }

  // 9. Misleading tool names: check for external side effects regardless of prefix
  if (EXTERNAL_SIDE_EFFECT_PATTERN.test(toolName)) {
    return {
      decision: "force_ask",
      semanticClass: "external_side_effect",
      reason: `Confirmation required: External side effect (network/publishing/messaging) detected in tool "${toolName}".`,
      category: "external_side_effect",
    };
  }

  // 10. Inspect arguments if command or path present
  if (norm.commandLine) {
    const cmdResult = classifyCommandLine(norm.commandLine);
    if (cmdResult.decision !== "allow") return cmdResult;
  }
  if (norm.filePath) {
    const pathResult = classifyFilePath(norm.filePath, "write");
    if (pathResult.decision !== "allow") return pathResult;
  }

  // 11. Conservative default for unverified tools: never automatically approve
  return {
    decision: "force_ask",
    semanticClass: "unknown",
    reason: `Confirmation required: Unrecognized or unvetted tool "${toolName}" requires developer confirmation.`,
    category: "ambiguous",
  };
}
