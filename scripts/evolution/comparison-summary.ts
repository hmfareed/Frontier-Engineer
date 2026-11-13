/**
 * Phase 7.5 Stage 3 — Deterministic Comparison Summary
 * Derives accurate, reconciled metrics directly from diff result collections.
 */

import type {
  ComparisonSummary,
  FileDiffResult,
  SymbolDiffResult,
  DependencyDiffResult,
  ComponentDiffResult,
  AdrDiffResult,
} from "./types.ts";

export class ComparisonSummaryDeriver {
  public static derive(
    files: FileDiffResult,
    symbols: SymbolDiffResult,
    dependencies: DependencyDiffResult,
    components: ComponentDiffResult,
    adrs: AdrDiffResult,
  ): ComparisonSummary {
    const renamedCount = files.changes.filter((f) => f.isInferredRename).length;

    return {
      files: {
        added: Math.max(0, files.addedCount),
        modified: Math.max(0, files.modifiedCount),
        deleted: Math.max(0, files.deletedCount),
        unchanged: Math.max(0, files.unchangedCount),
        renamed: Math.max(0, renamedCount),
      },
      symbols: {
        added: Math.max(0, symbols.addedCount),
        removed: Math.max(0, symbols.removedCount),
        modified: Math.max(0, symbols.modifiedCount),
        relocated: Math.max(0, symbols.relocatedCount),
        unchanged: Math.max(0, symbols.unchangedCount),
      },
      dependencies: {
        added: Math.max(0, dependencies.addedCount),
        removed: Math.max(0, dependencies.removedCount),
        modified: Math.max(0, dependencies.modifiedCount),
        unresolved: Math.max(0, dependencies.unresolvedCount),
        unchanged: Math.max(0, dependencies.unchangedCount),
      },
      components: {
        added: Math.max(0, components.addedCount),
        removed: Math.max(0, components.removedCount),
        modified: Math.max(0, components.modifiedCount),
        unchanged: Math.max(0, components.unchangedCount),
      },
      adrs: {
        added: Math.max(0, adrs.addedCount),
        removed: Math.max(0, adrs.removedCount),
        modified: Math.max(0, adrs.modifiedCount),
        unchanged: Math.max(0, adrs.unchangedCount),
      },
    };
  }
}
