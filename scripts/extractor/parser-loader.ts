import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
export const BUNDLE_PATH = path.join(root, "dist", "parser.bundle.js");
export const CJS_BUNDLE_PATH = path.join(root, "dist", "parser.bundle.cjs");

export interface ParserApi {
  isBundledParser: boolean;
  createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion?: any,
    setParentNodes?: boolean,
    scriptKind?: any,
  ): any;
  forEachChild<T>(node: any, cbNode: (node: any) => T | undefined): T | undefined;
  SyntaxKind: Record<string, any>;
  ScriptTarget: Record<string, any>;
  ScriptKind: Record<string, any>;
  resolveModuleName(
    moduleName: string,
    containingFile: string,
    compilerOptions: any,
    host: any,
    cache?: any,
    redirectedReference?: any,
  ): any;
  ModuleResolutionKind: Record<string, any>;
  parseJsonConfigFileContent(
    json: any,
    host: any,
    basePath: string,
    existingOptions?: any,
    configFileName?: string,
  ): any;
  readConfigFile(fileName: string, readFile: (path: string) => string | undefined): any;
  sys: any;
}

export interface LoadParserOptions {
  requireBundled?: boolean;
  bundlePath?: string;
}

let cachedParserPromise: Promise<ParserApi> | null = null;
let cachedParserSync: ParserApi | null = null;

/** Clears cached parser promise and sync instance (useful for tests simulating corrupted or missing bundles). */
export function resetParserCache(): void {
  cachedParserPromise = null;
  cachedParserSync = null;
}

/**
 * Synchronously loads the parser API. Uses dist/parser.bundle.cjs if available,
 * or dev typescript fallback.
 */
export function loadParserSync(): ParserApi {
  if (cachedParserSync) {
    return cachedParserSync;
  }

  if (fs.existsSync(CJS_BUNDLE_PATH)) {
    try {
      const cjsModule = require(CJS_BUNDLE_PATH);
      const parser = cjsModule.default || cjsModule;
      if (
        typeof parser.createSourceFile === "function" &&
        typeof parser.forEachChild === "function" &&
        typeof parser.resolveModuleName === "function"
      ) {
        cachedParserSync = {
          isBundledParser: true,
          createSourceFile: parser.createSourceFile,
          forEachChild: parser.forEachChild,
          SyntaxKind: parser.SyntaxKind,
          ScriptTarget: parser.ScriptTarget,
          ScriptKind: parser.ScriptKind,
          resolveModuleName: parser.resolveModuleName,
          ModuleResolutionKind: parser.ModuleResolutionKind,
          parseJsonConfigFileContent: parser.parseJsonConfigFileContent,
          readConfigFile: parser.readConfigFile,
          sys: parser.sys,
        };
        return cachedParserSync;
      }
    } catch {
      // Fall through to dev require
    }
  }

  try {
    const ts = require("typescript");
    const parser = ts.default || ts;
    if (
      typeof parser.createSourceFile === "function" &&
      typeof parser.forEachChild === "function" &&
      typeof parser.resolveModuleName === "function"
    ) {
      cachedParserSync = {
        isBundledParser: false,
        createSourceFile: parser.createSourceFile,
        forEachChild: parser.forEachChild,
        SyntaxKind: parser.SyntaxKind,
        ScriptTarget: parser.ScriptTarget,
        ScriptKind: parser.ScriptKind,
        resolveModuleName: parser.resolveModuleName,
        ModuleResolutionKind: parser.ModuleResolutionKind,
        parseJsonConfigFileContent: parser.parseJsonConfigFileContent,
        readConfigFile: parser.readConfigFile,
        sys: parser.sys,
      };
      return cachedParserSync;
    }
  } catch {
    // Ignore fallback error and throw below
  }

  throw new Error(
    "Parser runtime bundle missing and typescript module unavailable. " +
      "Ensure dist/parser.bundle.cjs is built (run: npm run build:parser) " +
      "or typescript is installed in the development environment.",
  );
}

