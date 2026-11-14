/**
 * Phase 7.6 — Deterministic Multi-Signal Relevance Ranker
 * Assigns transparent, reproducible scores and deterministic tie-breaking across all domains.
 */

import type { ConfidenceTier } from "../query/types.ts";
import type { AgentRetrievalPolicy, AnyRankedItem, TaskClassification } from "./types.ts";

const CONFIDENCE_WEIGHT: Record<ConfidenceTier, number> = {
  CONFIRMED: 0,
  INFERRED: 1,
  CANDIDATE: 2,
  UNRESOLVED: 3,
};

export interface RankingInputs {
  classification: TaskClassification;
  policy: AgentRetrievalPolicy;
  seedFiles: Set<string>;
}

export class RelevanceRanker {
  public static rank<T extends AnyRankedItem>(items: T[], inputs: RankingInputs): T[] {
    const scored = items.map((item) => this.scoreItem(item, inputs));

    scored.sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }
      const domWeightDiff =
        (inputs.policy.domainWeights[b.domain] ?? 1) - (inputs.policy.domainWeights[a.domain] ?? 1);
      if (domWeightDiff !== 0) {
        return domWeightDiff;
      }
      const confDiff = CONFIDENCE_WEIGHT[a.confidenceTier] - CONFIDENCE_WEIGHT[b.confidenceTier];
      if (confDiff !== 0) {
        return confDiff;
      }
      return a.id.localeCompare(b.id);
    });

    return scored;
  }

  private static scoreItem<T extends AnyRankedItem>(item: T, inputs: RankingInputs): T {
    const reasons: string[] = [];
    let score = 0;

    const { extractedTargets } = inputs.classification;
    const domainWeight = inputs.policy.domainWeights[item.domain] ?? 1;
    const roleBonus = Math.min(18, domainWeight * 2);
    score += roleBonus;
    reasons.push(`role_affinity(+${roleBonus})`);

    const searchableText = this.extractSearchableFields(item).toLowerCase();

    // 1. Direct target file matches
    let directFileHit = false;
    for (const targetFile of extractedTargets.files) {
      if (this.matchesFile(item, targetFile)) {
        directFileHit = true;
        break;
      }
    }
    if (directFileHit) {
      score += 45;
      reasons.push("exact_target_file(+45)");
    } else {
      // Seed neighbor proximity via evidence or item filePath
      for (const seed of inputs.seedFiles) {
        if (this.matchesFile(item, seed)) {
          score += 22;
          reasons.push("graph_seed_proximity(+22)");
          break;
        }
      }
    }

    // 2. Direct target symbol matches
    for (const targetSym of extractedTargets.symbols) {
      const symLower = targetSym.toLowerCase();
      if (
        (item.domain === "symbols" &&
          (item.name.toLowerCase() === symLower ||
            item.symbolIdentity.toLowerCase() === symLower ||
            item.symbolIdentity.toLowerCase().endsWith(`#${symLower}`))) ||
        (item.domain === "snippets" && searchableText.includes(symLower))
      ) {
        score += 40;
        reasons.push("exact_target_symbol(+40)");
        break;
      }
    }

    // 3. Component / ADR matches
    if (item.domain === "components") {
      const compHit = extractedTargets.components.some(
        (c) =>
          item.name.toLowerCase().includes(c.toLowerCase()) ||
          item.category.toLowerCase() === c.toLowerCase(),
      );
      if (compHit) {
        score += 38;
        reasons.push("target_component_match(+38)");
      }
      if (
        inputs.policy.agentId === "design-engineer" &&
        (item.category === "frontend" || item.name.toLowerCase().includes("ui"))
      ) {
        score += 15;
        reasons.push("ui_component_focus(+15)");
      }
      if (
        inputs.policy.agentId === "security-auditor" &&
        (item.category === "auth" || item.category === "api" || item.category === "database")
      ) {
        score += 15;
        reasons.push("security_boundary_component(+15)");
      }
    }

    if (item.domain === "decisions") {
      const adrHit = extractedTargets.adrs.some(
        (adr) => item.adrId.toUpperCase() === adr.toUpperCase(),
      );
      if (adrHit) {
        score += 45;
        reasons.push("explicit_adr_match(+45)");
      }
      if (
        item.isFallback ||
        item.verificationStatus === "DISK_HASH_MISMATCH" ||
        item.verificationStatus === "DISK_FILE_MISSING" ||
        item.verificationStatus === "MISSING_CONTENT_HASH" ||
        item.verificationStatus === "UNVERIFIED_HASH"
      ) {
        score -= 14;
        reasons.push("unverified_adr_snapshot(-14)");
      } else if (
        item.verificationStatus === "CONFIRMED" ||
        item.verificationStatus === "SNAPSHOT_METADATA"
      ) {
        score += 8;
        reasons.push("verified_adr_snapshot(+8)");
      }
    }

    // 4. Lexical keyword overlap with task prompt
    if (extractedTargets.keywords.length > 0) {
      let keywordHits = 0;
      for (const kw of extractedTargets.keywords) {
        if (searchableText.includes(kw)) {
          keywordHits++;
        }
      }
      if (keywordHits > 0) {
        const kwBonus = Math.min(20, keywordHits * 4);
        score += kwBonus;
        reasons.push(`keyword_overlap:${keywordHits}(+${kwBonus})`);
      }
    }

    // 5. Evidence confidence & memory verification boost/penalty
    if (item.confidenceTier === "CONFIRMED") {
      score += 8;
      reasons.push("confirmed_evidence(+8)");
    } else if (item.confidenceTier === "INFERRED") {
      score += 3;
      reasons.push("inferred_evidence(+3)");
    } else if (item.confidenceTier === "UNRESOLVED") {
      score -= 4;
      reasons.push("unresolved(-4)");
    }

    if (item.domain === "memories") {
      if (inputs.policy.preferredMemoryCategories.includes(item.category)) {
        score += 10;
        reasons.push(`preferred_memory_category(+10)`);
      }
      if (item.liveVerificationStatus === "VERIFIED") {
        score += 16;
        reasons.push("live_verified_memory(+16)");
      } else if (item.liveVerificationStatus === "DISPUTED") {
        if (inputs.policy.agentId === "security-auditor" || inputs.policy.agentId === "architect") {
          score += 2;
          reasons.push("disputed_governance_alert(+2)");
        } else {
          score -= 22;
          reasons.push("disputed_memory_penalty(-22)");
        }
      } else if (
        item.liveVerificationStatus === "STALE" ||
        item.liveVerificationStatus === "MISSING"
      ) {
        score -= 24;
        reasons.push("stale_memory_penalty(-24)");
      } else if (item.liveVerificationStatus === "UNVERIFIED") {
        score -= 8;
        reasons.push("unverified_memory_penalty(-8)");
      } else if (
        item.liveVerificationStatus === "SUPERSEDED" ||
        item.liveVerificationStatus === "ARCHIVED"
      ) {
        score -= 32;
        reasons.push("historical_memory_penalty(-32)");
      }
    }

    if (item.domain === "dependencies") {
      if (item.depth === 1) {
        score += 10;
        reasons.push("direct_dependency_hop(+10)");
      } else if (item.depth > 1) {
        const depthPenalty = Math.min(8, (item.depth - 1) * 2);
        score -= depthPenalty;
        reasons.push(`transitive_depth_${item.depth}(-${depthPenalty})`);
      }
    }

    if (item.domain === "tests" && item.associationStatus === "CONFIRMED") {
      score += 6;
      reasons.push("confirmed_test_link(+6)");
    }

    const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
    return {
      ...item,
      rankScore: boundedScore,
      rankingReasons: reasons,
    };
  }

  private static matchesFile(item: AnyRankedItem, filePath: string): boolean {
    const clean = filePath.toLowerCase();
    switch (item.domain) {
      case "files":
      case "snippets":
      case "symbols":
      case "decisions":
        return item.filePath.toLowerCase() === clean;
      case "tests":
        return (
          item.sourceFilePath.toLowerCase() === clean || item.testFilePath.toLowerCase() === clean
        );
      case "dependencies":
        return (
          item.sourceTarget.toLowerCase() === clean ||
          item.targetName.toLowerCase() === clean ||
          item.targetNodeIdentity.toLowerCase() === `file:${clean}`
        );
      case "components":
        return item.sampleFiles.some((f) => f.toLowerCase() === clean);
      case "memories":
        return item.evidence.some((e) => e.filePath.toLowerCase() === clean);
      default:
        return false;
    }
  }

  private static extractSearchableFields(item: AnyRankedItem): string {
    const parts: string[] = [item.title, item.id];
    switch (item.domain) {
      case "components":
        parts.push(item.name, item.category, item.rootPath, ...item.sampleFiles);
        break;
      case "files":
        parts.push(
          item.filePath,
          item.language,
          item.classification,
          item.componentAssociation ?? "",
        );
        break;
      case "symbols":
        parts.push(item.name, item.symbolIdentity, item.kind, item.filePath);
        break;
      case "dependencies":
        parts.push(item.sourceTarget, item.targetName, item.targetNodeIdentity, item.relationship);
        break;
      case "tests":
        parts.push(item.sourceFilePath, item.testFilePath);
        break;
      case "decisions":
        parts.push(item.adrId, item.adrStatus, item.summaryText, ...item.governedComponents);
        break;
      case "memories":
        parts.push(item.memoryKey, item.category, item.content, item.lifecycleStatus);
        break;
      case "snippets":
        parts.push(item.filePath, item.content);
        break;
    }
    return parts.join(" ");
  }
}
