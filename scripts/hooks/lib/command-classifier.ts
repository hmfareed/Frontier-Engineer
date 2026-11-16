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

import path from "node:path";
import { normalizeToolCall } from "./event-context.ts";
import {
  hasNtfsStreamSyntax,
  resolveWorkspaceContainment,
  stripTrailingDotsAndSpacesFromPath,
} from "./workspace-validator.ts";

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

/** Exported interface for tool call classification context. */
export interface ClassifyToolCallOptions {
  workspaceRoot?: string;
}

/** Patterns in tool names or operations indicating destructive operations regardless of prefix. */
const DESTRUCTIVE_TOOL_NAME_PATTERN =
  /(?:^|[_-])(?:delete|drop|truncate|format|rmdir|remove|purge|wipe|destroy|kill|execute|eval|exec)(?:[_-]|$)/i;

/** Patterns in tool names indicating external side effects (network, messaging, payment). */
const EXTERNAL_SIDE_EFFECT_PATTERN =
  /(?:^|[_-])(?:publish|deploy|broadcast|notify|upload|push|send|post|payment|charge|transfer)(?:[_-]|$)/i;

/**
 * Control-plane directories and manifests protected unconditionally from direct agent writes/edits (`deny`).
 * Includes host/agent control directories (`.gemini/`, `.claude/`, `.agent/`, `.frontier/`), git/CI/hook
 * infrastructure (`.git/`, `.github/workflows/`, `.husky/`, `scripts/hooks/`, `specs/hooks/`), and
 * the repository validation gate (`scripts/validate.ts`), because self-modifying these weakens trust boundaries.
 * Reads remain permitted (`allow`).
 */
export const PROTECTED_CONTROL_PLANE_DIRECTORIES = [
  ".git",
  ".frontier",
  ".github/workflows",
  ".husky",
  "scripts/hooks",
  "specs/hooks",
  ".gemini",
  ".claude",
  ".agent",
] as const;

export const PROTECTED_CONTROL_PLANE_MANIFESTS = [
  "hooks.json",
  "mcp_config.json",
  "plugin.json",
] as const;

export const PROTECTED_CONTROL_PLANE_FILES = ["scripts/validate.ts"] as const;

/**
 * Dependency, script, and compiler manifests requiring fresh developer confirmation (`force_ask`) on write/edit.
 * Unconditional denial would block legitimate dependency/build maintenance, while silent edits could inject
 * lifecycle scripts or weaken compiler/lockfile integrity without approval. Reads and `rm` rules stay unchanged.
 */
export const CONFIRMATION_REQUIRED_PROJECT_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
] as const;

const MAX_SHELL_WRAPPER_DEPTH = 8;

const SHELL_INTERPRETER_BINS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ash",
  "ksh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "iex",
  "invoke-expression",
]);

const ENV_VALUE_FLAGS = new Set(["-u", "--unset", "-C", "--chdir", "-a", "--argv0"]);
const ENV_INLINE_VALUE_FLAG_PREFIXES = ["--unset=", "--chdir=", "--argv0="];
const SUDO_VALUE_FLAGS = new Set([
  "-u",
  "-g",
  "-h",
  "-p",
  "-r",
  "-t",
  "-C",
  "-D",
  "-R",
  "-T",
  "-U",
]);

/** Executables eligible for destructive-filesystem command pattern checks. */
const DESTRUCTIVE_FS_BINS = new Set([
  "format",
  "mkfs",
  "diskpart",
  "rm",
  "rmdir",
  "rd",
  "remove-item",
  "del",
  "erase",
]);

/** Executables eligible for secret-printing / exfiltration command pattern checks. */
const SECRET_EXFIL_BINS = new Set([
  "cat",
  "type",
  "get-content",
  "gc",
  "head",
  "tail",
  "more",
  "less",
  "curl",
  "wget",
  "invoke-restmethod",
  "invoke-webrequest",
]);

/** Executables (and synthetic SQL-leading tokens) eligible for destructive database mutation checks. */
const DB_CLIENT_BINS = new Set([
  "psql",
  "mysql",
  "sqlite3",
  "sqlcmd",
  "mongosh",
  "duckdb",
  "cockroach",
  "clickhouse-client",
  "drop",
  "truncate",
  "delete",
  "alter",
]);

/** Executables eligible for high-risk `force_ask` command pattern checks. */
const HIGH_RISK_BINS = new Set([
  "git",
  "chmod",
  "icacls",
  "sudo",
  "doas",
  "takeown",
  "set-mppreference",
]);

interface ShellSegment {
  tokens: string[];
  pipedFromPrevious: boolean;
}

interface ParsedShellCommand {
  segments: ShellSegment[];
  hasUnclosedQuote: boolean;
}

interface ResolvedCommandSegment {
  tokens: string[];
  pipedFromPrevious: boolean;
  extraPayloads: string[];
  ambiguousReason?: string;
}

/**
 * Quote-aware shell command segmenter supporting chained (`&&`, `||`, `;`, `|`, `&`, newlines).
 * Tracks unclosed quotes so callers can fail conservatively on malformed shell syntax.
 * Note: This is a conservative pre-execution heuristic tokenizer, NOT a full POSIX Bash or PowerShell AST parser
 * (unsupported constructs include arbitrary shell functions/aliases, heredocs, and dynamic variable expansion).
 */
function splitShellSegmentsWithSeparators(commandLine: string): ParsedShellCommand {
  const segments: ShellSegment[] = [];
  let currentTokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: "'" | '"' | null = null;
  let previousSeparator: string | null = null;

  const pushToken = () => {
    if (hasToken || current.length > 0) {
      currentTokens.push(current);
      current = "";
      hasToken = false;
    }
  };

  const pushSegment = (nextSeparator: string | null) => {
    pushToken();
    if (currentTokens.length > 0) {
      segments.push({
        tokens: currentTokens,
        pipedFromPrevious: previousSeparator === "|",
      });
      currentTokens = [];
    }
    previousSeparator = nextSeparator;
  };

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    const next = commandLine[i + 1];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && (next === '"' || next === "\\")) {
        // Only unescape \" or \\ inside double quotes so Windows paths keep their separators
        current += next;
        i++;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }

    if (ch === "&" && next === "&") {
      pushSegment("&&");
      i++;
      continue;
    }
    if (ch === "|" && next === "|") {
      pushSegment("||");
      i++;
      continue;
    }
    if (ch === "&" || ch === ";" || ch === "|" || ch === "\n" || ch === "\r") {
      pushSegment(ch);
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }

    current += ch;
    hasToken = true;
  }

  pushSegment(null);
  return { segments, hasUnclosedQuote: quote !== null };
}

