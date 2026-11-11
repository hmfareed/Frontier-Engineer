import { describe, expect, it } from "vitest";
import type {
  ExportRecord,
  ExtractedSymbol,
  ExtractionResult,
  ImportRecord,
  SourceEvidence,
  SymbolKind,
} from "../../scripts/extractor/types.ts";
import { isExtractionResult, isValidSymbolKind } from "../../scripts/extractor/types.ts";

describe("extractor-types (Extraction Contracts & Invariants)", () => {
  it("validates valid symbol kinds", () => {
    const validKinds: SymbolKind[] = [
      "function",
      "class",
      "method",
      "interface",
      "type_alias",
      "enum",
      "variable",
      "react_component",
    ];

    for (const kind of validKinds) {
      expect(isValidSymbolKind(kind)).toBe(true);
    }

    expect(isValidSymbolKind("unknown_kind")).toBe(false);
    expect(isValidSymbolKind("")).toBe(false);
  });

  it("validates structure of a complete ExtractedSymbol and SourceEvidence", () => {
    const evidence: SourceEvidence = {
      lineStart: 10,
      lineEnd: 25,
      colStart: 1,
      colEnd: 2,
      evidenceHash: "a1b2c3d4e5f67890",
    };

    const symbol: ExtractedSymbol = {
      symbolId: "src/utils.ts#::function:calculateTotal[@0]",
      name: "calculateTotal",
      parentScope: null,
      kind: "function",
      fingerprint: "f0e1d2c3b4a5",
      isExported: true,
      sourceEvidence: evidence,
      metadata: {
        inferredCallable: true,
        docComment: "Calculates the total price",
      },
    };

    expect(symbol.symbolId).toContain("calculateTotal");
    expect(symbol.sourceEvidence.lineStart).toBe(10);
    expect(symbol.metadata?.inferredCallable).toBe(true);
  });

  it("validates structure of ImportRecord and ExportRecord", () => {
    const importRec: ImportRecord = {
      specifier: "./helpers.ts",
      resolvedPath: "src/helpers.ts",
      importedSymbols: [{ name: "formatCurrency", alias: "format" }],
      isTypeOnly: false,
      isDynamic: false,
      evidenceClassification: "syntactic_ast",
    };

    const exportRec: ExportRecord = {
      name: "formatCurrency",
      localName: "formatCurrency",
      isReExport: true,
      sourceModule: "./helpers.ts",
      isTypeOnly: false,
      isWildcard: false,
    };

    expect(importRec.resolvedPath).toBe("src/helpers.ts");
    expect(exportRec.isReExport).toBe(true);
  });

  it("validates runtime extraction result helper isExtractionResult", () => {
    const result: ExtractionResult = {
      canonicalPath: "src/index.ts",
      symbols: [],
      imports: [],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    };

    expect(isExtractionResult(result)).toBe(true);
    expect(isExtractionResult(null)).toBe(false);
    expect(isExtractionResult({})).toBe(false);
    expect(isExtractionResult({ canonicalPath: "a.ts" })).toBe(false);
  });
});
