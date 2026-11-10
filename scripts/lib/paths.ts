import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the plugin/repository root, derived from this file's location. */
export function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function relative(root: string, absolute: string): string {
  return toPosix(path.relative(root, absolute));
}
