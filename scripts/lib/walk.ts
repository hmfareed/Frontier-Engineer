import fs from "node:fs";
import path from "node:path";
import { relative } from "./paths.ts";

const SKIPPED_DIRS = new Set([".git", "node_modules", "coverage", "dist", ".workbuddy-ai"]);

/** Intentionally-invalid test fixtures must never be scanned as production content. */
const EXCLUDED_PREFIXES = ["tests/fixtures/"];

export function isExcluded(relPath: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/** Repo-relative POSIX paths of files below `root` that match `predicate`. */
export function walkFiles(
  root: string,
  predicate: (relPath: string) => boolean = () => true,
): string[] {
  const output: string[] = [];

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(absolute);
      } else if (entry.isFile()) {
        const rel = relative(root, absolute);
        if (predicate(rel)) output.push(rel);
      }
    }
  };

  visit(root);
  return output.sort();
}

export function readText(root: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(root, relPath), "utf8");
  } catch {
    return null;
  }
}

export function exists(root: string, relPath: string): boolean {
  return fs.existsSync(path.join(root, relPath));
}

export function isDirectory(root: string, relPath: string): boolean {
  try {
    return fs.statSync(path.join(root, relPath)).isDirectory();
  } catch {
    return false;
  }
}
