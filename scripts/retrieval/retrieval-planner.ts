/**
 * Phase 7.6 — Retrieval Planner
 * Maps task classification, agent policy, and request overrides into a bounded retrieval plan.
 */

import type { ResolvedRetrievalPolicy } from "./agent-policies.ts";
import type {
  RetrievalDomain,
  RetrievalPlan,
  RetrievalPlanStep,
  RetrievalRequest,
  TaskClassification,
  TaskType,
} from "./types.ts";

const TASK_DOMAIN_BOOSTS: Record<TaskType, RetrievalDomain[]> = {
  architecture_design: ["components", "decisions", "dependencies", "memories", "overview"],
  feature_implementation: ["files", "symbols", "dependencies", "tests", "snippets", "memories"],
  bug_fix: ["files", "symbols", "dependencies", "tests", "snippets", "memories"],
  refactoring: ["dependencies", "components", "files", "symbols", "tests", "decisions"],
  database_change: [
    "components",
    "files",
    "symbols",
    "decisions",
    "dependencies",
    "memories",
    "tests",
  ],
  security_audit: ["components", "dependencies", "files", "decisions", "memories", "snippets"],
  test_generation: ["tests", "files", "symbols", "components", "memories"],
  ui_ux_work: ["components", "files", "symbols", "snippets", "decisions", "tests"],
  documentation: ["decisions", "overview", "components", "memories", "files"],
  evolution_review: ["evolution", "memories", "decisions", "components", "files"],
  general_inspection: ["overview", "components", "files", "decisions", "memories"],
};

export class RetrievalPlanner {
  public static buildPlan(
    request: RetrievalRequest,
    classification: TaskClassification,
    resolvedPolicy: ResolvedRetrievalPolicy,
  ): RetrievalPlan {
    const { policy, effectiveLimits, includeSnippets, includeHistoricalMemories, priorityDomains } =
      resolvedPolicy;

    const taskBoosts = new Set<RetrievalDomain>(
      TASK_DOMAIN_BOOSTS[classification.primaryTaskType] ?? [],
    );

    const hasTargetFiles = classification.extractedTargets.files.length > 0;
    const hasTargetSymbols = classification.extractedTargets.symbols.length > 0;
    const hasTargetComponents = classification.extractedTargets.components.length > 0;
    const hasTargetAdrs = classification.extractedTargets.adrs.length > 0;
    const hasEvolutionPair =
      (request.baseScanId ?? classification.extractedTargets.baseScanId) !== undefined &&
      (request.targetScanId ?? classification.extractedTargets.targetScanId) !== undefined;

    const isLowSignalFallback =
      classification.confidenceTier === "UNRESOLVED" ||
      (classification.isAmbiguous === true &&
        !hasTargetFiles &&
        !hasTargetSymbols &&
        !hasTargetComponents &&
        !hasTargetAdrs &&
        !hasEvolutionPair);

    const candidates = new Set<RetrievalDomain>(priorityDomains);
    // Keep low-signal/unintelligible fallback plans tightly bounded to orientation + core governance domains
    if (isLowSignalFallback) {
      for (const dom of Array.from(candidates)) {
        if (!["overview", "components", "decisions", "memories", "files"].includes(dom)) {
          candidates.delete(dom);
        }
      }
      candidates.add("overview");
      candidates.add("components");
      candidates.add("decisions");
      candidates.add("memories");
    } else {
      // Always include core orientation + target-matching domains
      candidates.add("components");
      candidates.add("files");
      candidates.add("memories");
      candidates.add("decisions");
      if (hasTargetSymbols || classification.primaryTaskType !== "documentation") {
        candidates.add("symbols");
      }
      if (hasTargetFiles || hasTargetComponents || taskBoosts.has("dependencies")) {
        candidates.add("dependencies");
      }
      if (taskBoosts.has("tests") || hasTargetFiles || hasTargetComponents) {
        candidates.add("tests");
      }
      if (hasEvolutionPair || classification.intents.includes("evolution_review")) {
        candidates.add("evolution");
      }
    }
    if (!includeSnippets) {
      candidates.delete("snippets");
    } else {
      candidates.add("snippets");
    }

    // Order domains by policy priority + task boost
    const domainPriorityOrder = Array.from(candidates).sort((a, b) => {
      const weightA = (policy.domainWeights[a] ?? 1) + (taskBoosts.has(a) ? 4 : 0);
      const weightB = (policy.domainWeights[b] ?? 1) + (taskBoosts.has(b) ? 4 : 0);
      if (weightB !== weightA) return weightB - weightA;
      return priorityDomains.indexOf(a) - priorityDomains.indexOf(b);
    });

    const steps: RetrievalPlanStep[] = domainPriorityOrder.map((domain, idx) => {
      const reasons: string[] = [];
      if (priorityDomains.indexOf(domain) <= 3) {
        reasons.push(`core domain for '${policy.agentId}'`);
      }
      if (taskBoosts.has(domain)) {
        reasons.push(`boosted for '${classification.primaryTaskType}'`);
      }
      if (domain === "files" && hasTargetFiles) reasons.push("explicit/extracted file target");
      if (domain === "symbols" && hasTargetSymbols)
        reasons.push("explicit/extracted symbol target");
      if (domain === "components" && hasTargetComponents) reasons.push("component hint");
      if (domain === "decisions" && hasTargetAdrs) reasons.push("ADR reference");
      if (domain === "evolution" && hasEvolutionPair) reasons.push("snapshot comparison pair");
      if (reasons.length === 0) reasons.push("supporting context");

      const quota = policy.domainQuotas[domain] ?? Math.min(8, effectiveLimits.maxItems);
      const stepMaxItems =
        domain === "overview" || domain === "evolution"
          ? 1
          : Math.min(effectiveLimits.maxItems, Math.max(quota, 4));

      return {
        domain,
        priority: idx + 1,
        reason: reasons.join("; "),
        maxItems: domain === "snippets" && !includeSnippets ? 0 : stepMaxItems,
        depth: domain === "dependencies" ? effectiveLimits.maxDepth : 1,
      };
    });

    return {
      steps,
      effectiveLimits,
      includeSnippets,
      includeHistoricalMemories,
    };
  }
}
