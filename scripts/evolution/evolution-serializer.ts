/**
 * Phase 7.5 Stage 4 — Evolution Analysis Serializer & Terminal Formatter
 */

import type { EvolutionAnalysisResult } from "./types.ts";

export class EvolutionSerializer {
  public static serialize(analysis: EvolutionAnalysisResult, pretty = false): string {
    const normalized = this.normalize(analysis);
    return pretty ? JSON.stringify(normalized, null, 2) : JSON.stringify(normalized);
  }

  public static serializeCanonical(analysis: EvolutionAnalysisResult): string {
    const clone: Record<string, unknown> = {
      ...analysis,
      analyzedAt: "__CANONICAL__",
      comparison: {
        ...analysis.comparison,
        comparedAt: "__CANONICAL__",
      },
    };
    return JSON.stringify(this.normalize(clone));
  }

  public static formatTerminal(analysis: EvolutionAnalysisResult): string {
    const lines: string[] = [];
    lines.push("================================================================================");
    lines.push(`Frontier Engineer — Evolution Intelligence: ${analysis.analysisId}`);
    lines.push(
      `Repository: ${analysis.repositoryIdentity} (ID: ${analysis.repositoryId}) | Status: ${analysis.status}`,
    );
    lines.push(
      `Snapshots: Base ${analysis.baseSnapshot.scanId} -> Target ${analysis.targetSnapshot.scanId}`,
    );
    lines.push("--------------------------------------------------------------------------------");
    lines.push(`Architectural Drift Findings: ${analysis.drift.totalFindings}`);
    for (const f of analysis.drift.findings.slice(0, 20)) {
      lines.push(`  [${f.severity}] (${f.confidenceTier}) ${f.driftType}: ${f.title}`);
    }
    lines.push(`ADR Decision Correlations: ${analysis.decisions.totalCorrelations}`);
    for (const c of analysis.decisions.correlations.slice(0, 20)) {
      lines.push(`  [${c.severity}] (${c.confidenceTier}) ${c.correlationType}: ${c.title}`);
    }
    lines.push(
      `Engineering Debt: +${analysis.debt.introducedCount} introduced, ~${analysis.debt.worsenedCount} worsened, =${analysis.debt.persistingCount} persisting, -${analysis.debt.resolvedCount} resolved`,
    );
    for (const d of analysis.debt.items.slice(0, 20)) {
      lines.push(`  [${d.state}/${d.severity}] (${d.confidenceTier}) ${d.category}: ${d.title}`);
    }
    const ml = analysis.memoryLifecycle;
    lines.push(
      `Memory Lifecycle (${ml.totalEvaluated} evaluated): ${ml.verifiedActive} verified ACTIVE, ${ml.transitionedToStale} -> STALE, ${ml.transitionedToDisputed} -> DISPUTED, ${ml.transitionedToSuperseded} -> SUPERSEDED, ${ml.recoveredToActive} recovered ACTIVE`,
    );
    lines.push("================================================================================");
    return lines.join("\n");
  }

  private static normalize(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return null;
    }
    if (typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalize(item));
    }

    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      if (record[key] !== undefined) {
        result[key] = this.normalize(record[key]);
      }
    }
    return result;
  }
}
