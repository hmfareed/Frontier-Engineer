import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_IDS } from "../../scripts/lib/canonical.ts";
import {
  AGENT_RETRIEVAL_POLICIES,
  HARD_SAFETY_CEILINGS,
  getAgentRetrievalPolicy,
  resolveEffectivePolicy,
} from "../../scripts/retrieval/agent-policies.ts";
import type { AgentId } from "../../scripts/retrieval/types.ts";

describe("Agent Retrieval Policies & Configuration Precedence", () => {
  const tempDirs: string[] = [];

  function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-ret-policy-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("defines distinct non-overridable security policies for every canonical agent", () => {
    expect(Object.keys(AGENT_RETRIEVAL_POLICIES).sort()).toEqual([...AGENT_IDS].sort());
    for (const id of AGENT_IDS) {
      const policy = getAgentRetrievalPolicy(id as AgentId);
      expect(policy.agentId).toBe(id);
      expect(policy.excludeSensitiveContent).toBe(true);
      expect(policy.requireUntrustedFence).toBe(true);
      expect(policy.defaultLimits.maxDepth).toBeLessThanOrEqual(HARD_SAFETY_CEILINGS.maxDepth);
      expect(policy.defaultLimits.maxItems).toBeLessThanOrEqual(HARD_SAFETY_CEILINGS.maxItems);
    }

    expect(getAgentRetrievalPolicy("frontier-engineer").defaultIncludeSnippets).toBe(false);
    expect(getAgentRetrievalPolicy("architect").defaultIncludeSnippets).toBe(false);
    expect(getAgentRetrievalPolicy("implementation-engineer").defaultIncludeSnippets).toBe(true);
    expect(getAgentRetrievalPolicy("security-auditor").defaultIncludeSnippets).toBe(true);
    expect(getAgentRetrievalPolicy("qa-engineer").priorityDomains[0]).toBe("tests");
    expect(getAgentRetrievalPolicy("design-engineer").priorityDomains[0]).toBe("components");
  });

  it("enforces request > workspace .frontier/retrieval.config.json > defaults and clamps ceilings", () => {
    const ws = makeTempWorkspace();
    const frontierDir = path.join(ws, ".frontier");
    fs.mkdirSync(frontierDir, { recursive: true });
    fs.writeFileSync(
      path.join(frontierDir, "retrieval.config.json"),
      JSON.stringify({
        version: 1,
        defaults: { maxItems: 20, maxTotalChars: 24000 },
        agents: {
          architect: {
            includeSnippets: true,
            limits: { maxDepth: 5, maxItems: 28 },
          },
        },
      }),
      "utf8",
    );

    const resolvedFromWs = resolveEffectivePolicy(ws, {
      agentId: "architect",
      taskSummary: "Inspect architecture",
    });
    expect(resolvedFromWs.warnings).toEqual([]);
    expect(resolvedFromWs.includeSnippets).toBe(true);
    expect(resolvedFromWs.effectiveLimits.maxItems).toBe(28);
    expect(resolvedFromWs.effectiveLimits.maxDepth).toBe(5);
    expect(resolvedFromWs.effectiveLimits.maxTotalChars).toBe(24000);

    // Explicit request overrides workspace config but gets clamped by hard ceilings
    const clamped = resolveEffectivePolicy(ws, {
      agentId: "architect",
      taskSummary: "Inspect architecture",
      includeSnippets: false,
      limits: { maxItems: 9999, maxDepth: 99, maxTotalChars: 9999999, maxSnippetLines: 500 },
    });
    expect(clamped.includeSnippets).toBe(false);
    expect(clamped.effectiveLimits.maxItems).toBe(HARD_SAFETY_CEILINGS.maxItems);
    expect(clamped.effectiveLimits.maxDepth).toBe(HARD_SAFETY_CEILINGS.maxDepth);
    expect(clamped.effectiveLimits.maxTotalChars).toBe(HARD_SAFETY_CEILINGS.maxTotalChars);
    expect(clamped.effectiveLimits.maxSnippetLines).toBe(HARD_SAFETY_CEILINGS.maxSnippetLines);
  });

  it("ignores invalid workspace config safely and surfaces INVALID_WORKSPACE_CONFIG warning", () => {
    const ws = makeTempWorkspace();
    const frontierDir = path.join(ws, ".frontier");
    fs.mkdirSync(frontierDir, { recursive: true });
    fs.writeFileSync(
      path.join(frontierDir, "retrieval.config.json"),
      JSON.stringify({
        version: 1,
        unexpectedKey: true,
      }),
      "utf8",
    );

    const resolved = resolveEffectivePolicy(ws, {
      agentId: "qa-engineer",
      taskSummary: "Run tests",
    });
    expect(resolved.warnings.some((w) => w.code === "INVALID_WORKSPACE_CONFIG")).toBe(true);
    expect(resolved.effectiveLimits).toEqual(AGENT_RETRIEVAL_POLICIES["qa-engineer"].defaultLimits);
  });
});
