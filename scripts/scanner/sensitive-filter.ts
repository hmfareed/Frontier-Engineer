import path from "node:path";

export interface SensitivePathCheckResult {
  isSensitive: boolean;
  reason?: string;
}

export interface SecretScanResult {
  detected: boolean;
  secretType: string | null;
  redactedText: string;
}

const SENSITIVE_PATTERNS = {
  // Matches all environment files: .env, .env.local, .env.production, etc.
  envFile: /^\.env(\.[a-zA-Z0-9_-]+)*$/i,
  // Explicitly allowed templates / examples
  allowedEnvExample: /^\.env\.(example|sample|template)$/i,
  // Exact sensitive private key basenames or specific secret extensions
  privateKeyBasename: /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  privateKeyExtension: /\.(pem|key|pkcs12|pfx|p12|keystore)$/i,
  // Sensitive root directories
  sensitiveDir: /(?:^|\/)\.(ssh|aws|gnupg|vault)(?:\/|$)/i,
};

/**
 * Checks whether a canonical relative path points to a sensitive file or directory.
 * Explicitly preserves ordinary source files like keyboard.ts, tokenizer.ts, token.ts.
 */
export function evaluateSensitivePath(canonicalPath: string): SensitivePathCheckResult {
  const normalized = canonicalPath.replace(/\\/g, "/");
  const fileName = path.basename(normalized);

  // 1. Check if it's an explicitly allowed environment example/template
  if (SENSITIVE_PATTERNS.allowedEnvExample.test(fileName)) {
    return { isSensitive: false };
  }

  // 2. Check for .env files
  if (SENSITIVE_PATTERNS.envFile.test(fileName)) {
    return { isSensitive: true, reason: "SENSITIVE_ENV_FILE" };
  }

  // 3. Check for private keys by basename or exact extension
  if (SENSITIVE_PATTERNS.privateKeyBasename.test(fileName)) {
    return { isSensitive: true, reason: "PRIVATE_KEY" };
  }
  if (SENSITIVE_PATTERNS.privateKeyExtension.test(fileName)) {
    return { isSensitive: true, reason: "PRIVATE_KEY_OR_CERTIFICATE" };
  }

  // 4. Check for sensitive directories (.ssh, .aws, etc.)
  if (SENSITIVE_PATTERNS.sensitiveDir.test(normalized)) {
    return { isSensitive: true, reason: "SENSITIVE_DIRECTORY" };
  }

  return { isSensitive: false };
}

/**
 * Extracts configuration key names from .env.example / .env.sample files.
 * Discards all values and returns key names only.
 */
export function extractConfigKeysOnly(text: string): string[] {
  const keys: string[] = [];
  const lines = text.split(/\r?\n/);
  const keyRegex = /^\s*([A-Z_0-9]+)\s*=/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(keyRegex);
    if (match && match[1]) {
      keys.push(match[1]);
    }
  }

  return keys;
}

const PEM_BEGIN_REGEX = /-----BEGIN [A-Z0-9 ]{0,48}PRIVATE KEY(?: BLOCK)?-----/;
const PEM_END_REGEX = /-----END [A-Z0-9 ]{0,48}PRIVATE KEY(?: BLOCK)?-----/;
const PEM_BEGIN_GLOBAL = /-----BEGIN [A-Z0-9 ]{0,48}PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_END_GLOBAL = /-----END [A-Z0-9 ]{0,48}PRIVATE KEY(?: BLOCK)?-----/g;

