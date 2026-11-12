import crypto from "node:crypto";
import type { ParserApi } from "./parser-loader.ts";

/**
 * Formats a canonical, human-readable symbol ID string.
 * Format: {canonical_path}#{parent_scope}::{kind}:{qualified_name}[@{disambiguator}]
 */
export function formatCanonicalSymbolId(
  canonicalPath: string,
  parentScope: string | null,
  kind: string,
  qualifiedName: string,
  disambiguator: string | number = 0,
): string {
  const scope = parentScope || "";
  const dis = disambiguator !== undefined && disambiguator !== "" ? `@${disambiguator}` : "@0";
  return `${canonicalPath}#${scope}::${kind}:${qualifiedName}[${dis}]`;
}

/**
 * Computes a deterministic, line-independent symbol_id (SHA-256 hex).
 * Formula: SHA-256(canonical_path + "::" + parent_scope + "::" + kind + "::" + qualified_name + "::" + disambiguator)
 */
export function computeSymbolId(
  canonicalPath: string,
  parentScope: string | null,
  kind: string,
  qualifiedName: string,
  disambiguator: string | number = 0,
): string {
  const raw = formatCanonicalSymbolId(
    canonicalPath,
    parentScope,
    kind,
    qualifiedName,
    disambiguator,
  );
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

interface NormalizedToken {
  k: number;
  t?: string;
}

function extractNodeTokens(node: any, tokens: NormalizedToken[], parser: ParserApi): void {
  if (!node) return;

  const isIdentifierOrLiteral =
    node.kind === parser.SyntaxKind.Identifier ||
    node.kind === parser.SyntaxKind.StringLiteral ||
    node.kind === parser.SyntaxKind.NumericLiteral ||
    node.kind === parser.SyntaxKind.BigIntLiteral ||
    node.kind === parser.SyntaxKind.RegularExpressionLiteral ||
    node.kind === parser.SyntaxKind.NoSubstitutionTemplateLiteral ||
    node.kind === parser.SyntaxKind.TemplateHead ||
    node.kind === parser.SyntaxKind.TemplateMiddle ||
    node.kind === parser.SyntaxKind.TemplateTail ||
    node.kind === parser.SyntaxKind.JsxText;

  tokens.push({
    k: node.kind,
    t: isIdentifierOrLiteral
      ? (node.text ?? (node.escapedText ? String(node.escapedText) : undefined))
      : undefined,
  });

  parser.forEachChild(node, (child) => {
    extractNodeTokens(child, tokens, parser);
  });
}

/**
 * Computes a token-normalized declaration fingerprint (SHA-256 hex).
 * Strips comments, line numbers, and whitespace (AC-7202).
 */
export function computeFingerprint(node: any, sourceFile: any, parser: ParserApi): string {
  if (!node) return "";

  const tokens: NormalizedToken[] = [];
  extractNodeTokens(node, tokens, parser);

  const serialized = JSON.stringify(tokens);
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}
