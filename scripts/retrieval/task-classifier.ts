/**
 * Phase 7.6 — Deterministic Task Classifier
 * Zero-LLM lexical and structural classifier for extracting task types and targets.
 */

import type { ExtractedTargets, RetrievalRequest, TaskClassification, TaskType } from "./types.ts";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "what",
  "which",
  "where",
  "when",
  "how",
  "are",
  "can",
  "will",
  "should",
  "must",
  "have",
  "has",
  "been",
  "make",
  "add",
  "update",
  "change",
  "check",
  "inspect",
  "using",
  "repository",
  "repo",
  "codebase",
  "file",
  "files",
  "symbol",
  "module",
  "component",
]);

const KNOWN_COMPONENT_HINTS = [
  "auth",
  "authentication",
  "authorization",
  "database",
  "storage",
  "api",
  "backend",
  "frontend",
  "ui",
  "cli",
  "scanner",
  "extractor",
  "graph",
  "architecture",
  "query",
  "evolution",
  "memory",
  "hooks",
  "retrieval",
];

const TASK_PATTERNS: Array<{ taskType: TaskType; regex: RegExp; weight: number }> = [
  {
    taskType: "security_audit",
    regex:
      /\b(security|audit|vulnerab\w*|cve|owasp|secret|credential|auth(?:entication|orization)?|permission|sanitize|injection|traversal|threat|rbac)\b/i,
    weight: 4,
  },
  {
    taskType: "evolution_review",
    regex:
      /\b(evolution|drift|snapshot|compare|diff|regress\w*|historical|history|since\s+scan|scan\s+\d+|supersede[sd]?|stale\s+memory)\b/i,
    weight: 4,
  },
  {
    taskType: "test_generation",
    regex:
      /\b(test(?:ing|s)?|qa|coverage|vitest|playwright|spec|assertion|regress\w*|edge\s+case|verify|untested)\b/i,
    weight: 4,
  },
  {
    taskType: "ui_ux_work",
    regex:
      /\b(ui|ux|design|frontend|css|scss|tailwind|layout|accessibility|wcag|responsive|component\s+library|a11y|modal|form|dashboard|visual)\b/i,
    weight: 4,
  },
  {
    taskType: "architecture_design",
    regex:
      /\b(architect\w*|decision|boundary|boundaries|coupling|cycle|circular|schema|migration|contract|system\s+design|dependency\s+graph|module\s+structure)\b/i,
    weight: 3,
  },
  {
    taskType: "bug_fix",
    regex:
      /\b(fix|bug|defect|broken|crash\w*|error|exception|fail(?:ing|ure)?|race\s+condition|leak|patch|hotfix|root\s+cause)\b/i,
    weight: 4,
  },
  {
    taskType: "refactoring",
    regex:
      /\b(refactor\w*|clean\s*up|extract|consolidat\w*|deduplicat\w*|simplify|decoupl\w*|restructur\w*|modulariz\w*|rename)\b/i,
    weight: 4,
  },
  {
    taskType: "documentation",
    regex: /\b(doc(?:ument(?:ation|ing)?)?|readme|changelog|guide|specification|spec|markdown)\b/i,
    weight: 2,
  },
  {
    taskType: "feature_implementation",
    regex:
      /\b(implement\w*|build|creat\w*|update|modify|extend|add\s+(?:a|an|new|support)|develop|integrat\w*|endpoint|feature|cli\s+command)\b/i,
    weight: 4,
  },
];

const KNOWN_FILE_EXT_RE =
  "(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|sql|json|yaml|yml|md|css|scss|html|sqlite)";

