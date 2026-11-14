/**
 * Phase 7.6 — Untrusted Content Sanitizer, Secret Redactor & Containment Guard
 * Reuses Frontier sensitive-file and secret scanning primitives and fences repo text.
 */

import fs from "node:fs";
import path from "node:path";
import {
  evaluateSensitivePath,
  redactPemPrivateKeys,
  scanBufferForSecrets,
} from "../scanner/sensitive-filter.ts";

const HARD_EXCLUDED_SEGMENTS = new Set([".frontier", ".git", ".agents", ".ssh", ".aws", ".gnupg"]);
const MAX_SNIPPET_FILE_BYTES = 256 * 1024;
const PEM_MARKER = "[REDACTED_SECRET:PRIVATE_KEY]";

const EXTRA_SECRET_PATTERNS: Array<{
  type: string;
  regex: RegExp;
  replacer?: (...args: string[]) => string;
}> = [
  {
    type: "BEARER_TOKEN",
    regex: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/g,
  },
  {
    type: "DB_PASSWORD",
    regex: /((?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s/]+:)[^@\s/]+(@)/gi,
    replacer: (_m: string, p1: string, p2: string) => `${p1}[REDACTED_SECRET:DB_PASSWORD]${p2}`,
  },
  {
    type: "SENTRY_TOKEN",
    regex: /\bsntrys_[A-Za-z0-9]{32,}\b/g,
  },
  {
    type: "STRIPE_KEY",
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  {
    type: "ASSIGNED_SECRET",
    regex:
      /\b(?:password|passwd|client_secret|private_key|access_token|auth_token|jwt_secret|secret_key|api_secret)\s*[:=]\s*(?:(['"])([^\r\n'"]{8,})\1|([A-Za-z0-9+/_=-]{16,}))/gi,
  },
];

const INJECTION_SIGNAL_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: "override_instructions",
    regex:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|system)\s+instructions?\b/i,
  },
  {
    label: "system_prompt_spoof",
    regex:
      /(?:<\|?(?:system|assistant|developer|im_start)\|?>|<<SYS>>|\[INST\]|^\s*(?:SYSTEM|DEVELOPER|ASSISTANT)\s*:)/im,
  },
  {
    label: "tool_invocation_spoof",
    regex: /\b(?:execute\s+shell\s+command|call\s+tool\s+now|run\s+rm\s+-rf|exfiltrate)\b/i,
  },
];

export interface SanitizedTextResult {
  text: string;
  fencedText: string;
  inlineFencedText: string;
  redacted: boolean;
  redactionCount: number;
  promptInjectionDetected: boolean;
  injectionLabels: string[];
}

export interface SafeSnippetReadResult {
  allowed: boolean;
  reason?: string;
  content?: string;
  lineRange?: [number, number];
  redacted: boolean;
  redactionCount: number;
  promptInjectionDetected: boolean;
  injectionLabels: string[];
}

export class ContentSanitizer {
  public static isPathSafeAndInWorkspace(
    workspaceRoot: string,
    relativePosixPath: string,
  ): { safe: boolean; resolvedPath?: string; reason?: string } {
    if (!relativePosixPath || relativePosixPath.includes("\0")) {
      return { safe: false, reason: "INVALID_PATH" };
    }

    const normalized = relativePosixPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const segments = normalized.split("/");
    if (
      path.isAbsolute(normalized) ||
      /^[a-zA-Z]:/.test(normalized) ||
      segments.some((s) => s === ".." || HARD_EXCLUDED_SEGMENTS.has(s.toLowerCase()))
    ) {
      return { safe: false, reason: "EXCLUDED_OR_TRAVERSAL_PATH" };
    }

    const sens = evaluateSensitivePath(normalized);
    if (sens.isSensitive) {
      return { safe: false, reason: sens.reason ?? "SENSITIVE_PATH" };
    }

    try {
      const realRoot = fs.realpathSync(workspaceRoot);
      const candidate = path.resolve(realRoot, normalized);
      if (!fs.existsSync(candidate)) {
        return { safe: false, reason: "FILE_MISSING" };
      }
      const realCandidate = fs.realpathSync(candidate);
      const rel = path.relative(realRoot, realCandidate);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { safe: false, reason: "SYMLINK_OUTSIDE_WORKSPACE" };
      }
      const stat = fs.statSync(realCandidate);
      if (!stat.isFile()) {
        return { safe: false, reason: "NOT_A_REGULAR_FILE" };
      }
      return { safe: true, resolvedPath: realCandidate };
    } catch {
      return { safe: false, reason: "UNREADABLE_PATH" };
    }
  }

  public static sanitizeUntrustedText(
    rawText: string,
    label = "repo_content",
  ): SanitizedTextResult {
    // 1. Strip dangerous non-printable control & BiDi override characters while retaining newline/tab
    let clean = rawText
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");

    // 2. Neutralize any fence breakout sequences
    clean = clean
      .replace(/<<<UNTRUSTED_REPO_CONTENT/gi, "[ESCAPED_OPEN_FENCE]")
      .replace(/<<<END_UNTRUSTED_REPO_CONTENT>>>/gi, "[ESCAPED_CLOSE_FENCE]");

    // 3. Apply Frontier secret scanner + additive inline secret checks
    const primaryScan = scanBufferForSecrets(Buffer.from(clean, "utf8"));
    let redactedText = primaryScan.redactedText;
    let redactionCount = primaryScan.detected ? 1 : 0;

    for (const extra of EXTRA_SECRET_PATTERNS) {
      extra.regex.lastIndex = 0;
      if (extra.regex.test(redactedText)) {
        redactionCount++;
        extra.regex.lastIndex = 0;
        redactedText = extra.replacer
          ? redactedText.replace(extra.regex, extra.replacer)
          : redactedText.replace(extra.regex, `[REDACTED_SECRET:${extra.type}]`);
      }
    }

    // 4. Detect instruction-override / injection patterns (flag without executing)
    const injectionLabels: string[] = [];
    for (const pattern of INJECTION_SIGNAL_PATTERNS) {
      if (pattern.regex.test(redactedText)) {
        injectionLabels.push(pattern.label);
      }
    }

    const safeLabel = this.truncateUnicodeSafe(label.replace(/[\r\n"<>\\]/g, "_"), 180).text;
    const fencedText = [
      `<<<UNTRUSTED_REPO_CONTENT source="${safeLabel}" trust="untrusted_data">>>`,
      redactedText,
      "<<<END_UNTRUSTED_REPO_CONTENT>>>",
    ].join("\n");

    const singleLineBody = redactedText.replace(/\s+/g, " ").trim();
    const inlineFencedText = `<<<UNTRUSTED_REPO_CONTENT source="${safeLabel}" trust="untrusted_data">>> ${singleLineBody} <<<END_UNTRUSTED_REPO_CONTENT>>>`;

    return {
      text: redactedText,
      fencedText,
      inlineFencedText,
      redacted: redactionCount > 0,
      redactionCount,
      promptInjectionDetected: injectionLabels.length > 0,
      injectionLabels,
    };
  }

  /**
   * Sanitizes deterministic metadata labels (file paths, symbol names, warning messages)
   * without wrapping them in multi-line fences, ensuring no control characters, BiDi overrides,
   * secrets, or spoofed delimiter tags survive.
   */
  public static sanitizeMetadataText(rawText: string): {
    text: string;
    redacted: boolean;
    promptInjectionDetected: boolean;
  } {
    const res = this.sanitizeUntrustedText(rawText, "metadata");
    return {
      text: res.text.replace(/[\r\n]+/g, " ").trim(),
      redacted: res.redacted,
      promptInjectionDetected: res.promptInjectionDetected,
    };
  }

  public static readSafeSnippet(params: {
    workspaceRoot: string;
    filePath: string;
    sensitivityStatus: string;
    startLine?: number;
    endLine?: number;
    maxLines: number;
  }): SafeSnippetReadResult {
    if (params.sensitivityStatus !== "SAFE") {
      return {
        allowed: false,
        reason: "SENSITIVE_FILE",
        redacted: true,
        redactionCount: 0,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }

    const pathCheck = this.isPathSafeAndInWorkspace(params.workspaceRoot, params.filePath);
    if (!pathCheck.safe || !pathCheck.resolvedPath) {
      return {
        allowed: false,
        reason: pathCheck.reason,
        redacted: pathCheck.reason?.includes("SENSITIVE") ?? false,
        redactionCount: 0,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }

    try {
      const stat = fs.statSync(pathCheck.resolvedPath);
      if (stat.size > MAX_SNIPPET_FILE_BYTES) {
        // Bounded partial read: read only first 64KB chunk rather than loading huge file into memory
        const fd = fs.openSync(pathCheck.resolvedPath, "r");
        try {
          const buf = Buffer.alloc(MAX_SNIPPET_FILE_BYTES);
          const bytesRead = fs.readSync(fd, buf, 0, MAX_SNIPPET_FILE_BYTES, 0);
          return this.sliceAndSanitize(
            buf.subarray(0, bytesRead).toString("utf8"),
            params.filePath,
            params.startLine,
            params.endLine,
            params.maxLines,
          );
        } finally {
          fs.closeSync(fd);
        }
      }

      const raw = fs.readFileSync(pathCheck.resolvedPath, "utf8");
      return this.sliceAndSanitize(
        raw,
        params.filePath,
        params.startLine,
        params.endLine,
        params.maxLines,
      );
    } catch {
      return {
        allowed: false,
        reason: "READ_ERROR",
        redacted: false,
        redactionCount: 0,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }
  }

  /**
   * Truncates text deterministically without splitting a UTF-16 surrogate pair.
   */
  public static truncateUnicodeSafe(
    text: string,
    maxChars: number,
  ): { text: string; truncated: boolean } {
    if (maxChars <= 0) {
      return { text: "", truncated: text.length > 0 };
    }
    if (text.length <= maxChars) {
      return { text, truncated: false };
    }
    let cut = maxChars;
    if (cut > 0) {
      const prevUnit = text.charCodeAt(cut - 1);
      if (prevUnit >= 0xd800 && prevUnit <= 0xdbff) {
        cut -= 1;
      }
    }
    return { text: text.slice(0, cut), truncated: true };
  }

  /**
   * Bounds plain or fenced untrusted text to maxChars while preserving untrusted
   * boundary fences and valid Unicode code points.
   */
  public static boundFencedText(
    text: string,
    maxChars: number,
  ): { text: string; truncated: boolean } {
    if (maxChars <= 0) {
      return { text: "", truncated: text.length > 0 };
    }
    if (text.length <= maxChars) {
      return { text, truncated: false };
    }

    const openPrefix = "<<<UNTRUSTED_REPO_CONTENT ";
    const closeToken = "<<<END_UNTRUSTED_REPO_CONTENT>>>";
    if (text.startsWith(openPrefix) && text.endsWith(closeToken)) {
      const openEndIdx = text.indexOf(">>>");
      const closeStart = text.length - closeToken.length;
      if (openEndIdx !== -1 && openEndIdx + 3 < closeStart) {
        const openSep = text[openEndIdx + 3] === "\n" ? "\n" : " ";
        const closeSep = text[closeStart - 1] === "\n" ? "\n" : " ";
        const openFence = text.slice(0, openEndIdx + 3) + openSep;
        const closeFence = closeSep + closeToken;
        const inner = text.slice(openFence.length, text.length - closeFence.length);
        const marker = openSep === "\n" ? "\n...[TRUNCATED]" : "...[TRUNCATED]";
        const overhead = openFence.length + closeFence.length;

        if (maxChars >= overhead + marker.length + 1) {
          const innerBudget = maxChars - overhead - marker.length;
          const safeInner = this.truncateUnicodeSafe(inner, innerBudget).text;
          return { text: `${openFence}${safeInner}${marker}${closeFence}`, truncated: true };
        }
        if (maxChars >= overhead) {
          const innerBudget = maxChars - overhead;
          const safeInner = this.truncateUnicodeSafe(inner, innerBudget).text;
          return { text: `${openFence}${safeInner}${closeFence}`, truncated: true };
        }
      }
    }

    const suffix = "...[TRUNCATED]";
    if (maxChars > suffix.length + 1) {
      const safeHead = this.truncateUnicodeSafe(text, maxChars - suffix.length).text;
      return { text: `${safeHead}${suffix}`, truncated: true };
    }
    return this.truncateUnicodeSafe(text, maxChars);
  }

  private static sliceAndSanitize(
    rawText: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
    maxLines = 40,
  ): SafeSnippetReadResult {
    // Redact complete & mid-block PEM private keys across the full buffer BEFORE slicing lines
    // so mid-block slices without visible BEGIN/END headers never leak base64 key material.
    const fullPemScan = redactPemPrivateKeys(rawText, PEM_MARKER, { preserveLineCount: true });
    const allLines = fullPemScan.redactedText.split(/\r?\n/);
    const total = allLines.length;
    if (total === 0) {
      return {
        allowed: true,
        content: "",
        lineRange: [1, 1],
        redacted: fullPemScan.detected,
        redactionCount: fullPemScan.redactionCount,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }

    const from = Math.max(1, startLine ?? 1);
    if (from > total) {
      return {
        allowed: false,
        reason: "LINE_RANGE_OUT_OF_BOUNDS",
        redacted: fullPemScan.detected,
        redactionCount: fullPemScan.redactionCount,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }
    const boundedMax = Math.max(1, maxLines);
    const to = Math.min(
      total,
      endLine ? Math.min(endLine, from + boundedMax - 1) : from + boundedMax - 1,
    );

    const slicedLines = allLines.slice(from - 1, to);
    let sliceContainedPreRedactedPem = false;
    const collapsedLines: string[] = [];
    for (const line of slicedLines) {
      if (line.trim() === PEM_MARKER) {
        sliceContainedPreRedactedPem = true;
        if (collapsedLines.length > 0 && collapsedLines[collapsedLines.length - 1] === line) {
          continue;
        }
      }
      collapsedLines.push(line);
    }

    const sliced = collapsedLines.join("\n");
    const sanitized = this.sanitizeUntrustedText(sliced, `${filePath}:${from}-${to}`);
    const wasRedacted = sanitized.redacted || sliceContainedPreRedactedPem;
    const totalRedactions =
      sanitized.redactionCount + (sliceContainedPreRedactedPem && !sanitized.redacted ? 1 : 0);

    return {
      allowed: true,
      content: sanitized.fencedText,
      lineRange: [from, to],
      redacted: wasRedacted,
      redactionCount: totalRedactions,
      promptInjectionDetected: sanitized.promptInjectionDetected,
      injectionLabels: sanitized.injectionLabels,
    };
  }
}