function unescapePosixBackslashes(commandLine: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    const next = commandLine[i + 1];
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        out += ch;
        continue;
      }
      if (ch === "\\" && (next === '"' || next === "\\" || next === "$" || next === "`")) {
        out += next;
        i++;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "\\" && next !== undefined) {
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function resolveEnvInvocation(tokens: string[]): {
  effectiveTokens: string[];
  extraPayloads: string[];
  ambiguousReason?: string;
} {
  let idx = 1;
  let splitPayload: string | null = null;
  let trailingArgs: string[] = [];

  while (idx < tokens.length) {
    const cur = tokens[idx];
    if (cur === "--") {
      idx++;
      return { effectiveTokens: tokens.slice(idx), extraPayloads: [] };
    }
    if (cur === "-S" || cur === "--split-string" || /^-[a-zA-Z]*S$/.test(cur)) {
      if (idx + 1 >= tokens.length) {
        return {
          effectiveTokens: [],
          extraPayloads: [],
          ambiguousReason:
            "Confirmation required: Incomplete 'env -S' invocation requires developer confirmation.",
        };
      }
      splitPayload = tokens[idx + 1];
      trailingArgs = tokens.slice(idx + 2);
      break;
    }
    if (cur.startsWith("--split-string=")) {
      splitPayload = cur.slice("--split-string=".length);
      trailingArgs = tokens.slice(idx + 1);
      break;
    }
    if (cur.startsWith("-S") && cur.length > 2) {
      splitPayload = cur.slice(2);
      trailingArgs = tokens.slice(idx + 1);
      break;
    }
    if (ENV_VALUE_FLAGS.has(cur)) {
      idx += 2;
      continue;
    }
    if (
      ENV_INLINE_VALUE_FLAG_PREFIXES.some((prefix) => cur.startsWith(prefix)) ||
      /^-[uCa].+/.test(cur)
    ) {
      idx++;
      continue;
    }
    if (cur.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(cur)) {
      idx++;
      continue;
    }
    return { effectiveTokens: tokens.slice(idx), extraPayloads: [] };
  }

  if (splitPayload === null) {
    return { effectiveTokens: [], extraPayloads: [] };
  }

  if (splitPayload.trim().length === 0) {
    return {
      effectiveTokens: trailingArgs,
      extraPayloads: [],
      ambiguousReason:
        "Confirmation required: Empty 'env -S' payload requires developer confirmation.",
    };
  }

  const parsed = splitShellSegmentsWithSeparators(splitPayload);
  const firstTokens = parsed.segments[0]?.tokens ?? [];
  if (parsed.hasUnclosedQuote) {
    return {
      effectiveTokens: [...firstTokens, ...trailingArgs],
      extraPayloads: [splitPayload],
      ambiguousReason:
        "Confirmation required: Unclosed shell quote in 'env -S' payload requires developer confirmation.",
    };
  }

  if (parsed.segments.length === 0) {
    return { effectiveTokens: trailingArgs, extraPayloads: [] };
  }

  if (parsed.segments.length > 1) {
    return {
      effectiveTokens: [...firstTokens, ...trailingArgs],
      extraPayloads: [splitPayload],
    };
  }

  return {
    effectiveTokens: [...firstTokens, ...trailingArgs],
    extraPayloads: [],
  };
}

/**
 * Unwraps shell grouping tokens, environment variable assignments, and benign command wrappers
 * (`command`, `nohup`, `env` including `-S` / `--split-string`) into the underlying command argv.
 */
function resolveCommandSegment(
  rawTokens: string[],
  pipedFromPrevious: boolean,
): ResolvedCommandSegment {
  let tokens = [...rawTokens];
  let idx = 0;
  let end = tokens.length;
  const extraPayloads: string[] = [];
  let ambiguousReason: string | undefined;
  let unwrapIterations = 0;

  while (idx < end) {
    if (++unwrapIterations > 16) {
      ambiguousReason ??=
        "Confirmation required: Command wrapper nesting exceeds inspection limit and requires developer confirmation.";
      break;
    }

    const tok = tokens[idx];
    if (tok === "&" || tok === "{" || tok === "(" || tok === "command" || tok === "nohup") {
      idx++;
      continue;
    }
    if (tok.startsWith("(") || tok.startsWith("{")) {
      tokens[idx] = tok.slice(1);
      if (tokens[idx] === "") idx++;
      continue;
    }
    if (normalizeExecutableName(tok) === "env") {
      const envRes = resolveEnvInvocation(tokens.slice(idx, end));
      if (envRes.extraPayloads.length > 0) {
        extraPayloads.push(...envRes.extraPayloads);
      }
      if (envRes.ambiguousReason && !ambiguousReason) {
        ambiguousReason = envRes.ambiguousReason;
      }
      tokens = envRes.effectiveTokens;
      idx = 0;
      end = tokens.length;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx++;
      continue;
    }
    break;
  }

  while (end > idx) {
    const tail = tokens[end - 1];
    if (tail === "}" || tail === ")" || tail === ";") {
      end--;
      continue;
    }
    if (tail.endsWith("}") || tail.endsWith(")")) {
      tokens[end - 1] = tail.slice(0, -1);
      if (tokens[end - 1] === "") {
        end--;
        continue;
      }
    }
    break;
  }

  return {
    tokens: tokens.slice(idx, end).filter((t) => t.length > 0),
    pipedFromPrevious,
    extraPayloads,
    ambiguousReason,
  };
}

function normalizeExecutableName(token: string): string {
  return path.win32
    .basename(token)
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, "");
}

const GIT_VALUE_GLOBAL_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);

function extractGitSubcommand(tokens: string[]): { subcommand: string; subArgs: string[] } | null {
  if (tokens.length < 2 || normalizeExecutableName(tokens[0]) !== "git") {
    return null;
  }

  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "--") {
      i++;
      break;
    }
    if (GIT_VALUE_GLOBAL_FLAGS.has(tok)) {
      i += 2;
      continue;
    }
    if (tok.startsWith("-")) {
      i++;
      continue;
    }
    return {
      subcommand: tok.toLowerCase(),
      subArgs: tokens.slice(i + 1),
    };
  }

  return null;
}

const GIT_PUSH_VALUE_FLAGS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

