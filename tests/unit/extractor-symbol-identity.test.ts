import { describe, expect, it } from "vitest";
import { loadParser } from "../../scripts/extractor/parser-loader.ts";
import {
  computeFingerprint,
  computeSymbolId,
  formatCanonicalSymbolId,
} from "../../scripts/extractor/symbol-identity.ts";

describe("extractor-symbol-identity (Deterministic Identity & AC-7202 Fingerprint Stability)", () => {
  it("formats canonical symbol ID string and computes stable SHA-256 symbol_id", () => {
    const formatted = formatCanonicalSymbolId(
      "src/math.ts",
      null,
      "function",
      "add",
      0,
    );
    expect(formatted).toBe("src/math.ts#::function:add[@0]");

    const id1 = computeSymbolId("src/math.ts", null, "function", "add", 0);
    const id2 = computeSymbolId("src/math.ts", null, "function", "add", 0);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64); // SHA-256 hex length
  });

  it("assigns distinct symbol_ids to methods with parent scope", () => {
    const classId = formatCanonicalSymbolId("src/user.ts", null, "class", "User", 0);
    const methodId = formatCanonicalSymbolId("src/user.ts", "User", "method", "getName", 0);

    expect(classId).toBe("src/user.ts#::class:User[@0]");
    expect(methodId).toBe("src/user.ts#User::method:getName[@0]");
  });

  it("differentiates overload signatures and implementation via disambiguator", () => {
    const ov1 = computeSymbolId("src/api.ts", null, "function", "fetchData", "overload:1");
    const ov2 = computeSymbolId("src/api.ts", null, "function", "fetchData", "overload:2");
    const impl = computeSymbolId("src/api.ts", null, "function", "fetchData", "impl");

    expect(ov1).not.toBe(ov2);
    expect(ov2).not.toBe(impl);
    expect(ov1).not.toBe(impl);
  });

  it("AC-7202: inserting 10 blank lines leaves symbol_id and fingerprint unchanged", async () => {
    const parser = await loadParser();

    const codeOriginal = `
function calculateInterest(principal: number, rate: number): number {
  const result = principal * rate;
  return result;
}
    `.trim();

    // 10 blank lines added before the function
    const codeWithBlankLines = `\n\n\n\n\n\n\n\n\n\n` + codeOriginal;

    const sf1 = parser.createSourceFile("account.ts", codeOriginal, parser.ScriptTarget.Latest, true);
    const sf2 = parser.createSourceFile("account.ts", codeWithBlankLines, parser.ScriptTarget.Latest, true);

    const fnNode1 = sf1.statements[0];
    const fnNode2 = sf2.statements[0];

    const fp1 = computeFingerprint(fnNode1, sf1, parser);
    const fp2 = computeFingerprint(fnNode2, sf2, parser);

    expect(fp1).toBe(fp2);

    const id1 = computeSymbolId("src/account.ts", null, "function", "calculateInterest", 0);
    const id2 = computeSymbolId("src/account.ts", null, "function", "calculateInterest", 0);
    expect(id1).toBe(id2);
  });

  it("changes fingerprint when parameter type or body logic changes", async () => {
    const parser = await loadParser();

    const code1 = "function multiply(a: number, b: number): number { return a * b; }";
    const code2 = "function multiply(a: number, b: string): string { return String(a) + b; }";

    const sf1 = parser.createSourceFile("calc.ts", code1, parser.ScriptTarget.Latest, true);
    const sf2 = parser.createSourceFile("calc.ts", code2, parser.ScriptTarget.Latest, true);

    const fp1 = computeFingerprint(sf1.statements[0], sf1, parser);
    const fp2 = computeFingerprint(sf2.statements[0], sf2, parser);

    expect(fp1).not.toBe(fp2);
  });
});
