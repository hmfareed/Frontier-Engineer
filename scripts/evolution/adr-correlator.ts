/**
 * Phase 7.5 Stage 4 — ADR & Decision Governance Correlator
 * Correlates Architecture Decision Records (ADRs) against structural drift and component changes.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { AdrDetector } from "../architecture/adr-detector.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
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

    // Build effective target ADR map combining comparison diff and detector/source_evidence
    const effectiveAdrs = new Map<string, EffectiveAdr>();
    for (const item of comparison.adrs.changes) {
      if (item.changeType === "REMOVED" || !item.targetPath) continue;
      effectiveAdrs.set(item.adrId, {
        adrId: item.adrId,
        title: item.title,
        status: item.targetStatus ?? "Proposed",
        filePath: item.targetPath,
        governedComponents: item.governedComponents ?? [],
        isModifiedInTarget: item.changeType === "MODIFIED",
        isAddedInTarget: item.changeType === "ADDED",
        isFallback: Boolean(item.isFallback),
        contentHash: item.targetContentHash,
      });
    }

    // Load unchanged ADRs present in target scan if includeUnchanged was false
    const detectedTargetAdrs = AdrDetector.detect(db, repositoryId, targetScanId, rootPath);
    for (const adr of detectedTargetAdrs) {
      if (!effectiveAdrs.has(adr.adrId)) {
        effectiveAdrs.set(adr.adrId, {
          adrId: adr.adrId,
          title: adr.title,
          status: adr.status,
          filePath: adr.filePath,
          governedComponents: adr.governedComponents,
          isModifiedInTarget: false,
          isAddedInTarget: false,
          isFallback: false,
        });
      }
    }

    // Fallback: inspect snapshot source_evidence ADR_METADATA_JSON when offline/synthetic
    const metaRows = db
      .prepare(
        `SELECT f.normalized_path AS filePath, f.content_hash AS contentHash, se.evidence_description AS description
         FROM source_evidence se
         JOIN files f ON f.id = se.file_id
         WHERE se.repository_id = ? AND se.scan_id = ? AND se.evidence_type = 'ADR_METADATA_JSON'`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      filePath: string;
      contentHash: string | null;
      description: string;
    }[];
    const baseComponents = ComponentDetector.detect(db, repositoryId, baseScanId);
    const targetComponents = ComponentDetector.detect(db, repositoryId, targetScanId);
    const allCompsById = new Map(
      [...baseComponents, ...targetComponents].map((c) => [c.componentIdentity, c]),
    );

    for (const row of metaRows) {
      try {
        const meta = JSON.parse(row.description) as {
          adrId?: string;
          title?: string;
          status?: string;
          governedComponents?: string[];
        };
        if (!meta.adrId) continue;
        const diffItem = comparison.adrs.changes.find((a) => a.adrId === meta.adrId);
        const existing = effectiveAdrs.get(meta.adrId);
        const governed =
          meta.governedComponents && meta.governedComponents.length > 0
            ? meta.governedComponents
            : (existing?.governedComponents ?? []);
        if (!existing) {
          effectiveAdrs.set(meta.adrId, {
            adrId: meta.adrId,
            title: meta.title ?? meta.adrId,
            status: meta.status ?? "Proposed",
            filePath: row.filePath,
            governedComponents: governed,
            isModifiedInTarget: diffItem?.changeType === "MODIFIED",
            isAddedInTarget: diffItem?.changeType === "ADDED",
            isFallback: false,
            contentHash: row.contentHash,
          });
        } else if (existing.governedComponents.length === 0 && governed.length > 0) {
          existing.governedComponents = governed;
        }
      } catch {
        // Ignore malformed metadata JSON
      }
    }

    const removedComponents = new Map(
      comparison.components.changes
        .filter((c) => c.changeType === "REMOVED")
        .map((c) => [c.componentIdentity, c]),
    );

    // 1 & 2. Accepted ADRs governing removed or drifted components
    for (const adr of effectiveAdrs.values()) {
      const isAccepted = /\baccepted\b/i.test(adr.status);
      if (!isAccepted) continue;

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
            correlations.push({
              findingId: `decision:boundary_drift:${adr.adrId}:${drift.findingId}`,
              correlationType: "DECISION_GOVERNED_BOUNDARY_DRIFT",
              adrId: adr.adrId,
              componentIdentity: compId,
              title: `Boundary drift affects Accepted ${adr.adrId} (${compId})`,
              description: `Unchanged Accepted ADR '${adr.adrId}' governs '${compId}', which experienced '${drift.driftType}'`,
              severity: "MEDIUM",
              confidence: 0.8,
              confidenceTier: "INFERRED",
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
