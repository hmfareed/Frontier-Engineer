/**
 * Phase 7.5 Stage 4 — ADR & Decision Governance Correlator
 * Correlates Architecture Decision Records (ADRs) against structural drift and component changes.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import { AdrDiffEngine } from "./adr-diff.ts";
import type {
  AdrCorrelationFinding,
  DriftFinding,
  EvolutionAnalyzerOptions,
  SnapshotComparison,
} from "./types.ts";

interface EffectiveAdr {
  adrId: string;
  title: string;
  status: string;
  filePath: string;
  governedComponents: string[];
  isModifiedInTarget: boolean;
  isAddedInTarget: boolean;
  isFallback: boolean;
  contentHash?: string | null;
  rawContent?: string;
  evidenceDescription?: string;
}

export class AdrCorrelator {
  public static correlate(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    comparison: SnapshotComparison,
    driftFindings: DriftFinding[],
    options: EvolutionAnalyzerOptions = {},
  ): AdrCorrelationFinding[] {
    const correlations: AdrCorrelationFinding[] = [];
    const repoRow = db
      .prepare("SELECT root_path AS rootPath FROM repositories WHERE id = ?")
      .get(repositoryId) as { rootPath: string } | undefined;
    const rootPath = options.workspaceRoot ?? repoRow?.rootPath ?? process.cwd();

    // DEFECT-ADR-01: Resolve target ADRs strictly via hash-verified historical snapshot state
    const historicalTarget = AdrDiffEngine.resolveHistoricalAdrs(
      db,
      repositoryId,
      targetScanId,
      rootPath,
    );
    const diffById = new Map(comparison.adrs.changes.map((c) => [c.adrId.toUpperCase(), c]));
    const effectiveAdrs = new Map<string, EffectiveAdr>();

    for (const adr of historicalTarget.adrs) {
      const diffItem = diffById.get(adr.adrId.toUpperCase());
      effectiveAdrs.set(adr.adrId, {
        adrId: adr.adrId,
        title: adr.title,
        status: adr.status ?? "Unknown",
        filePath: adr.filePath,
        governedComponents: [...adr.governedComponents],
        isModifiedInTarget: diffItem?.changeType === "MODIFIED",
        isAddedInTarget: diffItem?.changeType === "ADDED",
        isFallback: adr.isFallback,
        contentHash: adr.contentHash,
        rawContent: adr.rawContent,
        evidenceDescription: adr.evidenceDescription,
      });
    }

    for (const item of comparison.adrs.changes) {
      if (item.changeType === "REMOVED" || !item.targetPath) continue;
      if (!effectiveAdrs.has(item.adrId)) {
        effectiveAdrs.set(item.adrId, {
          adrId: item.adrId,
          title: item.title,
          status: item.targetStatus ?? "Unknown",
          filePath: item.targetPath,
          governedComponents: item.governedComponents ?? [],
          isModifiedInTarget: item.changeType === "MODIFIED",
          isAddedInTarget: item.changeType === "ADDED",
          isFallback: Boolean(item.isFallback),
          contentHash: item.targetContentHash,
          evidenceDescription: item.evidenceDescription,
        });
      }
    }

    const baseComponents = ComponentDetector.detect(db, repositoryId, baseScanId);
    const targetComponents = ComponentDetector.detect(db, repositoryId, targetScanId);
    const allCompsById = new Map(
      [...baseComponents, ...targetComponents].map((c) => [c.componentIdentity, c]),
    );

    const removedComponents = new Map(
      comparison.components.changes
        .filter((c) => c.changeType === "REMOVED")
        .map((c) => [c.componentIdentity, c]),
    );

    // 1 & 2. Accepted (and hash-verified, non-fallback) ADRs governing removed or drifted components
    const acceptedVerifiedAdrs: EffectiveAdr[] = [];
    for (const adr of effectiveAdrs.values()) {
      if (adr.isFallback) continue;
      const isAccepted = /\baccepted\b/i.test(adr.status);
      if (!isAccepted) continue;
      acceptedVerifiedAdrs.push(adr);

      for (const compId of adr.governedComponents) {
        const removed = removedComponents.get(compId);
        if (removed) {
          correlations.push({
            findingId: `decision:orphan:${adr.adrId}:${compId}`,
            correlationType: "DECISION_GOVERNED_COMPONENT_REMOVED",
            adrId: adr.adrId,
            componentIdentity: compId,
            title: `Accepted ${adr.adrId} governs removed component ${compId}`,
            description: `Architecture Decision '${adr.adrId}' (${adr.status}) governs '${compId}', which was removed in scan ${targetScanId}`,
            severity: "HIGH",
            confidence: 0.95,
            confidenceTier: "CONFIRMED",
            relevantPaths: [adr.filePath, ...removed.removedMemberFiles],
            details: {
              adrId: adr.adrId,
              adrStatus: adr.status,
              componentIdentity: compId,
              removedFiles: removed.removedMemberFiles,
            },
            evidenceIds: removed.evidenceId ? [removed.evidenceId] : [],
          });
        }

        if (!adr.isModifiedInTarget && !adr.isAddedInTarget) {
          const boundaryDrifts = driftFindings.filter(
            (d) =>
              (d.driftType === "DRIFT_LAYER_VIOLATION_INTRODUCED" ||
                d.driftType === "DRIFT_COMPONENT_RECLASSIFIED") &&
              (d.subjectEntity === compId ||
                d.details.sourceComponentId === compId ||
                d.details.targetComponentId === compId),
          );
          for (const drift of boundaryDrifts) {
            const tier = drift.confidenceTier === "CONFIRMED" ? "CONFIRMED" : "INFERRED";
            correlations.push({
              findingId: `decision:boundary_drift:${adr.adrId}:${drift.findingId}`,
              correlationType: "DECISION_GOVERNED_BOUNDARY_DRIFT",
              adrId: adr.adrId,
              componentIdentity: compId,
              title: `Boundary drift affects Accepted ${adr.adrId} (${compId})`,
              description: `Unchanged Accepted ADR '${adr.adrId}' governs '${compId}', which experienced '${drift.driftType}'`,
              severity: "MEDIUM",
              confidence: tier === "CONFIRMED" ? 0.9 : 0.75,
              confidenceTier: tier,
              relevantPaths: Array.from(new Set([adr.filePath, ...drift.relevantPaths])).sort(),
              details: {
                adrId: adr.adrId,
                componentIdentity: compId,
                driftFindingId: drift.findingId,
                driftType: drift.driftType,
              },
              evidenceIds: [...drift.evidenceIds],
            });
          }
        }
      }
    }

    // 2b. Conflicting Accepted ADR governance detection (DECISION_CONFLICTING_GOVERNANCE)
    acceptedVerifiedAdrs.sort((a, b) => a.adrId.localeCompare(b.adrId));
    for (let i = 0; i < acceptedVerifiedAdrs.length; i++) {
      for (let j = i + 1; j < acceptedVerifiedAdrs.length; j++) {
        const adrA = acceptedVerifiedAdrs[i];
        const adrB = acceptedVerifiedAdrs[j];
        const sharedComponents = adrA.governedComponents.filter((c) =>
          adrB.governedComponents.includes(c),
        );
        const textA = `${adrA.title} ${adrA.rawContent ?? adrA.evidenceDescription ?? ""}`;
        const textB = `${adrB.title} ${adrB.rawContent ?? adrB.evidenceDescription ?? ""}`;

        const explicitSupersedeConflict =
          new RegExp(
            `\\b(supersede[sd]?|replace[sd]?|conflict[s]?\\s+with)\\s+${adrA.adrId}\\b`,
            "i",
          ).test(textB) ||
          new RegExp(
            `\\b(supersede[sd]?|replace[sd]?|conflict[s]?\\s+with)\\s+${adrB.adrId}\\b`,
            "i",
          ).test(textA);

        const prohibitRe = /\b(forbid|prohibit|disallow|must\s+not|never\s+import|no\s+direct)\b/i;
        const allowRe = /\b(allow|permit|direct\s+access|direct\s+import|require\s+direct)\b/i;
        const stanceConflict =
          sharedComponents.length > 0 &&
          ((prohibitRe.test(textA) && allowRe.test(textB)) ||
            (prohibitRe.test(textB) && allowRe.test(textA)));

        if (explicitSupersedeConflict || stanceConflict) {
          correlations.push({
            findingId: `decision:conflict:${adrA.adrId}:${adrB.adrId}`,
            correlationType: "DECISION_CONFLICTING_GOVERNANCE",
            adrId: adrA.adrId,
            componentIdentity: sharedComponents[0],
            title: `Conflicting Accepted decisions: ${adrA.adrId} and ${adrB.adrId}`,
            description: explicitSupersedeConflict
              ? `Both '${adrA.adrId}' and '${adrB.adrId}' remain Accepted despite explicit supersession/conflict reference`
              : `Accepted ADRs '${adrA.adrId}' and '${adrB.adrId}' contain opposing governance stances on shared component(s): ${sharedComponents.join(", ")}`,
            severity: "HIGH",
            confidence: explicitSupersedeConflict ? 0.95 : 0.8,
            confidenceTier: explicitSupersedeConflict ? "CONFIRMED" : "INFERRED",
            relevantPaths: [adrA.filePath, adrB.filePath].sort(),
            details: {
              conflictingAdrIds: [adrA.adrId, adrB.adrId],
              sharedComponents,
              conflictKind: explicitSupersedeConflict
                ? "unretired_supersession"
                : "opposing_stance",
            },
            evidenceIds: [],
          });
        }
      }
    }

    // 3. ADR status transitions to Superseded / Deprecated / Rejected
    for (const item of comparison.adrs.changes) {
      if (
        item.changeType === "MODIFIED" &&
        item.baseStatus &&
        item.targetStatus &&
        item.baseStatus.toLowerCase() !== item.targetStatus.toLowerCase() &&
        /\b(superseded|deprecated|rejected)\b/i.test(item.targetStatus)
      ) {
        correlations.push({
          findingId: `decision:status_change:${item.adrId}`,
          correlationType: "DECISION_STATUS_SUPERSEDED_OR_DEPRECATED",
          adrId: item.adrId,
          title: `Decision ${item.adrId} transitioned to ${item.targetStatus}`,
          description: `ADR '${item.adrId}' changed status from '${item.baseStatus}' to '${item.targetStatus}' in scan ${targetScanId}`,
          severity: "MEDIUM",
          confidence: item.isFallback ? 0.7 : 1.0,
          confidenceTier: item.isFallback ? "INFERRED" : "CONFIRMED",
          relevantPaths: [item.targetPath ?? item.basePath ?? ""].filter(Boolean),
          details: {
            adrId: item.adrId,
            baseStatus: item.baseStatus,
            targetStatus: item.targetStatus,
            governedComponents: item.governedComponents ?? [],
          },
          evidenceIds: item.evidenceId ? [item.evidenceId] : [],
        });
      }
    }

    // 4. Unlinked confirmed architectural component additions/removals
    const governedByRecentAdrs = new Set<string>();
    for (const adr of effectiveAdrs.values()) {
      if (adr.isAddedInTarget || adr.isModifiedInTarget) {
        for (const compId of adr.governedComponents) {
          governedByRecentAdrs.add(compId);
        }
      }
    }

    for (const compDiff of comparison.components.changes) {
      if (
        (compDiff.changeType === "ADDED" && compDiff.targetStatus === "CONFIRMED") ||
        (compDiff.changeType === "REMOVED" && compDiff.baseStatus === "CONFIRMED")
      ) {
        if (!governedByRecentAdrs.has(compDiff.componentIdentity)) {
          const compMeta = allCompsById.get(compDiff.componentIdentity);
          correlations.push({
            findingId: `decision:unlinked_comp:${compDiff.changeType.toLowerCase()}:${compDiff.componentIdentity}`,
            correlationType: "DECISION_UNLINKED_ARCHITECTURAL_CHANGE",
            componentIdentity: compDiff.componentIdentity,
            title: `Unlinked architectural change: ${compDiff.changeType} ${compDiff.componentIdentity}`,
            description: `Confirmed component '${compDiff.componentIdentity}' was ${compDiff.changeType.toLowerCase()} with no accompanying ADR update`,
            severity: "LOW",
            confidence: 0.6,
            confidenceTier: "CANDIDATE",
            relevantPaths: compMeta?.filePaths ?? [
              ...compDiff.addedMemberFiles,
              ...compDiff.removedMemberFiles,
            ],
            details: {
              componentIdentity: compDiff.componentIdentity,
              changeType: compDiff.changeType,
              category: compDiff.category,
            },
            evidenceIds: compDiff.evidenceId ? [compDiff.evidenceId] : [],
          });
        }
      }
    }

    correlations.sort((a, b) => a.findingId.localeCompare(b.findingId));
    return correlations;
  }
}
