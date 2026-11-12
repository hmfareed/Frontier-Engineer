/**
 * Phase 7.2 — Structural Extractors Data Types and Contracts
 * Storage-independent in-memory AST and graph extraction representations.
 */

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type_alias"
  | "enum"
  | "variable"
  | "react_component";

const VALID_SYMBOL_KINDS = new Set<string>([
  "function",
  "class",
  "method",
  "interface",
  "type_alias",
  "enum",
  "variable",
  "react_component",
]);

export function isValidSymbolKind(kind: string): kind is SymbolKind {
  return VALID_SYMBOL_KINDS.has(kind);
}

export interface SourceEvidence {
  lineStart: number;
  lineEnd: number;
  colStart: number;
  colEnd: number;
  evidenceHash: string;
}

export interface SymbolMetadata {
  inferredCallable?: boolean;
  isReactComponent?: boolean;
  reactComponentConfidence?: number;
  evidenceClassification?:
    "syntactic_ast" | "heuristic_jsx_return" | "dynamic_import_inferred" | "convention_inferred";
  docComment?: string;
  signature?: string;
  returnType?: string;
  typeParameters?: string[];
  modifiers?: string[];
}

export interface ExtractedSymbol {
  symbolId: string;
  name: string;
  parentScope: string | null;
  kind: SymbolKind;
  fingerprint: string;
  isExported: boolean;
  sourceEvidence: SourceEvidence;
  metadata?: SymbolMetadata;
}

export interface ImportedSymbol {
  name: string;
  alias?: string;
  isTypeOnly?: boolean;
}

export type EvidenceClassification =
  "syntactic_ast" | "heuristic_jsx_return" | "dynamic_import_inferred" | "external_or_missing";

export interface ImportRecord {
  specifier: string;
  resolvedPath: string | null;
  importedSymbols: ImportedSymbol[] | "*";
  isTypeOnly: boolean;
  isDynamic: boolean;
  evidenceClassification: EvidenceClassification;
  sourceEvidence?: SourceEvidence;
}

export interface ExportRecord {
  name: string;
  localName: string;
  isReExport: boolean;
  sourceModule: string | null;
  isTypeOnly: boolean;
  isWildcard: boolean;
  sourceEvidence?: SourceEvidence;
}

export interface CallExpressionRecord {
  calleeName: string;
  sourceEvidence: SourceEvidence;
  isDynamicImport?: boolean;
}

export type ExtractionStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export interface ExtractionDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
}

export interface ExtractionResult {
  canonicalPath: string;
  symbols: ExtractedSymbol[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  callExpressions: CallExpressionRecord[];
  status: ExtractionStatus;
  diagnostics: ExtractionDiagnostic[];
}

export interface ExtractorOptions {
  extractComments?: boolean;
  workspaceRoot?: string;
  tsconfigPath?: string;
  cancellationToken?: { isCancellationRequested: boolean };
}

export function isExtractionResult(val: unknown): val is ExtractionResult {
  if (!val || typeof val !== "object") return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.canonicalPath === "string" &&
    Array.isArray(obj.symbols) &&
    Array.isArray(obj.imports) &&
    Array.isArray(obj.exports) &&
    Array.isArray(obj.callExpressions) &&
    typeof obj.status === "string" &&
    Array.isArray(obj.diagnostics)
  );
}
