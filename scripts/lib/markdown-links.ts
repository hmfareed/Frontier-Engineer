import path from "node:path";
import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
const EXTERNAL_PREFIXES = ["http://", "https://", "mailto:", "tel:", "data:", "//", "#"];

/** Removes fenced blocks and inline code so example snippets are not treated as links. */
export function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

export function extractLinks(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of stripCode(markdown).matchAll(LINK_PATTERN)) {
    targets.push(match[1]);
  }
  return targets;
}

function normalizeTarget(target: string): string {
  let value = target.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
  value = value.split("#")[0].split("?")[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original when percent-encoding is malformed.
  }
  return value;
}

export function checkMarkdownLinks(root: string): Finding[] {
  const findings: Finding[] = [];
  const markdownFiles = walkFiles(root, (rel) => !isExcluded(rel) && rel.endsWith(".md"));

  for (const rel of markdownFiles) {
    const text = readText(root, rel);
    if (text === null) continue;
    const fromDirectory = path.posix.dirname(rel);

    for (const rawTarget of extractLinks(text)) {
      if (EXTERNAL_PREFIXES.some((prefix) => rawTarget.startsWith(prefix))) continue;
      const target = normalizeTarget(rawTarget);
      if (target === "") continue;

      const fileRelative = path.posix.normalize(path.posix.join(fromDirectory, target));
      const rootRelative = path.posix.normalize(target);
      if (exists(root, fileRelative) || exists(root, rootRelative)) continue;

      findings.push(
        finding(
          "error",
          "broken-markdown-link",
          rel,
          `Link target "${rawTarget}" does not resolve. Fix the path relative to ${fromDirectory}/.`,
        ),
      );
    }
  }
  return findings;
}