function classifyGitSegment(tokens: string[]): ClassificationResult | null {
  const git = extractGitSubcommand(tokens);
  if (!git) return null;

  const { subcommand, subArgs } = git;

  if (subcommand === "push") {
    const positionalArgs: string[] = [];
    let afterDoubleDash = false;
    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i];
      if (!afterDoubleDash && arg === "--") {
        afterDoubleDash = true;
        continue;
      }
      if (!afterDoubleDash) {
        if (arg === "--force" || arg === "--force-if-includes") {
          return {
            decision: "force_ask",
            semanticClass: "external_side_effect",
            reason:
              "Confirmation required: Force-pushing (`git push --force`) can overwrite remote history and requires developer confirmation.",
            category: "high_risk_git",
          };
        }
        if (arg === "--force-with-lease" || arg.startsWith("--force-with-lease=")) {
          return {
            decision: "force_ask",
            semanticClass: "external_side_effect",
            reason:
              "Confirmation required: Force-pushing with lease (`git push --force-with-lease`) rewrites remote branch history and requires developer confirmation.",
            category: "high_risk_git",
          };
        }
        if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) {
          return {
            decision: "force_ask",
            semanticClass: "external_side_effect",
            reason:
              "Confirmation required: Force-pushing (`git push -f`) can overwrite remote history and requires developer confirmation.",
            category: "high_risk_git",
          };
        }
        if (GIT_PUSH_VALUE_FLAGS.has(arg)) {
          i++;
          continue;
        }
        if (arg.startsWith("-")) {
          continue;
        }
      }
      positionalArgs.push(arg);
    }

    // Check refspec force-push syntax (`+main`, `+HEAD:main`, `+src:dst`, `origin +main`)
    const hasPlusRefspec = positionalArgs.some((pos) => pos.startsWith("+") && pos.length > 1);
    if (hasPlusRefspec) {
      return {
        decision: "force_ask",
        semanticClass: "external_side_effect",
        reason:
          "Confirmation required: Force refspec push (`+ref`) can overwrite remote history and requires developer confirmation.",
        category: "high_risk_git",
      };
    }
  }

  if (subcommand === "branch") {
    let hasForce = false;
    let hasDelete = false;
    for (const arg of subArgs) {
      if (arg === "--") break;
      if (arg === "-D" || /^-[a-zA-Z]*D[a-zA-Z]*$/.test(arg)) {
        return {
          decision: "force_ask",
          semanticClass: "destructive",
          reason:
            "Confirmation required: Force-deleting a git branch (`git branch -D`) can discard unmerged commits and requires developer confirmation.",
          category: "high_risk_git",
        };
      }
      if (arg === "--force" || arg === "-f" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) {
        hasForce = true;
      }
      if (arg === "--delete" || arg === "-d" || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(arg)) {
        hasDelete = true;
      }
    }
    if (hasForce && hasDelete) {
      return {
        decision: "force_ask",
        semanticClass: "destructive",
        reason:
          "Confirmation required: Force-deleting a git branch (`git branch --delete --force`) can discard unmerged commits and requires developer confirmation.",
        category: "high_risk_git",
      };
    }
  }

  if (subcommand === "clean") {
    for (const arg of subArgs) {
      if (arg === "--") break;
      if (arg === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/i.test(arg)) {
        return {
          decision: "force_ask",
          semanticClass: "destructive",
          reason:
            "Confirmation required: Destructive git clean operations require developer review.",
          category: "high_risk_git",
        };
      }
    }
  }

  if (subcommand === "reset") {
    for (const arg of subArgs) {
      if (arg === "--") break;
      if (arg === "--hard") {
        return {
          decision: "force_ask",
          semanticClass: "destructive",
          reason:
            "Confirmation required: Hard git reset discards uncommitted work and requires developer confirmation.",
          category: "high_risk_git",
        };
      }
    }
  }

  return null;
}

const NPM_INSTALL_ALIASES = new Set([
  "install",
  "i",
  "in",
  "ins",
  "inst",
  "insta",
  "instal",
  "isnt",
  "isnta",
  "isntal",
  "add",
]);

const NPM_VALUE_FLAGS = new Set([
  "-C",
  "--prefix",
  "-w",
  "--workspace",
  "--registry",
  "--cache",
  "--userconfig",
  "--globalconfig",
  "--loglevel",
  "--tag",
  "--before",
  "--fetch-retries",
  "--fetch-retry-mintimeout",
  "--fetch-retry-maxtimeout",
  "--fetch-timeout",
  "--cpu",
  "--os",
  "--libc",
  "--omit",
  "--include",
  "--install-strategy",
  "--audit-level",
  "--script-shell",
  "--noproxy",
]);

const PKG_INSTALL_VALUE_FLAGS = new Set([
  "-r",
  "--requirement",
  "-c",
  "--constraint",
  "-i",
  "--index-url",
  "--extra-index-url",
  "-t",
  "--target",
  "--prefix",
  "-C",
  "--dir",
  "--filter",
  "-F",
  "--registry",
  "--group",
  "-G",
]);

function scanPositionalArgs(
  args: string[],
  valueFlags: Set<string>,
): { positional: string[]; hasGlobalFlag: boolean } {
  const positional: string[] = [];
  let hasGlobalFlag = false;
  let afterDoubleDash = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash) {
      if (arg === "-g" || arg === "--global") {
        hasGlobalFlag = true;
        continue;
      }
      if (valueFlags.has(arg)) {
        i++;
        continue;
      }
      if (arg.startsWith("-")) {
        continue;
      }
    }
    positional.push(arg);
  }

  return { positional, hasGlobalFlag };
}

const YARN_PRE_SUB_VALUE_FLAGS = new Set([
  "--cwd",
  "--modules-folder",
  "--cache-folder",
  "--preferred-cache-folder",
  "--global-folder",
  "--registry",
  "--proxy",
  "--https-proxy",
  "--network-timeout",
  "--network-concurrency",
  "--mutex",
  "--use-yarnrc",
]);

const PIP_PRE_SUB_VALUE_FLAGS = new Set([
  "--cache-dir",
  "--python",
  "--root-user-action",
  "--proxy",
  "--cert",
  "--client-cert",
  "--trusted-host",
  "--timeout",
  "--retries",
  "--exists-action",
  "--log",
  "-C",
  "-i",
  "--index-url",
  "--extra-index-url",
]);

const UV_PRE_SUB_VALUE_FLAGS = new Set([
  "--project",
  "--directory",
  "--python",
  "--cache-dir",
  "--config-file",
  "--index-url",
  "--extra-index-url",
  "--default-index",
  "-C",
]);

const POETRY_PRE_SUB_VALUE_FLAGS = new Set(["--directory", "-C", "--project"]);
const CARGO_PRE_SUB_VALUE_FLAGS = new Set([
  "--manifest-path",
  "--target-dir",
  "--color",
  "--config",
  "-C",
  "-Z",
]);
const GO_PRE_SUB_VALUE_FLAGS = new Set(["-C"]);
const COMPOSER_PRE_SUB_VALUE_FLAGS = new Set(["-d", "--working-dir"]);
const GEM_PRE_SUB_VALUE_FLAGS = new Set(["-I", "--config-file"]);

function findSubcommandAndRest(
  tokens: string[],
  valueFlags: Set<string>,
): { subcommand: string; rest: string[] } | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--") {
      if (i + 1 < tokens.length) {
        return { subcommand: tokens[i + 1].toLowerCase(), rest: tokens.slice(i + 2) };
      }
      return null;
    }
    if (valueFlags.has(tok)) {
      i++;
      continue;
    }
    if (tok.startsWith("-")) continue;
    return { subcommand: tok.toLowerCase(), rest: tokens.slice(i + 1) };
  }
  return null;
}