/**
 * Loads the self-contained TypeScript parser API.
 * Prioritizes the zero-dependency bundled runtime at dist/parser.bundle.js (AC-7201).
 * If the bundled parser file is corrupted, throws an explicit, actionable error.
 * If requireBundled is false and the bundle is absent on disk, falls back to dynamic import of "typescript" in development.
 */
export function loadParser(options: LoadParserOptions = {}): Promise<ParserApi> {
  // If specific options provided, do not use static cache
  if (options.requireBundled || options.bundlePath) {
    return loadParserInternal(options);
  }

  if (cachedParserPromise) {
    return cachedParserPromise;
  }

  cachedParserPromise = loadParserInternal(options);
  return cachedParserPromise;
}

async function loadParserInternal(options: LoadParserOptions): Promise<ParserApi> {
  const targetBundlePath = options.bundlePath || BUNDLE_PATH;

  // 1. Try bundled parser in dist/parser.bundle.js (zero external dependencies)
  if (fs.existsSync(targetBundlePath)) {
    try {
      const bundleModule = await import(pathToFileURL(targetBundlePath).href);
      const parser = bundleModule.default || bundleModule;
      if (
        typeof parser.createSourceFile === "function" &&
        typeof parser.forEachChild === "function" &&
        typeof parser.resolveModuleName === "function"
      ) {
        return {
          isBundledParser: true,
          createSourceFile: parser.createSourceFile,
          forEachChild: parser.forEachChild,
          SyntaxKind: parser.SyntaxKind,
          ScriptTarget: parser.ScriptTarget,
          ScriptKind: parser.ScriptKind,
          resolveModuleName: parser.resolveModuleName,
          ModuleResolutionKind: parser.ModuleResolutionKind,
          parseJsonConfigFileContent: parser.parseJsonConfigFileContent,
          readConfigFile: parser.readConfigFile,
          sys: parser.sys,
        };
      } else {
        throw new Error(
          "Bundled parser module at " +
            targetBundlePath +
            " does not export expected TypeScript compiler functions.",
        );
      }
    } catch (bundleErr: any) {
      // If bundle file is present but failed to load, throw actionable error rather than silently masking failure
      throw new Error(
        `Failed to initialize bundled parser at ${targetBundlePath}: ${bundleErr?.message || String(bundleErr)}. ` +
          `Run: npm run build:parser to regenerate the bundle.`,
      );
    }
  }

  // If requireBundled was explicitly requested and file does not exist, fail immediately
  if (options.requireBundled) {
    throw new Error(
      `Bundled parser required but ${targetBundlePath} does not exist. ` +
        `Run: npm run build:parser to build the standalone bundle.`,
    );
  }

  // 2. Development fallback: try loading typescript directly
  try {
    // @ts-ignore dynamic import for dev environment
    const ts = await import("typescript");
    const parser = ts.default || ts;
    if (
      typeof parser.createSourceFile === "function" &&
      typeof parser.forEachChild === "function" &&
      typeof parser.resolveModuleName === "function"
    ) {
      return {
        isBundledParser: false,
        createSourceFile: parser.createSourceFile,
        forEachChild: parser.forEachChild,
        SyntaxKind: parser.SyntaxKind,
        ScriptTarget: parser.ScriptTarget,
        ScriptKind: parser.ScriptKind,
        resolveModuleName: parser.resolveModuleName,
        ModuleResolutionKind: parser.ModuleResolutionKind,
        parseJsonConfigFileContent: parser.parseJsonConfigFileContent,
        readConfigFile: parser.readConfigFile,
        sys: parser.sys,
      };
    }
  } catch {
    // Ignore fallback error and throw consolidated error below
  }

  throw new Error(
    "Parser runtime bundle missing and typescript module unavailable. " +
      "Ensure dist/parser.bundle.js is built (run: npm run build:parser) " +
      "or typescript is installed in the development environment.",
  );
}
