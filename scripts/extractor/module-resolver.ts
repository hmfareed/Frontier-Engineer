import fs from "node:fs";
import path from "node:path";
import { loadParserSync, type ParserApi } from "./parser-loader.ts";
import type { EvidenceClassification } from "./types.ts";

export interface TsConfigPaths {
  [pattern: string]: string[];
}

export type TsConfigStatus =
  | "missing"
  | "valid"
  | "invalid_json"
  | "invalid_options"
  | "unresolvable_extends"
  | "inheritance_cycle";

export interface TsConfigDiagnostic {
  message: string;
  code?: number;
  category?: "error" | "warning";
}

export interface TsConfigResult {
  status: TsConfigStatus;
  compilerOptions: any;
  diagnostics: TsConfigDiagnostic[];
  configFilePath?: string;
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
  status: "resolved" | "unresolved" | "degraded";
  resolutionMethod: "ts_resolve_module_name";
  classification: EvidenceClassification;
  isConfirmed: boolean;
  isExternal: boolean;
  configStatus?: TsConfigStatus;
  configDiagnostics?: TsConfigDiagnostic[];
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
 *
 * Distinguishes:
 * 1. missing: no tsconfig.json found (uses documented default Bundler options)
 * 2. valid: valid configuration parsed successfully
 * 3. invalid_json: JSON syntax error in config
 * 4. invalid_options: invalid compiler options
 * 5. unresolvable_extends: extended base config file not found
 * 6. inheritance_cycle: circularity detected in extends chain
 */
export function loadTsConfig(
  workspaceRoot: string,
  customPath?: string,
  parser?: ParserApi,
): TsConfigResult {
  const normRoot = path.resolve(workspaceRoot);
  const tsconfigPath = customPath
    ? path.resolve(normRoot, customPath)
    : path.join(normRoot, "tsconfig.json");

  const p = parser || loadParserSync();
  const defaultOptions = {
    moduleResolution: p.ModuleResolutionKind.Bundler ?? 99,
    target: p.ScriptTarget.ESNext ?? 99,
  };

  if (!fs.existsSync(tsconfigPath)) {
    return {
      status: "missing",
      compilerOptions: defaultOptions,
      diagnostics: [],
    };
  }

  try {
    const configFile = p.readConfigFile(tsconfigPath, (filePath: string) => {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    });

    if (configFile.error) {
      const err = configFile.error;
      const msg =
        typeof err.messageText === "string"
          ? err.messageText
          : err.messageText?.messageText || "JSON syntax error in config";
      return {
        status: "invalid_json",
        compilerOptions: defaultOptions,
        diagnostics: [{ message: msg, code: err.code, category: "error" }],
        configFilePath: tsconfigPath,
      };
    }

    if (!configFile.config || typeof configFile.config !== "object") {
      return {
        status: "invalid_json",
        compilerOptions: defaultOptions,
        diagnostics: [
          { message: "Config file did not contain a valid JSON object", category: "error" },
        ],
        configFilePath: tsconfigPath,
      };
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

    // Code 18003 is "No inputs were found in config file", which is expected for our headless host
    const rawErrors = (parsed.errors || []).filter((e: any) => e.code !== 18003);

    if (rawErrors.length > 0) {
      const diagnostics: TsConfigDiagnostic[] = rawErrors.map((e: any) => ({
        message:
          typeof e.messageText === "string"
            ? e.messageText
            : e.messageText?.messageText || "Config error",
        code: e.code,
        category: "error" as const,
      }));

      let status: TsConfigStatus = "invalid_options";
      for (const diag of diagnostics) {
        if (diag.code === 18000 || /circularity/i.test(diag.message)) {
          status = "inheritance_cycle";
          break;
        }
        if (
          diag.code === 5083 ||
          /cannot read file/i.test(diag.message) ||
          /not found/i.test(diag.message)
        ) {
          status = "unresolvable_extends";
          break;
        }
      }

      return {
        status,
        compilerOptions: { ...defaultOptions, ...(parsed.options || {}) },
        diagnostics,
        configFilePath: tsconfigPath,
      };
    }

    return {
      status: "valid",
      compilerOptions: parsed.options || defaultOptions,
      diagnostics: [],
      configFilePath: tsconfigPath,
    };
  } catch (err: any) {
    return {
      status: "invalid_json",
      compilerOptions: defaultOptions,
      diagnostics: [{ message: err?.message || String(err), category: "error" }],
      configFilePath: tsconfigPath,
    };
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
      configStatus: "valid",
      configDiagnostics: [],
    };
  }

  // 2. Resolve parser instance
  const parser = providedParser || optionsOrTsConfig?.parser || loadParserSync();

  // 3. Extract compiler options and config status
  let compilerOptions: any;
  let configStatus: TsConfigStatus = "valid";
  let configDiagnostics: TsConfigDiagnostic[] = [];

  if (optionsOrTsConfig?.compilerOptions) {
    compilerOptions = { ...optionsOrTsConfig.compilerOptions };
  } else if (
    optionsOrTsConfig &&
    (optionsOrTsConfig.baseUrl || optionsOrTsConfig.paths || optionsOrTsConfig.moduleResolution)
  ) {
    compilerOptions = { ...optionsOrTsConfig };
  } else {
    const configResult = loadTsConfig(normWorkspace, optionsOrTsConfig?.tsconfigPath, parser);
    compilerOptions = configResult.compilerOptions;
    configStatus = configResult.status;
    configDiagnostics = configResult.diagnostics;
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
  const isConfigInvalid = configStatus !== "valid" && configStatus !== "missing";

  if (!resolutionResult || !resolutionResult.resolvedModule) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: null,
      status: isConfigInvalid ? "degraded" : "unresolved",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: !isRelative,
      configStatus,
      configDiagnostics,
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
      configStatus,
      configDiagnostics,
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
      configStatus,
      configDiagnostics,
    };
  }

  // 8. Internal workspace module resolution
  const canonicalPath = rel.replace(/\\/g, "/");

  // If configuration was invalid, never claim a confirmed resolution based on silently discarded errors
  if (isConfigInvalid) {
    return {
      specifier,
      originalSpecifier: specifier,
      importingFile: fromCanonicalPath,
      resolvedCanonicalPath: canonicalPath,
      status: "degraded",
      resolutionMethod: "ts_resolve_module_name",
      classification: "external_or_missing",
      isConfirmed: false,
      isExternal: false,
      configStatus,
      configDiagnostics,
    };
  }

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
    configStatus,
    configDiagnostics,
  };
}