function hasRequirementInstallFlag(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (
      arg === "-r" ||
      arg === "--requirement" ||
      arg.startsWith("--requirement=") ||
      (/^-r.+/.test(arg) && !arg.startsWith("--"))
    ) {
      return true;
    }
  }
  return false;
}

function classifyPackageInstallSegment(tokens: string[]): ClassificationResult | null {
  if (tokens.length === 0) return null;
  let bin = normalizeExecutableName(tokens[0]);
  let rest = tokens.slice(1);

  if (bin === "corepack" && rest.length > 0) {
    bin = normalizeExecutableName(rest[0]);
    rest = rest.slice(1);
  }

  const PYTHON_VALUE_FLAGS = new Set(["-W", "-X", "--check-hash-based-pycs"]);

  // Handle `python [-u|-B|...] -m pip|uv|poetry ...`
  if (bin === "python" || bin === "python3" || bin === "py") {
    let resolvedModule = false;
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      if (tok === "-m" && rest[i + 1]) {
        const mod = rest[i + 1].toLowerCase();
        if (mod === "pip" || mod === "pip3" || mod === "uv" || mod === "poetry") {
          bin = mod;
          rest = rest.slice(i + 2);
          resolvedModule = true;
        }
        break;
      }
      if (PYTHON_VALUE_FLAGS.has(tok)) {
        i++;
        continue;
      }
      if (tok.startsWith("-")) continue;
      break;
    }
    if (!resolvedModule) {
      return null;
    }
  }

  const pkgConfirm = (manager: string): ClassificationResult => ({
    decision: "force_ask",
    semanticClass: "external_side_effect",
    reason: `Confirmation required: Installing new package(s) via ${manager} modifies dependencies and requires developer confirmation.`,
    category: "external_side_effect",
  });

  if (bin === "npm") {
    let subIdx = -1;
    let hasGlobalBeforeSub = false;
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      if (tok === "-g" || tok === "--global") {
        hasGlobalBeforeSub = true;
        continue;
      }
      if (NPM_VALUE_FLAGS.has(tok)) {
        i++;
        continue;
      }
      if (tok.startsWith("-")) continue;
      subIdx = i;
      break;
    }
    if (subIdx === -1) return null;
    const sub = rest[subIdx].toLowerCase();
    if (!NPM_INSTALL_ALIASES.has(sub)) return null;
    const { positional, hasGlobalFlag } = scanPositionalArgs(
      rest.slice(subIdx + 1),
      NPM_VALUE_FLAGS,
    );
    if (hasGlobalBeforeSub || hasGlobalFlag || positional.length > 0) {
      return pkgConfirm("npm");
    }
    return null;
  }

  if (bin === "pnpm" || bin === "bun") {
    const found = findSubcommandAndRest(rest, PKG_INSTALL_VALUE_FLAGS);
    if (!found) return null;
    if (found.subcommand === "add" || (bin === "bun" && found.subcommand === "a")) {
      return pkgConfirm(bin);
    }
    if (found.subcommand === "install" || found.subcommand === "i") {
      const { positional, hasGlobalFlag } = scanPositionalArgs(found.rest, PKG_INSTALL_VALUE_FLAGS);
      if (hasGlobalFlag || positional.length > 0) {
        return pkgConfirm(bin);
      }
    }
    return null;
  }

  if (bin === "yarn") {
    const found = findSubcommandAndRest(rest, YARN_PRE_SUB_VALUE_FLAGS);
    if (!found) return null;
    if (found.subcommand === "add") return pkgConfirm("yarn");
    if (found.subcommand === "global") {
      const afterGlobal = findSubcommandAndRest(found.rest, YARN_PRE_SUB_VALUE_FLAGS);
      if (afterGlobal?.subcommand === "add") {
        return pkgConfirm("yarn");
      }
    }
    return null;
  }

  if (bin === "pip" || bin === "pip3") {
    const found = findSubcommandAndRest(rest, PIP_PRE_SUB_VALUE_FLAGS);
    if (!found || found.subcommand !== "install") return null;
    if (hasRequirementInstallFlag(found.rest)) {
      return pkgConfirm(bin);
    }
    const { positional } = scanPositionalArgs(found.rest, PKG_INSTALL_VALUE_FLAGS);
    if (positional.length > 0) {
      return pkgConfirm(bin);
    }
    return null;
  }

  if (bin === "uv") {
    const found = findSubcommandAndRest(rest, UV_PRE_SUB_VALUE_FLAGS);
    if (!found) return null;
    if (found.subcommand === "add") {
      return pkgConfirm("uv");
    }
    if (found.subcommand === "pip") {
      const pipSub = findSubcommandAndRest(found.rest, UV_PRE_SUB_VALUE_FLAGS);
      if (pipSub?.subcommand === "install") {
        if (hasRequirementInstallFlag(pipSub.rest)) {
          return pkgConfirm("uv pip");
        }
        const { positional } = scanPositionalArgs(pipSub.rest, PKG_INSTALL_VALUE_FLAGS);
        if (positional.length > 0) return pkgConfirm("uv pip");
      }
    }
    return null;
  }

  if (bin === "poetry") {
    const found = findSubcommandAndRest(rest, POETRY_PRE_SUB_VALUE_FLAGS);
    if (found?.subcommand === "add") {
      return pkgConfirm("poetry");
    }
    return null;
  }

  if (bin === "cargo") {
    const cargoRest = rest.filter((tok, idx) => !(idx === 0 && tok.startsWith("+")));
    const found = findSubcommandAndRest(cargoRest, CARGO_PRE_SUB_VALUE_FLAGS);
    if (found && (found.subcommand === "add" || found.subcommand === "install")) {
      return pkgConfirm("cargo");
    }
    return null;
  }

  if (bin === "go") {
    const found = findSubcommandAndRest(rest, GO_PRE_SUB_VALUE_FLAGS);
    if (found && (found.subcommand === "get" || found.subcommand === "install")) {
      return pkgConfirm("go");
    }
    return null;
  }

  if (bin === "composer") {
    const found = findSubcommandAndRest(rest, COMPOSER_PRE_SUB_VALUE_FLAGS);
    if (found?.subcommand === "require") {
      return pkgConfirm("composer");
    }
    return null;
  }

  if (bin === "gem") {
    const found = findSubcommandAndRest(rest, GEM_PRE_SUB_VALUE_FLAGS);
    if (found?.subcommand === "install") {
      return pkgConfirm("gem");
    }
    return null;
  }

  if (bin === "dotnet") {
    const lowered = rest.map((t) => t.toLowerCase());
    if (lowered.includes("add") && lowered.includes("package")) {
      return pkgConfirm("dotnet");
    }
    return null;
  }

  return null;
}

