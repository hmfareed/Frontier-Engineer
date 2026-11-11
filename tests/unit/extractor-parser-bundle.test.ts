import { describe, expect, it } from "vitest";
import { loadParser } from "../../scripts/extractor/parser-loader.ts";

describe("extractor-parser-bundle (Bundled TypeScript Parser API)", () => {
  it("loads parser API and parses TypeScript source into an AST", async () => {
    const parser = await loadParser();

    expect(parser).toBeDefined();
    expect(typeof parser.createSourceFile).toBe("function");
    expect(typeof parser.forEachChild).toBe("function");
    expect(parser.SyntaxKind).toBeDefined();
    expect(parser.ScriptTarget).toBeDefined();

    const code = "export function greet(name: string): string { return `Hello, ${name}`; }";
    const sf = parser.createSourceFile("test.ts", code, parser.ScriptTarget.Latest, true);

    expect(sf).toBeDefined();
    expect(sf.fileName).toBe("test.ts");
    expect(sf.statements.length).toBe(1);
    expect(sf.statements[0].kind).toBe(parser.SyntaxKind.FunctionDeclaration);
  });
});
