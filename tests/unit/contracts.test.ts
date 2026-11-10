import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_IDS } from "../../scripts/lib/canonical.ts";
import { RUBRIC_DIMENSIONS, checkContracts } from "../../scripts/lib/contracts.ts";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const HANDOFF_SCHEMA = "schemas/handoff.schema.json";
const SCENARIOS_SCHEMA = "schemas/evaluation-scenarios.schema.json";

const examples = JSON.parse(
  fs.readFileSync(path.join(root, "specs", "handoff-examples.json"), "utf8"),
) as { handoff: Record<string, unknown>; response: Record<string, unknown> };

const scenarios = JSON.parse(
  fs.readFileSync(path.join(root, "specs", "evaluation", "scenarios.json"), "utf8"),
) as {
  version: number;
  status: string;
  agents: Record<string, Array<{ id: string; expectedBehaviors: string[] }>>;
  rubric: Array<{ dimension: string; question: string }>;
};

function validate(schema: string, value: unknown): string[] {
  return validateValueAgainstSchema(root, value, "test.json", schema, "test").map(
    (item) => item.message,
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const temporaryRoots: string[] = [];

function contractRoot(document: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-contracts-"));
  temporaryRoots.push(dir);
  fs.cpSync(path.join(root, "schemas"), path.join(dir, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs", "evaluation"), { recursive: true });
  fs.writeFileSync(path.join(dir, "specs", "handoff-examples.json"), JSON.stringify(examples));
  fs.writeFileSync(
    path.join(dir, "specs", "evaluation", "scenarios.json"),
    JSON.stringify(document),
  );
  return dir;
}

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("handoff contract", () => {
  it("accepts the checked handoff and response examples", () => {
    expect(validate(HANDOFF_SCHEMA, examples.handoff)).toEqual([]);
    expect(validate(HANDOFF_SCHEMA, examples.response)).toEqual([]);
    expect(checkContracts(root)).toEqual([]);
  });

  it("rejects a handoff with a missing required field", () => {
    const value = clone(examples.handoff);
    delete value.acceptanceCriteria;
    expect(validate(HANDOFF_SCHEMA, value).length).toBeGreaterThan(0);
  });

  it("rejects an invented field in a response", () => {
    const value = clone(examples.response);
    value.score = 99;
    expect(validate(HANDOFF_SCHEMA, value).join(" ")).toContain("additional properties");
  });

  it("rejects an invalid test state", () => {
    const value = clone(examples.response);
    const verification = value.verification as Record<string, unknown>;
    value.verification = { ...verification, testStates: ["passed-fabricated"] };
    expect(validate(HANDOFF_SCHEMA, value).length).toBeGreaterThan(0);
  });

  it("rejects an unknown handoff status", () => {
    const value = clone(examples.response);
    value.handoffStatus = "done" as never;
    expect(validate(HANDOFF_SCHEMA, value).length).toBeGreaterThan(0);
  });
});

describe("evaluation scenarios", () => {
  it("defines scenarios for every agent with no scores", () => {
    expect(Object.keys(scenarios.agents).sort()).toEqual([...AGENT_IDS].sort());
    expect(scenarios.status).toBe("defined");
    for (const [id, entries] of Object.entries(scenarios.agents)) {
      expect(entries.length, id).toBeGreaterThanOrEqual(3);
      for (const entry of entries) {
        expect(entry.expectedBehaviors.length).toBeGreaterThan(0);
        expect(Object.keys(entry)).not.toContain("score");
      }
    }
  });

  it("covers all eight rubric dimensions", () => {
    expect(scenarios.rubric.map((item) => item.dimension).sort()).toEqual(
      [...RUBRIC_DIMENSIONS].sort(),
    );
    for (const item of scenarios.rubric) expect(item.question.length).toBeGreaterThan(10);
  });

  it("validates against the scenarios schema", () => {
    expect(validate(SCENARIOS_SCHEMA, scenarios)).toEqual([]);
  });

  it("rejects a missing rubric dimension in the schema", () => {
    const value = clone(scenarios);
    value.rubric = value.rubric.slice(1);
    expect(validate(SCENARIOS_SCHEMA, value).length).toBeGreaterThan(0);
  });

  it("refuses to accept an unexecuted measured status", () => {
    const dir = contractRoot({ ...scenarios, status: "measured" });
    expect(checkContracts(dir).map((item) => item.rule)).toContain("unevaluated-scores-claimed");
  });

  it("detects a missing scenario set for an agent", () => {
    const agents = clone(scenarios.agents);
    delete agents["qa-engineer"];
    const dir = contractRoot({ ...scenarios, agents });
    expect(checkContracts(dir).map((item) => item.rule)).toContain("evaluation-agent-missing");
  });
});
