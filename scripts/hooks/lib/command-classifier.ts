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
import { resolveWorkspaceContainment } from "./workspace-validator.ts";

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

/** Control-plane directories and manifest files protected from direct agent writes/edits. */
export const PROTECTED_CONTROL_PLANE_DIRECTORIES = [
  ".git",
  ".frontier",
  ".github/workflows",
  ".husky",
  "scripts/hooks",
  "specs/hooks",
] as const;

export const PROTECTED_CONTROL_PLANE_MANIFESTS = [
  "hooks.json",
  "mcp_config.json",
  "plugin.json",
] as const;

function splitShellSegments(commandLine: string): string[][] {
  const segments: string[][] = [];
  let currentTokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: "'" | '"' | null = null;

  const pushToken = () => {
    if (hasToken || current.length > 0) {
      currentTokens.push(current);
      current = "";
      hasToken = false;
    }
  };

  const pushSegment = () => {
    pushToken();
    if (currentTokens.length > 0) {
      segments.push(currentTokens);
      currentTokens = [];
    }
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
      pushSegment();
      i++;
      continue;
    }
    if (ch === "|" && next === "|") {
      pushSegment();
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n" || ch === "\r") {
      pushSegment();
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }

    current += ch;
    hasToken = true;
  }

  pushSegment();
  return segments;
}

