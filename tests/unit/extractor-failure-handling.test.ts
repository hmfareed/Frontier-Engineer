import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractFileSymbols } from "../../scripts/extractor/index.ts";

describe("extractor-failure-handling (Failure Modes & Security Hardening)", () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "fe-fail-sec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("1. handles empty source files cleanly as SUCCESS with zero symbols", async () => {
    const result = await extractFileSymbols("src/empty.ts", "");
    expect(result.status).toBe("SUCCESS");
    expect(result.symbols).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);

    const whitespaceResult = await extractFileSymbols("src/whitespace.ts", "   \n\n\t  ");
    expect(whitespaceResult.status).toBe("SUCCESS");
    expect(whitespaceResult.symbols).toHaveLength(0);
  });

  it("2. handles very large source files efficiently without memory exhaustion", async () => {
    // Generate 500 functions in a single source file
    const stmts: string[] = [];
    for (let i = 0; i < 500; i++) {
      stmts.push(`export function func_${i}(arg: number): number { return arg + ${i}; }`);
    }
    const largeContent = stmts.join("\n");

    const startTime = Date.now();
    const result = await extractFileSymbols("src/large.ts", largeContent);
    const durationMs = Date.now() - startTime;

    expect(result.status).toBe("SUCCESS");
    expect(result.symbols).toHaveLength(500);
    expect(durationMs).toBeLessThan(5000); // Must complete well within 5 seconds
  });

  it("3. distinguishes malformed syntax as PARTIAL with non-secret diagnostics", async () => {
    const malformedContent = `
      function good(): string { return "ok"; }
      function broken( { let x = ;
      function anotherGood(): number { return 1; }
    `;

    const result = await extractFileSymbols("src/malformed.ts", malformedContent);
    expect(result.status).toBe("PARTIAL");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // Extracted symbols from valid AST portions should still be preserved
    const good = result.symbols.find((s) => s.name === "good");
    expect(good).toBeDefined();
  });

  it("4. rejects invalid and out-of-repository canonical paths with FAILED status", async () => {
    // Parent traversal
    const res1 = await extractFileSymbols("../outside.ts", "const x = 1;");
    expect(res1.status).toBe("FAILED");
    expect(res1.diagnostics[0].message).toContain("Invalid canonical path");

    // Windows absolute path
    const res2 = await extractFileSymbols("C:/repo/src/file.ts", "const x = 1;");
    expect(res2.status).toBe("FAILED");

    // Unix absolute path
    const res3 = await extractFileSymbols("/etc/passwd", "const x = 1;");
    expect(res3.status).toBe("FAILED");
  });

  it("5. handles circular imports between files cleanly without infinite recursion", async () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));

    const contentA = `
      import { b } from "./modB.js";
      export const a = 1;
    `;
    const contentB = `
      import { a } from "./modA.js";
      export const b = 2;
    `;

    fs.writeFileSync(path.join(tmpWorkspace, "src", "modA.ts"), contentA);
    fs.writeFileSync(path.join(tmpWorkspace, "src", "modB.ts"), contentB);

    const resA = await extractFileSymbols("src/modA.ts", contentA, {
      workspaceRoot: tmpWorkspace,
    });
    expect(resA.status).toBe("SUCCESS");
    expect(resA.imports[0].resolvedPath).toBe("src/modB.ts");

    const resB = await extractFileSymbols("src/modB.ts", contentB, {
      workspaceRoot: tmpWorkspace,
    });
    expect(resB.status).toBe("SUCCESS");
    expect(resB.imports[0].resolvedPath).toBe("src/modA.ts");
  });

  it("6. marks missing imports cleanly as unresolved with external_or_missing classification", async () => {
    const content = `import { nonexistent } from "./does-not-exist";`;
    const result = await extractFileSymbols("src/main.ts", content, {
      workspaceRoot: tmpWorkspace,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].resolvedPath).toBe(null);
    expect(result.imports[0].evidenceClassification).toBe("external_or_missing");
  });

  it("7. redacts secrets and credentials so diagnostics never leak secret values", async () => {
    // Malformed syntax near a GitHub PAT token
    const sensitiveBrokenContent = `
      const token = "ghp_123456789012345678901234567890123456";
      function broken( {
    `;

    const result = await extractFileSymbols("src/secret.ts", sensitiveBrokenContent);
    expect(result.status).toBe("PARTIAL");

    for (const diag of result.diagnostics) {
      expect(diag.message).not.toContain("ghp_123456789012345678901234567890123456");
    }
  });

  it("8. honors cancellation token by terminating with FAILED status", async () => {
    const token = { isCancellationRequested: true };
    const result = await extractFileSymbols("src/cancelled.ts", "const a = 1;", {
      cancellationToken: token,
    });

    expect(result.status).toBe("FAILED");
    expect(result.diagnostics[0].message).toContain("cancelled");
  });
});
