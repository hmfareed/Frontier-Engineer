import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  REQUIRED_SECTIONS,
  adapterFrontmatter,
  buildAdapterContent,
  buildAdapterFiles,
  checkAdapterRegistry,
  checkGeneratedAgents,
  loadCanonicalSpecs,
  validateCanonicalSpecs,
} from "../../scripts/lib/canonical.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { parseFrontmatter } from "../../scripts/lib/yaml-frontmatter.ts";

const root = repoRoot();
const temporaryRoots: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-canonical-"));
  temporaryRoots.push(dir);
  fs.cpSync(path.join(root, "schemas"), path.join(dir, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs", "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs", "adapters"), { recursive: true });
  return dir;
}

function spec(overrides: Record<string, unknown> = {}, body?: string): string {
  const frontmatter = {
    id: "demo-agent",
    name: "Demo Agent",
    role: "Test Specialist",
    kind: "specialist",
    version: 1,
    summary:
      "Demonstrates a compliant canonical specification. Use when testing canonical validation.",
    requiredCapabilities: ["repository-inspection"],
    optionalCapabilities: [],
    recommendedMcp: [],
    fileAccess: "read",
    browserAccess: "none",
    terminalAccess: "none",
    approvalRequirements: [],
    delegatesTo: [],
    platformConfig: {},
    ...overrides,
  };
  const sections = REQUIRED_SECTIONS.map(
    (section) => `## ${section}\n\nContent for ${section}.\n`,
  ).join("\n");
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n# Demo\n\n${body ?? sections}`;
}

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("canonical agent specifications", () => {
  it("loads all six specs with no validation findings", () => {
    const { specs, findings } = loadCanonicalSpecs(root);
    expect(findings).toEqual([]);
    expect(specs).toHaveLength(6);
    expect(specs.map((item) => item.id).sort()).toEqual([...AGENT_IDS].sort());
  });

  it("assigns exactly one coordinator and five specialists", () => {
    const { specs } = loadCanonicalSpecs(root);
    expect(specs.filter((item) => item.kind === "coordinator").map((item) => item.id)).toEqual([
      "frontier-engineer",
    ]);
    expect(specs.filter((item) => item.kind === "specialist")).toHaveLength(5);
  });

  it("gives every agent a distinct purpose and summary", () => {
    const { specs } = loadCanonicalSpecs(root);
    expect(new Set(specs.map((item) => item.summary)).size).toBe(6);
    expect(new Set(specs.map((item) => item.role)).size).toBe(6);
    for (const item of specs) expect(item.body.length).toBeGreaterThan(1000);
  });

  it("enforces every required section in the repository specs", () => {
    const { specs } = loadCanonicalSpecs(root);
    for (const item of specs) {
      for (const section of REQUIRED_SECTIONS) {
        expect(item.body, `${item.id} / ${section}`).toContain(`## ${section}`);
      }
    }
  });

  it("keeps platformConfig empty in every canonical spec", () => {
    const { specs } = loadCanonicalSpecs(root);
    for (const item of specs) expect(item.frontmatter.platformConfig).toEqual({});
  });

  it("rejects a non-empty platformConfig", () => {
    const dir = makeRoot();
    fs.writeFileSync(
      path.join(dir, "specs", "agents", "demo-agent.md"),
      spec({ platformConfig: { antigravity: true } }),
    );
    expect(validateCanonicalSpecs(dir).map((item) => item.rule)).toContain(
      "invalid-canonical-agent",
    );
  });

  it("reports a missing section and an id/filename mismatch", () => {
    const dir = makeRoot();
    fs.writeFileSync(
      path.join(dir, "specs", "agents", "demo-agent.md"),
      spec({}, "## Identity\n\nOnly one section.\n"),
    );
    fs.writeFileSync(path.join(dir, "specs", "agents", "wrong-name.md"), spec());
    const rules = validateCanonicalSpecs(dir).map((item) => item.rule);
    expect(rules).toContain("canonical-section-missing");
    expect(rules).toContain("canonical-id-filename-mismatch");
  });

  it("rejects an unknown delegation target", () => {
    const dir = makeRoot();
    fs.writeFileSync(
      path.join(dir, "specs", "agents", "demo-agent.md"),
      spec({ delegatesTo: ["ghost-agent"] }),
    );
    expect(validateCanonicalSpecs(dir).map((item) => item.rule)).toContain(
      "unknown-delegation-target",
    );
  });
});

describe("Antigravity adapter generation", () => {
  it("produces six adapters with verified frontmatter only", () => {
    const files = buildAdapterFiles(root);
    expect(files.size).toBe(6);
    for (const [rel, content] of files) {
      expect(rel.startsWith("agents/")).toBe(true);
      const parsed = parseFrontmatter(content);
      const data = parsed.data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(
        ["commandExecutionPolicy", "description", "mainAgent", "model", "name", "subagent"].sort(),
      );
      expect(data.model).toBe("inherit");
      expect(data.commandExecutionPolicy).toBe("sandbox");
      expect(content).not.toContain("tools:");
      expect(content).not.toContain("platformConfig");
    }
  });

  it("makes only the coordinator a main agent", () => {
    const { specs } = loadCanonicalSpecs(root);
    for (const item of specs) {
      const frontmatter = adapterFrontmatter(item);
      expect(frontmatter.mainAgent).toBe(item.id === "frontier-engineer");
      expect(frontmatter.subagent).toBe(item.id !== "frontier-engineer");
    }
  });

  it("embeds the canonical body and a platform-specific section", () => {
    const coordinator = loadCanonicalSpecs(root).specs.find(
      (item) => item.id === "frontier-engineer",
    );
    expect(coordinator).toBeDefined();
    if (!coordinator) throw new Error("coordinator canonical spec is missing");
    const content = buildAdapterContent(coordinator);
    expect(content).toContain("## Antigravity runtime adapter");
    expect(content).toContain("## Identity");
    expect(content).toContain("Generated from");
    expect(content).toContain("invoke_subagent");
  });

  it("confirms generated files are current", () => {
    expect(checkGeneratedAgents(root)).toEqual([]);
  });

  it("detects a missing or stale generated file", () => {
    const dir = makeRoot();
    fs.writeFileSync(path.join(dir, "specs", "agents", "demo-agent.md"), spec());
    fs.mkdirSync(path.join(dir, "agents"));
    expect(checkGeneratedAgents(dir).map((item) => item.rule)).toContain("generated-agent-missing");
    fs.writeFileSync(
      path.join(dir, "agents", "demo-agent.md"),
      buildAdapterContent(loadCanonicalSpecs(dir).specs[0]).replace("sandbox", "eager"),
    );
    expect(checkGeneratedAgents(dir).map((item) => item.rule)).toContain("generated-agent-stale");
  });

  it("labels unimplemented adapters explicitly", () => {
    expect(checkAdapterRegistry(root)).toEqual([]);
    const dir = makeRoot();
    fs.cpSync(path.join(root, "specs", "adapters"), path.join(dir, "specs", "adapters"), {
      recursive: true,
    });
    const text = fs
      .readFileSync(path.join(root, "specs", "adapters", "claude-code.md"), "utf8")
      .replaceAll("NOT IMPLEMENTED", "Planned");
    fs.writeFileSync(path.join(dir, "specs", "adapters", "claude-code.md"), text);
    expect(checkAdapterRegistry(dir).map((item) => item.rule)).toContain("adapter-status-unclear");
  });
});
