/**
 * Phase 7.5 Stage 3 — Deterministic Component Diff Engine
 * Architectural component comparison, member file delta tracking, and boundary change analysis.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import type { ArchitectureComponent } from "../architecture/types.ts";
import type {
  ComponentDiffItem,
  ComponentDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

export class ComponentDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: ComponentDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Detect components for base and target snapshots deterministically
    const baseComponents = ComponentDetector.detect(db, repositoryId, baseScanId);
    const targetComponents = ComponentDetector.detect(db, repositoryId, targetScanId);

    const baseMap = new Map<string, ArchitectureComponent>();
    for (const c of baseComponents) {
      baseMap.set(c.componentIdentity, c);
    }

    const targetMap = new Map<string, ArchitectureComponent>();
    for (const c of targetComponents) {
      targetMap.set(c.componentIdentity, c);
    }

    const allIdentities = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
    const sortedIdentities = Array.from(allIdentities).sort((a, b) => a.localeCompare(b));

    const changes: ComponentDiffItem[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;

    for (const id of sortedIdentities) {
      const base = baseMap.get(id);
      const target = targetMap.get(id);

      if (!base && target) {
        // ADDED
        addedCount++;
        const evidenceId = `ev:comp:add:${targetScanId}:${id}`;
        changes.push({
          componentIdentity: id,
          name: target.name,
          category: target.category,
          rootPath: target.rootPath,
          changeType: "ADDED",
          targetConfidence: target.confidence,
          targetStatus: target.status,
          addedMemberFiles: [...target.filePaths].sort(),
          removedMemberFiles: [],
          unchangedMemberFiles: [],
          evidenceDescription: target.evidenceDescription,
          evidenceId,
        });

        evidence.push({
          evidenceId,
          repositoryId,
          snapshotId: targetScanId,
          sourcePath: target.rootPath,
          sourceHash: null,
          entityIdentity: id,
          evidenceType: "component_addition",
          confidence: target.confidence,
          supportedClassification: "ADDED",
          isInferred: target.status !== "CONFIRMED",
        });
      } else if (base && !target) {
        // REMOVED
        removedCount++;
        const evidenceId = `ev:comp:rem:${baseScanId}:${id}`;
        changes.push({
          componentIdentity: id,
          name: base.name,
          category: base.category,
          rootPath: base.rootPath,
          changeType: "REMOVED",
          baseConfidence: base.confidence,
          baseStatus: base.status,
          addedMemberFiles: [],
          removedMemberFiles: [...base.filePaths].sort(),
          unchangedMemberFiles: [],
          evidenceDescription: base.evidenceDescription,
          evidenceId,
        });

        evidence.push({
          evidenceId,
          repositoryId,
          snapshotId: baseScanId,
          sourcePath: base.rootPath,
          sourceHash: null,
          entityIdentity: id,
          evidenceType: "component_removal",
          confidence: base.confidence,
          supportedClassification: "REMOVED",
          isInferred: base.status !== "CONFIRMED",
        });
      } else if (base && target) {
        // BOTH PRESENT: compare membership and attributes
        const baseFileSet = new Set(base.filePaths);
        const targetFileSet = new Set(target.filePaths);

        const addedMemberFiles = target.filePaths
          .filter((p) => !baseFileSet.has(p))
          .sort((a, b) => a.localeCompare(b));
        const removedMemberFiles = base.filePaths
          .filter((p) => !targetFileSet.has(p))
          .sort((a, b) => a.localeCompare(b));
        const unchangedMemberFiles = base.filePaths
          .filter((p) => targetFileSet.has(p))
          .sort((a, b) => a.localeCompare(b));

        const isModified =
          addedMemberFiles.length > 0 ||
          removedMemberFiles.length > 0 ||
          base.category !== target.category ||
          base.name !== target.name ||
          base.status !== target.status;

        if (isModified) {
          modifiedCount++;
          const evidenceId = `ev:comp:mod:${targetScanId}:${id}`;
          changes.push({
            componentIdentity: id,
            name: target.name,
            category: target.category,
            rootPath: target.rootPath,
            changeType: "MODIFIED",
            baseConfidence: base.confidence,
            targetConfidence: target.confidence,
            baseStatus: base.status,
            targetStatus: target.status,
            addedMemberFiles,
            removedMemberFiles,
            unchangedMemberFiles,
            evidenceDescription: target.evidenceDescription,
            evidenceId,
          });

          evidence.push({
            evidenceId,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: target.rootPath,
            sourceHash: null,
            entityIdentity: id,
            evidenceType: "component_boundary_modification",
            confidence: target.confidence,
            supportedClassification: "MODIFIED",
            isInferred: target.status !== "CONFIRMED",
          });
        } else {
          unchangedCount++;
          if (includeUnchanged) {
            changes.push({
              componentIdentity: id,
              name: target.name,
              category: target.category,
              rootPath: target.rootPath,
              changeType: "UNCHANGED",
              baseConfidence: base.confidence,
              targetConfidence: target.confidence,
              baseStatus: base.status,
              targetStatus: target.status,
              addedMemberFiles: [],
              removedMemberFiles: [],
              unchangedMemberFiles,
              evidenceDescription: target.evidenceDescription,
            });
          }
        }
      }
    }

    // Sort changes deterministically: componentIdentity ASC
    changes.sort((a, b) => a.componentIdentity.localeCompare(b.componentIdentity));

    return {
      result: {
        changes,
        addedCount,
        removedCount,
        modifiedCount,
        unchangedCount,
      },
      evidence,
      limitations,
    };
  }
}
