import { parse as parseYaml } from "yaml";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import { isExcluded, readText, walkFiles } from "./walk.ts";
import type { Finding } from "./types.ts";

export interface FrontmatterResult {
  present: boolean;
  data: unknown;
  body: string;
  error: string | null;
}

/** Extracts a leading YAML frontmatter block. An unclosed block is reported as an error. */
export function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { present: false, data: undefined, body: normalized, error: null };
  }

  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    return {
      present: true,
      data: undefined,
      body: normalized,
      error: "Frontmatter starts with --- but is never closed by a --- line.",
    };
  }

  const yamlText = lines.slice(1, closing).join("\n");
  const body = lines.slice(closing + 1).join("\n");
  try {
    return { present: true, data: parseYaml(yamlText) as unknown, body, error: null };
  } catch (error) {
    return {
      present: true,
      data: undefined,
      body,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkYamlSyntax(root: string): Finding[] {
  const findings: Finding[] = [];
  const yamlFiles = walkFiles(
    root,
    (rel) => !isExcluded(rel) && (rel.endsWith(".yaml") || rel.endsWith(".yml")),
  );
  for (const rel of yamlFiles) {
    const text = readText(root, rel);
    if (text === null) continue;
    try {
      parseYaml(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      findings.push(finding("error", "invalid-yaml", rel, `YAML parse failed: ${message}`));
    }
  }

  const markdownFiles = walkFiles(root, (rel) => !isExcluded(rel) && rel.endsWith(".md"));
  for (const rel of markdownFiles) {
    const text = readText(root, rel);
    if (text === null) continue;
    const result = parseFrontmatter(text);
    if (result.error) {
      findings.push(
        finding(
          "error",
          "invalid-frontmatter-yaml",
          rel,
          `Frontmatter is invalid: ${result.error}`,
        ),
      );
    }
  }
  return findings;
}

// The regex captures the stem, not the filename (e.g. "AGENTS", not "AGENTS.md").
const RULE_FILES_WITHOUT_FRONTMATTER = new Set(["AGENTS", "GEMINI"]);

/** Validates agent, skill and rule metadata against the verified Antigravity schemas. */
export function checkMetadata(root: string): Finding[] {
  const findings: Finding[] = [];
  const markdownFiles = walkFiles(root, (rel) => !isExcluded(rel) && rel.endsWith(".md"));

  for (const rel of markdownFiles) {
    const skillMatch = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    const agentFileMatch = /^agents\/([^/]+)\.md$/.exec(rel);
    const agentDirMatch = /^agents\/([^/]+)\/agent\.md$/.exec(rel);
    const ruleMatch = /^rules\/([^/]+)\.md$/.exec(rel);

    if (rel.startsWith("skills/") && rel.endsWith("/SKILL.md") && !skillMatch) {
      findings.push(
        finding(
          "warning",
          "component-scan-depth",
          rel,
          "Antigravity scans skills/ one level deep. Move this folder directly under skills/ or register it via skills.json.",
        ),
      );
      continue;
    }
    if (rel.startsWith("rules/") && rel.includes("/", 6) && rel.endsWith(".md")) {
      findings.push(
        finding(
          "warning",
          "component-scan-depth",
          rel,
          "Antigravity scans rules/ one level deep. Move this file directly under rules/ or register it via rules.json.",
        ),
      );
      continue;
    }
    if (
      rel.startsWith("agents/") &&
      rel.endsWith(".md") &&
      !agentFileMatch &&
      !agentDirMatch &&
      !rel.endsWith("/README.md")
    ) {
      findings.push(
        finding(
          "warning",
          "component-scan-depth",
          rel,
          "Antigravity loads agents/<name>.md and agents/<name>/agent.md only. Move this file to a supported path or register it via agents.json.",
        ),
      );
      continue;
    }

    let schemaRel: string | null = null;
    let ruleId = "";
    if (skillMatch) {
      schemaRel = "schemas/skill-frontmatter.schema.json";
      ruleId = "invalid-skill-metadata";
    } else if (agentFileMatch || agentDirMatch) {
      schemaRel = "schemas/agent-frontmatter.schema.json";
      ruleId = "invalid-agent-metadata";
    } else if (ruleMatch && !RULE_FILES_WITHOUT_FRONTMATTER.has(ruleMatch[1])) {
      schemaRel = "schemas/rule-frontmatter.schema.json";
      ruleId = "invalid-rule-metadata";
    } else {
      continue;
    }

    const text = readText(root, rel);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter.present || frontmatter.error) {
      findings.push(
        finding(
          "error",
          "missing-frontmatter",
          rel,
          "This component requires a valid YAML frontmatter block (see docs/27-OFFICIAL-FORMAT-VERIFICATION.md).",
        ),
      );
      continue;
    }

    findings.push(...validateValueAgainstSchema(root, frontmatter.data, rel, schemaRel, ruleId));

    const data =
      typeof frontmatter.data === "object" && frontmatter.data !== null
        ? (frontmatter.data as Record<string, unknown>)
        : null;

    if (skillMatch && data && data.name !== skillMatch[1]) {
      findings.push(
        finding(
          "error",
          "skill-name-folder-mismatch",
          rel,
          `frontmatter name "${String(data.name)}" must match the parent folder "${skillMatch[1]}".`,
        ),
      );
    }

    const agentStem = agentFileMatch?.[1] ?? agentDirMatch?.[1];
    if (agentStem && data && data.name !== agentStem) {
      findings.push(
        finding(
          "error",
          "agent-name-filename-mismatch",
          rel,
          `frontmatter name "${String(data.name)}" must match the agent path "${agentStem}".`,
        ),
      );
    }
  }
  return findings;
}
