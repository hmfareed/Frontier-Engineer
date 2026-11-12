import { describe, expect, it } from "vitest";
import { visitSourceFile } from "../../scripts/extractor/ast-visitor.ts";
import { loadParserSync } from "../../scripts/extractor/parser-loader.ts";

describe("extractor-evidence (Source Evidence & Confidence Contracts)", () => {
  const parser = loadParserSync();

  it("1. extracts exact line and column ranges with valid evidence hash", () => {
    const code = `
function greet(name: string): string {
  return "hello " + name;
}
    `.trim();

    const sf = parser.createSourceFile("src/greet.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/greet.ts", parser);

    expect(findings.symbols).toHaveLength(1);
    const sym = findings.symbols[0];
    const ev = sym.sourceEvidence;

    expect(ev.lineStart).toBe(1);
    expect(ev.colStart).toBe(1);
    expect(ev.lineEnd).toBe(3);
    expect(ev.colEnd).toBe(2);
    expect(ev.evidenceHash).toHaveLength(64);
  });

  it("2. includes decorators and modifiers in declaration source range", () => {
    const code = `@logged\nexport class AccountService {}`;
    const sf = parser.createSourceFile("src/service.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/service.ts", parser);

    const cls = findings.symbols.find((s) => s.name === "AccountService");
    expect(cls).toBeDefined();
    expect(cls?.sourceEvidence.lineStart).toBe(1);
    expect(cls?.sourceEvidence.colStart).toBe(1);
    expect(cls?.isExported).toBe(true);
  });

  it("3. provides distinct verifiable source evidence for each overload and implementation", () => {
    const code = `
function format(val: string): string;
function format(val: number): string;
function format(val: any): string {
  return String(val);
}
    `.trim();

    const sf = parser.createSourceFile("src/format.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/format.ts", parser);

    expect(findings.symbols).toHaveLength(3);
    const [ov1, ov2, impl] = findings.symbols;

    expect(ov1.sourceEvidence.lineStart).toBe(1);
    expect(ov1.sourceEvidence.lineEnd).toBe(1);

    expect(ov2.sourceEvidence.lineStart).toBe(2);
    expect(ov2.sourceEvidence.lineEnd).toBe(2);

    expect(impl.sourceEvidence.lineStart).toBe(3);
    expect(impl.sourceEvidence.lineEnd).toBe(5);

    expect(ov1.sourceEvidence.evidenceHash).not.toBe(ov2.sourceEvidence.evidenceHash);
    expect(ov2.sourceEvidence.evidenceHash).not.toBe(impl.sourceEvidence.evidenceHash);
  });

  it("4. provides source evidence for re-exports and dynamic imports", () => {
    const code = `
export { alpha, beta } from "./other";
export * from "./wildcard";
const mod = import("./dynamic-module");
    `.trim();

    const sf = parser.createSourceFile("src/reexport.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/reexport.ts", parser);

    // Named re-exports
    const namedReExports = findings.exports.filter((e) => e.isReExport && !e.isWildcard);
    expect(namedReExports).toHaveLength(2);
    expect(namedReExports[0].sourceEvidence?.lineStart).toBe(1);
    expect(namedReExports[1].sourceEvidence?.lineStart).toBe(1);

    // Wildcard re-export
    const wildcardExport = findings.exports.find((e) => e.isWildcard);
    expect(wildcardExport).toBeDefined();
    expect(wildcardExport?.sourceEvidence?.lineStart).toBe(2);

    // Dynamic import
    const dynImport = findings.imports.find((i) => i.isDynamic);
    expect(dynImport).toBeDefined();
    expect(dynImport?.evidenceClassification).toBe("dynamic_import_inferred");
    expect(dynImport?.sourceEvidence?.lineStart).toBe(3);
  });

  it("5. strictly separates syntactic React typing (1.0) from heuristic JSX return (0.8)", () => {
    const code = `
import React from 'react';

// Explicit type annotation -> syntactic AST evidence (confidence 1.0)
export const TypedComp: React.FC = () => <div>Typed</div>;

// Inferred from PascalCase and JSX return -> heuristic evidence (confidence 0.8)
export function HeuristicComp() {
  return <span>Heuristic</span>;
}

// Ordinary function -> not a React component
export function standardHelper() {
  return "just a string";
}
    `.trim();

    const sf = parser.createSourceFile(
      "src/components.tsx",
      code,
      parser.ScriptTarget.Latest,
      true,
      parser.ScriptKind.TSX,
    );
    const findings = visitSourceFile(sf, "src/components.tsx", parser);

    const typed = findings.symbols.find((s) => s.name === "TypedComp");
    expect(typed).toBeDefined();
    expect(typed?.metadata?.isReactComponent).toBe(true);
    expect(typed?.metadata?.reactComponentConfidence).toBe(1.0);
    expect(typed?.metadata?.evidenceClassification).toBe("syntactic_ast");

    const heuristic = findings.symbols.find((s) => s.name === "HeuristicComp");
    expect(heuristic).toBeDefined();
    expect(heuristic?.metadata?.isReactComponent).toBe(true);
    expect(heuristic?.metadata?.reactComponentConfidence).toBe(0.8);
    expect(heuristic?.metadata?.evidenceClassification).toBe("heuristic_jsx_return");
    // Ensure heuristic is NEVER marked as syntactic_ast
    expect(heuristic?.metadata?.evidenceClassification).not.toBe("syntactic_ast");

    const helper = findings.symbols.find((s) => s.name === "standardHelper");
    expect(helper).toBeDefined();
    expect(helper?.metadata?.isReactComponent).toBeUndefined();
  });

  it("6. extracts anonymous/default export declarations with source evidence", () => {
    const code = `
export default class {
  render() { return 1; }
}
    `.trim();

    const sf = parser.createSourceFile("src/anon.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/anon.ts", parser);

    const defCls = findings.symbols.find((s) => s.name === "default" && s.kind === "class");
    expect(defCls).toBeDefined();
    expect(defCls?.sourceEvidence.lineStart).toBe(1);
    expect(defCls?.sourceEvidence.lineEnd).toBe(3);
  });
});