interface ShellWrapperExtraction {
  payload?: string;
  escalateReason?: string;
}

const PS_VALUE_FLAGS = new Set([
  "-executionpolicy",
  "-ep",
  "-inputformat",
  "-if",
  "-outputformat",
  "-of",
  "-settingsfile",
  "-configurationname",
  "-workingdirectory",
  "-wd",
  "-windowstyle",
  "-w",
  "-file",
  "-f",
]);

function extractShellWrapperPayload(tokens: string[]): ShellWrapperExtraction | null {
  if (tokens.length < 2) return null;
  const bin = normalizeExecutableName(tokens[0]);

  if (bin === "eval" && tokens.length >= 2) {
    return { payload: tokens.slice(1).join(" ") };
  }

  if (bin === "powershell" || bin === "pwsh") {
    const encIdx = tokens.findIndex((t) =>
      /^-(?:ec|enc|enco|encod|encoded|encodedcommand)$/i.test(t),
    );
    if (encIdx !== -1) {
      const rawB64 = tokens[encIdx + 1];
      if (rawB64 && /^[A-Za-z0-9+/=]+$/.test(rawB64)) {
        try {
          const decoded = Buffer.from(rawB64, "base64")
            .toString("utf16le")
            .replace(/\0/g, "")
            .trim();
          if (decoded.length > 0) {
            return { payload: decoded };
          }
        } catch {
          // Fall through to conservative escalation
        }
      }
      return {
        escalateReason:
          "Confirmation required: Obfuscated or encoded PowerShell command requires developer confirmation.",
      };
    }

    const idx = tokens.findIndex((t) => /^-(?:c|cmd|command)$/i.test(t));
    if (idx !== -1 && tokens[idx + 1]) {
      return { payload: tokens.slice(idx + 1).join(" ") };
    }

    // PowerShell also executes implicit positional script strings when -File is absent
    let hasFileFlag = false;
    for (let i = 1; i < tokens.length; i++) {
      const lowered = tokens[i].toLowerCase();
      if (lowered === "-file" || lowered === "-f") {
        hasFileFlag = true;
        break;
      }
      if (PS_VALUE_FLAGS.has(lowered)) {
        i++;
        continue;
      }
      if (lowered.startsWith("-")) continue;
      if (!hasFileFlag) {
        return { payload: tokens.slice(i).join(" ") };
      }
    }
    return null;
  }

  if (tokens.length < 3) return null;

  if (bin === "bash" || bin === "sh" || bin === "zsh") {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === "-o" && i + 1 < tokens.length) {
        i++;
        continue;
      }
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(tok)) {
        if (tokens[i + 1]) {
          return { payload: tokens[i + 1] };
        }
      }
    }
  } else if (bin === "cmd") {
    const idx = tokens.findIndex((t) => /^\/[ck]$/i.test(t));
    if (idx !== -1 && tokens[idx + 1]) {
      return { payload: tokens.slice(idx + 1).join(" ") };
    }
  }
  return null;
}

function extractCommandSubstitutions(commandLine: string): {
  substitutions: string[];
  unparsedReason?: string;
} {
  const substitutions: string[] = [];
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    const next = commandLine[i + 1];

    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }

    if (ch === "\\") {
      i++;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if ((ch === "$" || ch === "<" || ch === ">") && next === "(") {
      let depth = 1;
      let innerQuote: "'" | '"' | null = null;
      let j = i + 2;
      while (j < commandLine.length && depth > 0) {
        const ic = commandLine[j];
        if (innerQuote === "'") {
          if (ic === "'") innerQuote = null;
        } else if (ic === "\\") {
          j += 2;
          continue;
        } else if (innerQuote === '"') {
          if (ic === '"') innerQuote = null;
        } else if (ic === "'" || ic === '"') {
          innerQuote = ic;
        } else if (ic === "(") {
          depth++;
        } else if (ic === ")") {
          depth--;
        }
        j++;
      }

      if (depth !== 0) {
        return {
          substitutions,
          unparsedReason:
            "Confirmation required: Unbalanced command substitution syntax requires developer confirmation.",
        };
      }
      const inner = commandLine.slice(i + 2, j - 1).trim();
      if (inner.length > 0) {
        substitutions.push(inner);
      }
      i = j - 1;
      continue;
    }

    if (ch === "`") {
      let j = i + 1;
      let closed = false;
      while (j < commandLine.length) {
        if (commandLine[j] === "\\") {
          j += 2;
          continue;
        }
        if (commandLine[j] === "`") {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        return {
          substitutions,
          unparsedReason:
            "Confirmation required: Unclosed backtick command substitution requires developer confirmation.",
        };
      }
      const inner = commandLine.slice(i + 1, j).trim();
      if (inner.length > 0) {
        substitutions.push(inner);
      }
      i = j;
    }
  }

  return { substitutions };
}

function unwrapPrivilegeCommandTokens(seg: string[]): string[] | null {
  const bin = normalizeExecutableName(seg[0]);
  if (bin !== "sudo" && bin !== "doas") {
    return null;
  }

  let idx = 1;
  while (idx < seg.length) {
    const cur = seg[idx];
    if (cur === "--") {
      idx++;
      break;
    }
    if (SUDO_VALUE_FLAGS.has(cur)) {
      idx += 2;
      continue;
    }
    if (cur.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(cur)) {
      idx++;
      continue;
    }
    break;
  }

  return seg.slice(idx);
}

/**
 * Evaluates normalized argv tokens against prohibited (`deny`) and high-risk (`force_ask`) command rules.
 * Matching against normalized executable names prevents quote-concatenation bypasses (`'r'm`, `"c"at`)
 * without triggering false positives on inert string arguments (e.g., `echo 'rm -rf /'`).
 */
