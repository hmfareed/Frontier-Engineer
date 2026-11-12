import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTsConfig, resolveModuleSpecifier } from "../../scripts/extractor/module-resolver.ts";
import { loadParserSync } from "../../scripts/extractor/parser-loader.ts";

describe("extractor-module-resolution (TypeScript Module Resolution Logic & Compiler Parity)", () => {
  let tmpWorkspace: string;
  const parser = loadParserSync();

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "fe-mod-res-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("1. resolves relative path with explicit extension (.ts, .tsx, .d.ts)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "helpers.ts"), "export const x = 1;");
    fs.writeFileSync(path.join(tmpWorkspace, "src", "types.d.ts"), "export type ID = string;");

    const res1 = resolveModuleSpecifier("./helpers.ts", "src/main.ts", tmpWorkspace);
    expect(res1.status).toBe("resolved");
    expect(res1.resolvedCanonicalPath).toBe("src/helpers.ts");
    expect(res1.resolutionMethod).toBe("ts_resolve_module_name");
    expect(res1.isConfirmed).toBe(true);
    expect(res1.isExternal).toBe(false);

    const res2 = resolveModuleSpecifier("./types.d.ts", "src/main.ts", tmpWorkspace);
    expect(res2.status).toBe("resolved");
    expect(res2.resolvedCanonicalPath).toBe("src/types.d.ts");
  });

  it("2. resolves relative path with extension probing in Bundler mode", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "button.tsx"),
      "export const Button = () => null;",
    );
    fs.writeFileSync(path.join(tmpWorkspace, "src", "util.ts"), "export const u = 1;");

    const res1 = resolveModuleSpecifier("./button", "src/main.ts", tmpWorkspace);
    expect(res1.status).toBe("resolved");
    expect(res1.resolvedCanonicalPath).toBe("src/button.tsx");

    const res2 = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(res2.status).toBe("resolved");
    expect(res2.resolvedCanonicalPath).toBe("src/util.ts");
  });

  it("3. resolves TypeScript ESM .js import to .ts source file (NodeNext & Bundler)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "calc.ts"), "export const add = () => {};");

    const result = resolveModuleSpecifier("./calc.js", "src/main.ts", tmpWorkspace, {
      compilerOptions: { moduleResolution: parser.ModuleResolutionKind.NodeNext },
    });
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/calc.ts");
  });

  it("4. resolves directory index probing (index.ts, index.tsx)", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src", "components"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "components", "index.ts"),
      "export const Card = 1;",
    );

    const result = resolveModuleSpecifier("./components", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/components/index.ts");
  });

  it("5. resolves tsconfig.json extends and baseUrl and paths mappings", () => {
    // Create base tsconfig
    const baseConfig = {
      compilerOptions: {
        baseUrl: "./src",
        paths: {
          "@/*": ["*"],
        },
      },
    };
    fs.writeFileSync(path.join(tmpWorkspace, "tsconfig.base.json"), JSON.stringify(baseConfig));

    // Create extending tsconfig
    const appConfig = {
      extends: "./tsconfig.base.json",
      compilerOptions: {
        target: "ES2022",
      },
    };
    fs.writeFileSync(path.join(tmpWorkspace, "tsconfig.json"), JSON.stringify(appConfig));

    fs.mkdirSync(path.join(tmpWorkspace, "src", "core"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "core", "config.ts"),
      "export const env = 'dev';",
    );

    const result = resolveModuleSpecifier("@/core/config", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/core/config.ts");
  });

  it("6. resolves multiple path targets and fallback order", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src", "fallback"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "src", "fallback", "logger.ts"),
      "export const log = () => {};",
    );

    const tsconfig = {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@lib/*": ["src/custom/*", "src/fallback/*"],
        },
      },
    };

    const result = resolveModuleSpecifier("@lib/logger", "src/main.ts", tmpWorkspace, tsconfig);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("src/fallback/logger.ts");
  });

  it("7. resolves NodeNext and Node16 resolution modes with .mts, .cts, .mjs, .cjs", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"));
    fs.writeFileSync(path.join(tmpWorkspace, "src", "esm-mod.mts"), "export const esm = true;");
    fs.writeFileSync(path.join(tmpWorkspace, "src", "cjs-mod.cts"), "export const cjs = true;");

    // In NodeNext, import './esm-mod.mjs' resolves to './esm-mod.mts'
    const resNodeNext = resolveModuleSpecifier("./esm-mod.mjs", "src/main.mts", tmpWorkspace, {
      compilerOptions: { moduleResolution: parser.ModuleResolutionKind.NodeNext },
    });
    expect(resNodeNext.status).toBe("resolved");
    expect(resNodeNext.resolvedCanonicalPath).toBe("src/esm-mod.mts");

    // In Node16, import './cjs-mod.cjs' resolves to './cjs-mod.cts'
    const resNode16 = resolveModuleSpecifier("./cjs-mod.cjs", "src/main.cts", tmpWorkspace, {
      compilerOptions: { moduleResolution: parser.ModuleResolutionKind.Node16 },
    });
    expect(resNode16.status).toBe("resolved");
    expect(resNode16.resolvedCanonicalPath).toBe("src/cjs-mod.cts");
  });

  it("8. resolves conditional package exports in local packages", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "ui", "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "@fe/ui",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "ui", "dist", "index.d.ts"),
      "export const Button: any;",
    );

    const result = resolveModuleSpecifier("../packages/ui", "src/main.ts", tmpWorkspace, {
      compilerOptions: { moduleResolution: parser.ModuleResolutionKind.NodeNext },
    });
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("packages/ui/dist/index.d.ts");
  });

  it("9. resolves package types and typings fields in local packages", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "types-pkg", "types"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "types-pkg", "package.json"),
      JSON.stringify({
        name: "@fe/types-pkg",
        main: "./index.js",
        types: "./types/index.d.ts",
      }),
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "types-pkg", "types", "index.d.ts"),
      "export type Role = 'admin';",
    );

    const result = resolveModuleSpecifier("../packages/types-pkg", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("packages/types-pkg/types/index.d.ts");
  });

  it("10. resolves typesVersions field in local packages", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "tv-pkg", "ts4.0"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "tv-pkg", "package.json"),
      JSON.stringify({
        name: "@fe/tv-pkg",
        types: "./index.d.ts",
        typesVersions: {
          "*": {
            "*": ["./ts4.0/*"],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "tv-pkg", "ts4.0", "index.d.ts"),
      "export const tv = 4;",
    );

    const result = resolveModuleSpecifier("../packages/tv-pkg", "src/main.ts", tmpWorkspace);
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("packages/tv-pkg/ts4.0/index.d.ts");
  });

  it("11. resolves package self-references", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "self-ref", "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, "packages", "self-ref", "feature"));
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "self-ref", "package.json"),
      JSON.stringify({
        name: "@fe/self-ref",
        exports: {
          "./feature": {
            types: "./feature/index.d.ts",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "packages", "self-ref", "feature", "index.d.ts"),
      "export const feat = true;",
    );

    const result = resolveModuleSpecifier(
      "@fe/self-ref/feature",
      "packages/self-ref/src/index.ts",
      tmpWorkspace,
      {
        compilerOptions: { moduleResolution: parser.ModuleResolutionKind.NodeNext },
      },
    );
    expect(result.status).toBe("resolved");
    expect(result.resolvedCanonicalPath).toBe("packages/self-ref/feature/index.d.ts");
  });

  it("12. enforces workspace boundaries by rejecting imports resolving outside repository", () => {
    // Outside file
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-outside-"));
    fs.writeFileSync(path.join(outsideDir, "secret.ts"), "export const secret = 1;");

    try {
      const relToOutside = path
        .relative(path.join(tmpWorkspace, "src"), path.join(outsideDir, "secret.ts"))
        .replace(/\\/g, "/");
      const result = resolveModuleSpecifier(relToOutside, "src/main.ts", tmpWorkspace);
      expect(result.status).toBe("unresolved");
      expect(result.resolvedCanonicalPath).toBe(null);
      expect(result.isExternal).toBe(true);
      expect(result.classification).toBe("external_or_missing");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("13. distinguishes invalid JSON, invalid options, unresolvable extends, and inheritance cycles in tsconfig", () => {
    fs.mkdirSync(path.join(tmpWorkspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpWorkspace, "src", "util.ts"), "export const ok = 1;");

    // Case 1: Missing tsconfig uses documented defaults and confirms resolution
    const missingConfig = loadTsConfig(tmpWorkspace);
    expect(missingConfig.status).toBe("missing");
    expect(missingConfig.diagnostics).toHaveLength(0);
    const resMissing = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(resMissing.status).toBe("resolved");
    expect(resMissing.isConfirmed).toBe(true);

    // Case 2: Invalid JSON preserves diagnostics and marks resolution degraded / unconfirmed
    fs.writeFileSync(path.join(tmpWorkspace, "tsconfig.json"), "{ INVALID TSCONFIG ");
    const jsonErrConfig = loadTsConfig(tmpWorkspace);
    expect(jsonErrConfig.status).toBe("invalid_json");
    expect(jsonErrConfig.diagnostics.length).toBeGreaterThan(0);
    const resJsonErr = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(resJsonErr.status).toBe("degraded");
    expect(resJsonErr.isConfirmed).toBe(false);
    expect(resJsonErr.configStatus).toBe("invalid_json");

    // Case 3: Invalid compiler options preserves diagnostics
    fs.writeFileSync(
      path.join(tmpWorkspace, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleResolution: "INVALID_RESOLVER_MODE" } }),
    );
    const optErrConfig = loadTsConfig(tmpWorkspace);
    expect(optErrConfig.status).toBe("invalid_options");
    expect(optErrConfig.diagnostics.length).toBeGreaterThan(0);
    const resOptErr = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(resOptErr.status).toBe("degraded");
    expect(resOptErr.isConfirmed).toBe(false);
    expect(resOptErr.configStatus).toBe("invalid_options");

    // Case 4: Unresolvable extends reference
    fs.writeFileSync(
      path.join(tmpWorkspace, "tsconfig.json"),
      JSON.stringify({ extends: "./non-existent-base.json" }),
    );
    const unresConfig = loadTsConfig(tmpWorkspace);
    expect(unresConfig.status).toBe("unresolvable_extends");
    expect(unresConfig.diagnostics.length).toBeGreaterThan(0);
    const resUnres = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(resUnres.status).toBe("degraded");
    expect(resUnres.isConfirmed).toBe(false);
    expect(resUnres.configStatus).toBe("unresolvable_extends");

    // Case 5: Inheritance cycle
    fs.writeFileSync(
      path.join(tmpWorkspace, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.cycle.json" }),
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, "tsconfig.cycle.json"),
      JSON.stringify({ extends: "./tsconfig.json" }),
    );
    const cycleConfig = loadTsConfig(tmpWorkspace);
    expect(cycleConfig.status).toBe("inheritance_cycle");
    expect(cycleConfig.diagnostics.length).toBeGreaterThan(0);
    const resCycle = resolveModuleSpecifier("./util", "src/main.ts", tmpWorkspace);
    expect(resCycle.status).toBe("degraded");
    expect(resCycle.isConfirmed).toBe(false);
    expect(resCycle.configStatus).toBe("inheritance_cycle");
  });

  it("14. classifies built-in and external modules as unresolved / external", () => {
    const nodeRes = resolveModuleSpecifier("node:fs", "src/main.ts", tmpWorkspace);
    expect(nodeRes.status).toBe("unresolved");
    expect(nodeRes.resolvedCanonicalPath).toBe(null);
    expect(nodeRes.isExternal).toBe(true);
    expect(nodeRes.classification).toBe("external_or_missing");
    expect(nodeRes.isConfirmed).toBe(false);

    const reactRes = resolveModuleSpecifier("react", "src/main.ts", tmpWorkspace);
    expect(reactRes.status).toBe("unresolved");
    expect(reactRes.resolvedCanonicalPath).toBe(null);
    expect(reactRes.isExternal).toBe(true);

    const missingRes = resolveModuleSpecifier("./nonexistent.ts", "src/main.ts", tmpWorkspace);
    expect(missingRes.status).toBe("unresolved");
    expect(missingRes.resolvedCanonicalPath).toBe(null);
  });
});
