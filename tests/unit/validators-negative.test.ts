import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkConfigPlacement,
  checkJsonSyntax,
  checkOptionalConfigs,
  checkPluginManifest,
} from "../../scripts/lib/json-config.ts";
import { checkMarkdownLinks } from "../../scripts/lib/markdown-links.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { countBySeverity, formatReport } from "../../scripts/lib/report.ts";
import { checkDocumentationIndex, checkRequiredFiles } from "../../scripts/lib/required-files.ts";
import { checkSecretHygiene } from "../../scripts/lib/security.ts";
import { checkMetadata, checkYamlSyntax } from "../../scripts/lib/yaml-frontmatter.ts";

const temporaryRoots: string[] = [];

function makeRoot(withSchemas = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fe-validator-"));
  temporaryRoots.push(root);
  if (withSchemas) {
    fs.cpSync(path.join(repoRoot(), "schemas"), path.join(root, "schemas"), { recursive: true });
  }
  return root;
}

function write(root: string, rel: string, content: string): void {
  const absolute = path.join(root, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

function fixture(name: string): string {
  return fs.readFileSync(path.join(repoRoot(), "tests", "fixtures", name), "utf8");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("required files and documentation index", () => {
  it("reports every missing required file on an empty tree", () => {
    const findings = checkRequiredFiles(makeRoot());
    expect(findings.length).toBeGreaterThan(10);
    expect(findings.every((item) => item.severity === "error")).toBe(true);
  });

  it("flags a document that is not linked from docs/README.md", () => {
    const root = makeRoot();
    write(root, "docs/README.md", "# Index\n\n[Overview](01-overview.md)\n");
    write(root, "docs/01-overview.md", "# Overview\n");
    write(root, "docs/orphan.md", "# Orphan\n");
    const findings = checkDocumentationIndex(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("doc-not-indexed");
    expect(findings[0].message).toContain("orphan.md");
  });
});

describe("JSON and YAML syntax", () => {
  it("detects malformed JSON", () => {
    const root = makeRoot();
    write(root, "broken.json", fixture("broken.json"));
    const findings = checkJsonSyntax(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("invalid-json");
  });

  it("does not scan intentionally invalid fixtures", () => {
    const root = makeRoot();
    write(root, "tests/fixtures/broken.json", fixture("broken.json"));
    expect(checkJsonSyntax(root)).toEqual([]);
  });

  it("detects malformed YAML and an unclosed frontmatter block", () => {
    const root = makeRoot();
    write(root, "invalid.yaml", fixture("invalid.yaml"));
    write(root, "broken-frontmatter.md", fixture("broken-frontmatter.md"));
    const findings = checkYamlSyntax(root);
    expect(findings.map((item) => item.rule)).toContain("invalid-yaml");
    expect(findings.map((item) => item.rule)).toContain("invalid-frontmatter-yaml");
  });
});

describe("plugin manifest validation", () => {
  const validManifest = JSON.stringify({
    name: "demo-plugin",
    displayName: "Demo Plugin",
    version: "0.1.0",
    description: "A test plugin.",
    suggestedPrompts: ["Run a readiness check"],
    author: { name: "Testers" },
    logo: "assets/logo.svg",
    license: "MIT",
  });

  it("accepts a manifest with a bundled logo and no invented fields", () => {
    const root = makeRoot(true);
    write(root, "plugin.json", validManifest);
    write(root, "assets/logo.svg", "<svg></svg>");
    expect(checkPluginManifest(root)).toEqual([]);
  });

  it("reports a missing logo asset", () => {
    const root = makeRoot(true);
    write(root, "plugin.json", validManifest);
    expect(checkPluginManifest(root).map((item) => item.rule)).toContain("missing-logo-asset");
  });

  it("rejects an invented manifest property", () => {
    const root = makeRoot(true);
    write(root, "plugin.json", JSON.stringify({ name: "demo-plugin", invented: true }));
    expect(checkPluginManifest(root).map((item) => item.rule)).toContain("invalid-plugin-manifest");
  });

  it("validates optional MCP config only when present", () => {
    const root = makeRoot(true);
    expect(checkOptionalConfigs(root)).toEqual([]);
    write(root, "mcp_config.json", JSON.stringify({ mcpServers: { broken: { args: [] } } }));
    expect(checkOptionalConfigs(root).map((item) => item.rule)).toContain("invalid-mcp-config");
  });
});

describe("component metadata", () => {
  it("rejects a skill whose name does not match its folder", () => {
    const root = makeRoot(true);
    write(
      root,
      "skills/demo/SKILL.md",
      "---\nname: wrong-name\ndescription: Use when testing.\n---\n",
    );
    expect(checkMetadata(root).map((item) => item.rule)).toContain("skill-name-folder-mismatch");
  });

  it("warns when a skill is nested deeper than the one-level scan", () => {
    const root = makeRoot(true);
    write(
      root,
      "skills/group/demo/SKILL.md",
      "---\nname: demo\ndescription: Use when testing.\n---\n",
    );
    expect(checkMetadata(root).map((item) => item.rule)).toContain("component-scan-depth");
  });

  it("accepts a compliant skill and a compliant agent", () => {
    const root = makeRoot(true);
    write(root, "skills/demo/SKILL.md", "---\nname: demo\ndescription: Use when testing.\n---\n");
    write(
      root,
      "agents/reviewer.md",
      "---\nname: reviewer\ndescription: Reviews changes read-only.\nsubagent: true\ntools:\n  - view_file\n---\n",
    );
    expect(checkMetadata(root)).toEqual([]);
  });

  it("rejects a named rule without a trigger", () => {
    const root = makeRoot(true);
    write(root, "rules/security.md", "---\ndescription: Missing trigger.\n---\n");
    expect(checkMetadata(root).map((item) => item.rule)).toContain("invalid-rule-metadata");
  });
});

describe("security and placement", () => {
  it("flags committed environment files and private key material", () => {
    const root = makeRoot();
    write(root, ".env", "SECRET=value\n");
    const pemHeader = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
    write(root, "notes.md", `${pemHeader}\n`);
    const rules = checkSecretHygiene(root).map((item) => item.rule);
    expect(rules).toContain("env-file-present");
    expect(rules).toContain("private-key-material");
  });

  it("warns about foreign agent-platform config", () => {
    const root = makeRoot();
    write(root, ".claude-plugin/plugin.json", "{}");
    const findings = checkConfigPlacement(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("ignores fenced example links", () => {
    const root = makeRoot();
    write(root, "example.md", "```md\n[not-a-link](./nope.md)\n```\n");
    expect(checkMarkdownLinks(root)).toEqual([]);
  });
});

describe("reporting", () => {
  it("counts errors so the CLI can exit non-zero", () => {
    const results = [
      {
        name: "check",
        findings: [
          { severity: "error" as const, rule: "r", file: "f", message: "m" },
          { severity: "warning" as const, rule: "r", file: "f", message: "m" },
        ],
      },
    ];
    expect(countBySeverity(results).error).toBe(1);
    expect(formatReport(results)).toContain("Critical checks failed");
  });
});
