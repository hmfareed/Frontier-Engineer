import { AGENT_IDS } from "./canonical.ts";
import { parseJsonText, validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { readText } from "./walk.ts";

const HANDOFF_SCHEMA = "schemas/handoff.schema.json";
const SCENARIOS_SCHEMA = "schemas/evaluation-scenarios.schema.json";

export const RUBRIC_DIMENSIONS = [
  "Correctness",
  "Relevance",
  "Technical reasoning",
  "Instruction adherence",
  "Completeness",
  "Security awareness",
  "Honesty",
  "Appropriate delegation",
] as const;

const SCENARIO_PREFIXES: Record<string, string> = {
  "frontier-engineer": "FE",
  architect: "AR",
  "implementation-engineer": "IM",
  "security-auditor": "SE",
  "qa-engineer": "QA",
  "design-engineer": "DE",
};

function readJson(root: string, relPath: string): { value: unknown; findings: Finding[] } {
  const text = readText(root, relPath);
  if (text === null) {
    return {
      value: undefined,
      findings: [
        finding(
          "error",
          "contract-file-missing",
          relPath,
          `Required file is missing. Create ${relPath}.`,
        ),
      ],
    };
  }
  const parsed = parseJsonText(text, relPath);
  if (!parsed.ok && parsed.finding) return { value: undefined, findings: [parsed.finding] };
  return { value: parsed.value, findings: [] };
}

/** Validates the handoff contract examples and the evaluation scenario definitions. */
export function checkContracts(root: string): Finding[] {
  const findings: Finding[] = [];

  const examples = readJson(root, "specs/handoff-examples.json");
  findings.push(...examples.findings);
  if (examples.value && typeof examples.value === "object") {
    const record = examples.value as Record<string, unknown>;
    for (const key of ["handoff", "response"]) {
      if (!(key in record)) {
        findings.push(
          finding(
            "error",
            "contract-example-missing",
            "specs/handoff-examples.json",
            `Missing "${key}" example.`,
          ),
        );
        continue;
      }
      findings.push(
        ...validateValueAgainstSchema(
          root,
          record[key],
          `specs/handoff-examples.json#${key}`,
          HANDOFF_SCHEMA,
          "invalid-handoff-example",
        ),
      );
    }
  }

  const scenarios = readJson(root, "specs/evaluation/scenarios.json");
  findings.push(...scenarios.findings);
  if (!scenarios.value || typeof scenarios.value !== "object") return findings;

  const document = scenarios.value as Record<string, unknown>;
  findings.push(
    ...validateValueAgainstSchema(
      root,
      document,
      "specs/evaluation/scenarios.json",
      SCENARIOS_SCHEMA,
      "invalid-evaluation-scenarios",
    ),
  );

  if (document.status !== "defined") {
    findings.push(
      finding(
        "error",
        "unevaluated-scores-claimed",
        "specs/evaluation/scenarios.json",
        'status must remain "defined" until evaluations are actually executed and scored.',
      ),
    );
  }

  const agents = (document.agents ?? {}) as Record<string, unknown>;
  const keys = Object.keys(agents);
  for (const id of AGENT_IDS) {
    if (!keys.includes(id)) {
      findings.push(
        finding(
          "error",
          "evaluation-agent-missing",
          "specs/evaluation/scenarios.json",
          `No scenarios defined for "${id}".`,
        ),
      );
    }
  }
  for (const [id, entries] of Object.entries(agents)) {
    if (!Array.isArray(entries)) continue;
    const prefix = SCENARIO_PREFIXES[id];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const scenarioId = (entry as Record<string, unknown>).id;
      if (prefix && typeof scenarioId === "string" && !scenarioId.startsWith(`${prefix}-`)) {
        findings.push(
          finding(
            "error",
            "evaluation-id-prefix",
            "specs/evaluation/scenarios.json",
            `Scenario "${scenarioId}" under "${id}" must use the "${prefix}-" prefix.`,
          ),
        );
      }
    }
  }

  const rubric = Array.isArray(document.rubric)
    ? (document.rubric as Array<Record<string, unknown>>)
    : [];
  const dimensions = rubric.map((item) => String(item.dimension ?? ""));
  for (const dimension of RUBRIC_DIMENSIONS) {
    if (!dimensions.includes(dimension)) {
      findings.push(
        finding(
          "error",
          "rubric-dimension-missing",
          "specs/evaluation/scenarios.json",
          `Rubric is missing "${dimension}".`,
        ),
      );
    }
  }

  return findings;
}