function evaluateSegmentPatterns(seg: string[], guardDepth = 0): ClassificationResult | null {
  if (seg.length === 0) return null;
  const bin = normalizeExecutableName(seg[0]);
  const normalizedSegStr = [bin, ...seg.slice(1)].join(" ");

  if (DESTRUCTIVE_FS_BINS.has(bin) || bin.startsWith("mkfs.")) {
    for (const { pattern, reason } of PROHIBITED_DESTRUCTIVE_COMMANDS) {
      if (pattern.test(normalizedSegStr)) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: ${reason}`,
          category: "destructive_filesystem",
        };
      }
    }
  }

  if (SECRET_EXFIL_BINS.has(bin)) {
    for (const { pattern, reason } of PROHIBITED_SECRET_PRINT_COMMANDS) {
      if (pattern.test(normalizedSegStr)) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: ${reason}`,
          category: "secret_exposure",
        };
      }
    }
  }

  if (DB_CLIENT_BINS.has(bin)) {
    for (const { pattern, reason } of PROHIBITED_DATABASE_MUTATIONS) {
      if (pattern.test(normalizedSegStr)) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: ${reason}`,
          category: "database_mutation",
        };
      }
    }
  }

  if (guardDepth < 4) {
    const innerPriv = unwrapPrivilegeCommandTokens(seg);
    if (innerPriv && innerPriv.length > 0) {
      const resolvedInner = resolveCommandSegment(innerPriv, false);
      const innerHit = evaluateSegmentPatterns(resolvedInner.tokens, guardDepth + 1);
      if (innerHit?.decision === "deny") {
        return innerHit;
      }
    }
  }

  if (HIGH_RISK_BINS.has(bin)) {
    for (const { pattern, reason } of HIGH_RISK_COMMANDS) {
      if (pattern.test(normalizedSegStr)) {
        return {
          decision: "force_ask",
          semanticClass: "destructive",
          reason: `Confirmation required: ${reason}`,
          category: /git/i.test(reason) ? "high_risk_git" : "dangerous_permissions",
        };
      }
    }
  }

  return null;
}

function classifyCommandLineRaw(commandLine: string, depth: number): ClassificationResult {
  if (!commandLine || typeof commandLine !== "string" || commandLine.trim().length === 0) {
    return {
      decision: "deny",
      semanticClass: "unknown",
      reason: "Blocked: Missing or empty command line cannot be verified.",
      category: "ambiguous",
    };
  }

  const trimmed = commandLine.trim();
  let escalatedResult: ClassificationResult | null = null;

  const recordEscalation = (candidate: ClassificationResult) => {
    if (!escalatedResult && (candidate.decision === "force_ask" || candidate.decision === "ask")) {
      escalatedResult = candidate;
    }
  };

  // 1. Inspect command substitutions (`$(...)`, `<(...)`, `>(...)`, backticks)
  const subScan = extractCommandSubstitutions(trimmed);
  for (const subCmd of subScan.substitutions) {
    if (depth >= MAX_SHELL_WRAPPER_DEPTH) {
      recordEscalation({
        decision: "force_ask",
        semanticClass: "unknown",
        reason:
          "Confirmation required: Deeply nested shell command substitution exceeds static inspection depth.",
        category: "ambiguous",
      });
      break;
    }
    const subRes = classifyCommandLineInternal(subCmd, depth + 1);
    if (subRes.decision === "deny") {
      return subRes;
    }
    recordEscalation(subRes);
  }
  if (subScan.unparsedReason) {
    recordEscalation({
      decision: "force_ask",
      semanticClass: "unknown",
      reason: subScan.unparsedReason,
      category: "ambiguous",
    });
  }

  // 2. Parse into quote-normalized shell segments and resolve wrappers (`env`, `nohup`, `command`)
  const parsedShell = splitShellSegmentsWithSeparators(trimmed);
  if (parsedShell.hasUnclosedQuote) {
    recordEscalation({
      decision: "force_ask",
      semanticClass: "unknown",
      reason:
        "Confirmation required: Unclosed shell quote in command line requires developer confirmation.",
      category: "ambiguous",
    });
  }

  const resolvedSegments = parsedShell.segments
    .map((s) => resolveCommandSegment(s.tokens, s.pipedFromPrevious))
    .filter((r) => r.tokens.length > 0 || r.ambiguousReason || r.extraPayloads.length > 0);

  const inspectNestedPayload = (
    payload: string,
    exceedsMsg: string,
  ): ClassificationResult | null => {
    if (depth >= MAX_SHELL_WRAPPER_DEPTH) {
      recordEscalation({
        decision: "force_ask",
        semanticClass: "unknown",
        reason: exceedsMsg,
        category: "ambiguous",
      });
      return null;
    }
    const nested = classifyCommandLineInternal(payload, depth + 1);
    if (nested.decision === "deny") {
      return nested;
    }
    recordEscalation(nested);
    return null;
  };

  // 3. Evaluate normalized segments for prohibited patterns, wrappers, pipe-to-shell, git, and package managers
  for (let i = 0; i < resolvedSegments.length; i++) {
    const resolved = resolvedSegments[i];
    const seg = resolved.tokens;

    for (const extraPayload of resolved.extraPayloads) {
      const denied = inspectNestedPayload(
        extraPayload,
        "Confirmation required: Shell wrapper nesting exceeds inspection depth and requires developer confirmation.",
      );
      if (denied) return denied;
    }

    if (resolved.ambiguousReason) {
      recordEscalation({
        decision: "force_ask",
        semanticClass: "unknown",
        reason: resolved.ambiguousReason,
        category: "ambiguous",
      });
    }

    if (seg.length === 0) continue;

    const patternHit = evaluateSegmentPatterns(seg);
    if (patternHit) {
      if (patternHit.decision === "deny") {
        return patternHit;
      }
      recordEscalation(patternHit);
    }

    const bin = normalizeExecutableName(seg[0]);

    if (resolved.pipedFromPrevious && SHELL_INTERPRETER_BINS.has(bin)) {
      recordEscalation({
        decision: "force_ask",
        semanticClass: "external_side_effect",
        reason: `Confirmation required: Piping stdin into shell interpreter '${bin}' requires developer confirmation.`,
        category: "ambiguous",
      });
    }

    const nextSeg = resolvedSegments[i + 1];
    if (
      nextSeg?.pipedFromPrevious &&
      nextSeg.tokens.length > 0 &&
      SHELL_INTERPRETER_BINS.has(normalizeExecutableName(nextSeg.tokens[0])) &&
      (bin === "echo" || bin === "printf") &&
      seg.length > 1
    ) {
      const denied = inspectNestedPayload(
        seg.slice(1).join(" "),
        "Confirmation required: Pipe-to-shell inspection exceeds maximum nesting depth.",
      );
      if (denied) return denied;

      if (bin === "printf" && seg[1].includes("%") && seg.length > 2) {
        const deniedArgs = inspectNestedPayload(
          seg.slice(2).join(" "),
          "Confirmation required: Pipe-to-shell inspection exceeds maximum nesting depth.",
        );
        if (deniedArgs) return deniedArgs;
      }
    }

    const wrapper = extractShellWrapperPayload(seg);
    if (wrapper) {
      if (wrapper.escalateReason) {
        recordEscalation({
          decision: "force_ask",
          semanticClass: "unknown",
          reason: wrapper.escalateReason,
          category: "ambiguous",
        });
      } else if (wrapper.payload) {
        const denied = inspectNestedPayload(
          wrapper.payload,
          "Confirmation required: Shell wrapper nesting exceeds inspection depth and requires developer confirmation.",
        );
        if (denied) return denied;
      }
    }

    const gitHit = classifyGitSegment(seg);
    if (gitHit) {
      recordEscalation(gitHit);
    } else {
      const pkgHit = classifyPackageInstallSegment(seg);
      if (pkgHit) {
        recordEscalation(pkgHit);
      }
    }
  }

  if (escalatedResult) {
    return escalatedResult;
  }

  return { decision: "allow", semanticClass: "workspace_read", category: "safe" };
}

function classifyCommandLineInternal(commandLine: string, depth: number): ClassificationResult {
  const rawResult = classifyCommandLineRaw(commandLine, depth);
  if (rawResult.decision === "deny" || depth >= MAX_SHELL_WRAPPER_DEPTH) {
    return rawResult;
  }

  const trimmed = typeof commandLine === "string" ? commandLine.trim() : "";
  if (trimmed.length === 0) {
    return rawResult;
  }

  // Check POSIX backslash-unescaped view strictly for additive escalation (`g\it`, `r\m`)
  const posixUnescaped = unescapePosixBackslashes(trimmed);
  if (posixUnescaped !== trimmed && posixUnescaped.trim().length > 0) {
    const unescapedResult = classifyCommandLineRaw(posixUnescaped.trim(), depth);
    if (unescapedResult.decision === "deny") {
      return unescapedResult;
    }
    if (rawResult.decision === "allow" && unescapedResult.decision !== "allow") {
      return unescapedResult;
    }
  }

  return rawResult;
}

/** Classifies a shell command string. */
export function classifyCommandLine(commandLine: string): ClassificationResult {
  return classifyCommandLineInternal(commandLine, 0);
}

function matchControlPlaneTarget(
  candidateRel: string,
  _hasCanonicalWorkspaceRelative: boolean,
): string | null {
  const lower = candidateRel.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!lower) return null;

  for (const dir of PROTECTED_CONTROL_PLANE_DIRECTORIES) {
    if (
      lower === dir ||
      lower.startsWith(`${dir}/`) ||
      lower.includes(`/${dir}/`) ||
      lower.endsWith(`/${dir}`)
    ) {
      return `${dir}/`;
    }
  }

  for (const manifest of PROTECTED_CONTROL_PLANE_MANIFESTS) {
    if (lower === manifest || lower.endsWith(`/${manifest}`)) {
      return manifest;
    }
  }

  for (const file of PROTECTED_CONTROL_PLANE_FILES) {
    if (lower === file || lower.endsWith(`/${file}`)) {
      return file;
    }
  }

  return null;
}

function matchConfirmationRequiredProjectFile(candidateRel: string): string | null {
  const lower = candidateRel.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!lower) return null;

  for (const file of CONFIRMATION_REQUIRED_PROJECT_FILES) {
    if (lower === file || lower.endsWith(`/${file}`)) {
      return file;
    }
  }
  return null;
}

/** Classifies a file access or modification path against containment, secret, and control-plane policies. */
export function classifyFilePath(
  targetPath: string,
  operation: "read" | "write" | "edit",
  workspaceRoot?: string,
): ClassificationResult {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return {
      decision: "deny",
      semanticClass: "destructive",
      reason: "Blocked: Missing or empty file path; canonical containment cannot be established.",
      category: "destructive_filesystem",
    };
  }

  let canonicalRel: string | undefined;

  if (workspaceRoot !== undefined) {
    const containment = resolveWorkspaceContainment(targetPath, workspaceRoot);
    if (!containment.allowed || containment.relativePath === undefined) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${containment.reason ?? `Path '${targetPath}' resolves outside approved workspace boundaries.`}`,
        category: "destructive_filesystem",
      };
    }
    canonicalRel = containment.relativePath;
  } else {
    // Static boundary checks when no explicit workspaceRoot is provided
    const fwd = targetPath.replace(/\\/g, "/");
    if (
      targetPath.includes("\0") ||
      fwd.startsWith("//") ||
      /^[a-zA-Z]:(?![/\\])/.test(targetPath) ||
      hasNtfsStreamSyntax(targetPath)
    ) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: Path '${targetPath}' is unsafe or outside local workspace boundaries.`,
        category: "destructive_filesystem",
      };
    }
    if (!path.isAbsolute(targetPath) && !/^[a-zA-Z]:[/\\]/.test(targetPath)) {
      const normalizedRel = path.posix.normalize(fwd);
      if (normalizedRel === ".." || normalizedRel.startsWith("../")) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: Relative path '${targetPath}' traverses outside workspace boundaries.`,
          category: "destructive_filesystem",
        };
      }
    }
  }

  // Normalize path separators and Windows trailing dot/space aliases for pattern matching
  const normalized = targetPath.replace(/\\/g, "/");
  const normalizedAlias = stripTrailingDotsAndSpacesFromPath(normalized);
  const canonicalAlias =
    canonicalRel !== undefined ? stripTrailingDotsAndSpacesFromPath(canonicalRel) : undefined;

  const candidatesToCheck = Array.from(
    new Set(
      [normalized, normalizedAlias, canonicalRel, canonicalAlias].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      ),
    ),
  );

  // Prohibit reading, writing, or editing private credential files
  for (const candidate of candidatesToCheck) {
    for (const pattern of SENSITIVE_FILE_NAMES) {
      if (pattern.test(candidate)) {
        const actionWord = operation === "read" ? "Access to" : "Modification of";
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: ${actionWord} sensitive credential file (${pathBasename(candidate)}) is prohibited.`,
          category: "secret_exposure",
        };
      }
    }
  }

  // Prohibit direct write/edit mutations to security-critical control-plane files and state directories
  if (operation === "write" || operation === "edit") {
    const matchInputs =
      canonicalRel !== undefined ? [canonicalRel, canonicalAlias!] : [normalized, normalizedAlias];
    for (const input of matchInputs) {
      const protectedTarget = matchControlPlaneTarget(input, canonicalRel !== undefined);
      if (protectedTarget) {
        return {
          decision: "deny",
          semanticClass: "destructive",
          reason: `Blocked: Direct ${operation} targeting protected control-plane resource '${protectedTarget}' is prohibited.`,
          category: "destructive_filesystem",
        };
      }
    }

    for (const input of matchInputs) {
      const gatedProjectFile = matchConfirmationRequiredProjectFile(input);
      if (gatedProjectFile) {
        return {
          decision: "force_ask",
          semanticClass: "workspace_write",
          reason: `Confirmation required: Direct ${operation} targeting project configuration/lockfile '${gatedProjectFile}' requires developer confirmation.`,
          category: "dangerous_permissions",
        };
      }
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
  options?: ClassifyToolCallOptions | string,
): ClassificationResult {
  if (!toolName || typeof toolName !== "string" || toolName.trim() === "") {
    return {
      decision: "deny",
      semanticClass: "unknown",
      reason: "Blocked: Missing tool name in toolCall payload.",
    };
  }

  const workspaceRoot = typeof options === "string" ? options : options?.workspaceRoot;
  const norm = normalizeToolCall(toolName, args);

  // Helper to evaluate every candidate command / path cleanly with deny dominance
  const evaluateCommands = (cmds: string[]): ClassificationResult | undefined => {
    let escalated: ClassificationResult | undefined;
    for (const cmd of cmds) {
      const res = classifyCommandLine(cmd);
      if (res.decision === "deny") return res;
      if ((res.decision === "force_ask" || res.decision === "ask") && !escalated) {
        escalated = res;
      }
    }
    return escalated ?? (cmds.length > 0 ? classifyCommandLine(cmds[0]) : undefined);
  };

  const evaluatePaths = (
    paths: string[],
    op: "read" | "write" | "edit",
  ): ClassificationResult | undefined => {
    let escalated: ClassificationResult | undefined;
    for (const p of paths) {
      const res = classifyFilePath(p, op, workspaceRoot);
      if (res.decision === "deny") return res;
      if ((res.decision === "force_ask" || res.decision === "ask") && !escalated) {
        escalated = res;
      }
    }
    if (escalated) return escalated;
    return paths.length > 0
      ? {
          decision: "allow",
          semanticClass: op === "read" ? "workspace_read" : "workspace_write",
          category: "safe",
        }
      : undefined;
  };

  // 1. Command execution
  if (toolName === "run_command") {
    const cmdEval = evaluateCommands(norm.commandLines);
    if (cmdEval?.decision === "deny") return cmdEval;
    if (
      norm.malformedCommandReason ||
      norm.hasConflictingCommands ||
      norm.commandLines.length === 0
    ) {
      return {
        decision: "deny",
        semanticClass: "unknown",
        reason: `Blocked: ${norm.malformedCommandReason ?? (norm.hasConflictingCommands ? "Conflicting command arguments detected in run_command." : "Missing command line in run_command.")}`,
        category: "ambiguous",
      };
    }
    if (cmdEval && cmdEval.decision !== "allow") return cmdEval;
    // Also inspect any file paths attached unexpectedly alongside a safe command
    const pathEval = evaluatePaths(norm.filePaths, "write");
    if (pathEval && pathEval.decision !== "allow") return pathEval;
    return cmdEval!;
  }

  // 2. Native file inspection / reading (workspace_read)
  if (toolName === "view_file" || toolName === "read_file") {
    const pathEval = evaluatePaths(norm.filePaths, "read");
    if (pathEval?.decision === "deny") return pathEval;
    if (norm.malformedFileReason || norm.hasConflictingFilePaths || norm.filePaths.length === 0) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${norm.malformedFileReason ?? (norm.hasConflictingFilePaths ? `Conflicting file path arguments in '${toolName}'.` : `Missing file path in '${toolName}'.`)}`,
        category: "destructive_filesystem",
      };
    }
    return pathEval!;
  }

  // 3. Native file creation / writing (workspace_write)
  if (toolName === "write_to_file" || toolName === "write_file") {
    const pathEval = evaluatePaths(norm.filePaths, "write");
    if (pathEval?.decision === "deny") return pathEval;
    if (norm.malformedFileReason || norm.hasConflictingFilePaths || norm.filePaths.length === 0) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${norm.malformedFileReason ?? (norm.hasConflictingFilePaths ? `Conflicting file path arguments in '${toolName}'.` : `Missing file path in '${toolName}'.`)}`,
        category: "destructive_filesystem",
      };
    }
    return pathEval!;
  }

  // 4. Native file modification / replacement (workspace_write)
  if (
    toolName === "replace_file_content" ||
    toolName === "multi_replace_file_content" ||
    toolName === "edit_file"
  ) {
    const pathEval = evaluatePaths(norm.filePaths, "edit");
    if (pathEval?.decision === "deny") return pathEval;
    if (norm.malformedFileReason || norm.hasConflictingFilePaths || norm.filePaths.length === 0) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: ${norm.malformedFileReason ?? (norm.hasConflictingFilePaths ? `Conflicting file path arguments in '${toolName}'.` : `Missing file path in '${toolName}'.`)}`,
        category: "destructive_filesystem",
      };
    }
    return pathEval!;
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

  // 7. Reject malformed tool argument containers even on trusted read-only tools
  if (norm.malformedCommandReason || norm.malformedFileReason) {
    return {
      decision: "deny",
      semanticClass: "unknown",
      reason: `Blocked: ${norm.malformedCommandReason ?? norm.malformedFileReason}`,
      category: "ambiguous",
    };
  }

  // Explicitly trusted read-only tools
  if (TRUSTED_READ_ONLY_TOOLS.has(toolName)) {
    return { decision: "allow", semanticClass: "trusted_read_only", category: "safe" };
  }

  // 8. Inspect arguments first for hard denials (do not downgrade to force_ask)
  let cmdResult: ClassificationResult | undefined;
  for (const cmd of norm.commandLines) {
    const res = classifyCommandLine(cmd);
    if (res.decision === "deny") return res;
    if (!cmdResult || res.decision !== "allow") cmdResult = res;
  }

  let pathResult: ClassificationResult | undefined;
  for (const p of norm.filePaths) {
    const res = classifyFilePath(p, "write", workspaceRoot);
    if (res.decision === "deny") return res;
    if (!pathResult || res.decision !== "allow") pathResult = res;
  }

  if (
    norm.malformedCommandReason ||
    norm.malformedFileReason ||
    norm.hasConflictingCommands ||
    norm.hasConflictingFilePaths
  ) {
    return {
      decision: "deny",
      semanticClass: "unknown",
      reason: `Blocked: ${norm.malformedCommandReason ?? norm.malformedFileReason ?? "Conflicting tool arguments detected."}`,
      category: "ambiguous",
    };
  }

  // 9. Misleading tool names: check for destructive tokens regardless of prefix
  if (DESTRUCTIVE_TOOL_NAME_PATTERN.test(toolName)) {
    return {
      decision: "force_ask",
      semanticClass: "destructive",
      reason: `Confirmation required: Destructive action detected in tool "${toolName}".`,
      category: "ambiguous",
    };
  }

  // 10. Misleading tool names: check for external side effects regardless of prefix
  if (EXTERNAL_SIDE_EFFECT_PATTERN.test(toolName)) {
    return {
      decision: "force_ask",
      semanticClass: "external_side_effect",
      reason: `Confirmation required: External side effect (network/publishing/messaging) detected in tool "${toolName}".`,
      category: "external_side_effect",
    };
  }

  if (cmdResult && cmdResult.decision !== "allow") return cmdResult;
  if (pathResult && pathResult.decision !== "allow") return pathResult;

  // 11. Conservative default for unverified tools: never automatically approve
  return {
    decision: "force_ask",
    semanticClass: "unknown",
    reason: `Confirmation required: Unrecognized or unvetted tool "${toolName}" requires developer confirmation.`,
    category: "ambiguous",
  };
}
