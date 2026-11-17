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
  // Sensitive key-value assignments for passwords, tokens, and credentials (quoted or unquoted)
  {
    pattern:
      /(["']?\b(?:password|passwd|token|secret|apiKey|api_key|auth_token|authToken|access_token|private_key|db_pass|db_password)\b["']?\s*[:=]\s*)(?:(["'])([^"'\r\n]+?)\2|([^"'\r\n\s;]+))/gi,
    replacement: (_m: string, p1: string, p2?: string) =>
      p2 ? `${p1}${p2}[REDACTED]${p2}` : `${p1}[REDACTED]`,
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

function safeOwnKeys(obj: object): { keys: string[]; enumerationError?: string } {
  try {
    return { keys: Object.keys(obj) };
  } catch (err) {
    return { keys: [], enumerationError: err instanceof Error ? err.message : String(err) };
  }
}

function shouldSkipPropertyBeforeRead(obj: object, key: string): boolean {
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc) return false;
    if ("value" in desc && typeof desc.value === "function") return true;
    // Never execute getter-backed toJSON hooks during traversal.
    if (key === "toJSON" && typeof desc.get === "function") return true;
    return false;
  } catch {
    return false;
  }
}

function safeReadProperty(
  obj: object,
  key: string | number,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: (obj as Record<string | number, unknown>)[key] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Recursively (via explicit heap stack) redacts strings within arrays and objects.
 * Protects against self-references, nested cycles, throwing getters, own toJSON overrides,
 * and arbitrarily deep structures while allowing repeated sibling DAG references to be redacted.
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

  const enqueueObjectProperties = (curr: object, target: Record<string, unknown>): void => {
    const { keys, enumerationError } = safeOwnKeys(curr);
    if (enumerationError !== undefined) {
      target.__enumerationError = `[PropertyEnumerationError: ${redactString(enumerationError)}]`;
      return;
    }

    const pending: Array<{ key: string; value: unknown }> = [];
    for (const key of keys) {
      // Never copy own functions or execute getter-backed toJSON overrides onto redacted clones.
      if (shouldSkipPropertyBeforeRead(curr, key)) {
        continue;
      }
      const read = safeReadProperty(curr, key);
      if (!read.ok) {
        target[key] = SENSITIVE_KEY_PATTERN.test(key)
          ? "[REDACTED]"
          : `[PropertyAccessError: ${redactString(read.error)}]`;
        continue;
      }
      if (typeof read.value === "function") {
        continue;
      }
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof read.value === "string") {
        target[key] = "[REDACTED]";
      } else {
        pending.push({ key, value: read.value });
      }
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      const { key, value: childVal } = pending[i];
      stack.push({
        kind: "enter",
        source: childVal,
        assign: (redactedVal) => {
          target[key] = redactedVal;
        },
      });
    }
  };

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
      const nameRead = safeReadProperty(curr, "name");
      const msgRead = safeReadProperty(curr, "message");
      const errOut: Record<string, unknown> = {
        name: nameRead.ok ? String(nameRead.value) : "Error",
        message: msgRead.ok
          ? redactString(String(msgRead.value))
          : `[PropertyAccessError: ${redactString(msgRead.error)}]`,
      };
      frame.assign(errOut);
      stack.push({ kind: "exit", obj: curr });
      enqueueObjectProperties(curr, errOut);

      // Standard Error.cause is non-enumerable in ES2022; ensure it is also traversed and redacted.
      const causeRead = safeReadProperty(curr, "cause");
      if (
        causeRead.ok &&
        causeRead.value !== undefined &&
        !Object.prototype.propertyIsEnumerable.call(curr, "cause")
      ) {
        stack.push({
          kind: "enter",
          source: causeRead.value,
          assign: (redactedCause) => {
            errOut.cause = redactedCause;
          },
        });
      } else if (!causeRead.ok) {
        errOut.cause = `[PropertyAccessError: ${redactString(causeRead.error)}]`;
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
        const elemRead = safeReadProperty(curr, idx);
        if (!elemRead.ok) {
          outArr[idx] = `[PropertyAccessError: ${redactString(elemRead.error)}]`;
          continue;
        }
        if (typeof elemRead.value === "function") {
          outArr[idx] = null;
          continue;
        }
        stack.push({
          kind: "enter",
          source: elemRead.value,
          assign: (redactedItem) => {
            outArr[idx] = redactedItem;
          },
        });
      }
    } else {
      const copy: Record<string, unknown> = {};
      frame.assign(copy);
      enqueueObjectProperties(curr, copy);
    }
  }

  return rootHolder.root;
}
