import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPluginManifest } from "../../scripts/lib/json-config.ts";
import { checkMarkdownLinks } from "../../scripts/lib/markdown-links.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { countBySeverity } from "../../scripts/lib/report.ts";
import { REQUIRED_DIRECTORIES, REQUIRED_FILES } from "../../scripts/lib/required-files.ts";
import { checkSecretHygiene } from "../../scripts/lib/security.ts";
import type { Finding } from "../../scripts/lib/types.ts";
import {
  checkMetadata,
  checkYamlSyntax,
  parseFrontmatter,
} from "../../scripts/lib/yaml-frontmatter.ts";
import { runChecks } from "../../scripts/validate.ts";

const root = repoRoot();

function errors(findings: Finding[]): Finding[] {
  return findings.filter((item) => item.severity === "error");
}

describe("repository foundation", () => {
  it("passes every critical validation check", () => {
    const results = runChecks(root);
    expect(countBySeverity(results).error).toBe(0);
    for (const result of results) {
      expect(
        errors(result.findings),
        `${result.name}: ${JSON.stringify(errors(result.findings))}`,
      ).toEqual([]);
    }
  });

  it("has no broken Markdown links anywhere in the repository", () => {
    expect(checkMarkdownLinks(root)).toEqual([]);
  });

  it("has a valid plugin manifest and a bundled logo", () => {
    expect(checkPluginManifest(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, "assets", "logo.svg"))).toBe(true);
  });

  it("has valid YAML syntax and no invalid component metadata", () => {
    expect(errors(checkYamlSyntax(root))).toEqual([]);
    expect(errors(checkMetadata(root))).toEqual([]);
  });

  it("has no committed secrets", () => {
    expect(errors(checkSecretHygiene(root))).toEqual([]);
  });

  it("contains every required file and directory", () => {
    for (const rel of REQUIRED_FILES) {
      expect(fs.existsSync(path.join(root, rel)), rel).toBe(true);
    }
    for (const rel of REQUIRED_DIRECTORIES) {
      expect(fs.statSync(path.join(root, rel)).isDirectory(), rel).toBe(true);
    }
  });

  it("keeps the always-on rule free of YAML frontmatter", () => {
    const content = fs.readFileSync(path.join(root, "rules", "AGENTS.md"), "utf8");
    expect(parseFrontmatter(content).present).toBe(false);
    expect(content).toContain("Inspect before implementing");
  });

  it("keeps plugin.json and package.json identity in sync", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    expect(manifest.name).toBe("frontier-engineer");
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
  });

  it("does not ship unverified optional configs", () => {
    expect(fs.existsSync(path.join(root, "mcp_config.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "hooks.json"))).toBe(false);
  });

  it("documents the verified component layout", () => {
    const structure = fs.readFileSync(
      path.join(root, "docs", "15-REPOSITORY-STRUCTURE.md"),
      "utf8",
    );
    for (const component of [
      "plugin.json",
      "agents/",
      "skills/",
      "rules/",
      "scripts/",
      "schemas/",
    ]) {
      expect(structure).toContain(component);
    }
  });
});
