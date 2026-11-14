/**
 * Secret redaction utility for Frontier Engineer hooks runtime.
 * Ensures zero credential leaks in diagnostics, audit logs, and error traces.
 */

import {
  CONTEXT_SECRET_PATTERN_DEFS,
  CORE_SECRET_PATTERN_DEFS,
  redactPemPrivateKeys,
} from "../../scanner/sensitive-filter.ts";

function findPattern(type: string): RegExp {
  const def =
    CORE_SECRET_PATTERN_DEFS.find((p) => p.type === type) ??
    CONTEXT_SECRET_PATTERN_DEFS.find((p) => p.type === type);
  if (!def) {
    throw new Error(`Missing canonical secret pattern definition '${type}'.`);
  }
  return def.regex;
}

const HOOK_REDACTION_RULES: Array<{
  pattern: RegExp;
  replacement: string | ((...args: string[]) => string);
}> = [
  // GitHub Personal Access / OAuth / App / Refresh Tokens & Fine-grained PATs
  { pattern: findPattern("GITHUB_PAT"), replacement: "[REDACTED_GITHUB_TOKEN]" },
  // Preserve classic ghp_[REDACTED] marker expectation when classic ghp_ prefix is present:
  {
    pattern: findPattern("GITHUB_FINE_GRAINED_PAT"),
    replacement: "github_pat_[REDACTED]",
  },
  // OpenAI & Stripe API keys
  { pattern: findPattern("STRIPE_KEY"), replacement: "[REDACTED_API_KEY]" },
  { pattern: findPattern("OPENAI_API_KEY"), replacement: "[REDACTED_API_KEY]" },
  // Slack tokens (short & hyphenated multi-segment)
  { pattern: findPattern("SLACK_TOKEN"), replacement: "[REDACTED_SLACK_TOKEN]" },
  // AWS Access Keys
  { pattern: findPattern("AWS_ACCESS_KEY"), replacement: "[REDACTED_AWS_KEY]" },
  // Sentry auth tokens
  { pattern: findPattern("SENTRY_TOKEN"), replacement: "sntrys_[REDACTED]" },
  // Bearer & Basic Auth headers
  { pattern: findPattern("BEARER_TOKEN"), replacement: "Bearer [REDACTED]" },
  {
    pattern: findPattern("BASIC_AUTH_HEADER"),
    replacement: (_m: string, p1: string) => `${p1}[REDACTED]`,
  },
  // Database connection URIs with embedded passwords (including slashes and URL-encoded chars)
  {
    pattern: findPattern("DB_PASSWORD"),
    replacement: (_m: string, p1: string, p2: string) => `${p1}[REDACTED]${p2}`,
  },
  // Quoted key-value pairs for passwords, tokens, and secrets in JSON/flags
  {
    pattern:
      /(["']?(?:password|token|secret|apiKey|api_key|auth_token|authToken|access_token|private_key)["']?\s*[:=]\s*["'])([^"'\r\n\s]+)(["'])/gi,
    replacement: "$1[REDACTED]$3",
  },
];

/** Redacts sensitive strings according to canonical credential patterns. */
export function redactString(input: string): string {
  if (!input || typeof input !== "string") return "";
  let result = redactPemPrivateKeys(input, "[REDACTED_PRIVATE_KEY]").redactedText;
  for (const { pattern, replacement } of HOOK_REDACTION_RULES) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    if (pattern.source.includes("gh[pousr]_") && typeof replacement === "string") {
      result = result.replace(re, (m) => (m.startsWith("ghp_") ? "ghp_[REDACTED]" : replacement));
    } else if (typeof replacement === "string") {
      result = result.replace(re, replacement);
    } else {
      result = result.replace(re, replacement);
    }
  }
  return result;
}

const SENSITIVE_KEY_PATTERN = /password|secret|token|credential|api_?key|private_?key/i;

/**
 * Recursively (via explicit heap stack) redacts strings within arrays and objects.
 * Protects against self-references, nested cycles, and arbitrarily deep structures
 * while allowing repeated sibling DAG references to be redacted normally.
 */
export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;

  const rootHolder: { root?: unknown } = {};
  const activeAncestors = new WeakSet<object>();

  type Frame =
    | { kind: "enter"; source: unknown; assign: (val: unknown) => void }
    | { kind: "exit"; obj: object };

  const stack: Frame[] = [
    {
      kind: "enter",
      source: value,
      assign: (v) => {
        rootHolder.root = v;
      },
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "exit") {
      activeAncestors.delete(frame.obj);
      continue;
    }

    const curr = frame.source;
    if (curr === null || curr === undefined) {
      frame.assign(curr);
      continue;
    }
    if (typeof curr === "string") {
      frame.assign(redactString(curr));
      continue;
    }
    if (typeof curr !== "object") {
      frame.assign(curr);
      continue;
    }

    if (activeAncestors.has(curr)) {
      frame.assign("[Circular]");
      continue;
    }

    if (curr instanceof Date) {
      frame.assign(new Date(curr.getTime()));
      continue;
    }
    if (curr instanceof RegExp) {
      frame.assign(curr.toString());
      continue;
    }
    if (curr instanceof Error) {
      activeAncestors.add(curr);
      const errOut: Record<string, unknown> = {
        name: curr.name,
        message: redactString(curr.message),
      };
      frame.assign(errOut);
      stack.push({ kind: "exit", obj: curr });
      const entries = Object.entries(curr as unknown as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i];
        stack.push({
          kind: "enter",
          source: SENSITIVE_KEY_PATTERN.test(k) && typeof v === "string" ? "[REDACTED]" : v,
          assign: (redactedVal) => {
            errOut[k] = redactedVal;
          },
        });
      }
      continue;
    }

    activeAncestors.add(curr);
    stack.push({ kind: "exit", obj: curr });

    if (Array.isArray(curr)) {
      const outArr = new Array<unknown>(curr.length);
      frame.assign(outArr);
      for (let i = curr.length - 1; i >= 0; i--) {
        const idx = i;
        stack.push({
          kind: "enter",
          source: curr[idx],
          assign: (redactedItem) => {
            outArr[idx] = redactedItem;
          },
        });
      }
    } else {
      const copy: Record<string, unknown> = {};
      frame.assign(copy);
      const entries = Object.entries(curr as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, val] = entries[i];
        if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === "string") {
          copy[key] = "[REDACTED]";
        } else {
          stack.push({
            kind: "enter",
            source: val,
            assign: (redactedVal) => {
              copy[key] = redactedVal;
            },
          });
        }
      }
    }
  }

  return rootHolder.root;
}
