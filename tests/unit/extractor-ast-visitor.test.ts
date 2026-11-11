import { describe, expect, it } from "vitest";
import { loadParser } from "../../scripts/extractor/parser-loader.ts";
import { visitSourceFile } from "../../scripts/extractor/ast-visitor.ts";

describe("extractor-ast-visitor (AST Node Classification & Declaration Semantics)", () => {
  it("1. extracts function, class, and method declarations correctly", async () => {
    const parser = await loadParser();
    const code = `
      export function greet(name: string): string {
        return "Hello " + name;
      }

      export class UserService {
        findUser(id: string) {
          return { id };
        }
      }
    `;

    const sf = parser.createSourceFile("src/service.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/service.ts", parser);

    const greet = findings.symbols.find((s) => s.name === "greet");
    expect(greet).toBeDefined();
    expect(greet?.kind).toBe("function");
    expect(greet?.isExported).toBe(true);

    const userService = findings.symbols.find((s) => s.name === "UserService");
    expect(userService).toBeDefined();
    expect(userService?.kind).toBe("class");
    expect(userService?.isExported).toBe(true);

    const findUser = findings.symbols.find((s) => s.name === "findUser");
    expect(findUser).toBeDefined();
    expect(findUser?.kind).toBe("method");
    expect(findUser?.parentScope).toBe("UserService");
  });

  it("2. distinguishes variable declarations with arrow functions from standalone functions", async () => {
    const parser = await loadParser();
    const code = `
      export const calculateDiscount = (price: number) => price * 0.1;
      export const MAX_RETRY_COUNT = 5;
    `;

    const sf = parser.createSourceFile("src/calc.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/calc.ts", parser);

    const calc = findings.symbols.find((s) => s.name === "calculateDiscount");
    expect(calc).toBeDefined();
    expect(calc?.kind).toBe("variable");
    expect(calc?.metadata?.inferredCallable).toBe(true);

    const count = findings.symbols.find((s) => s.name === "MAX_RETRY_COUNT");
    expect(count).toBeDefined();
    expect(count?.kind).toBe("variable");
    expect(count?.metadata?.inferredCallable).toBe(false);
  });

  it("3. extracts interface, type alias, and enum declarations", async () => {
    const parser = await loadParser();
    const code = `
      export interface UserProfile {
        name: string;
      }
      export type UserId = string | number;
      export enum UserRole {
        ADMIN = "admin",
        USER = "user",
      }
    `;

    const sf = parser.createSourceFile("src/types.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/types.ts", parser);

    expect(findings.symbols.some((s) => s.name === "UserProfile" && s.kind === "interface")).toBe(
      true,
    );
    expect(findings.symbols.some((s) => s.name === "UserId" && s.kind === "type_alias")).toBe(true);
    expect(findings.symbols.some((s) => s.name === "UserRole" && s.kind === "enum")).toBe(true);
  });

  it("4. handles export / re-export patterns without creating fake local symbols for re-exports", async () => {
    const parser = await loadParser();
    const code = `
      export { internalHelper } from "./helpers.ts";
      export * from "./constants.ts";
      const localValue = 42;
      export { localValue };
    `;

    const sf = parser.createSourceFile("src/index.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/index.ts", parser);

    // internalHelper is re-exported from "./helpers.ts", so it should NOT be in symbols
    expect(findings.symbols.some((s) => s.name === "internalHelper")).toBe(false);

    // exports array should capture the re-export
    const reexport = findings.exports.find((e) => e.name === "internalHelper");
    expect(reexport).toBeDefined();
    expect(reexport?.isReExport).toBe(true);
    expect(reexport?.sourceModule).toBe("./helpers.ts");

    // wildcard re-export
    const wildcard = findings.exports.find((e) => e.sourceModule === "./constants.ts");
    expect(wildcard?.isWildcard).toBe(true);
  });

  it("5. classifies React components with appropriate confidence heuristic", async () => {
    const parser = await loadParser();
    const code = `
      import React from "react";

      // PascalCase returning JSX -> heuristic confidence 0.8
      export function UserCard() {
        return <div>User</div>;
      }

      // Explicitly typed as React.FC -> confidence 1.0
      export const ProfileBadge: React.FC = () => {
        return <span>Badge</span>;
      };
    `;

    const sf = parser.createSourceFile(
      "src/components.tsx",
      code,
      parser.ScriptTarget.Latest,
      true,
    );
    const findings = visitSourceFile(sf, "src/components.tsx", parser);

    const userCard = findings.symbols.find((s) => s.name === "UserCard");
    expect(userCard).toBeDefined();
    expect(userCard?.metadata?.isReactComponent).toBe(true);
    expect(userCard?.metadata?.reactComponentConfidence).toBe(0.8);
    expect(userCard?.metadata?.evidenceClassification).toBe("heuristic_jsx_return");

    const badge = findings.symbols.find((s) => s.name === "ProfileBadge");
    expect(badge).toBeDefined();
    expect(badge?.metadata?.isReactComponent).toBe(true);
    expect(badge?.metadata?.reactComponentConfidence).toBe(1.0);
    expect(badge?.metadata?.evidenceClassification).toBe("syntactic_ast");
  });

  it("6. extracts dynamic imports with status inferred", async () => {
    const parser = await loadParser();
    const code = `
      async function loadPlugin() {
        const mod = await import("./plugins/auth.ts");
        return mod;
      }
    `;

    const sf = parser.createSourceFile("src/loader.ts", code, parser.ScriptTarget.Latest, true);
    const findings = visitSourceFile(sf, "src/loader.ts", parser);

    const dynamicImport = findings.imports.find((i) => i.specifier === "./plugins/auth.ts");
    expect(dynamicImport).toBeDefined();
    expect(dynamicImport?.isDynamic).toBe(true);
    expect(dynamicImport?.evidenceClassification).toBe("dynamic_import_inferred");
  });
});
