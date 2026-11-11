import fs from "node:fs";
import path from "node:path";
import type { EvidenceClassification } from "./types.ts";

export interface TsConfigPaths {
  [pattern: string]: string[];
}

export interface TsConfigOptions {
  compilerOptions?: {
    baseUrl?: string;
    paths?: TsConfigPaths;
  };
}

export interface ModuleResolutionResult {
  specifier: string;
  resolvedCanonicalPath: string | null;
  status: "resolved" | "unresolved";
  classification: EvidenceClassification;
  isExternal: boolean;
}

const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.d.ts", "index.js", "index.jsx"];

const NODE_BUILTINS = new Set<string>([
  "assert",
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
  "repl",
  "stream",
  "stream/promises",
  "stream/web",
  "string_decoder",
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
 * Loads and parses tsconfig.json from workspace root or specified path.
 */
export function loadTsConfig(workspaceRoot: string, customPath?: string): TsConfigOptions | undefined {
  const tsconfigPath = customPath || path.join(workspaceRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(tsconfigPath, "utf8");
    // Strip single-line comments and trailing commas before parsing
    const sanitized = raw
      .replace(/\/\/[^\n\r]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(sanitized);
  } catch {
    return undefined;
  }
}

/** Probes file candidate variations (exact, extensions, directory index, package.json). */
function probeCandidate(targetPath: string): string | null {
  // 1. Exact file
  if (fs.existsSync(targetPath)) {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) return targetPath;
      if (stat.isDirectory()) {
        // Probe directory package.json
        const pkgJsonPath = path.join(targetPath, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
            if (typeof pkg.main === "string") {
              const mainProbe = probeCandidate(path.resolve(targetPath, pkg.main));
              if (mainProbe) return mainProbe;
            }
          } catch {
            // Ignore package.json parse error
          }
        }
        // Probe directory index files
        for (const indexName of INDEX_FILES) {
          const indexPath = path.join(targetPath, indexName);
          if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
            return indexPath;
          }
        }
      }
    } catch {
      // Ignore stat error
    }
  }

  // 2. TypeScript ESM source mapping (.js/.jsx -> .ts/.tsx/.d.ts)
  if (targetPath.endsWith(".js") || targetPath.endsWith(".jsx")) {
    const base = targetPath.replace(/\.jsx?$/, "");
    for (const ext of [".ts", ".tsx", ".d.ts"]) {
      const candidate = `${base}${ext}`;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  // 3. Extension probing
  for (const ext of EXTENSIONS) {
    const candidate = `${targetPath}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // 4. Directory index probing without existing directory check
  for (const indexName of INDEX_FILES) {
    const candidate = path.join(targetPath, indexName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolves an import/export module specifier to an on-disk canonical path.
 * Adheres to standard TypeScript resolution: baseUrl, paths, relative probing, and package exports.
 */
export function resolveModuleSpecifier(
  specifier: string,
  fromCanonicalPath: string,
  workspaceRoot: string,
  tsconfig?: TsConfigOptions,
): ModuleResolutionResult {
  const normWorkspace = path.resolve(workspaceRoot);

  // 1. Check for standard library or external module
  const isNodeBuiltin = specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");

  // 2. Handle tsconfig path mapping (e.g. @/* -> src/*)
  if (!isRelative && !isNodeBuiltin && tsconfig?.compilerOptions?.paths) {
    const baseUrl = path.resolve(
      normWorkspace,
      tsconfig.compilerOptions.baseUrl || ".",
    );
    const pathsMap = tsconfig.compilerOptions.paths;

    for (const [pattern, targets] of Object.entries(pathsMap)) {
      let matched = false;
      let matchedSuffix = "";

      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -2);
        if (specifier.startsWith(prefix + "/")) {
          matched = true;
          matchedSuffix = specifier.slice(prefix.length + 1);
        }
      } else if (pattern === specifier) {
        matched = true;
        matchedSuffix = "";
      }

      if (matched) {
        for (const targetPattern of targets) {
          const resolvedTarget = targetPattern.endsWith("/*")
            ? targetPattern.slice(0, -2) + "/" + matchedSuffix
            : targetPattern;

          const candidateAbs = path.resolve(baseUrl, resolvedTarget);
          const probed = probeCandidate(candidateAbs);
          if (probed && probed.startsWith(normWorkspace)) {
            const canonical = path
              .relative(normWorkspace, probed)
              .replace(/\\/g, "/");
            return {
              specifier,
              resolvedCanonicalPath: canonical,
              status: "resolved",
              classification: "syntactic_ast",
              isExternal: false,
            };
          }
        }
      }
    }
  }

  // 3. Handle relative imports
  if (isRelative) {
    const fromDirAbs = path.dirname(path.resolve(normWorkspace, fromCanonicalPath));
    const targetAbs = path.resolve(fromDirAbs, specifier);
    const probed = probeCandidate(targetAbs);

    if (probed && probed.startsWith(normWorkspace)) {
      const canonical = path
        .relative(normWorkspace, probed)
        .replace(/\\/g, "/");
      return {
        specifier,
        resolvedCanonicalPath: canonical,
        status: "resolved",
        classification: "syntactic_ast",
        isExternal: false,
      };
    }
  }

  // 4. External or unresolvable
  return {
    specifier,
    resolvedCanonicalPath: null,
    status: "unresolved",
    classification: "external_or_missing",
    isExternal: !isRelative || isNodeBuiltin,
  };
}
