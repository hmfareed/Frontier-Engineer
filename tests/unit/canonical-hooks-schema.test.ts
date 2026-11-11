import { describe, expect, it } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { CANONICAL_HOOK_SCHEMA, HOOK_REGISTRY_SCHEMA } from "../../scripts/lib/canonical-hooks.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("canonical hooks schema validation", () => {
  const validHook = {
    id: "test-pre-tool",
    name: "Test Pre Tool",
    description: "Inspects proposed tool executions for safety before running.",
    event: "PreToolUse",
    matcher: "run_command",
    handler: {
      type: "command",
      command: "node scripts/hooks/runtime/dispatcher.ts",
      timeout: 15,
    },
    securityClassification: "critical_security",
    failureMode: "fail_closed",
    enabled: true,
    platformConfig: {},
  };

  it("accepts a compliant canonical hook definition", () => {
    const findings = validateValueAgainstSchema(
      root,
      validHook,
      "test.md",
      CANONICAL_HOOK_SCHEMA,
      "test-rule",
    );
    expect(findings).toEqual([]);
  });

  it("rejects an unknown lifecycle event name", () => {
    const invalid = { ...validHook, event: "OnToolExecution" };
    const findings = validateValueAgainstSchema(
      root,
      invalid,
      "test.md",
      CANONICAL_HOOK_SCHEMA,
      "test-rule",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.message).toContain("must be equal to one of the allowed values");
  });

  it("rejects unsupported handler types", () => {
    const invalid = {
      ...validHook,
      handler: { type: "http", command: "http://localhost:8080", timeout: 10 },
    };
    const findings = validateValueAgainstSchema(
      root,
      invalid,
      "test.md",
      CANONICAL_HOOK_SCHEMA,
      "test-rule",
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it("rejects non-positive or bounded timeouts", () => {
    const zeroTimeout = {
      ...validHook,
      handler: { type: "command", command: "node test.js", timeout: 0 },
    };
    const findings = validateValueAgainstSchema(
      root,
      zeroTimeout,
      "test.md",
      CANONICAL_HOOK_SCHEMA,
      "test-rule",
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it("rejects an invalid failure mode", () => {
    const invalid = { ...validHook, failureMode: "ignore_errors" };
    const findings = validateValueAgainstSchema(
      root,
      invalid,
      "test.md",
      CANONICAL_HOOK_SCHEMA,
      "test-rule",
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it("validates hook registry schema against valid and invalid registries", () => {
    const validRegistry = {
      version: "0.6.3",
      lastUpdated: "2026-11-11",
      hooks: [
        {
          id: "test-pre-tool",
          name: "Test Pre Tool",
          event: "PreToolUse",
          matcher: "run_command",
          securityClassification: "critical_security",
          failureMode: "fail_closed",
          enabled: true,
          specPath: "specs/hooks/pre-tool-use.md",
          handlerPath: "scripts/hooks/handlers/pre-tool-use.ts",
          compatibility: {
            antigravity: "supported",
          },
        },
      ],
    };
    const validFindings = validateValueAgainstSchema(
      root,
      validRegistry,
      "specs/hooks/hook-registry.md",
      HOOK_REGISTRY_SCHEMA,
      "test-rule",
    );
    expect(validFindings).toEqual([]);

    const invalidRegistry = { ...validRegistry, version: "invalid" };
    const invalidFindings = validateValueAgainstSchema(
      root,
      invalidRegistry,
      "specs/hooks/hook-registry.md",
      HOOK_REGISTRY_SCHEMA,
      "test-rule",
    );
    expect(invalidFindings.length).toBeGreaterThan(0);
  });
});
