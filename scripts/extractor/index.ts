import path from "node:path";
import { visitSourceFile } from "./ast-visitor.ts";
import { loadTsConfig, resolveModuleSpecifier } from "./module-resolver.ts";
import { loadParser, type ParserApi } from "./parser-loader.ts";
import { computeFingerprint, computeSymbolId, formatCanonicalSymbolId } from "./symbol-identity.ts";
import type {
  ExtractionDiagnostic,
  ExtractionResult,
  ExtractionStatus,
  ExtractorOptions,
} from "./types.ts";

export * from "./ast-visitor.ts";
export * from "./module-resolver.ts";
export * from "./parser-loader.ts";
export * from "./symbol-identity.ts";
export * from "./types.ts";

function getScriptKind(canonicalPath: string, parser: ParserApi): number {
  if (canonicalPath.endsWith(".tsx")) return parser.ScriptKind.TSX;
  if (canonicalPath.endsWith(".jsx")) return parser.ScriptKind.JSX;
  if (
    canonicalPath.endsWith(".js") ||
    canonicalPath.endsWith(".mjs") ||
    canonicalPath.endsWith(".cjs")
  ) {
    return parser.ScriptKind.JS;
  }
  return parser.ScriptKind.TS;
}

function isValidCanonicalPath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  if (path.isAbsolute(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  const normalized = p.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes(".")) return false;
  return true;
}

function redactSecrets(msg: string): string {
  return msg
    .replace(/\b(ghp_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_SECRET]")
    .replace(/\b(sk-[A-Za-z0-9_]{20,})\b/g, "[REDACTED_SECRET]")
    .replace(/\b(AKIA[A-Z0-9]{16})\b/g, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, "Bearer [REDACTED_SECRET]");
}

/**
 * High-level public facade for Phase 7.2 Structural Extraction.
 *
 * Coordinates self-contained parser loading, AST node traversal, deterministic symbol
 * identity generation, token fingerprinting, and module specifier resolution.
 * Operates purely in-memory with zero SQLite or persistent database dependencies.
 */
export async function extractFileSymbols(
  canonicalPath: string,
  content: string,
  options: ExtractorOptions = {},
): Promise<ExtractionResult> {
  const diagnostics: ExtractionDiagnostic[] = [];
  let status: ExtractionStatus = "SUCCESS";

  // 1. Check for cancellation
  if (options.cancellationToken?.isCancellationRequested) {
    return {
      canonicalPath,
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status: "FAILED",
      diagnostics: [
        {
          severity: "error",
          message: "Extraction cancelled by cancellation token.",
        },
      ],
    };
  }

  // 2. Validate canonical path boundaries
  if (!isValidCanonicalPath(canonicalPath)) {
    return {
      canonicalPath,
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status: "FAILED",
      diagnostics: [
        {
          severity: "error",
          message: `Invalid canonical path "${canonicalPath}": must be a normalized repository-relative path within workspace boundaries.`,
        },
      ],
    };
  }

  // 3. Load bundled parser
  const parser = await loadParser();
  const scriptKind = getScriptKind(canonicalPath, parser);

  // 4. Parse AST
  let sourceFile: any;
  try {
    sourceFile = parser.createSourceFile(
      canonicalPath,
      content,
      parser.ScriptTarget.Latest,
      true,
      scriptKind,
    );
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    return {
      canonicalPath,
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status: "FAILED",
      diagnostics: [
        {
          severity: "error",
          message: redactSecrets(rawMsg),
        },
      ],
    };
  }

  // 5. Collect parse diagnostics and ensure secrets are redacted
  if (sourceFile?.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
    status = "PARTIAL";
    for (const d of sourceFile.parseDiagnostics) {
      const rawMsg =
        typeof d.messageText === "string"
          ? d.messageText
          : d.messageText?.messageText || "Parse diagnostic";
      diagnostics.push({
        severity: "warning",
        message: redactSecrets(rawMsg),
        line: d.start,
      });
    }
  }

  // 6. Handle empty content: valid empty extraction
  if (content.trim().length === 0) {
    return {
      canonicalPath,
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status,
      diagnostics,
    };
  }

  // 7. Load tsconfig if workspaceRoot is provided
  const tsconfig = options.workspaceRoot
    ? loadTsConfig(options.workspaceRoot, options.tsconfigPath, parser)
    : undefined;

  // 8. Visit AST and extract raw findings
  const findings = visitSourceFile(sourceFile, canonicalPath, parser);

  // 9. Resolve imports if workspaceRoot is available
  if (options.workspaceRoot) {
    for (const imp of findings.imports) {
      const res = resolveModuleSpecifier(
        imp.specifier,
        canonicalPath,
        options.workspaceRoot,
        tsconfig,
        parser,
      );
      imp.resolvedPath = res.resolvedCanonicalPath;
      if (res.status === "unresolved" || res.isExternal) {
        imp.evidenceClassification = res.classification;
      }
    }
  }

  return {
    canonicalPath,
    symbols: findings.symbols,
    imports: findings.imports,
    exports: findings.exports,
    callExpressions: findings.callExpressions,
    status,
    diagnostics,
  };
}
