import path from "node:path";
import type { FileClassification } from "./types.ts";
import { evaluateSensitivePath } from "./sensitive-filter.ts";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".rb",
  ".swift",
  ".kt",
  ".scala",
  ".sh",
  ".bash",
]);

const DOCUMENTATION_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".rst",
  ".adoc",
  ".asciidoc",
  ".pdf", // Note: PDF is document, but also binary. If binary check is after, classified as documentation or binary. Let's make pdf binary.
]);

const CONFIGURATION_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".xml",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
]);

const ASSET_EXTENSIONS = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
]);

const BINARY_EXTENSIONS = new Set([
  ".wasm",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".db3",
  ".sqlite-wal",
  ".sqlite-shm",
  ".node",
]);

/**
 * Classifies a file based on its path, extension, and sensitive path rules.
 */
export function classifyFile(canonicalPath: string): FileClassification {
  // First check if it is a sensitive file
  if (evaluateSensitivePath(canonicalPath).isSensitive) {
    return "sensitive";
  }

  const ext = path.extname(canonicalPath).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    return "binary";
  }
  if (SOURCE_EXTENSIONS.has(ext)) {
    return "source";
  }
  if (CONFIGURATION_EXTENSIONS.has(ext)) {
    return "configuration";
  }
  if (DOCUMENTATION_EXTENSIONS.has(ext)) {
    return "documentation";
  }
  if (ASSET_EXTENSIONS.has(ext)) {
    return "asset";
  }

  const fileName = path.basename(canonicalPath).toLowerCase();
  if (fileName === "dockerfile" || fileName === "makefile") {
    return "configuration";
  }
  if (fileName === "license" || fileName === "changelog" || fileName === "notice") {
    return "documentation";
  }

  return "unknown";
}
