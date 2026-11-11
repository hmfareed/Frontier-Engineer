import { visitSourceFile } from "./ast-visitor.ts";
import { loadTsConfig, resolveModuleSpecifier } from "./module-resolver.ts";
import { loadParser, type ParserApi } from "./parser-loader.ts";
import {
  computeFingerprint,
  computeSymbolId,
  formatCanonicalSymbolId,
} from "./symbol-identity.ts";
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
  if (canonicalPath.endsWith(".js") || canonicalPath.endsWith(".mjs") || canonicalPath.endsWith(".cjs")) {
    return parser.ScriptKind.JS;
  }
  return parser.ScriptKind.TS;
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

  const parser = await loadParser();
  const scriptKind = getScriptKind(canonicalPath, parser);

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
          message: err?.message || String(err),
        },
      ],
    };
  }

  // Check for parse diagnostics if available on sourceFile
  if (sourceFile?.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
    status = "PARTIAL";
    for (const d of sourceFile.parseDiagnostics) {
      diagnostics.push({
        severity: "warning",
        message: typeof d.messageText === "string" ? d.messageText : d.messageText?.messageText || "Parse diagnostic",
        line: d.start,
      });
    }
  }

  // Load tsconfig if workspaceRoot is provided
  const tsconfig = options.workspaceRoot
    ? loadTsConfig(options.workspaceRoot, options.tsconfigPath)
    : undefined;

  // Visit AST and extract raw findings
  const findings = visitSourceFile(sourceFile, canonicalPath, parser);

  // Resolve imports if workspaceRoot is available
  if (options.workspaceRoot) {
    for (const imp of findings.imports) {
      const res = resolveModuleSpecifier(
        imp.specifier,
        canonicalPath,
        options.workspaceRoot,
        tsconfig,
      );
      imp.resolvedPath = res.resolvedCanonicalPath;
      if (res.isExternal) {
        imp.evidenceClassification = "external_or_missing";
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
