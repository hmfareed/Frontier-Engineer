import { describe, expect, it } from "vitest";
import { loadParserSync } from "../../scripts/extractor/parser-loader.ts";
import { computeFingerprint } from "../../scripts/extractor/symbol-identity.ts";

describe("extractor-fingerprint (Token Fingerprinting & Fidelity Guarantees)", () => {
  const parser = loadParserSync();

  function getFirstStmt(code: string, scriptKind?: any) {
    const sf = parser.createSourceFile(
      "test.tsx",
      code,
      parser.ScriptTarget.Latest,
      true,
      scriptKind || parser.ScriptKind.TSX,
    );
    return { stmt: sf.statements[0], sf };
  }

  it("1. ignores comments, JSDoc, whitespace, and formatting changes", () => {
    const codeA = `
      function calculate(a: number, b: number): number {
        return a + b;
      }
    `.trim();

    const codeB = `
      /**
       * Calculates the sum of two numbers.
       * @param a first operand
       * @param b second operand
       */
      // inline explanation
      function calculate(
        a: number, /* operand a */
        b: number  // operand b
      ): number {
        /* block comment */
        return a + b;
      }
    `.trim();

    const { stmt: stmtA, sf: sfA } = getFirstStmt(codeA);
    const { stmt: stmtB, sf: sfB } = getFirstStmt(codeB);

    const fpA = computeFingerprint(stmtA, sfA, parser);
    const fpB = computeFingerprint(stmtB, sfB, parser);

    expect(fpA).toBe(fpB);
  });

  it("2. detects changes in string literals", () => {
    const { stmt: s1, sf: sf1 } = getFirstStmt('const greeting = "Hello";');
    const { stmt: s2, sf: sf2 } = getFirstStmt('const greeting = "World";');

    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));
  });

  it("3. detects changes in template literals (NoSubstitution and TemplateParts)", () => {
    // NoSubstitutionTemplateLiteral
    const { stmt: s1, sf: sf1 } = getFirstStmt("const msg = `alpha`;");
    const { stmt: s2, sf: sf2 } = getFirstStmt("const msg = `beta`;");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // Template with expressions
    const { stmt: s3, sf: sf3 } = getFirstStmt("const tmpl1 = `prefix ${1} suffix`;");
    const { stmt: s4, sf: sf4 } = getFirstStmt("const tmpl2 = `prefix ${1} altered`;");
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("4. detects changes in regular expression literals", () => {
    const { stmt: s1, sf: sf1 } = getFirstStmt("const regex = /^[a-z]+$/;");
    const { stmt: s2, sf: sf2 } = getFirstStmt("const regex = /^[0-9]+$/i;");

    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));
  });

  it("5. detects changes in JSX text and attributes", () => {
    // JSX text
    const { stmt: s1, sf: sf1 } = getFirstStmt("const el1 = <div>Hello World</div>;");
    const { stmt: s2, sf: sf2 } = getFirstStmt("const el2 = <div>Goodbye World</div>;");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // JSX attribute value
    const { stmt: s3, sf: sf3 } = getFirstStmt('const btn1 = <button className="btn-primary" />;');
    const { stmt: s4, sf: sf4 } = getFirstStmt('const btn2 = <button className="btn-danger" />;');
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("6. detects changes in numeric and bigint literals", () => {
    const { stmt: s1, sf: sf1 } = getFirstStmt("const n1 = 42;");
    const { stmt: s2, sf: sf2 } = getFirstStmt("const n2 = 43;");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    const { stmt: s3, sf: sf3 } = getFirstStmt("const b1 = 100n;");
    const { stmt: s4, sf: sf4 } = getFirstStmt("const b2 = 200n;");
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("7. detects changes in parameter types and return types", () => {
    // Parameter types
    const { stmt: s1, sf: sf1 } = getFirstStmt("function parse(x: number) {}");
    const { stmt: s2, sf: sf2 } = getFirstStmt("function parse(x: string) {}");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // Return types
    const { stmt: s3, sf: sf3 } = getFirstStmt("function get(): number { return 1; }");
    const { stmt: s4, sf: sf4 } = getFirstStmt("function get(): string { return '1'; }");
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("8. detects changes in generic constraints", () => {
    const { stmt: s1, sf: sf1 } = getFirstStmt("function wrap<T extends object>(val: T) {}");
    const { stmt: s2, sf: sf2 } = getFirstStmt("function wrap<T extends any[]>(val: T) {}");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));
  });

  it("9. detects changes in decorators and modifiers", () => {
    // Decorators
    const { stmt: s1, sf: sf1 } = getFirstStmt("@sealed class Service {}");
    const { stmt: s2, sf: sf2 } = getFirstStmt("@injectable class Service {}");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // Modifiers (e.g. readonly vs mutable, async vs sync)
    const { stmt: s3, sf: sf3 } = getFirstStmt("async function run() {}");
    const { stmt: s4, sf: sf4 } = getFirstStmt("function run() {}");
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("10. detects changes in initializers and function body logic", () => {
    // Initializer
    const { stmt: s1, sf: sf1 } = getFirstStmt("const timeout = 1000;");
    const { stmt: s2, sf: sf2 } = getFirstStmt("const timeout = 5000;");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // Function body logic
    const { stmt: s3, sf: sf3 } = getFirstStmt(
      "function calc(a: number, b: number) { return a + b; }",
    );
    const { stmt: s4, sf: sf4 } = getFirstStmt(
      "function calc(a: number, b: number) { return a * b; }",
    );
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });

  it("11. detects changes in import specifiers and export declarations", () => {
    // Import specifier
    const { stmt: s1, sf: sf1 } = getFirstStmt("import { x } from './alpha';");
    const { stmt: s2, sf: sf2 } = getFirstStmt("import { x } from './beta';");
    expect(computeFingerprint(s1, sf1, parser)).not.toBe(computeFingerprint(s2, sf2, parser));

    // Export declaration
    const { stmt: s3, sf: sf3 } = getFirstStmt("export { a };");
    const { stmt: s4, sf: sf4 } = getFirstStmt("export { a, b };");
    expect(computeFingerprint(s3, sf3, parser)).not.toBe(computeFingerprint(s4, sf4, parser));
  });
});
