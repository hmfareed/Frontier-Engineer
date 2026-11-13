/**
 * Phase 7.6 — Retrieval Output Formatters
 * Deterministic JSON serialization and concise terminal rendering for agent & CLI use.
 */

import type { RetrievalResponse } from "./types.ts";

export class RetrievalFormatter {
  public static formatJson(response: RetrievalResponse, pretty = true): string {
    const normalized = this.normalizeKeys(response);
    return pretty ? JSON.stringify(normalized, null, 2) : JSON.stringify(normalized);
  }

  public static formatTerminal(response: RetrievalResponse): string {
    const lines: string[] = [];
    lines.push(`=== FRONTIER RETRIEVAL [${response.retrievalId}] for '${response.agentId}' ===`);
    lines.push(
      `Repository: ${response.repository.repositoryIdentity} | Scan: ${response.snapshot.scanId} (${response.snapshot.status}) | Freshness: ${response.snapshot.freshness.status}`,
    );
    lines.push(
      `Task Type: ${response.classification.primaryTaskType} | Confidence: ${response.confidenceSummary.confirmedCount} confirmed, ${response.confidenceSummary.inferredCount} inferred`,
    );
    lines.push(
      `Budget: ${response.budget.includedCount}/${response.budget.totalCandidatesFound} items | ~${response.budget.estimatedTokens} tokens (${response.budget.usedChars} chars)`,
    );

    if (response.warnings.length > 0) {
      lines.push("");
      lines.push(`Warnings (${response.warnings.length}):`);
      for (const w of response.warnings) {
        lines.push(`  - [${w.code}] ${w.message}`);
      }
    }

    if (response.context.overview) {
      const ov = response.context.overview;
      lines.push("");
      lines.push(
        `Overview: ${ov.componentCount} components, ${ov.entrypointPaths.length} entrypoints, ${ov.cycleCount} cycles, ${ov.decisionCount} ADRs`,
      );
    }

    const sections: Array<
      [string, Array<{ title: string; rankScore: number; confidenceTier: string }>]
    > = [
      ["Components", response.context.components],
      ["Decisions (ADRs)", response.context.decisions],
      ["Engineering Memories", response.context.memories],
      ["Files", response.context.files],
      ["Symbols", response.context.symbols],
      ["Dependencies & Dependents", response.context.dependencies],
      ["Tests", response.context.tests],
      ["Code Snippets (Untrusted Data)", response.context.snippets],
    ];

    for (const [heading, items] of sections) {
      if (items.length === 0) continue;
      lines.push("");
      lines.push(`${heading} (${items.length}):`);
      for (const item of items) {
        lines.push(`  - [score ${item.rankScore} | ${item.confidenceTier}] ${item.title}`);
      }
    }

    if (response.context.evolution) {
      const evo = response.context.evolution;
      lines.push("");
      lines.push(
        `Evolution (scan ${evo.baseScanId} -> ${evo.targetScanId}): +${evo.filesAdded}/~${evo.filesModified}/-${evo.filesDeleted} files | ${evo.driftFindingsCount} drift | ${evo.adrCorrelationsCount} ADR correlations | ${evo.debtItemsCount} debt`,
      );
    }

    return lines.join("\n");
  }

  private static normalizeKeys(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => this.normalizeKeys(v));

    const record = value as Record<string, unknown>;
    const sorted = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of sorted) {
      const v = record[k];
      if (v !== undefined) {
        out[k] = this.normalizeKeys(v);
      }
    }
    return out;
  }
}
