import fs from "node:fs";
import path from "node:path";
import { loadParserSync, type ParserApi } from "./parser-loader.ts";
import type { EvidenceClassification } from "./types.ts";

export interface TsConfigPaths {
  [pattern: string]: string[];
}

export interface TsConfigOptions {
  compilerOptions?: any;
}

export interface ModuleResolutionOptions {
  compilerOptions?: any;
  customHost?: any;
  parser?: ParserApi;
  tsconfigPath?: string;
}

export interface ModuleResolutionResult {
  specifier: string;
  originalSpecifier: string;
  importingFile: string;
  resolvedCanonicalPath: string | null;
  status: "resolved" | "unresolved";
  resolutionMethod: "ts_resolve_module_name";
  classification: EvidenceClassification;
  isConfirmed: boolean;
  isExternal: boolean;
}

const NODE_BUILTINS = new Set<string>([
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "test",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * Loads and parses tsconfig.json from workspace root or specified custom path.
 * Uses bundled TypeScript compiler config parser to correctly resolve 'extends',
 * baseUrl, paths, and compiler options.
 */
export function loadTsConfig(
  workspaceRoot: string,
  customPath?: string,
  parser?: ParserApi,
): any | undefined {
  const normRoot = path.resolve(workspaceRoot);
  const tsconfigPath = customPath
    ? path.resolve(normRoot, customPath)
    : path.join(normRoot, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return undefined;
  }

  try {
    const p = parser || loadParserSync();
    const configFile = p.readConfigFile(tsconfigPath, (filePath: string) => {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    });

    if (configFile.error || !configFile.config) {
      return undefined;
    }

    const parseConfigHost = {
      useCaseSensitiveFileNames: process.platform !== "win32",
      readDirectory: () => [],
      fileExists: (filePath: string) => {
        try {
          return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        } catch {
          return false;
        }
      },
      readFile: (filePath: string) => {
        try {
          return fs.readFileSync(filePath, "utf8");
        } catch {
          return undefined;
        }
      },
    };

    const parsed = p.parseJsonConfigFileContent(
      configFile.config,
      parseConfigHost,
      path.dirname(tsconfigPath),
      {},
      tsconfigPath,
    );

    return parsed.options || {};
  } catch {
    return undefined;
  }
}

/**
 * Creates a standard TypeScript ModuleResolutionHost bounded to the workspace filesystem.
 */
export function createModuleResolutionHost(workspaceRoot: string, customHost?: any): any {
  if (customHost) return customHost;

  const normRoot = path.resolve(workspaceRoot);

  return {
    fileExists(fileName: string): boolean {
      try {
        return fs.existsSync(fileName) && fs.statSync(fileName).isFile();
      } catch {
        return false;
      }
    },
    readFile(fileName: string): string | undefined {
      try {
        return fs.readFileSync(fileName, "utf8");
      } catch {
        return undefined;
      }
    },
    directoryExists(directoryName: string): boolean {
      try {
        return fs.existsSync(directoryName) && fs.statSync(directoryName).isDirectory();
      } catch {
        return false;
      }
    },
    realpath(filePath: string): string {
      try {
        return fs.realpathSync(filePath);
      } catch {
        return filePath;
      }
    },
    getCurrentDirectory(): string {
      return normRoot;
    },
    getDirectories(dirPath: string): string[] {
      try {
        return fs
          .readdirSync(dirPath, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        return [];
      }
    },
    useCaseSensitiveFileNames: process.platform !== "win32",
  };
}

/**
 * Resolves an import/export module specifier to an on-disk canonical path using
 * the bundled TypeScript compiler's actual ts.resolveModuleName() engine.
 *
 * Guarantees standard TypeScript module resolution semantics:
 * - tsconfig.json extends, baseUrl, and wildcard path mappings
 * - Multiple path targets and fallback order
 * - NodeNext, Node16, and Bundler module resolution modes
 * - Conditional package exports (import, require, types)
 * - Package types, typings, and typesVersions
 * - Package self-references and workspace package boundaries
 * - .mts, .cts, .mjs, .cjs, and .d.ts extensions
 */
export function resolveModuleSpecifier(
  specifier: string,
  fromCanonicalPath: string,
  workspaceRoot: string,
  optionsOrTsConfig?: ModuleResolutionOptions | TsConfigOptions | any,
  providedParser?: ParserApi,
): ModuleResolutionResult {
  const normWorkspace = path.resolve(workspaceRoot);
  const containingFileAbs = path.resolve(normWorkspace, fromCanonicalPath);

  // 1. Detect standard Node built-in modules
  const isNodeBuiltin = specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
  if (isNodeBuiltin) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: null,
      status: "unresolved",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: true,
    };
  }

  // 2. Resolve parser instance
  const parser = providedParser || optionsOrTsConfig?.parser || loadParserSync();

  // 3. Extract compiler options
  let compilerOptions: any;
  if (optionsOrTsConfig?.compilerOptions) {
    compilerOptions = { ...optionsOrTsConfig.compilerOptions };
  } else if (
    optionsOrTsConfig &&
    (optionsOrTsConfig.baseUrl || optionsOrTsConfig.paths || optionsOrTsConfig.moduleResolution)
  ) {
    compilerOptions = { ...optionsOrTsConfig };
  } else {
    compilerOptions = loadTsConfig(normWorkspace, optionsOrTsConfig?.tsconfigPath, parser) || {};
  }

  // Ensure default module resolution if not specified
  if (!compilerOptions.moduleResolution) {
    compilerOptions.moduleResolution = parser.ModuleResolutionKind.Bundler ?? 99;
  }

  // Ensure baseUrl is absolute when provided
  if (compilerOptions.baseUrl && !path.isAbsolute(compilerOptions.baseUrl)) {
    compilerOptions.baseUrl = path.resolve(normWorkspace, compilerOptions.baseUrl);
  }

  // 4. Create resolution host
  const host = createModuleResolutionHost(normWorkspace, optionsOrTsConfig?.customHost);

  // 5. Invoke TypeScript compiler module resolution
  let resolutionResult: any;
  try {
    resolutionResult = parser.resolveModuleName(
      specifier,
      containingFileAbs,
      compilerOptions,
      host,
    );
  } catch {
    resolutionResult = undefined;
  }

  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");

  if (!resolutionResult || !resolutionResult.resolvedModule) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: null,
      status: "unresolved",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: !isRelative,
    };
  }

  const resolvedFileName = resolutionResult.resolvedModule.resolvedFileName;

  // 6. Enforce workspace boundary: reject resolutions outside the workspace
  const rel = path.relative(normWorkspace, resolvedFileName);
  const isInsideWorkspace = !rel.startsWith("..") && !path.isAbsolute(rel);

  if (!isInsideWorkspace) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: null,
      status: "unresolved",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: true,
    };
  }

  // 7. Check if resolved target is inside node_modules
  const segments = rel.split(/[\\/]/);
  const isNodeModules = segments.includes("node_modules");

  if (isNodeModules) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: null,
      status: "unresolved",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: true,
    };
  }

  // 8. Confirmed internal workspace module
  const canonicalPath = rel.replace(/\\/g, "/");

  return {
    specifier,
    originalSpecifier: specifier,
    importingFile: fromCanonicalPath,
    resolvedCanonicalPath: canonicalPath,
    status: "resolved",
    resolutionMethod: "ts_resolve_module_name",
    classification: "syntactic_ast",
    isConfirmed: true,
    isExternal: false,
  };
}
