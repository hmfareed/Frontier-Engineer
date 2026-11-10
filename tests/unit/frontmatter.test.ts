import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { parseFrontmatter } from "../../scripts/lib/yaml-frontmatter.ts";

function fixture(name: string): string {
  return fs.readFileSync(path.join(repoRoot(), "tests", "fixtures", name), "utf8");
}

describe("parseFrontmatter", () => {
  it("extracts metadata and body from a compliant SKILL.md", () => {
    const result = parseFrontmatter(fixture("valid-skill.md"));
    expect(result.present).toBe(true);
    expect(result.error).toBeNull();
    expect((result.data as Record<string, unknown>).name).toBe("valid-skill");
    expect(result.body).toContain("# Valid skill");
  });

  it("parses a folded YAML description into a single string", () => {
    const result = parseFrontmatter(fixture("valid-skill.md"));
    expect(typeof (result.data as Record<string, unknown>).description).toBe("string");
  });

  it("reports an unclosed frontmatter block", () => {
    const result = parseFrontmatter(fixture("broken-frontmatter.md"));
    expect(result.present).toBe(true);
    expect(result.error).toContain("never closed");
  });

  it("reports syntactically invalid YAML", () => {
    const result = parseFrontmatter("---\nname: [a, b\n---\n\n# Body\n");
    expect(result.error).not.toBeNull();
  });

  it("treats plain Markdown as having no frontmatter", () => {
    const result = parseFrontmatter("# Plain document\n\nNo metadata here.\n");
    expect(result.present).toBe(false);
    expect(result.body).toContain("Plain document");
  });

  it("accepts a UTF-8 BOM before the opening delimiter", () => {
    const result = parseFrontmatter("\uFEFF---\nname: bom\n---\n");
    expect(result.present).toBe(true);
    expect((result.data as Record<string, unknown>).name).toBe("bom");
  });
});
