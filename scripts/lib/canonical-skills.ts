import path from "node:path";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { parseFrontmatter } from "./yaml-frontmatter.ts";

export const SKILL_IDS = [
  "architecture",
  "advanced-debugging",
  "security-audit",
  "code-review",
  "frontend-engineering",
  "backend-engineering",
  "testing-engineering",
  "deep-research",
  "database-engineering",
  "performance-engineering",
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export const REQUIRED_SKILL_SECTIONS = [
  "Purpose",
  "Activation criteria",
  "Non-activation guidelines",
  "Required context and inputs",
  "Operating procedure",
  "Technical and engineering standards",
  "Verification and evidence requirements",
  "Expected outputs and deliverables",
  "Risks, boundaries and failure modes",
  "Progressive disclosure references",
] as const;

export const CANONICAL_SKILL_SCHEMA = "schemas/canonical-skill.schema.json";

export interface CanonicalSkillSpec {
  relPath: string;
  id: string;
  name: string;
  title: string;
  version: number;
  summary: string;
  description: string;
  requiredCapabilities: string[];
  primaryAgents: string[];
  activationTriggers: string[];
  nonActivationGuidelines: string[];
  body: string;
  frontmatter: Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Loads and structurally validates every canonical skill specification. */
export function loadCanonicalSkillSpecs(root: string): {
  specs: CanonicalSkillSpec[];
  findings: Finding[];
} {
  const specs: CanonicalSkillSpec[] = [];
  const findings: Finding[] = [];
  const relPaths = walkFiles(
    root,
    (rel) => rel.startsWith("specs/skills/") && rel.endsWith(".md") && !isExcluded(rel),
  );

  for (const relPath of relPaths) {
    if (relPath.startsWith("specs/skills/references/")) continue;
    if (path.posix.dirname(relPath) !== "specs/skills") continue;

    const text = readText(root, relPath);
    if (text === null) {
      findings.push(
        finding("error", "unreadable-canonical-skill", relPath, "File could not be read."),
      );
      continue;
    }
    const parsed = parseFrontmatter(text);
    if (!parsed.present || parsed.error) {
      findings.push(
        finding(
          "error",
          "invalid-canonical-skill-frontmatter",
          relPath,
          "Canonical skill requires valid YAML frontmatter.",
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
        CANONICAL_SKILL_SCHEMA,
        "invalid-canonical-skill",
      ),
    );

    const stem = path.posix.basename(relPath, ".md");
    if (asString(data.id) !== stem) {
      findings.push(
        finding(
          "error",
          "canonical-skill-id-filename-mismatch",
          relPath,
          `frontmatter id "${asString(data.id)}" must match the filename "${stem}".`,
        ),
      );
    }

    const missingSections = REQUIRED_SKILL_SECTIONS.filter(
      (section) => !new RegExp(`^## ${section}\\s*$`, "m").test(parsed.body),
    );
    for (const section of missingSections) {
      findings.push(
        finding(
          "error",
          "canonical-skill-section-missing",
          relPath,
          `Missing required section "## ${section}".`,
        ),
      );
    }

    specs.push({
      relPath,
      id: stem,
      name: asString(data.name),
      title: asString(data.title),
      version: typeof data.version === "number" ? data.version : 1,
      summary: asString(data.summary),
      description: asString(data.description),
      requiredCapabilities: asStringArray(data.requiredCapabilities),
      primaryAgents: asStringArray(data.primaryAgents),
      activationTriggers: asStringArray(data.activationTriggers),
      nonActivationGuidelines: asStringArray(data.nonActivationGuidelines),
      body: parsed.body,
      frontmatter: data,
    });
  }

  const ids = new Set(specs.map((spec) => spec.id));
  for (const expected of SKILL_IDS) {
    if (!ids.has(expected)) {
      findings.push(
        finding(
          "error",
          "canonical-skill-missing",
          "specs/skills/",
          `Missing canonical specification for "${expected}".`,
        ),
      );
    }
  }

  for (const spec of specs) {
    if (!SKILL_IDS.includes(spec.id as SkillId)) {
      findings.push(
        finding(
          "error",
          "unexpected-canonical-skill",
          spec.relPath,
          `Unexpected skill id "${spec.id}".`,
        ),
      );
    }
  }

  return { specs, findings };
}

export function validateCanonicalSkillSpecs(root: string): Finding[] {
  return loadCanonicalSkillSpecs(root).findings;
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

/** Produces the full content of each generated Antigravity skill file. */
export function buildSkillAdapterContent(spec: CanonicalSkillSpec): string {
  let adaptedBody = stripCanonicalHeading(spec.body);
  // Transform canonical link prefix (./references/<id>/) into adapter link prefix (./references/)
  adaptedBody = adaptedBody.replaceAll(`./references/${spec.id}/`, "./references/");

  const lines = [
    "---",
    `name: ${yamlScalar(spec.id)}`,
    `description: ${yamlScalar(spec.description)}`,
    "---",
    "",
    `# ${spec.name} — ${spec.title}`,
    "",
    `> Generated from \`${spec.relPath}\` by \`scripts/generate-antigravity-skills.ts\`. Edit the canonical specification, not this file.`,
    "",
    adaptedBody,
    "",
  ];
  return lines.join("\n");
}

/** Builds map of all generated skill files in skills/ */
export function buildSkillAdapterFiles(root: string): Map<string, string> {
  const output = new Map<string, string>();
  const { specs } = loadCanonicalSkillSpecs(root);
  for (const spec of specs) {
    output.set(`skills/${spec.id}/SKILL.md`, buildSkillAdapterContent(spec));
  }

  // Also collect and mirror reference files from specs/skills/references/<id>/ into skills/<id>/references/
  const refFiles = walkFiles(
    root,
    (rel) => rel.startsWith("specs/skills/references/") && rel.endsWith(".md") && !isExcluded(rel),
  );
  for (const rel of refFiles) {
    const text = readText(root, rel);
    if (text !== null) {
      const match = /^specs\/skills\/references\/([^/]+)\/(.+)$/.exec(rel);
      if (match) {
        output.set(`skills/${match[1]}/references/${match[2]}`, text);
      }
    }
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

/** Compares generated skill files with their canonical source, ignoring formatting-only drift. */
export function checkGeneratedSkills(root: string): Finding[] {
  const findings: Finding[] = loadCanonicalSkillSpecs(root).findings.slice();
  const expected = buildSkillAdapterFiles(root);

  for (const [relPath, content] of expected) {
    const actual = readText(root, relPath);
    if (actual === null) {
      findings.push(
        finding(
          "error",
          "generated-skill-missing",
          relPath,
          "Generated skill file is missing. Run npm run generate:skills.",
        ),
      );
      continue;
    }

    if (relPath.endsWith("/SKILL.md")) {
      const expectedParsed = parseFrontmatter(content);
      const actualParsed = parseFrontmatter(actual);
      if (!actualParsed.present || actualParsed.error) {
        findings.push(
          finding(
            "error",
            "generated-skill-frontmatter-invalid",
            relPath,
            "Generated skill frontmatter is not valid YAML.",
          ),
        );
        continue;
      }
      if (sortedJson(expectedParsed.data) !== sortedJson(actualParsed.data)) {
        findings.push(
          finding(
            "error",
            "generated-skill-stale",
            relPath,
            "Frontmatter differs from the canonical specification. Run npm run generate:skills.",
          ),
        );
      }
      if (normalizeBody(expectedParsed.body) !== normalizeBody(actualParsed.body)) {
        findings.push(
          finding(
            "error",
            "generated-skill-stale",
            relPath,
            "Body differs from the canonical specification. Run npm run generate:skills.",
          ),
        );
      }
    } else {
      // Direct comparison for reference files
      if (normalizeBody(content) !== normalizeBody(actual)) {
        findings.push(
          finding(
            "error",
            "generated-skill-reference-stale",
            relPath,
            "Skill reference file differs from specs/skills/references/. Run npm run generate:skills.",
          ),
        );
      }
    }
  }

  const expectedNames = new Set(expected.keys());
  const stray = walkFiles(
    root,
    (rel) =>
      rel.startsWith("skills/") &&
      rel.endsWith(".md") &&
      !expectedNames.has(rel) &&
      !isExcluded(rel),
  );
  for (const rel of stray) {
    findings.push(
      finding(
        "error",
        "unexpected-skill-file",
        rel,
        "This file has no canonical specification in specs/skills/. Remove it or regenerate.",
      ),
    );
  }

  return findings;
}
