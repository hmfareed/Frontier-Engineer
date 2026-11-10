import path from "node:path";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { parseFrontmatter } from "./yaml-frontmatter.ts";

export const RULE_CATEGORIES = [
  "engineering",
  "frontend",
  "backend",
  "database",
  "security",
  "testing",
  "performance",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const MODULAR_RULE_IDS = [
  "general-engineering",
  "code-quality",
  "documentation",
  "frontend-standards",
  "accessibility",
  "backend-standards",
  "api-security",
  "database-standards",
  "migration-safety",
  "security-standards",
  "secrets-management",
  "testing-standards",
  "performance-standards",
] as const;

export type ModularRuleId = (typeof MODULAR_RULE_IDS)[number];

export const REQUIRED_RULE_SECTIONS = [
  "Purpose",
  "Scope and applicability",
  "Core standards",
  "Invariants and prohibitions",
  "Verification criteria",
] as const;

export const MANDATORY_GLOBAL_PRINCIPLES = [
  "Inspect before implementing",
  "Understand the existing architecture",
  "Prefer existing project conventions",
  "Plan complex changes",
  "Make minimal, focused, maintainable changes",
  "Never claim a feature works without verification",
  "Run relevant tests after implementation",
  "Report failed tests and unresolved issues honestly",
  "Avoid unnecessary dependencies",
  "Never expose secrets or credentials",
  "Require approval for destructive operations",
  "Preserve existing user work",
  "Distinguish assumptions from verified facts",
  "Do not fabricate documentation, APIs, or tool capabilities",
  "Document important architectural decisions",
] as const;

export const CANONICAL_RULE_SCHEMA = "schemas/canonical-rule.schema.json";

export interface CanonicalRuleSpec {
  relPath: string;
  id: string;
  name: string;
  category: RuleCategory;
  triggerType: "always_on" | "glob" | "model_decision";
  globs?: string;
  description: string;
  priority: number;
  enforcementLevel: "mandatory" | "advisory";
  body: string;
  frontmatter: Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Loads and validates all canonical rules (both AGENTS.md and the modular rules in subfolders). */
export function loadCanonicalRules(root: string): {
  rules: CanonicalRuleSpec[];
  globalRule: string | null;
  findings: Finding[];
} {
  const rules: CanonicalRuleSpec[] = [];
  const findings: Finding[] = [];

  // Check global AGENTS.md in specs/rules/
  const globalPath = "specs/rules/AGENTS.md";
  const globalText = readText(root, globalPath);
  if (globalText === null) {
    findings.push(
      finding(
        "error",
        "canonical-global-rule-missing",
        globalPath,
        "Global AGENTS.md rule is missing in specs/rules/.",
      ),
    );
  } else {
    const parsed = parseFrontmatter(globalText);
    if (parsed.present) {
      findings.push(
        finding(
          "error",
          "global-rule-has-frontmatter",
          globalPath,
          "Global AGENTS.md must not contain YAML frontmatter (always-on rule).",
        ),
      );
    }
    for (const principle of MANDATORY_GLOBAL_PRINCIPLES) {
      if (!globalText.includes(principle)) {
        findings.push(
          finding(
            "error",
            "global-rule-missing-principle",
            globalPath,
            `Global rule is missing mandatory principle: "${principle}".`,
          ),
        );
      }
    }
  }

  // Load modular rules from specs/rules/<category>/<id>.md
  const relPaths = walkFiles(
    root,
    (rel) =>
      rel.startsWith("specs/rules/") &&
      rel.endsWith(".md") &&
      !isExcluded(rel) &&
      rel !== "specs/rules/AGENTS.md",
  );

  for (const relPath of relPaths) {
    const text = readText(root, relPath);
    if (text === null) {
      findings.push(
        finding("error", "unreadable-canonical-rule", relPath, "File could not be read."),
      );
      continue;
    }

    const parsed = parseFrontmatter(text);
    if (!parsed.present || parsed.error) {
      findings.push(
        finding(
          "error",
          "invalid-canonical-rule-frontmatter",
          relPath,
          "Canonical rule requires valid YAML frontmatter.",
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
        CANONICAL_RULE_SCHEMA,
        "invalid-canonical-rule",
      ),
    );

    const stem = path.posix.basename(relPath, ".md");
    if (asString(data.id) !== stem) {
      findings.push(
        finding(
          "error",
          "canonical-rule-id-filename-mismatch",
          relPath,
          `frontmatter id "${asString(data.id)}" must match the filename "${stem}".`,
        ),
      );
    }

    const categoryDir = path.posix.basename(path.posix.dirname(relPath));
    if (asString(data.category) !== categoryDir) {
      findings.push(
        finding(
          "error",
          "canonical-rule-category-mismatch",
          relPath,
          `frontmatter category "${asString(data.category)}" must match the parent directory "${categoryDir}".`,
        ),
      );
    }

    const missingSections = REQUIRED_RULE_SECTIONS.filter(
      (section) => !new RegExp(`^## ${section}\\s*$`, "m").test(parsed.body),
    );
    for (const section of missingSections) {
      findings.push(
        finding(
          "error",
          "canonical-rule-section-missing",
          relPath,
          `Missing required section "## ${section}".`,
        ),
      );
    }

    rules.push({
      relPath,
      id: stem,
      name: asString(data.name),
      category: data.category as RuleCategory,
      triggerType: data.triggerType as "always_on" | "glob" | "model_decision",
      globs: typeof data.globs === "string" ? data.globs : undefined,
      description: asString(data.description),
      priority: typeof data.priority === "number" ? data.priority : 5,
      enforcementLevel: data.enforcementLevel === "mandatory" ? "mandatory" : "advisory",
      body: parsed.body,
      frontmatter: data,
    });
  }

  const ids = new Set(rules.map((r) => r.id));
  for (const expected of MODULAR_RULE_IDS) {
    if (!ids.has(expected)) {
      findings.push(
        finding(
          "error",
          "canonical-rule-missing",
          "specs/rules/",
          `Missing canonical rule specification for "${expected}".`,
        ),
      );
    }
  }

  for (const rule of rules) {
    if (!MODULAR_RULE_IDS.includes(rule.id as ModularRuleId)) {
      findings.push(
        finding(
          "error",
          "unexpected-canonical-rule",
          rule.relPath,
          `Unexpected rule id "${rule.id}".`,
        ),
      );
    }
  }

  return { rules, globalRule: globalText, findings };
}

export function validateCanonicalRules(root: string): Finding[] {
  return loadCanonicalRules(root).findings;
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

/** Produces Antigravity rule adapter content with verified Antigravity frontmatter. */
export function buildRuleAdapterContent(spec: CanonicalRuleSpec): string {
  const frontmatterLines = ["---", `trigger: ${yamlScalar(spec.triggerType)}`];
  if (spec.triggerType === "glob" && spec.globs) {
    frontmatterLines.push(`globs: ${yamlScalar(spec.globs)}`);
  }
  if (spec.description) {
    frontmatterLines.push(`description: ${yamlScalar(spec.description)}`);
  }
  frontmatterLines.push("---");

  const lines = [
    ...frontmatterLines,
    "",
    `# ${spec.name} Rule`,
    "",
    `> Generated from \`${spec.relPath}\` by \`scripts/generate-antigravity-rules.ts\`. Edit the canonical specification, not this file.`,
    "",
    stripCanonicalHeading(spec.body),
    "",
  ];
  return lines.join("\n");
}

/** Builds map of all generated rule files in rules/ */
export function buildRuleAdapterFiles(root: string): Map<string, string> {
  const output = new Map<string, string>();
  const { rules, globalRule } = loadCanonicalRules(root);

  if (globalRule !== null) {
    const adaptedGlobal = globalRule.replaceAll("../../docs/", "../docs/");
    output.set("rules/AGENTS.md", adaptedGlobal);
  }

  for (const rule of rules) {
    output.set(`rules/${rule.id}.md`, buildRuleAdapterContent(rule));
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

/** Compares generated rule files in rules/ with canonical specifications in specs/rules/. */
export function checkGeneratedRules(root: string): Finding[] {
  const findings: Finding[] = loadCanonicalRules(root).findings.slice();
  const expected = buildRuleAdapterFiles(root);

  for (const [relPath, content] of expected) {
    const actual = readText(root, relPath);
    if (actual === null) {
      findings.push(
        finding(
          "error",
          "generated-rule-missing",
          relPath,
          "Generated rule file is missing. Run npm run generate:rules.",
        ),
      );
      continue;
    }

    if (relPath === "rules/AGENTS.md") {
      if (normalizeBody(content) !== normalizeBody(actual)) {
        findings.push(
          finding(
            "error",
            "generated-rule-stale",
            relPath,
            "rules/AGENTS.md differs from specs/rules/AGENTS.md. Run npm run generate:rules.",
          ),
        );
      }
      continue;
    }

    const expectedParsed = parseFrontmatter(content);
    const actualParsed = parseFrontmatter(actual);
    if (!actualParsed.present || actualParsed.error) {
      findings.push(
        finding(
          "error",
          "generated-rule-frontmatter-invalid",
          relPath,
          "Generated rule frontmatter is not valid YAML.",
        ),
      );
      continue;
    }

    if (sortedJson(expectedParsed.data) !== sortedJson(actualParsed.data)) {
      findings.push(
        finding(
          "error",
          "generated-rule-stale",
          relPath,
          "Frontmatter differs from canonical specification. Run npm run generate:rules.",
        ),
      );
    }

    if (normalizeBody(expectedParsed.body) !== normalizeBody(actualParsed.body)) {
      findings.push(
        finding(
          "error",
          "generated-rule-stale",
          relPath,
          "Body differs from canonical specification. Run npm run generate:rules.",
        ),
      );
    }
  }

  const expectedNames = new Set(expected.keys());
  const stray = walkFiles(
    root,
    (rel) =>
      rel.startsWith("rules/") &&
      rel.endsWith(".md") &&
      !expectedNames.has(rel) &&
      !isExcluded(rel),
  );
  for (const rel of stray) {
    findings.push(
      finding(
        "error",
        "unexpected-rule-file",
        rel,
        "This file has no canonical specification in specs/rules/. Remove it or regenerate.",
      ),
    );
  }

  return findings;
}
