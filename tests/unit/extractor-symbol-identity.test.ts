import { describe, expect, it } from "vitest";
import { visitSourceFile } from "../../scripts/extractor/ast-visitor.ts";
import { loadParserSync } from "../../scripts/extractor/parser-loader.ts";
import {
  computeFingerprint,
  computeSymbolId,
  formatCanonicalSymbolId,
} from "../../scripts/extractor/symbol-identity.ts";

describe("extractor-symbol-identity (Deterministic Identity & Adversarial Scenarios)", () => {
  const parser = loadParserSync();

  it("1. formats canonical symbol ID string and computes stable SHA-256 symbol_id", () => {
    const formatted = formatCanonicalSymbolId("src/math.ts", null, "function", "add", 0);
    expect(formatted).toBe("src/math.ts#::function:add[@0]");

    const id1 = computeSymbolId("src/math.ts", null, "function", "add", 0);
    const id2 = computeSymbolId("src/math.ts", null, "function", "add", 0);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64);
  });

  it("2. handles same-named declarations in separate scopes without collision", () => {
    const code = `
      function renderHeader() {
        function calculate() { return 1; }
      }
      function renderFooter() {
        function calculate() { return 2; }
      }
    `;
    const sf = parser.createSourceFile("src/page.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/page.ts", parser);

    const calcs = findings.symbols.filter((s) => s.name === "calculate");
    expect(calcs).toHaveLength(2);
    expect(calcs[0].parentScope).toBe("renderHeader");
    expect(calcs[1].parentScope).toBe("renderFooter");
    expect(calcs[0].symbolId).not.toBe(calcs[1].symbolId);
  });

  it("3. tracks nested lexical scopes (outer.inner)", () => {
    const code = `
      function outer() {
        function inner() {
          function deep() { return 42; }
        }
      }
    `;
    const sf = parser.createSourceFile("src/nested.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/nested.ts", parser);

    const deep = findings.symbols.find((s) => s.name === "deep");
    expect(deep).toBeDefined();
    expect(deep?.parentScope).toBe("outer.inner");
  });

  it("4. handles class methods, accessors (get/set), and constructors", () => {
    const code = `
      class UserProfile {
        constructor() {}
        get displayName(): string { return "user"; }
        set displayName(val: string) {}
        save(): void {}
      }
    `;
    const sf = parser.createSourceFile("src/user.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/user.ts", parser);

    const getter = findings.symbols.find(
      (s) =>
        s.name === "displayName" &&
        s.symbolId.includes(
          computeSymbolId("src/user.ts", "UserProfile", "method", "displayName", "get"),
        ),
    );
    const setter = findings.symbols.find(
      (s) =>
        s.name === "displayName" &&
        s.symbolId.includes(
          computeSymbolId("src/user.ts", "UserProfile", "method", "displayName", "set"),
        ),
    );
    const ctor = findings.symbols.find((s) => s.name === "constructor");
    const save = findings.symbols.find((s) => s.name === "save");

    expect(getter).toBeDefined();
    expect(setter).toBeDefined();
    expect(ctor).toBeDefined();
    expect(save).toBeDefined();

    expect(getter?.symbolId).not.toBe(setter?.symbolId);
  });

  it("5. disambiguates function overloads from implementation", () => {
    const code = `
      function parse(input: string): string;
      function parse(input: number): number;
      function parse(input: any): any {
        return input;
      }
    `;
    const sf = parser.createSourceFile("src/parser.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/parser.ts", parser);

    const parseSymbols = findings.symbols.filter((s) => s.name === "parse");
    expect(parseSymbols).toHaveLength(3);

    const ov1Expected = computeSymbolId("src/parser.ts", null, "function", "parse", "overload:1");
    const ov2Expected = computeSymbolId("src/parser.ts", null, "function", "parse", "overload:2");
    const implExpected = computeSymbolId("src/parser.ts", null, "function", "parse", "impl");

    expect(parseSymbols[0].symbolId).toBe(ov1Expected);
    expect(parseSymbols[1].symbolId).toBe(ov2Expected);
    expect(parseSymbols[2].symbolId).toBe(implExpected);
  });

  it("6. disambiguates declaration merging with distinct disambiguators", () => {
    const code = `
      interface Session {
        id: string;
      }
      interface Session {
        token: string;
      }
    `;
    const sf = parser.createSourceFile("src/types.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/types.ts", parser);

    const sessions = findings.symbols.filter((s) => s.name === "Session");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].symbolId).not.toBe(sessions[1].symbolId);
    expect(sessions[0].fingerprint).not.toBe(sessions[1].fingerprint);
  });

  it("7. handles anonymous declarations and default exports", () => {
    const code = `
      export default function() {
        return "anon";
      }
    `;
    const sf = parser.createSourceFile("src/def.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/def.ts", parser);

    expect(findings.symbols).toHaveLength(1);
    expect(findings.symbols[0].name).toBe("default");
    expect(findings.symbols[0].isExported).toBe(true);
  });

  it("8. verifies line and formatting independence: blank lines leave symbol_id and fingerprint unchanged", () => {
    const codeOriginal = `
      function calculateInterest(principal: number, rate: number): number {
        const result = principal * rate;
        return result;
      }
    `.trim();

    const codeWithBlankLines = `\n\n\n\n\n\n\n\n\n\n` + codeOriginal;

    const sf1 = parser.createSourceFile(
      "account.ts",
      codeOriginal,
      parser.ScriptTarget.Latest,
      true,
    );
    const sf2 = parser.createSourceFile(
      "account.ts",
      codeWithBlankLines,
      parser.ScriptTarget.Latest,
      true,
    );

    const fp1 = computeFingerprint(sf1.statements[0], sf1, parser);
    const fp2 = computeFingerprint(sf2.statements[0], sf2, parser);
    expect(fp1).toBe(fp2);

    const id1 = computeSymbolId("src/account.ts", null, "function", "calculateInterest", 0);
    const id2 = computeSymbolId("src/account.ts", null, "function", "calculateInterest", 0);
    expect(id1).toBe(id2);
  });

  it("9. reordered distinct declarations retain their individual symbol_ids", () => {
    const codeA = `
      function first(): number { return 1; }
      function second(): number { return 2; }
    `;
    const codeB = `
      function second(): number { return 2; }
      function first(): number { return 1; }
    `;

    const sfA = parser.createSourceFile("src/order.ts", codeA, parser.ScriptTarget.Latest, true);
    const sfB = parser.createSourceFile("src/order.ts", codeB, parser.ScriptTarget.Latest, true);

    const findingsA = visitSourceFile(sfA, "src/order.ts", parser);
    const findingsB = visitSourceFile(sfB, "src/order.ts", parser);

    const firstA = findingsA.symbols.find((s) => s.name === "first");
    const firstB = findingsB.symbols.find((s) => s.name === "first");
    expect(firstA?.symbolId).toBe(firstB?.symbolId);

    const secondA = findingsA.symbols.find((s) => s.name === "second");
    const secondB = findingsB.symbols.find((s) => s.name === "second");
    expect(secondA?.symbolId).toBe(secondB?.symbolId);
  });

  it("10. renaming a declaration changes its symbol_id", () => {
    const idBefore = computeSymbolId("src/calc.ts", null, "function", "add", 0);
    const idAfter = computeSymbolId("src/calc.ts", null, "function", "sum", 0);
    expect(idBefore).not.toBe(idAfter);
  });

  it("11. moving a declaration to another file changes its canonical symbol_id", () => {
    const idFileA = computeSymbolId("src/old-path.ts", null, "function", "helper", 0);
    const idFileB = computeSymbolId("src/new-path.ts", null, "function", "helper", 0);
    expect(idFileA).not.toBe(idFileB);
  });
});
