import { describe, expect, it } from "vitest";
import { parseJsonText, validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

function validate(schema: string, value: unknown): string[] {
  return validateValueAgainstSchema(root, value, "test.json", `schemas/${schema}`, "test").map(
    (item) => item.message,
  );
}

describe("parseJsonText", () => {
  it("parses valid JSON", () => {
    expect(parseJsonText('{"a":1}', "a.json").ok).toBe(true);
  });

  it("returns an actionable error for malformed JSON", () => {
    const outcome = parseJsonText('{ "a": 1,', "a.json");
    expect(outcome.ok).toBe(false);
    expect(outcome.finding?.severity).toBe("error");
    expect(outcome.finding?.rule).toBe("invalid-json");
  });
});

describe("plugin manifest schema", () => {
  it("accepts a manifest using only verified fields", () => {
    expect(
      validate("plugin.schema.json", {
        $schema: "https://antigravity.google/schemas/v1/plugin.json",
        name: "frontier-engineer",
        version: "0.1.0",
        suggestedPrompts: ["Do something useful"],
      }),
    ).toEqual([]);
  });

  it("rejects an invalid name and an invented property", () => {
    const messages = validate("plugin.schema.json", {
      name: "Not_Kebab_Case",
      inventedProperty: true,
    });
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join(" ")).toContain("additional properties");
    expect(messages.join(" ")).toContain("must match pattern");
  });

  it("rejects more than three suggested prompts", () => {
    expect(
      validate("plugin.schema.json", {
        name: "demo",
        suggestedPrompts: ["a", "b", "c", "d"],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("skill and rule metadata schemas", () => {
  it("requires a description on a skill", () => {
    expect(validate("skill-frontmatter.schema.json", { name: "demo" }).length).toBeGreaterThan(0);
  });

  it("accepts a compliant skill", () => {
    expect(
      validate("skill-frontmatter.schema.json", { name: "demo", description: "Use when testing." }),
    ).toEqual([]);
  });

  it("requires description for a model_decision rule", () => {
    expect(
      validate("rule-frontmatter.schema.json", { trigger: "model_decision" }).length,
    ).toBeGreaterThan(0);
    expect(
      validate("rule-frontmatter.schema.json", {
        trigger: "model_decision",
        description: "Apply when reviewing database migrations.",
      }),
    ).toEqual([]);
  });

  it("requires globs for a glob rule", () => {
    expect(validate("rule-frontmatter.schema.json", { trigger: "glob" }).length).toBeGreaterThan(0);
    expect(
      validate("rule-frontmatter.schema.json", { trigger: "glob", globs: "**/*.ts, **/*.tsx" }),
    ).toEqual([]);
  });

  it("rejects an unsupported trigger value", () => {
    expect(
      validate("rule-frontmatter.schema.json", { trigger: "alwaysOn" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("optional config schemas", () => {
  it("requires exactly one transport on each MCP server", () => {
    expect(
      validate("mcp-config.schema.json", { mcpServers: { broken: { args: [] } } }).length,
    ).toBeGreaterThan(0);
    expect(validate("mcp-config.schema.json", { mcpServers: { ok: { command: "node" } } })).toEqual(
      [],
    );
  });

  it("rejects a flat Stop handler array wrapped as a tool event", () => {
    expect(
      validate("hooks.schema.json", {
        guard: { PreToolUse: [{ type: "command", command: "node check.mjs" }] },
      }).length,
    ).toBeGreaterThan(0);
  });

  it("accepts a verified hooks structure", () => {
    expect(
      validate("hooks.schema.json", {
        guard: {
          enabled: true,
          Stop: [{ type: "command", command: "node ./scripts/verify.mjs", timeout: 15 }],
          PreToolUse: [
            {
              matcher: "run_command",
              hooks: [{ type: "command", command: "node ./scripts/policy.mjs" }],
            },
          ],
        },
      }),
    ).toEqual([]);
  });
});
