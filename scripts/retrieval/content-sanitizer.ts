/**
 * Phase 7.6 — Untrusted Content Sanitizer, Secret Redactor & Containment Guard
 * Reuses Frontier sensitive-file and secret scanning primitives and fences repo text.
 */

import fs from "node:fs";
import path from "node:path";
import { evaluateSensitivePath, scanBufferForSecrets } from "../scanner/sensitive-filter.ts";

const HARD_EXCLUDED_SEGMENTS = new Set([".frontier", ".git", ".agents", ".ssh", ".aws", ".gnupg"]);
const MAX_SNIPPET_FILE_BYTES = 64 * 1024;

const EXTRA_SECRET_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  {
    type: "BEARER_TOKEN",
    regex: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/g,
  },
  {
    type: "ASSIGNED_SECRET",
    regex: /\b(?:password|passwd|client_secret|private_key)\s*[:=]\s*['"][^'"]{10,}['"]/gi,
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
    regex: /(?:<\|?system\|?>|^\s*SYSTEM\s*:|^\s*DEVELOPER\s*:)/im,
  },
  {
    label: "tool_invocation_spoof",
    regex: /\b(?:execute\s+shell\s+command|call\s+tool\s+now|run\s+rm\s+-rf|exfiltrate)\b/i,
  },
];

export interface SanitizedTextResult {
  text: string;
  fencedText: string;
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
    // 1. Strip dangerous non-printable control characters while retaining newline/tab
    let clean = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // 2. Neutralize any fence breakout sequences
    clean = clean
      .replace(/<<<UNTRUSTED_REPO_CONTENT/g, "[ESCAPED_OPEN_FENCE]")
      .replace(/<<<END_UNTRUSTED_REPO_CONTENT>>>/g, "[ESCAPED_CLOSE_FENCE]");

    // 3. Apply Frontier secret scanner + additive inline secret checks
    const primaryScan = scanBufferForSecrets(Buffer.from(clean, "utf8"));
    let redactedText = primaryScan.redactedText;
    let redactionCount = primaryScan.detected ? 1 : 0;

    for (const extra of EXTRA_SECRET_PATTERNS) {
      extra.regex.lastIndex = 0;
      if (extra.regex.test(redactedText)) {
        redactionCount++;
        extra.regex.lastIndex = 0;
        redactedText = redactedText.replace(extra.regex, `[REDACTED_SECRET:${extra.type}]`);
      }
    }

    // 4. Detect instruction-override / injection patterns (flag without executing)
    const injectionLabels: string[] = [];
    for (const pattern of INJECTION_SIGNAL_PATTERNS) {
      if (pattern.regex.test(redactedText)) {
        injectionLabels.push(pattern.label);
      }
    }

    const fencedText = [
      `<<<UNTRUSTED_REPO_CONTENT source="${label}" trust="untrusted_data">>>`,
      redactedText,
      "<<<END_UNTRUSTED_REPO_CONTENT>>>",
    ].join("\n");

    return {
      text: redactedText,
      fencedText,
      redacted: redactionCount > 0,
      redactionCount,
      promptInjectionDetected: injectionLabels.length > 0,
      injectionLabels,
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

  private static sliceAndSanitize(
    rawText: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
    maxLines = 40,
  ): SafeSnippetReadResult {
    const allLines = rawText.split(/\r?\n/);
    const total = allLines.length;
    if (total === 0) {
      return {
        allowed: true,
        content: "",
        lineRange: [1, 1],
        redacted: false,
        redactionCount: 0,
        promptInjectionDetected: false,
        injectionLabels: [],
      };
    }

    const from = Math.max(1, startLine ?? 1);
    const boundedMax = Math.max(1, maxLines);
    const to = Math.min(
      total,
      endLine ? Math.min(endLine, from + boundedMax - 1) : from + boundedMax - 1,
    );
    const sliced = allLines.slice(from - 1, to).join("\n");

    const sanitized = this.sanitizeUntrustedText(sliced, `${filePath}:${from}-${to}`);
    return {
      allowed: true,
      content: sanitized.fencedText,
      lineRange: [from, to],
      redacted: sanitized.redacted,
      redactionCount: sanitized.redactionCount,
      promptInjectionDetected: sanitized.promptInjectionDetected,
      injectionLabels: sanitized.injectionLabels,
    };
  }
}