export class TaskClassifier {
  public static classify(request: RetrievalRequest): TaskClassification {
    const combinedText = [request.taskSummary ?? "", request.objective ?? ""].join(" ").trim();
    const extractedTargets = this.extractTargets(request, combinedText);
    const signals: string[] = [];

    // Strip file paths and qualified symbol tokens before classifying prose intent
    // so directory/file names (e.g. src/auth/token.ts) do not override action verbs.
    const pathStripRe = new RegExp(
      `(?:[A-Za-z0-9_.-]+[\\\\/])+[A-Za-z0-9_.-]+(?:\\.${KNOWN_FILE_EXT_RE})?`,
      "gi",
    );
    const intentText = combinedText.replace(pathStripRe, " ").trim();

    // Score each task type deterministically
    const scores = new Map<TaskType, number>();
    for (const rule of TASK_PATTERNS) {
      const globalRe = new RegExp(rule.regex.source, "gi");
      const matches = intentText.match(globalRe);
      if (matches && matches.length > 0) {
        const distinctMatches = Array.from(new Set(matches.map((m) => m.toLowerCase())));
        const delta = rule.weight * Math.min(distinctMatches.length, 4);
        scores.set(rule.taskType, (scores.get(rule.taskType) ?? 0) + delta);
        signals.push(`${rule.taskType}: matched [${distinctMatches.sort().join(", ")}]`);
      }
    }

    if (
      (extractedTargets.baseScanId !== undefined && extractedTargets.targetScanId !== undefined) ||
      (request.baseScanId !== undefined && request.targetScanId !== undefined)
    ) {
      scores.set("evolution_review", (scores.get("evolution_review") ?? 0) + 6);
      signals.push("evolution_review: explicit or extracted scan comparison pair");
    }

    if (extractedTargets.adrs.length > 0) {
      scores.set("architecture_design", (scores.get("architecture_design") ?? 0) + 2);
      signals.push(`architecture_design: referenced ADRs [${extractedTargets.adrs.join(", ")}]`);
    }

    const sortedTypes = Array.from(scores.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );

    let primaryTaskType: TaskType;
    if (request.taskType) {
      primaryTaskType = request.taskType;
      signals.unshift(`explicit override: ${request.taskType}`);
    } else if (sortedTypes.length > 0) {
      primaryTaskType = sortedTypes[0][0];
    } else {
      primaryTaskType = "general_inspection";
      signals.push("default fallback: general_inspection");
    }

    const intents: TaskType[] = [primaryTaskType];
    for (const [candidate] of sortedTypes) {
      if (!intents.includes(candidate)) {
        intents.push(candidate);
      }
    }

    return {
      primaryTaskType,
      intents,
      extractedTargets,
      classificationSignals: signals,
    };
  }

