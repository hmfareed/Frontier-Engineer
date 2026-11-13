/**
 * Phase 7.5 Stage 3 — Deterministic Dependency & Import Diff Engine
 * Module specifier comparison, target resolution changes, unresolved state preservation, and structural tracking.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type {
  DependencyDiffItem,
  DependencyDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

interface JoinedImportRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  sourceFileId: number;
  sourcePath: string;
  importedSpecifier: string;
  importKind: string;
  resolvedFileId: number | null;
  resolvedPath: string | null;
  resolutionStatus: "RESOLVED" | "UNRESOLVED" | "EXTERNAL" | "BUILTIN" | "DEGRADED";
  startLine: number;
  endLine: number;
  evidenceId: number | null;
}

export class DependencyDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: DependencyDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Query base imports with source path and resolved path
    const baseRows = db
      .prepare(
        `SELECT
          i.id, i.repository_id AS repositoryId, i.scan_id AS scanId,
          i.source_file_id AS sourceFileId, sf.normalized_path AS sourcePath,
          i.imported_specifier AS importedSpecifier, i.import_kind AS importKind,
          i.resolved_file_id AS resolvedFileId, rf.normalized_path AS resolvedPath,
          i.resolution_status AS resolutionStatus, i.start_line AS startLine,
          i.end_line AS endLine, i.evidence_id AS evidenceId
        FROM imports i
        JOIN files sf ON sf.id = i.source_file_id
        LEFT JOIN files rf ON rf.id = i.resolved_file_id
        WHERE i.scan_id = ?
        ORDER BY sf.normalized_path ASC, i.imported_specifier ASC`,
      )
      .all(baseScanId) as unknown as JoinedImportRecord[];

    // Query target imports with source path and resolved path
    const targetRows = db
      .prepare(
        `SELECT
          i.id, i.repository_id AS repositoryId, i.scan_id AS scanId,
          i.source_file_id AS sourceFileId, sf.normalized_path AS sourcePath,
          i.imported_specifier AS importedSpecifier, i.import_kind AS importKind,
          i.resolved_file_id AS resolvedFileId, rf.normalized_path AS resolvedPath,
          i.resolution_status AS resolutionStatus, i.start_line AS startLine,
          i.end_line AS endLine, i.evidence_id AS evidenceId
        FROM imports i
        JOIN files sf ON sf.id = i.source_file_id
        LEFT JOIN files rf ON rf.id = i.resolved_file_id
        WHERE i.scan_id = ?
        ORDER BY sf.normalized_path ASC, i.imported_specifier ASC`,
      )
      .all(targetScanId) as unknown as JoinedImportRecord[];

    // Map imports by key: sourcePath + "::" + importedSpecifier + "::" + importKind
    const makeKey = (r: JoinedImportRecord) =>
      `${r.sourcePath}::${r.importedSpecifier}::${r.importKind}`;

    const baseMap = new Map<string, JoinedImportRecord>();
    for (const r of baseRows) {
      baseMap.set(makeKey(r), r);
    }

    const targetMap = new Map<string, JoinedImportRecord>();
    for (const r of targetRows) {
      targetMap.set(makeKey(r), r);
    }

    const allKeys = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
    const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));

    const changes: DependencyDiffItem[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let unresolvedCount = 0;
    let unchangedCount = 0;

    for (const key of sortedKeys) {
      const base = baseMap.get(key);
      const target = targetMap.get(key);

      if (!base && target) {
        // ADDED
        addedCount++;
        const changeType = target.resolutionStatus === "UNRESOLVED" ? "UNRESOLVED" : "ADDED";
        if (changeType === "UNRESOLVED") {
          unresolvedCount++;
        }

        changes.push({
          sourcePath: target.sourcePath,
          specifier: target.importedSpecifier,
          importKind: target.importKind,
          changeType,
          targetResolvedPath: target.resolvedPath,
          targetResolutionStatus: target.resolutionStatus,
          targetLines: { startLine: target.startLine, endLine: target.endLine },
          confidence: target.resolutionStatus === "RESOLVED" ? 1.0 : 0.8,
        });

        evidence.push({
          evidenceId: `ev:dep:add:${targetScanId}:${key}`,
          repositoryId,
          snapshotId: targetScanId,
          sourcePath: target.sourcePath,
          sourceHash: null,
          entityIdentity: `import:${key}`,
          evidenceType: "import_addition",
          lineRange: [target.startLine, target.endLine],
          confidence: target.resolutionStatus === "RESOLVED" ? 1.0 : 0.8,
          supportedClassification: changeType,
        });
      } else if (base && !target) {
        // REMOVED
        removedCount++;
        changes.push({
          sourcePath: base.sourcePath,
          specifier: base.importedSpecifier,
          importKind: base.importKind,
          changeType: "REMOVED",
          baseResolvedPath: base.resolvedPath,
          baseResolutionStatus: base.resolutionStatus,
          baseLines: { startLine: base.startLine, endLine: base.endLine },
          confidence: base.resolutionStatus === "RESOLVED" ? 1.0 : 0.8,
        });

        evidence.push({
          evidenceId: `ev:dep:rem:${baseScanId}:${key}`,
          repositoryId,
          snapshotId: baseScanId,
          sourcePath: base.sourcePath,
          sourceHash: null,
          entityIdentity: `import:${key}`,
          evidenceType: "import_removal",
          lineRange: [base.startLine, base.endLine],
          confidence: base.resolutionStatus === "RESOLVED" ? 1.0 : 0.8,
          supportedClassification: "REMOVED",
        });
      } else if (base && target) {
        // BOTH PRESENT
        const resolutionChanged =
          base.resolvedPath !== target.resolvedPath ||
          base.resolutionStatus !== target.resolutionStatus;

        if (resolutionChanged) {
          modifiedCount++;
          changes.push({
            sourcePath: target.sourcePath,
            specifier: target.importedSpecifier,
            importKind: target.importKind,
            changeType: "MODIFIED",
            baseResolvedPath: base.resolvedPath,
            targetResolvedPath: target.resolvedPath,
            baseResolutionStatus: base.resolutionStatus,
            targetResolutionStatus: target.resolutionStatus,
            baseLines: { startLine: base.startLine, endLine: base.endLine },
            targetLines: { startLine: target.startLine, endLine: target.endLine },
            confidence: 0.95,
          });

          evidence.push({
            evidenceId: `ev:dep:mod:${targetScanId}:${key}`,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: target.sourcePath,
            sourceHash: null,
            entityIdentity: `import:${key}`,
            evidenceType: "import_resolution_modification",
            lineRange: [target.startLine, target.endLine],
            confidence: 0.95,
            supportedClassification: "MODIFIED",
          });
        } else if (target.resolutionStatus === "UNRESOLVED") {
          // Invariant: Unresolved imports remain preserved as UNRESOLVED
          unresolvedCount++;
          if (includeUnchanged) {
            changes.push({
              sourcePath: target.sourcePath,
              specifier: target.importedSpecifier,
              importKind: target.importKind,
              changeType: "UNRESOLVED",
              baseResolvedPath: base.resolvedPath,
              targetResolvedPath: target.resolvedPath,
              baseResolutionStatus: base.resolutionStatus,
              targetResolutionStatus: target.resolutionStatus,
              baseLines: { startLine: base.startLine, endLine: base.endLine },
              targetLines: { startLine: target.startLine, endLine: target.endLine },
              confidence: 0.8,
            });
          }
        } else {
          // UNCHANGED
          unchangedCount++;
          if (includeUnchanged) {
            changes.push({
              sourcePath: target.sourcePath,
              specifier: target.importedSpecifier,
              importKind: target.importKind,
              changeType: "UNCHANGED",
              baseResolvedPath: base.resolvedPath,
              targetResolvedPath: target.resolvedPath,
              baseResolutionStatus: base.resolutionStatus,
              targetResolutionStatus: target.resolutionStatus,
              baseLines: { startLine: base.startLine, endLine: base.endLine },
              targetLines: { startLine: target.startLine, endLine: target.endLine },
              confidence: 1.0,
            });
          }
        }
      }
    }

    // Sort changes deterministically: sourcePath ASC, specifier ASC, importKind ASC
    changes.sort(
      (a, b) =>
        a.sourcePath.localeCompare(b.sourcePath) ||
        a.specifier.localeCompare(b.specifier) ||
        a.importKind.localeCompare(b.importKind),
    );

    return {
      result: {
        changes,
        addedCount,
        removedCount,
        modifiedCount,
        unresolvedCount,
        unchangedCount,
      },
      evidence,
      limitations,
    };
  }
}
