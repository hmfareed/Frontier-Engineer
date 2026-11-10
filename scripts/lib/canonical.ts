import path from "node:path";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { parseFrontmatter } from "./yaml-frontmatter.ts";

export const AGENT_IDS = [
  "frontier-engineer",
  "architect",
  "implementation-engineer",
  "security-auditor",
  "qa-engineer",
  "design-engineer",
] as const;

export const REQUIRED_SECTIONS = [
  "Identity",
  "Purpose",
  "Responsibilities",
  "Instructions",
  "Input requirements",
  "Expected outputs",
  "Decision-making procedures",
  "Handoff protocol",
  "Tool requirements",
  "Deliverables",
  "Restrictions",
] as const;

export const CANONICAL_SCHEMA = "schemas/canonical-agent.schema.json";

export interface CanonicalSpec {
  relPath: string;
  id: string;
  name: string;
  role: string;
  kind: "coordinator" | "specialist";
  summary: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Loads and structurally validates every canonical agent specification. */
export function loadCanonicalSpecs(root: string): { specs: CanonicalSpec[]; findings: Finding[] } {
  const specs: CanonicalSpec[] = [];
  const findings: Finding[] = [];
  const relPaths = walkFiles(
    root,
    (rel) => rel.startsWith("specs/agents/") && rel.endsWith(".md") && !isExcluded(rel),
  );

  for (const relPath of relPaths) {
    const text = readText(root, relPath);
    if (text === null) {
      findings.push(
        finding("error", "unreadable-canonical-agent", relPath, "File could not be read."),
      );
      continue;
    }
    const parsed = parseFrontmatter(text);
    if (!parsed.present || parsed.error) {
      findings.push(
        finding(
          "error",
          "invalid-canonical-frontmatter",
          relPath,
          "Canonical agent requires valid YAML frontmatter.",
        ),
      );
      continue;
    }
    const data =
      typeof parsed.data === "object" && parsed.data !== null
        ? (parsed.data as Record<string, unknown>)
        : {};
    findings.push(
      ...validateValueAgainstSchema(
        root,
        data,
        relPath,
        CANONICAL_SCHEMA,
        "invalid-canonical-agent",
      ),
    );

    const stem = path.posix.basename(relPath, ".md");
    if (asString(data.id) !== stem) {
      findings.push(
        finding(
          "error",
          "canonical-id-filename-mismatch",
          relPath,
          `frontmatter id "${asString(data.id)}" must match the filename "${stem}".`,
        ),
      );
    }

    const missingSections = REQUIRED_SECTIONS.filter(
      (section) => !new RegExp(`^## ${section}\\s*$`, "m").test(parsed.body),
    );
    for (const section of missingSections) {
      findings.push(
        finding(
          "error",
          "canonical-section-missing",
          relPath,
          `Missing required section "## ${section}".`,
        ),
      );
    }

    const delegatesTo = Array.isArray(data.delegatesTo) ? data.delegatesTo : [];
    for (const target of delegatesTo) {
      if (typeof target === "string" && !AGENT_IDS.includes(target as (typeof AGENT_IDS)[number])) {
        findings.push(
          finding(
            "error",
            "unknown-delegation-target",
            relPath,
            `"${target}" is not a known agent id.`,
          ),
        );
      }
    }

    specs.push({
      relPath,
      id: stem,
      name: asString(data.name),
      role: asString(data.role),
      kind: data.kind === "coordinator" ? "coordinator" : "specialist",
      summary: asString(data.summary),
      body: parsed.body,
      frontmatter: data,
    });
  }

  const ids = new Set(specs.map((spec) => spec.id));
  for (const expected of AGENT_IDS) {
    if (!ids.has(expected)) {
      findings.push(
        finding(
          "error",
          "canonical-agent-missing",
          "specs/agents/",
          `Missing canonical specification for "${expected}".`,
        ),
      );
    }
  }
  for (const spec of specs) {
    if (!AGENT_IDS.includes(spec.id as (typeof AGENT_IDS)[number])) {
      findings.push(
        finding(
          "error",
          "unexpected-canonical-agent",
          spec.relPath,
          `Unexpected agent id "${spec.id}".`,
        ),
      );
    }
  }

  const coordinators = specs.filter((spec) => spec.kind === "coordinator");
  if (coordinators.length !== 1 || coordinators[0]?.id !== "frontier-engineer") {
    findings.push(
      finding(
        "error",
        "invalid-coordinator-set",
        "specs/agents/",
        "Exactly one coordinator named frontier-engineer is required.",
      ),
    );
  }

  return { specs, findings };
}

export function validateCanonicalSpecs(root: string): Finding[] {
  return loadCanonicalSpecs(root).findings;
}

/** Platform-neutral summary used by the Antigravity adapter frontmatter. */
export function adapterFrontmatter(spec: CanonicalSpec): Record<string, unknown> {
  const isCoordinator = spec.kind === "coordinator";
  return {
    name: spec.id,
    description: spec.summary,
    mainAgent: isCoordinator,
    subagent: !isCoordinator,
    model: "inherit",
    commandExecutionPolicy: "sandbox",
  };
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function stripCanonicalHeading(body: string): string {
  return body
    .split("\n")
    .filter((line, index) => !(index < 5 && /^#\s/.test(line)))
    .join("\n")
    .replace(/^\s*\n+/, "")
    .trimEnd();
}

/** Produces the full content of each generated Antigravity agent file. */
export function buildAdapterContent(spec: CanonicalSpec): string {
  const frontmatter = adapterFrontmatter(spec);
  const lines = [
    "---",
    `name: ${yamlScalar(String(frontmatter.name))}`,
    `description: ${yamlScalar(String(frontmatter.description))}`,
    `mainAgent: ${String(frontmatter.mainAgent)}`,
    `subagent: ${String(frontmatter.subagent)}`,
    `model: ${String(frontmatter.model)}`,
    `commandExecutionPolicy: ${String(frontmatter.commandExecutionPolicy)}`,
    "---",
    "",
    `# ${spec.name} — ${spec.role}`,
    "",
    `> Generated from \`${spec.relPath}\` by \`scripts/generate-antigravity-agents.ts\`. Edit the canonical specification, not this file.`,
    "",
    stripCanonicalHeading(spec.body),
    "",
    "## Antigravity runtime adapter",
    "",
    `- **Role:** ${spec.kind === "coordinator" ? "primary agent; delegate with the verified \`invoke_subagent\` tool" : "background subagent; report results to the coordinator"}.`,
    "- **Handoff:** follow `specs/handoff-contract.md`. Include the `taskId` in every response.",
    "- **Permissions:** `commandExecutionPolicy: sandbox`; destructive, production, and external write actions require explicit human approval.",
    "- **Verification:** report executed checks and real outcomes only. Keep passed, failed, blocked, not executed, and not written distinct.",
    "- **Scope:** never expand the assigned scope or edit a file owned by another agent; ask the coordinator to reassign it.",
    "",
  ];
  return lines.join("\n");
}

export function buildAdapterFiles(root: string): Map<string, string> {
  const output = new Map<string, string>();
  for (const spec of loadCanonicalSpecs(root).specs) {
    output.set(`agents/${spec.id}.md`, buildAdapterContent(spec));
  }
  return output;
}

function normalizeBody(body: string): string {
  return body
    .replace(/^>\s*Generated from.*$/gm, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Compares generated agent files with their canonical source, ignoring formatting-only drift. */
export function checkGeneratedAgents(root: string): Finding[] {
  const findings: Finding[] = loadCanonicalSpecs(root).findings.slice();
  const expected = buildAdapterFiles(root);

  for (const [relPath, content] of expected) {
    const actual = readText(root, relPath);
    if (actual === null) {
      findings.push(
        finding(
          "error",
          "generated-agent-missing",
          relPath,
          "Generated agent file is missing. Run npm run generate:agents.",
        ),
      );
      continue;
    }
    const expectedParsed = parseFrontmatter(content);
    const actualParsed = parseFrontmatter(actual);
    if (!actualParsed.present || actualParsed.error) {
      findings.push(
        finding(
          "error",
          "generated-frontmatter-invalid",
          relPath,
          "Generated agent frontmatter is not valid YAML.",
        ),
      );
      continue;
    }
    if (sortedJson(expectedParsed.data) !== sortedJson(actualParsed.data)) {
      findings.push(
        finding(
          "error",
          "generated-agent-stale",
          relPath,
          "Frontmatter differs from the canonical specification. Run npm run generate:agents.",
        ),
      );
    }
    if (normalizeBody(expectedParsed.body) !== normalizeBody(actualParsed.body)) {
      findings.push(
        finding(
          "error",
          "generated-agent-stale",
          relPath,
          "Body differs from the canonical specification. Run npm run generate:agents.",
        ),
      );
    }
  }

  const expectedNames = new Set(expected.keys());
  const stray = walkFiles(
    root,
    (rel) =>
      rel.startsWith("agents/") &&
      rel.endsWith(".md") &&
      !expectedNames.has(rel) &&
      !isExcluded(rel),
  );
  for (const rel of stray) {
    findings.push(
      finding(
        "error",
        "unexpected-agent-file",
        rel,
        "This file has no canonical specification. Remove it or add a canonical spec and regenerate.",
      ),
    );
  }
  return findings;
}

const UNIMPLEMENTED_ADAPTERS = ["claude-code", "codex", "cursor", "windsurf"];

/** Guards against accidentally claiming an unverified adapter is functional. */
export function checkAdapterRegistry(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const name of UNIMPLEMENTED_ADAPTERS) {
    const rel = `specs/adapters/${name}.md`;
    const text = readText(root, rel);
    if (text === null) {
      findings.push(
        finding("error", "adapter-doc-missing", rel, "Adapter requirements document is missing."),
      );
    } else if (!text.includes("NOT IMPLEMENTED")) {
      findings.push(
        finding(
          "error",
          "adapter-status-unclear",
          rel,
          "Unimplemented adapters must be explicitly labelled NOT IMPLEMENTED.",
        ),
      );
    }
  }
  if (!exists(root, "specs/adapters/antigravity.md")) {
    findings.push(
      finding(
        "error",
        "adapter-doc-missing",
        "specs/adapters/antigravity.md",
        "Antigravity adapter document is missing.",
      ),
    );
  }
  return findings;
}