function unwrapCommandSegment(rawTokens: string[]): string[] {
  let idx = 0;
  while (idx < rawTokens.length) {
    const tok = rawTokens[idx];
    if (tok === "&" || tok === "command" || tok === "nohup") {
      idx++;
      continue;
    }
    if (tok === "env") {
      idx++;
      while (
        idx < rawTokens.length &&
        (rawTokens[idx].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rawTokens[idx]))
      ) {
        idx++;
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx++;
      continue;
    }
    break;
  }
  return rawTokens.slice(idx);
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

    // Check refspec force-push syntax (`+branch` or `+HEAD:main` or `+src:dst`)
    const hasPlusRefspec = positionalArgs.some((pos, index) => {
      if (!pos.startsWith("+") || pos.length <= 1) return false;
      return index >= 1 || pos.includes(":");
    });
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

function classifyPackageInstallSegment(tokens: string[]): ClassificationResult | null {
  if (tokens.length === 0) return null;
  let bin = normalizeExecutableName(tokens[0]);
  let rest = tokens.slice(1);

  if (bin === "corepack" && rest.length > 0) {
    bin = normalizeExecutableName(rest[0]);
    rest = rest.slice(1);
  }

  // Handle `python -m pip install <pkg>` / `python3 -m pip install <pkg>` / `py -m pip install <pkg>`
  if ((bin === "python" || bin === "python3" || bin === "py") && rest[0] === "-m" && rest[1]) {
    const mod = rest[1].toLowerCase();
    if (mod === "pip" || mod === "pip3" || mod === "uv" || mod === "poetry") {
      bin = mod;
      rest = rest.slice(2);
    } else {
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
    let subIdx = -1;
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      if (PKG_INSTALL_VALUE_FLAGS.has(tok)) {
        i++;
        continue;
      }
      if (tok.startsWith("-")) continue;
      subIdx = i;
      break;
    }
    if (subIdx === -1) return null;
    const sub = rest[subIdx].toLowerCase();
    const afterSub = rest.slice(subIdx + 1);
    if (sub === "add" || (bin === "bun" && sub === "a")) {
      return pkgConfirm(bin);
    }
    if (sub === "install" || sub === "i") {
      const { positional, hasGlobalFlag } = scanPositionalArgs(afterSub, PKG_INSTALL_VALUE_FLAGS);
      if (hasGlobalFlag || positional.length > 0) {
        return pkgConfirm(bin);
      }
    }
    return null;
  }

  if (bin === "yarn") {
    const firstPos = rest.find((t) => !t.startsWith("-"))?.toLowerCase();
    if (!firstPos) return null;
    if (firstPos === "add") return pkgConfirm("yarn");
    if (firstPos === "global") {
      const afterGlobal = rest.slice(rest.findIndex((t) => t.toLowerCase() === "global") + 1);
      if (afterGlobal.some((t) => t.toLowerCase() === "add")) {
        return pkgConfirm("yarn");
      }
    }
    return null;
  }

  if (bin === "pip" || bin === "pip3") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    if (subIdx === -1) return null;
    if (rest[subIdx].toLowerCase() !== "install") return null;
    const { positional } = scanPositionalArgs(rest.slice(subIdx + 1), PKG_INSTALL_VALUE_FLAGS);
    if (positional.length > 0) {
      return pkgConfirm(bin);
    }
    return null;
  }

  if (bin === "uv") {
    const posTokens = rest.filter((t) => !t.startsWith("-"));
    if (posTokens[0]?.toLowerCase() === "add") {
      return pkgConfirm("uv");
    }
    if (posTokens[0]?.toLowerCase() === "pip" && posTokens[1]?.toLowerCase() === "install") {
      const installIdx = rest.findIndex((t) => t.toLowerCase() === "install");
      const { positional } = scanPositionalArgs(
        rest.slice(installIdx + 1),
        PKG_INSTALL_VALUE_FLAGS,
      );
      if (positional.length > 0) return pkgConfirm("uv pip");
    }
    return null;
  }

  if (bin === "poetry") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    if (subIdx !== -1 && rest[subIdx].toLowerCase() === "add") {
      return pkgConfirm("poetry");
    }
    return null;
  }

  if (bin === "cargo") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    const sub = subIdx !== -1 ? rest[subIdx].toLowerCase() : "";
    if (sub === "add" || sub === "install") {
      return pkgConfirm("cargo");
    }
    return null;
  }

  if (bin === "go") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    const sub = subIdx !== -1 ? rest[subIdx].toLowerCase() : "";
    if (sub === "get" || sub === "install") {
      return pkgConfirm("go");
    }
    return null;
  }

  if (bin === "composer") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    if (subIdx !== -1 && rest[subIdx].toLowerCase() === "require") {
      return pkgConfirm("composer");
    }
    return null;
  }

  if (bin === "gem") {
    const subIdx = rest.findIndex((t) => !t.startsWith("-"));
    if (subIdx !== -1 && rest[subIdx].toLowerCase() === "install") {
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

function extractShellWrapperPayload(tokens: string[]): string | null {
  if (tokens.length < 3) return null;
  const bin = normalizeExecutableName(tokens[0]);
  if (bin === "bash" || bin === "sh" || bin === "zsh") {
    const idx = tokens.findIndex((t) => t === "-c" || t === "-lc");
    if (idx !== -1 && tokens[idx + 1]) return tokens[idx + 1];
  } else if (bin === "powershell" || bin === "pwsh") {
    const idx = tokens.findIndex((t) => /^-(?:c|command)$/i.test(t));
    if (idx !== -1 && tokens[idx + 1]) return tokens.slice(idx + 1).join(" ");
  } else if (bin === "cmd") {
    const idx = tokens.findIndex((t) => /^\/c$/i.test(t));
    if (idx !== -1 && tokens[idx + 1]) return tokens.slice(idx + 1).join(" ");
  }
  return null;
}

function classifyCommandLineInternal(commandLine: string, depth: number): ClassificationResult {
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

  // 4. Recursively inspect quoted subshell payloads (e.g. bash -c "...", cmd /c "...") before escalating
  let escalatedResult: ClassificationResult | null = null;
  const segments = splitShellSegments(trimmed);
  for (const rawSeg of segments) {
    const seg = unwrapCommandSegment(rawSeg);
    if (seg.length === 0) continue;

    if (depth < 2) {
      const innerCmd = extractShellWrapperPayload(seg);
      if (innerCmd) {
        const nested = classifyCommandLineInternal(innerCmd, depth + 1);
        if (nested.decision === "deny") {
          return nested;
        }
        if ((nested.decision === "force_ask" || nested.decision === "ask") && !escalatedResult) {
          escalatedResult = nested;
        }
      }
    }

    if (!escalatedResult) {
      const gitHit = classifyGitSegment(seg);
      if (gitHit) {
        escalatedResult = gitHit;
      } else {
        const pkgHit = classifyPackageInstallSegment(seg);
        if (pkgHit) {
          escalatedResult = pkgHit;
        }
      }
    }
  }

  if (escalatedResult) {
    return escalatedResult;
  }

  // 5. Check pattern-based high-risk operations requiring fresh confirmation ('force_ask')
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

/** Classifies a shell command string. */
export function classifyCommandLine(commandLine: string): ClassificationResult {
  return classifyCommandLineInternal(commandLine, 0);
}

function matchControlPlaneTarget(
  candidateRel: string,
  hasCanonicalWorkspaceRelative: boolean,
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
    if (hasCanonicalWorkspaceRelative) {
      if (lower === manifest || lower.endsWith(`/${manifest}`)) {
        return manifest;
      }
    } else if (lower === manifest || lower.endsWith(`/${manifest}`)) {
      return manifest;
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
      /^[a-zA-Z]:(?![/\\])/.test(targetPath)
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

  // Normalize path separators for pattern matching
  const normalized = targetPath.replace(/\\/g, "/");
  const candidatesToCheck = canonicalRel !== undefined ? [normalized, canonicalRel] : [normalized];

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
    const matchInput = canonicalRel !== undefined ? canonicalRel : normalized;
    const protectedTarget = matchControlPlaneTarget(matchInput, canonicalRel !== undefined);
    if (protectedTarget) {
      return {
        decision: "deny",
        semanticClass: "destructive",
        reason: `Blocked: Direct ${operation} targeting protected control-plane resource '${protectedTarget}' is prohibited.`,
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

  // 1. Command execution
  if (toolName === "run_command") {
    return classifyCommandLine(norm.commandLine ?? "");
  }

  // 2. Native file inspection / reading (workspace_read)
  if (toolName === "view_file" || toolName === "read_file") {
    return classifyFilePath(norm.filePath ?? "", "read", workspaceRoot);
  }

  // 3. Native file creation / writing (workspace_write)
  if (toolName === "write_to_file" || toolName === "write_file") {
    return classifyFilePath(norm.filePath ?? "", "write", workspaceRoot);
  }

  // 4. Native file modification / replacement (workspace_write)
  if (
    toolName === "replace_file_content" ||
    toolName === "multi_replace_file_content" ||
    toolName === "edit_file"
  ) {
    return classifyFilePath(norm.filePath ?? "", "edit", workspaceRoot);
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

  // 8. Inspect arguments first for hard denials (do not downgrade to force_ask)
  const cmdResult = norm.commandLine ? classifyCommandLine(norm.commandLine) : undefined;
  if (cmdResult?.decision === "deny") return cmdResult;

  const pathResult = norm.filePath
    ? classifyFilePath(norm.filePath, "write", workspaceRoot)
    : undefined;
  if (pathResult?.decision === "deny") return pathResult;

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
