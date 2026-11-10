import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkMarkdownLinks, extractLinks, stripCode } from "../../scripts/lib/markdown-links.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const temporaryRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fe-links-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stripCode and extractLinks", () => {
  it("removes fenced code blocks and inline code", () => {
    const markdown =
      "See [real](./real.md) and `[hidden](./hidden.md)`\n\n```md\n[fenced](./fenced.md)\n```\n";
    expect(stripCode(markdown)).not.toContain("fenced.md");
    expect(stripCode(markdown)).not.toContain("hidden.md");
    expect(extractLinks(markdown)).toEqual(["./real.md"]);
  });

  it("extracts rule file-include references too", () => {
    expect(extractLinks("Follow @[API standards](../docs/api.md)")).toEqual(["../docs/api.md"]);
  });
});

describe("checkMarkdownLinks", () => {
  it("reports a broken relative link with an actionable message", () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, "broken-link.md"),
      fs.readFileSync(path.join(repoRoot(), "tests/fixtures/broken-link.md"), "utf8"),
    );
    const findings = checkMarkdownLinks(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("./missing-document.md");
  });

  it("accepts a link that resolves relative to its own directory", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "target.md"), "# Target\n");
    fs.writeFileSync(
      path.join(root, "docs", "index.md"),
      "[Target](target.md) and [external](https://example.com)\n",
    );
    expect(checkMarkdownLinks(root)).toEqual([]);
  });

  it("accepts a link with an anchor fragment", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "target.md"), "# Target\n");
    fs.writeFileSync(path.join(root, "index.md"), "[Section](target.md#target)\n");
    expect(checkMarkdownLinks(root)).toEqual([]);
  });
});
