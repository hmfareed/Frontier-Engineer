import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();
const examples = JSON.parse(
  fs.readFileSync(path.join(root, "specs", "handoff-examples.json"), "utf8"),
) as { handoff: Record<string, unknown>; response: Record<string, unknown> };

describe("Handoff Retrieval Attachment Backward Compatibility", () => {
  function validateHandoff(candidate: unknown): string[] {
    return validateValueAgainstSchema(
      root,
      candidate,
      "handoff-test.json",
      "schemas/handoff.schema.json",
      "handoff-compat",
    ).map((f) => f.message);
  }

  it("preserves full compatibility with legacy handoffs lacking retrievalContext", () => {
    expect(validateHandoff(examples.handoff)).toEqual([]);
    expect(validateHandoff(examples.response)).toEqual([]);
  });

  it("accepts a handoff carrying a schema-valid compact retrievalContext attachment", () => {
    const withRetrieval = {
      ...examples.handoff,
      retrievalContext: {
        contract: "frontier-engineer/retrieval-attachment",
        version: 1,
        retrievalId: "ret-1234567890abcdef",
        repositoryIdentity: "repo-demo-123",
        scanId: 4,
        snapshotStatus: "COMPLETE",
        freshnessStatus: "FRESH",
        isStale: false,
        taskType: "security_audit",
        confidenceSummary: {
          confirmedCount: 3,
          inferredCount: 1,
          candidateCount: 0,
          unresolvedCount: 0,
          isMixedConfidence: true,
        },
        highlights: [
          {
            domain: "files",
            idOrPath: "file:src/middleware/auth.ts",
            summary: "src/middleware/auth.ts",
            confidenceTier: "CONFIRMED",
            evidenceFile: "src/middleware/auth.ts",
          },
        ],
        warnings: [],
        budget: {
          includedCount: 4,
          truncatedCount: 0,
          estimatedTokens: 320,
        },
      },
    };

    expect(validateHandoff(withRetrieval)).toEqual([]);
  });

  it("rejects malformed retrievalContext fields or extra unknown properties", () => {
    const withBadExtra = {
      ...examples.handoff,
      inventedProperty: "blocked",
    };
    expect(validateHandoff(withBadExtra).join(" ")).toContain("additional properties");

    const withBadAttachment = {
      ...examples.handoff,
      retrievalContext: {
        contract: "frontier-engineer/retrieval-attachment",
        version: 99,
        unexpectedNested: true,
      },
    };
    expect(validateHandoff(withBadAttachment).length).toBeGreaterThan(0);
  });
});
