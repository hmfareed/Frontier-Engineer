/**
 * Secret redaction utility for Frontier Engineer hooks runtime.
 * Ensures zero credential leaks in diagnostics, audit logs, and error traces.
 */

import { redactPemPrivateKeys } from "../../scanner/sensitive-filter.ts";

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // GitHub Personal Access Tokens (classic and fine-grained)
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replacement: "ghp_[REDACTED]",
  },
  {
    pattern: /github_pat_[a-zA-Z0-9_]{82}/g,
    replacement: "github_pat_[REDACTED]",
  },
  // AWS Access Keys
  {
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // Sentry auth tokens
  {
    pattern: /sntrys_[a-zA-Z0-9]{64}/g,
    replacement: "sntrys_[REDACTED]",
  },
  // Bearer tokens in headers or commands
  {
    pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
    replacement: "Bearer [REDACTED]",
  },
  // Database connection URIs with embedded passwords (postgresql://user:pass@host)
  {
    pattern: /((?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s\/]+:)[^@\s\/]+(@)/gi,
    replacement: "$1[REDACTED]$2",
  },
  // Key-value pairs for passwords, tokens, and secrets in JSON/flags
  {
    pattern:
      /(["']?(?:password|token|secret|apiKey|api_key|auth_token|authToken|access_token|private_key)["']?\s*[:=]\s*["'])([^"'\r\n\s]+)(["'])/gi,
    replacement: "$1[REDACTED]$3",
  },
];

/** Redacts sensitive strings according to standard credential patterns. */
export function redactString(input: string): string {
  if (!input || typeof input !== "string") return "";
  let result = redactPemPrivateKeys(input, "[REDACTED_PRIVATE_KEY]").redactedText;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Recursively redacts strings within arrays, objects, or primitive values. */
export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (
        /password|secret|token|credential|api_?key|private_?key/i.test(key) &&
        typeof val === "string"
      ) {
        copy[key] = "[REDACTED]";
      } else {
        copy[key] = redactValue(val);
      }
    }
    return copy;
  }

  return value;
}
