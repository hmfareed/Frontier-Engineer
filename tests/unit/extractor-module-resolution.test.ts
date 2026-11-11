import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTsConfig,
  resolveModuleSpecifier,
} from "../../scripts/extractor/module-resolver.ts";

describe("extractor-module-resolution (TypeScript Module Resolution Logic)", () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "fe-mod-res-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("1. resolves relative path with explicit extension", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "helpers.ts"), "export const x = 1;");
    fs.writeFileSync(path.join(tmpWorkspace, "src", "main.ts"), "import './helpers.ts';");

    const result = resolveModuleSpecifier("./helpers.ts", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/helpers.ts");
    expect(result.isExternal).toBe(false);
  });

  it("2. resolves relative path with extension probing (.ts, .tsx, .js)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "button.tsx"), "export const Button = () => null;");
    fs.writeFileSync(path.join(tmpWorkspace, "src", "util.ts"), "export const u = 1;");

    const res1 = resolveModuleSpecifier("./button", "src/main.ts", tmpWorkspace);
    expect(res1.status).toBe("resolved");
    expect(res1.resolvedCanonicalPath).toBe("src/button.tsx");

    const res2 = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(res2.status).toBe("resolved");
    expect(res2.resolvedCanonicalPath).toBe("src/util.ts");
  });

  it("3. resolves TypeScript .js import to .ts source file", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "calc.ts"), "export const add = () => {};");

    // Standard TS ESM pattern: import './calc.js' resolving to on-disk calc.ts
    const result = resolveModuleSpecifier("./calc.js", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/calc.ts");
  });

  it("4. resolves directory index probing (index.ts, index.tsx)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src", "components"), { recursive: true });
    fs.writeFileSync(path.join(tmpWorkspace, "src", "components", "index.ts"), "export * from './button';");

    const result = resolveModuleSpecifier("./components", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/components/index.ts");
  });

  it("5. resolves path mapping from tsconfig.json paths (@/* -> src/*)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src", "core"), { recursive: true });
    fs.writeFileSync(path.join(tmpWorkspace, "src", "core", "config.ts"), "export const env = 'dev';");

    const tsconfig = {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
    };

    const result = resolveModuleSpecifier("@/core/config", "src/main.ts", tmpWorkspace, tsconfig);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/core/config.ts");
  });

  it("6. resolves package.json main/exports in local workspace packages", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "shared", "package.json"),
      JSON.stringify({ name: "@fe/shared", main: "src/index.ts" }),
    );
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "shared", "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "packages", "shared", "src", "index.ts"), "export const v = 1;");

    const result = resolveModuleSpecifier("../packages/shared", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("packages/shared/src/index.ts");
  });

  it("7. classifies built-in and external modules as unresolved / external", () => {
    const nodeRes = resolveModuleSpecifier("node:fs", "src/main.ts", tmpWorkspace);
    expect(nodeRes.status).toBe("unresolved");
    expect(nodeRes.resolvedCanonicalPath).toBe(null);
    expect(nodeRes.isExternal).toBe(true);
    expect(nodeRes.classification).toBe("external_or_missing");

    const reactRes = resolveModuleSpecifier("react", "src/main.ts", tmpWorkspace);
    expect(reactRes.status).toBe("unresolved");
    expect(reactRes.resolvedCanonicalPath).toBe(null);
    expect(reactRes.isExternal).toBe(true);

    const missingRes = resolveModuleSpecifier("./nonexistent.ts", "src/main.ts", tmpWorkspace);
    expect(missingRes.status).toBe("unresolved");
    expect(missingRes.resolvedCanonicalPath).toBe(null);
  });
});