  public static normalizeSafePath(rawPath: string): {
    safe: boolean;
    normalized?: string;
    raw: string;
  } {
    const trimmed = rawPath.trim().replace(/^['"`(]+|['"`),.;:!?]+$/g, "");
    if (!trimmed || trimmed.includes("\0")) {
      return { safe: false, raw: rawPath };
    }
    const posix = trimmed.replace(/\\/g, "/");
    if (posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix)) {
      return { safe: false, raw: rawPath };
    }
    const stripped = posix.replace(/^\.\//, "");
    const segments = stripped.split("/").filter((s) => s.length > 0 && s !== ".");
    if (segments.length === 0 || segments.some((s) => s === "..")) {
      return { safe: false, raw: rawPath };
    }
    return { safe: true, normalized: segments.join("/"), raw: rawPath };
  }

  private static extractTargets(request: RetrievalRequest, text: string): ExtractedTargets {
    const fileSet = new Set<string>();
    const symbolSet = new Set<string>();
    const compSet = new Set<string>();
    const adrSet = new Set<string>();
    const unsafeSet = new Set<string>();

    // 1. Explicit hints from request
    for (const f of request.targetFiles ?? []) {
      const norm = this.normalizeSafePath(f);
      if (norm.safe && norm.normalized) {
        fileSet.add(norm.normalized);
      } else {
        unsafeSet.add(f);
      }
    }
    for (const s of request.targetSymbols ?? []) {
      const clean = s.trim();
      if (clean) symbolSet.add(clean);
    }
    for (const c of request.targetComponents ?? []) {
      const clean = c.trim();
      if (clean) compSet.add(clean);
    }
    for (const a of request.targetAdrs ?? []) {
      const clean = a.trim().toUpperCase();
      if (clean) adrSet.add(clean);
    }

    // 2. Extract file paths from text (relative paths with known extensions or slashes)
    const pathRe = new RegExp(
      `(?:^|[\\s(\`"'\\[])((?:[A-Za-z0-9_.-]+[\\\\/])*[A-Za-z0-9_.-]+\\.${KNOWN_FILE_EXT_RE})(?=[\\s)\`"'\\].,;:!?#]|$)`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(text)) !== null) {
      const candidate = m[1];
      const norm = this.normalizeSafePath(candidate);
      if (norm.safe && norm.normalized) {
        fileSet.add(norm.normalized);
      } else if (candidate.includes("..") || candidate.startsWith("/")) {
        unsafeSet.add(candidate);
      }
    }

    // Flag explicit traversal attempts in prose (e.g. ../../etc/passwd or ../secret)
    const unsafePathRe = /(?:^|\s)((?:\.\.[\\/])+[^\s`"']+)/g;
    while ((m = unsafePathRe.exec(text)) !== null) {
      unsafeSet.add(m[1]);
    }

    // 3. Extract ADR IDs
    const adrRe = /\bADR[-_ ]?(\d{1,4})\b/gi;
    while ((m = adrRe.exec(text)) !== null) {
      const num = m[1].padStart(3, "0");
      adrSet.add(`ADR-${num}`);
    }

    // 4. Extract symbols (path#Symbol or PascalCase / snake_case / camelCase identifiers)
    const qualifiedSymbolRe = /\b([A-Za-z0-9_./-]+#[A-Za-z_][A-Za-z0-9_.]*)\b/g;
    while ((m = qualifiedSymbolRe.exec(text)) !== null) {
      symbolSet.add(m[1]);
    }

    const camelOrPascalRe = /\b([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z]+_[a-z0-9_]+)\b/g;
    while ((m = camelOrPascalRe.exec(text)) !== null) {
      const token = m[1];
      if (!STOPWORDS.has(token.toLowerCase()) && token.length >= 4) {
        symbolSet.add(token);
      }
    }

    // Also capture standalone PascalCase identifiers like "ConnectionManager" or "RetrievalEngine"
    const pascalRe = /\b([A-Z][a-z]{2,}[A-Za-z0-9]*)\b/g;
    while ((m = pascalRe.exec(text)) !== null) {
      const token = m[1];
      if (
        !STOPWORDS.has(token.toLowerCase()) &&
        !/^(Phase|Stage|Frontier|Engineer|Agent|Task|Error|Warning|File|Scan|Test|Tests)$/.test(
          token,
        )
      ) {
        symbolSet.add(token);
      }
    }

    // 5. Component domain hints from prose and extracted file directory segments
    const lowerText = text.toLowerCase();
    const pathSegments = new Set<string>();
    for (const filePath of fileSet) {
      for (const seg of filePath.toLowerCase().split("/").slice(0, -1)) {
        pathSegments.add(seg);
      }
    }
    for (const hint of KNOWN_COMPONENT_HINTS) {
      if (new RegExp(`\\b${hint}\\b`, "i").test(lowerText) || pathSegments.has(hint)) {
        compSet.add(hint);
      }
    }

    // 6. Optional scan pair pattern in text
    let baseScanId = request.baseScanId;
    let targetScanId = request.targetScanId;
    if (baseScanId === undefined || targetScanId === undefined) {
      const scanPairMatch = text.match(
        /\bscan(?:s)?\s+(\d+)\s*(?:to|vs\.?|and|->|\.\.)\s*(?:scan\s+)?(\d+)\b/i,
      );
      if (scanPairMatch) {
        baseScanId = parseInt(scanPairMatch[1], 10);
        targetScanId = parseInt(scanPairMatch[2], 10);
      }
    }

    // 7. Keywords (deduped sorted lowercase tokens)
    const rawTokens = lowerText
      .replace(/[^a-z0-9_/-]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    const keywordSet = new Set<string>(rawTokens);

    return {
      files: Array.from(fileSet).sort((a, b) => a.localeCompare(b)),
      symbols: Array.from(symbolSet).sort((a, b) => a.localeCompare(b)),
      components: Array.from(compSet).sort((a, b) => a.localeCompare(b)),
      adrs: Array.from(adrSet).sort((a, b) => a.localeCompare(b)),
      keywords: Array.from(keywordSet).sort((a, b) => a.localeCompare(b)),
      ignoredUnsafeTargets: Array.from(unsafeSet).sort((a, b) => a.localeCompare(b)),
      baseScanId,
      targetScanId,
    };
  }
}
