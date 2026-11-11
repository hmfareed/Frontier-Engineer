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

const KNOWN_SECRET_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: "AWS_ACCESS_KEY", regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  { type: "GITHUB_PAT", regex: /\b(ghp_[0-9a-zA-Z]{36})\b/g },
  { type: "GITHUB_FINE_GRAINED_PAT", regex: /\b(github_pat_[0-9a-zA-Z_]{82})\b/g },
  { type: "PRIVATE_KEY_HEADER", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
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
  let redacted = text;

  for (const pattern of KNOWN_SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) {
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
