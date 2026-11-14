import { describe, expect, it } from "vitest";
import { getAgentRetrievalPolicy } from "../../scripts/retrieval/agent-policies.ts";
import { ContextBudgeter } from "../../scripts/retrieval/context-budgeter.ts";
import { RelevanceRanker } from "../../scripts/retrieval/relevance-ranker.ts";
import { TaskClassifier } from "../../scripts/retrieval/task-classifier.ts";
import type { RankedFileItem, RankedMemoryItem } from "../../scripts/retrieval/types.ts";

describe("RelevanceRanker & ContextBudgeter (Deterministic Scoring & Allocation)", () => {
  function makeFileItem(
    filePath: string,
    tier: "CONFIRMED" | "INFERRED" = "CONFIRMED",
  ): RankedFileItem {
    return {
      id: `file:${filePath}`,
      domain: "files",
      title: filePath,
      rankScore: 0,
      rankingReasons: [],
      confidenceTier: tier,
      untrustedRepositoryContent: false,
      filePath,
      language: "typescript",
      classification: "source",
      sensitivityStatus: "SAFE",
      exportedSymbolsCount: 2,
      importsCount: 1,
      evidence: [],
    };
  }

  function makeMemoryItem(
    key: string,
    liveStatus: RankedMemoryItem["liveVerificationStatus"],
  ): RankedMemoryItem {
    return {
      id: `memory:${key}`,
      domain: "memories",
      title: `${key} guidance`,
      rankScore: 0,
      rankingReasons: [],
      confidenceTier: "CONFIRMED",
      untrustedRepositoryContent: true,
      memoryId: 1,
      memoryKey: key,
      category: "engineering_convention",
      lifecycleStatus: liveStatus === "DISPUTED" ? "DISPUTED" : "ACTIVE",
      liveVerificationStatus: liveStatus,
      supersededById: null,
      version: 1,
      content: "Verify invariants cleanly before saving changes.",
      promptInjectionDetected: false,
      evidence: [],
    };
  }

  it("ranks exact target matches and verified memories ahead of stale or distant candidates deterministically", () => {
    const policy = getAgentRetrievalPolicy("implementation-engineer");
    const classification = TaskClassifier.classify({
      agentId: "implementation-engineer",
      taskSummary: "Fix auth validation bug in src/auth/validator.ts",
    });

    const target = makeFileItem("src/auth/validator.ts");
    const neighbor = makeFileItem("src/auth/session.ts");
    const unrelated = makeFileItem("src/billing/invoice.ts");
    const verifiedMem = makeMemoryItem("auth-check-active", "VERIFIED");
    const staleMem = makeMemoryItem("auth-check-stale", "STALE");

    const inputs = {
      classification,
      policy,
      seedFiles: new Set(["src/auth/validator.ts", "src/auth/session.ts"]),
    };

    const runA = RelevanceRanker.rank([unrelated, staleMem, neighbor, verifiedMem, target], inputs);
    const runB = RelevanceRanker.rank([target, verifiedMem, staleMem, unrelated, neighbor], inputs);

    expect(runA.map((i) => i.id)).toEqual(runB.map((i) => i.id));
    expect(runA[0].id).toBe("file:src/auth/validator.ts");
    expect(runA[0].rankingReasons).toContain("exact_target_file(+45)");

    const idxVerified = runA.findIndex((i) => i.id === "memory:auth-check-active");
    const idxStale = runA.findIndex((i) => i.id === "memory:auth-check-stale");
    expect(idxVerified).toBeLessThan(idxStale);
  });

  it("enforces item, character, and token budgets strictly and emits deterministic truncation metadata", () => {
    const policy = getAgentRetrievalPolicy("implementation-engineer");
    const items = Array.from({ length: 15 }, (_, idx) =>
      makeFileItem(`src/mod/file_${String(idx).padStart(2, "0")}.ts`),
    );

    const allocation = ContextBudgeter.allocate(
      items,
      {
        maxItems: 5,
        maxTotalChars: 2400,
        maxTokens: 600,
        maxDepth: 2,
        maxSnippetLines: 20,
      },
      policy,
      300,
    );

    expect(allocation.selected.length).toBeLessThanOrEqual(5);
    expect(allocation.budget.usedChars).toBeLessThanOrEqual(2400);
    expect(allocation.budget.estimatedTokens).toBeLessThanOrEqual(600);
    expect(allocation.budget.truncatedCount).toBe(15 - allocation.selected.length);
    expect(allocation.budget.truncatedDomains).toEqual(["files"]);
    expect(allocation.budget.omittedItemIds.length).toBe(allocation.budget.truncatedCount);
  });

  it("deduplicates duplicate candidate IDs, demotes disputed/unverified memories cleanly, and ranks confirmed ADRs over fallbacks", () => {
    const policy = getAgentRetrievalPolicy("implementation-engineer");
    const classification = TaskClassifier.classify({
      agentId: "implementation-engineer",
      taskSummary: "Fix auth validation bug",
    });

    const verifiedMem = makeMemoryItem("mem-verified", "VERIFIED");
    const unverifiedMem = makeMemoryItem("mem-unverified", "UNVERIFIED");
    const disputedMem = makeMemoryItem("mem-disputed", "DISPUTED");

    const ranked = RelevanceRanker.rank([disputedMem, unverifiedMem, verifiedMem], {
      classification,
      policy,
      seedFiles: new Set(),
    });
    expect(ranked[0].id).toBe("memory:mem-verified");
    expect(ranked[1].id).toBe("memory:mem-unverified");
    expect(ranked[2].id).toBe("memory:mem-disputed");

    const dupA = makeFileItem("src/auth/validator.ts");
    const dupB = makeFileItem("src/auth/validator.ts");
    const alloc = ContextBudgeter.allocate([dupA, dupB], policy.defaultLimits, policy, 200);
    expect(alloc.selected.length).toBe(1);
  });
});
