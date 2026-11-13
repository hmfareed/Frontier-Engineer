/**
 * Phase 7.6 — Context Budgeter
 * Deterministic cross-domain budgeting across maxItems, maxTotalChars, and estimated tokens.
 * Preserves metadata, freshness, and critical warnings outside item truncation.
 */

import type {
  AgentRetrievalPolicy,
  AnyRankedItem,
  BudgetReport,
  RetrievalDomain,
  RetrievalLimits,
} from "./types.ts";

export interface BudgetSelectionResult {
  selected: AnyRankedItem[];
  omitted: AnyRankedItem[];
  budget: BudgetReport;
}

export class ContextBudgeter {
  public static estimateTokens(chars: number): number {
    return Math.ceil(chars / 4);
  }

  public static measureItemChars(item: AnyRankedItem): number {
    return JSON.stringify(item).length;
  }

  public static allocate(
    rankedCandidates: AnyRankedItem[],
    limits: RetrievalLimits,
    policy: AgentRetrievalPolicy,
    baseMetadataChars = 0,
  ): BudgetSelectionResult {
    const selected: AnyRankedItem[] = [];
    const omitted: AnyRankedItem[] = [];
    const domainCounts = new Map<RetrievalDomain, number>();

    let usedChars = baseMetadataChars;

    // Pass 1: Respect per-domain quotas + item/char/token caps
    const deferred: AnyRankedItem[] = [];
    for (const candidate of rankedCandidates) {
      if (selected.length >= limits.maxItems) {
        omitted.push(candidate);
        continue;
      }

      const quota = policy.domainQuotas[candidate.domain];
      const currentDomCount = domainCounts.get(candidate.domain) ?? 0;
      if (quota !== undefined && currentDomCount >= quota) {
        deferred.push(candidate);
        continue;
      }

      const itemChars = this.measureItemChars(candidate);
      const nextTotalChars = usedChars + itemChars;
      const nextTokens = this.estimateTokens(nextTotalChars);

      if (nextTotalChars > limits.maxTotalChars || nextTokens > limits.maxTokens) {
        omitted.push(candidate);
        continue;
      }

      selected.push(candidate);
      usedChars = nextTotalChars;
      domainCounts.set(candidate.domain, currentDomCount + 1);
    }

    // Pass 2: Backfill remaining capacity from deferred items if high relevance and space left
    for (const candidate of deferred) {
      if (selected.length >= limits.maxItems) {
        omitted.push(candidate);
        continue;
      }
      // Never backfill snippets if role quota explicitly set to 0
      if (policy.domainQuotas[candidate.domain] === 0) {
        omitted.push(candidate);
        continue;
      }

      const itemChars = this.measureItemChars(candidate);
      const nextTotalChars = usedChars + itemChars;
      const nextTokens = this.estimateTokens(nextTotalChars);

      if (nextTotalChars > limits.maxTotalChars || nextTokens > limits.maxTokens) {
        omitted.push(candidate);
        continue;
      }

      selected.push(candidate);
      usedChars = nextTotalChars;
    }

    const truncatedDomains = Array.from(new Set(omitted.map((i) => i.domain))).sort((a, b) =>
      a.localeCompare(b),
    );

    const budget: BudgetReport = {
      limitsConfigured: limits,
      usedChars,
      estimatedTokens: this.estimateTokens(usedChars),
      totalCandidatesFound: rankedCandidates.length,
      includedCount: selected.length,
      truncatedCount: omitted.length,
      truncatedDomains,
      omittedItemIds: omitted.slice(0, 50).map((i) => i.id),
    };

    return {
      selected,
      omitted,
      budget,
    };
  }
}