function isPemArmorHeaderLine(line: string): boolean {
  return /^\s*(?:\/\/+\s+|#+\s*|\*+\s+)?(?:Proc-Type|DEK-Info|Version|Hash|Comment):/i.test(line);
}

function extractPemBase64Token(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (PEM_BEGIN_REGEX.test(trimmed) || PEM_END_REGEX.test(trimmed)) return null;
  // Strip optional comment line prefixes (only space-separated //, or # / * which are non-base64)
  const withoutComment = trimmed.replace(/^(?:\/\/\s+|#+\s*|\*+\s+)/, "").trim();
  if (withoutComment.length === 0) return null;
  const stripped = withoutComment
    .replace(/(?:\\r|\\n)+$/g, "")
    .replace(/^[`"']/, "")
    .replace(/(?:\\r|\\n|[`"';,\\+])+$/g, "");
  if (stripped.length === 0) return null;
  return /^[A-Za-z0-9+/=]+$/.test(stripped) ? stripped : null;
}

function isPemBase64ContinuationLine(line: string, minBase64Chars = 16): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (isPemArmorHeaderLine(trimmed)) return true;
  const token = extractPemBase64Token(line);
  return token !== null && token.length >= minBase64Chars;
}

function isShortIncompletePemFragment(token: string, hasSeenPayload: boolean): boolean {
  if (token.length === 0) return false;
  if (token.length >= 12) return true;
  if (token.includes("=")) return true;
  if (/[+/0-9]/.test(token)) return true;
  return hasSeenPayload;
}

function findLastPemBase64LineToEof(lines: string[], startIndex: number): number | null {
  let lastPayloadLine: number | null = null;
  for (let k = startIndex; k < lines.length; k++) {
    const line = lines[k];
    if (line.trim().length === 0) continue;
    if (PEM_BEGIN_REGEX.test(line) || PEM_END_REGEX.test(line)) return null;
    if (isPemArmorHeaderLine(line) || extractPemBase64Token(line) !== null) {
      lastPayloadLine = k;
      continue;
    }
    return null;
  }
  return lastPayloadLine;
}

function maskSpanPreservingTail(
  line: string,
  fromCol: number,
  toCol: number,
  marker: string,
): string {
  return `${line.slice(0, fromCol)}${marker}${line.slice(toCol)}`;
}

/**
 * Redacts complete, incomplete, inline escaped, and trailing-fragment PEM private key blocks
 * in linear time without backtracking regexes.
 */
export function redactPemPrivateKeys(
  input: string,
  marker = "[REDACTED_SECRET:PRIVATE_KEY]",
  options: { preserveLineCount?: boolean } = {},
): { redactedText: string; detected: boolean; redactionCount: number } {
  if (!input || (!PEM_BEGIN_REGEX.test(input) && !PEM_END_REGEX.test(input))) {
    return { redactedText: input, detected: false, redactionCount: 0 };
  }

  const preserveLineCount = options.preserveLineCount === true;
  const lineEnding = input.includes("\r\n") ? "\r\n" : "\n";
  const lines = input.split(/\r?\n/);
  const markerContainsPem = PEM_BEGIN_REGEX.test(marker) || PEM_END_REGEX.test(marker);
  let detected = false;
  let redactionCount = 0;

  // Step 1: Mask inline BEGIN...END pairs residing on the same physical line (e.g., escaped "\\n")
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let searchFrom = 0;
    while (searchFrom < line.length) {
      PEM_BEGIN_GLOBAL.lastIndex = searchFrom;
      const beginMatch = PEM_BEGIN_GLOBAL.exec(line);
      if (!beginMatch) break;

      PEM_END_GLOBAL.lastIndex = beginMatch.index + beginMatch[0].length;
      const endMatch = PEM_END_GLOBAL.exec(line);
      if (!endMatch) break;

      detected = true;
      redactionCount++;
      line = maskSpanPreservingTail(
        line,
        beginMatch.index,
        endMatch.index + endMatch[0].length,
        marker,
      );
      searchFrom = beginMatch.index + marker.length;
    }
    lines[i] = line;
  }

  // Step 2: Scan multi-line complete blocks, incomplete EOF blocks, and orphan END tail fragments
  const maskedLineFlags = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    const beginMatch = PEM_BEGIN_REGEX.exec(lines[i]);
    if (beginMatch && beginMatch.index !== undefined) {
      detected = true;
      redactionCount++;

      let closingIdx = -1;
      let closingEndCol = 0;
      const sameLineTailStart = beginMatch.index + beginMatch[0].length;
      const sameLineTail = lines[i].slice(sameLineTailStart);
      const sameLineBegin = PEM_BEGIN_REGEX.exec(sameLineTail);
      const sameLineEnd = PEM_END_REGEX.exec(sameLineTail);
      if (
        sameLineEnd &&
        sameLineEnd.index !== undefined &&
        (!sameLineBegin ||
          sameLineBegin.index === undefined ||
          sameLineEnd.index < sameLineBegin.index)
      ) {
        closingIdx = i;
        closingEndCol = sameLineTailStart + sameLineEnd.index + sameLineEnd[0].length;
      } else if (!sameLineBegin) {
        for (let j = i + 1; j < lines.length; j++) {
          const beginOnJ = PEM_BEGIN_REGEX.exec(lines[j]);
          const endMatch = PEM_END_REGEX.exec(lines[j]);
          if (
            endMatch &&
            endMatch.index !== undefined &&
            (!beginOnJ || beginOnJ.index === undefined || endMatch.index < beginOnJ.index)
          ) {
            closingIdx = j;
            closingEndCol = endMatch.index + endMatch[0].length;
            break;
          }
          if (beginOnJ) {
            break;
          }
        }
      }

      if (closingIdx !== -1) {
        const prefix = lines[i].slice(0, beginMatch.index);
        const suffix = lines[closingIdx].slice(closingEndCol);
        const suffixHasPem =
          !markerContainsPem && (PEM_BEGIN_REGEX.test(suffix) || PEM_END_REGEX.test(suffix));

        if (suffixHasPem) {
          for (let k = i; k < closingIdx; k++) {
            maskedLineFlags[k] = true;
            if (preserveLineCount) {
              lines[k] = k === i ? `${prefix}${marker}` : marker;
            } else {
              lines[k] = k === i ? `${prefix}${marker}` : "";
            }
          }
          if (preserveLineCount) {
            maskedLineFlags[closingIdx] = true;
            lines[closingIdx] = `${marker}${suffix}`;
          } else {
            lines[closingIdx] = suffix;
          }
          i = closingIdx - 1;
          continue;
        }

        for (let k = i; k <= closingIdx; k++) {
          maskedLineFlags[k] = true;
          if (preserveLineCount) {
            if (k === i) lines[k] = `${prefix}${marker}`;
            else if (k === closingIdx) lines[k] = `${marker}${suffix}`;
            else lines[k] = marker;
          } else {
            lines[k] = k === i ? `${prefix}${marker}${suffix}` : "";
          }
        }
        i = closingIdx;
        continue;
      }

      // Incomplete block with no closing END: consume contiguous PEM armor / base64 lines,
      // including short trailing payload fragments (e.g., "dA==", "AQAB") at end-of-block or EOF.
      const prefix = lines[i].slice(0, beginMatch.index);
      const beginHeaderEnd = beginMatch.index + beginMatch[0].length;
      const tailOnBeginLine = lines[i].slice(beginHeaderEnd);
      const inlineClosingQuote = tailOnBeginLine.match(/[`"']/);

      let endSpan = i;
      let hasSeenPayload =
        isPemArmorHeaderLine(tailOnBeginLine) || isPemBase64ContinuationLine(tailOnBeginLine, 12);

      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (PEM_BEGIN_REGEX.test(line) || PEM_END_REGEX.test(line)) {
          break;
        }

        if (isPemArmorHeaderLine(line)) {
          hasSeenPayload = true;
          endSpan = j;
          continue;
        }

        const token = extractPemBase64Token(line);
        if (token !== null) {
          if (token.length >= 12) {
            hasSeenPayload = true;
            endSpan = j;
            continue;
          }
          if (isShortIncompletePemFragment(token, hasSeenPayload)) {
            endSpan = j;
            if (token.includes("=")) {
              // Padding terminates a base64 block cleanly without risking adjacent identifiers
              continue;
            }
            continue;
          }
          const eofTail = findLastPemBase64LineToEof(lines, j);
          if (eofTail !== null) {
            endSpan = eofTail;
            break;
          }
          break;
        }

        if (line.trim().length === 0 && j + 1 < lines.length) {
          const nextLine = lines[j + 1];
          const nextToken = extractPemBase64Token(nextLine);
          if (
            isPemArmorHeaderLine(nextLine) ||
            (nextToken !== null &&
              (nextToken.length >= 12 || isShortIncompletePemFragment(nextToken, hasSeenPayload)))
          ) {
            endSpan = j;
            continue;
          }
        }
        break;
      }

      const suffix =
        endSpan === i && inlineClosingQuote && inlineClosingQuote.index !== undefined
          ? tailOnBeginLine.slice(inlineClosingQuote.index)
          : "";

      for (let k = i; k <= endSpan; k++) {
        maskedLineFlags[k] = true;
        if (preserveLineCount) {
          lines[k] = k === i ? `${prefix}${marker}${suffix}` : marker;
        } else {
          lines[k] = k === i ? `${prefix}${marker}${suffix}` : "";
        }
      }

      const suffixHasPem =
        !markerContainsPem &&
        suffix.length > 0 &&
        (PEM_BEGIN_REGEX.test(suffix) || PEM_END_REGEX.test(suffix));
      if (suffixHasPem) {
        i--;
      } else {
        i = endSpan;
      }
      continue;
    }

    // Orphan closing END header (e.g., snippet sliced starting inside PEM body through END)
    const orphanEnd = PEM_END_REGEX.exec(lines[i]);
    if (orphanEnd && orphanEnd.index !== undefined) {
      detected = true;
      redactionCount++;

      let startSpan = i;
      for (let j = i - 1; j >= 0; j--) {
        if (maskedLineFlags[j]) break;
        const line = lines[j];
        const minLen = j === i - 1 ? 1 : 12;
        if (
          isPemArmorHeaderLine(line) ||
          isPemBase64ContinuationLine(line, minLen) ||
          (line.trim().length === 0 &&
            j > 0 &&
            (isPemArmorHeaderLine(lines[j - 1]) || isPemBase64ContinuationLine(lines[j - 1], 12)))
        ) {
          startSpan = j;
          continue;
        }
        break;
      }

      const suffix = lines[i].slice(orphanEnd.index + orphanEnd[0].length);
      const suffixHasPem =
        !markerContainsPem && (PEM_BEGIN_REGEX.test(suffix) || PEM_END_REGEX.test(suffix));

      if (suffixHasPem) {
        for (let k = startSpan; k < i; k++) {
          maskedLineFlags[k] = true;
          if (preserveLineCount) {
            lines[k] = marker;
          } else {
            lines[k] = k === startSpan ? marker : "";
          }
        }
        if (preserveLineCount) {
          maskedLineFlags[i] = true;
          lines[i] = `${marker}${suffix}`;
        } else {
          lines[i] = startSpan === i ? `${marker}${suffix}` : suffix;
        }
        i--;
        continue;
      }

      for (let k = startSpan; k <= i; k++) {
        maskedLineFlags[k] = true;
        if (preserveLineCount) {
          lines[k] = k === i ? `${marker}${suffix}` : marker;
        } else {
          lines[k] = k === startSpan ? `${marker}${suffix}` : "";
        }
      }

      if (suffixHasPem) {
        i--;
      }
    }
  }

  if (preserveLineCount) {
    return { redactedText: lines.join(lineEnding), detected, redactionCount };
  }

  const outputLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (maskedLineFlags[i] && lines[i] === "") {
      continue;
    }
    outputLines.push(lines[i]);
  }
  return { redactedText: outputLines.join(lineEnding), detected, redactionCount };
}

const KNOWN_SECRET_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  {
    type: "AWS_ACCESS_KEY",
    regex: /\b((?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[0-9A-Z]{16})\b/g,
  },
  { type: "GITHUB_PAT", regex: /\b(ghp_[0-9a-zA-Z]{36})\b/g },
  { type: "GITHUB_FINE_GRAINED_PAT", regex: /\b(github_pat_[0-9a-zA-Z_]{82})\b/g },
  { type: "SLACK_TOKEN", regex: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g },
  {
    type: "GENERIC_API_KEY",
    regex: /\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][0-9a-zA-Z_\-]{20,}['"]/gi,
  },
];

/**
 * Scans an in-memory buffer for known secret and credential patterns.
 * If detected, returns detected: true, secretType, and redacted text.
 */
export function scanBufferForSecrets(buffer: Buffer): SecretScanResult {
  const text = buffer.toString("utf8");
  let detected = false;
  let firstSecretType: string | null = null;

  const pemResult = redactPemPrivateKeys(text, "[REDACTED_SECRET:PRIVATE_KEY]");
  let redacted = pemResult.redactedText;
  if (pemResult.detected) {
    detected = true;
    firstSecretType = "PRIVATE_KEY";
  }

  for (const pattern of KNOWN_SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(redacted)) {
      detected = true;
      if (!firstSecretType) firstSecretType = pattern.type;
      pattern.regex.lastIndex = 0;
      redacted = redacted.replace(pattern.regex, `[REDACTED_SECRET:${pattern.type}]`);
    }
  }

  return {
    detected,
    secretType: firstSecretType,
    redactedText: redacted,
  };
}
