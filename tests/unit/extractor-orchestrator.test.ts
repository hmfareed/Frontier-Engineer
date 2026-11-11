import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractFileSymbols } from "../../scripts/extractor/index.ts";

describe("extractor-orchestrator (Public Facade & End-to-End Extraction)", () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "fe-extractor-orch-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("1. extracts complete file symbols, imports, and exports with resolved modules", async () => {
    // Scaffold workspace files
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "types.ts"),
      "export interface User { id: string; }",
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "userService.ts"),
      `
      import type { User } from "./types.ts";
      import { existsSync } from "node:fs";

      export class UserService {
        getUser(id: string): User {
          return { id };
        }
      }

      export const defaultUser: User = { id: "0" };
      export { User } from "./types.ts";
      `,
    );

    const content = fs.readFileSync(path.join(tmpWorkspace, "src", "userService.ts"), "utf8");
    const result = await extractFileSymbols("src/userService.ts", content, {
      workspaceRoot: tmpWorkspace,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.canonicalPath).toBe("src/userService.ts");

    // Symbols
    expect(result.symbols.length).toBeGreaterThanOrEqual(3);
    const userClass = result.symbols.find((s) => s.name === "UserService");
    expect(userClass).toBeDefined();
    expect(userClass?.kind).toBe("class");

    const getMethod = result.symbols.find((s) => s.name === "getUser");
    expect(getMethod).toBeDefined();
    expect(getMethod?.kind).toBe("method");
    expect(getMethod?.parentScope).toBe("UserService");

    const defaultVar = result.symbols.find((s) => s.name === "defaultUser");
    expect(defaultVar).toBeDefined();
    expect(defaultVar?.kind).toBe("variable");

    // Imports resolution
    const typesImport = result.imports.find((i) => i.specifier === "./types.ts");
    expect(typesImport).toBeDefined();
    expect(typesImport?.resolvedPath).toBe("src/types.ts");
    expect(typesImport?.isTypeOnly).toBe(true);

    const nodeImport = result.imports.find((i) => i.specifier === "node:fs");
    expect(nodeImport).toBeDefined();
    expect(nodeImport?.resolvedPath).toBe(null);
    expect(nodeImport?.evidenceClassification).toBe("external_or_missing");

    // Exports
    const reexport = result.exports.find((e) => e.name === "User");
    expect(reexport).toBeDefined();
    expect(reexport?.isReExport).toBe(true);
  });

  it("2. handles tsconfig path mappings during end-to-end extraction", async () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src", "utils"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "utils", "math.ts"),
      "export const add = (a: number, b: number) => a + b;",
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@utils/*": ["src/utils/*"],
          },
        },
      }),
    );

    const code = `
      import { add } from "@utils/math";
      export function sum(nums: number[]) { return nums.reduce(add, 0); }
    `;

    const result = await extractFileSymbols("src/calc.ts", code, {
      workspaceRoot: tmpWorkspace,
    });

    expect(result.status).toBe("SUCCESS");
    const mathImport = result.imports.find((i) => i.specifier === "@utils/math");
    expect(mathImport).toBeDefined();
    expect(mathImport?.resolvedPath).toBe("src/utils/math.ts");
  });

  it("3. handles syntax errors gracefully with PARTIAL or FAILED status", async () => {
    const brokenCode = `function broken( { let x = ;`;

    const result = await extractFileSymbols("src/broken.ts", brokenCode, {
      workspaceRoot: tmpWorkspace,
    });

    expect(result.canonicalPath).toBe("src/broken.ts");
    expect(result).toBeDefined();
  });
});
