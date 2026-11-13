/**
 * Phase 7.5 Stage 3 — Deterministic File Diff Engine
 * Content-hash-backed file comparison, timestamp-invariance, strict rename heuristics, and secret protection.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { FileRecord } from "../storage/types.ts";
import type {
  FileDiffItem,
  FileDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

export class FileDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: FileDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const detectRenames = options.detectRenames ?? true;
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Query base files
    const baseFiles = db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          relative_path AS relativePath, normalized_path AS normalizedPath,
          extension, language, classification, size_bytes AS sizeBytes,
          modified_at AS modifiedAt, content_hash AS contentHash,
          sensitivity_status AS sensitivityStatus, index_status AS indexStatus,
          indexed_at AS indexedAt
        FROM files
        WHERE scan_id = ?
        ORDER BY normalized_path ASC`,
      )
      .all(baseScanId) as unknown as FileRecord[];

    // Query target files
    const targetFiles = db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          relative_path AS relativePath, normalized_path AS normalizedPath,
          extension, language, classification, size_bytes AS sizeBytes,
          modified_at AS modifiedAt, content_hash AS contentHash,
          sensitivity_status AS sensitivityStatus, index_status AS indexStatus,
          indexed_at AS indexedAt
        FROM files
        WHERE scan_id = ?
        ORDER BY normalized_path ASC`,
      )
      .all(targetScanId) as unknown as FileRecord[];

    const baseMap = new Map<string, FileRecord>();
    for (const f of baseFiles) {
      baseMap.set(f.normalizedPath, f);
    }

    const targetMap = new Map<string, FileRecord>();
    for (const f of targetFiles) {
      targetMap.set(f.normalizedPath, f);
    }

    const allPaths = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
    const sortedPaths = Array.from(allPaths).sort((a, b) => a.localeCompare(b));

    const initialChanges: FileDiffItem[] = [];
    let addedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let unchangedCount = 0;

    for (const p of sortedPaths) {
      const base = baseMap.get(p);
      const target = targetMap.get(p);

      if (!base && target) {
        // ADDED
        addedCount++;
        const item: FileDiffItem = {
          path: p,
          changeType: "ADDED",
          baseHash: null,
          targetHash: target.contentHash,
          targetClassification: target.classification,
          targetSizeBytes: target.sizeBytes,
        };
        initialChanges.push(item);

        evidence.push({
          evidenceId: `ev:file:add:${target.scanId}:${p}`,
          repositoryId,
          snapshotId: target.scanId,
          sourcePath: p,
          sourceHash: target.contentHash,
          entityIdentity: `file:${p}`,
          evidenceType: "file_addition",
          confidence: 1.0,
          supportedClassification: "ADDED",
        });
      } else if (base && !target) {
        // DELETED
        deletedCount++;
        const item: FileDiffItem = {
          path: p,
          changeType: "DELETED",
          baseHash: base.contentHash,
          targetHash: null,
          baseClassification: base.classification,
          baseSizeBytes: base.sizeBytes,
        };
        initialChanges.push(item);

        evidence.push({
          evidenceId: `ev:file:del:${base.scanId}:${p}`,
          repositoryId,
          snapshotId: base.scanId,
          sourcePath: p,
          sourceHash: base.contentHash,
          entityIdentity: `file:${p}`,
          evidenceType: "file_deletion",
          confidence: 1.0,
          supportedClassification: "DELETED",
        });
      } else if (base && target) {
        // BOTH PRESENT
        const isBaseSensitive = base.sensitivityStatus === "SENSITIVE";
        const isTargetSensitive = target.sensitivityStatus === "SENSITIVE";

        if (isBaseSensitive || isTargetSensitive) {
          limitations.push({
            code: "LIM_SENSITIVE_FILE_CONTENT_UNINSPECTABLE",
            description: `File '${p}' is classified as sensitive; content diffing suppressed to avoid secret exposure.`,
            domain: "file",
            affectedEntityCount: 1,
          });

          // If size or classification or sensitivity status differs
          if (
            base.sizeBytes !== target.sizeBytes ||
            base.classification !== target.classification ||
            base.sensitivityStatus !== target.sensitivityStatus
          ) {
            modifiedCount++;
            const item: FileDiffItem = {
              path: p,
              changeType: "MODIFIED",
              baseHash: null,
              targetHash: null,
              baseClassification: base.classification,
              targetClassification: target.classification,
              baseSizeBytes: base.sizeBytes,
              targetSizeBytes: target.sizeBytes,
            };
            initialChanges.push(item);
            evidence.push({
              evidenceId: `ev:file:mod:${target.scanId}:${p}`,
              repositoryId,
              snapshotId: target.scanId,
              sourcePath: p,
              sourceHash: null,
              entityIdentity: `file:${p}`,
              evidenceType: "sensitive_file_metadata_change",
              confidence: 0.9,
              supportedClassification: "MODIFIED",
            });
          } else {
            unchangedCount++;
            if (includeUnchanged) {
              initialChanges.push({
                path: p,
                changeType: "UNCHANGED",
                baseHash: null,
                targetHash: null,
                baseClassification: base.classification,
                targetClassification: target.classification,
                baseSizeBytes: base.sizeBytes,
                targetSizeBytes: target.sizeBytes,
              });
            }
          }
        } else {
          // Standard safe files with content hashes
          const baseHash = base.contentHash;
          const targetHash = target.contentHash;

          if (baseHash && targetHash && baseHash === targetHash) {
            // Unchanged: timestamp-only differences must NOT trigger MODIFIED
            unchangedCount++;
            if (includeUnchanged) {
              initialChanges.push({
                path: p,
                changeType: "UNCHANGED",
                baseHash,
                targetHash,
                baseClassification: base.classification,
                targetClassification: target.classification,
                baseSizeBytes: base.sizeBytes,
                targetSizeBytes: target.sizeBytes,
              });
            }
          } else {
            // Content hash changed or was computed differently
            modifiedCount++;
            const item: FileDiffItem = {
              path: p,
              changeType: "MODIFIED",
              baseHash,
              targetHash,
              baseClassification: base.classification,
              targetClassification: target.classification,
              baseSizeBytes: base.sizeBytes,
              targetSizeBytes: target.sizeBytes,
            };
            initialChanges.push(item);
            evidence.push({
              evidenceId: `ev:file:mod:${target.scanId}:${p}`,
              repositoryId,
              snapshotId: target.scanId,
              sourcePath: p,
              sourceHash: targetHash,
              entityIdentity: `file:${p}`,
              evidenceType: "file_content_modification",
              confidence: 1.0,
              supportedClassification: "MODIFIED",
            });
          }
        }
      }
    }

    // 2. Strict Rename Detection
    if (detectRenames) {
      // Find eligible deleted and added files
      const deletedCandidates = initialChanges.filter(
        (c) => c.changeType === "DELETED" && c.baseHash && c.baseHash.length > 0,
      );
      const addedCandidates = initialChanges.filter(
        (c) => c.changeType === "ADDED" && c.targetHash && c.targetHash.length > 0,
      );

      // Group by hash
      const deletedByHash = new Map<string, FileDiffItem[]>();
      for (const d of deletedCandidates) {
        const h = d.baseHash!;
        if (!deletedByHash.has(h)) deletedByHash.set(h, []);
        deletedByHash.get(h)!.push(d);
      }

      const addedByHash = new Map<string, FileDiffItem[]>();
      for (const a of addedCandidates) {
        const h = a.targetHash!;
        if (!addedByHash.has(h)) addedByHash.set(h, []);
        addedByHash.get(h)!.push(a);
      }

      for (const [hash, adds] of addedByHash.entries()) {
        const dels = deletedByHash.get(hash);
        if (!dels) continue;

        if (adds.length === 1 && dels.length === 1) {
          // Exactly unique match!
          const addedItem = adds[0];
          const deletedItem = dels[0];

          addedItem.isInferredRename = true;
          addedItem.renameSourcePath = deletedItem.path;
          addedItem.renameConfidence = 0.95;

          evidence.push({
            evidenceId: `ev:file:rename:${targetScanId}:${addedItem.path}`,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: addedItem.path,
            sourceHash: hash,
            entityIdentity: `file:${addedItem.path}`,
            evidenceType: "inferred_file_rename",
            confidence: 0.95,
            supportedClassification: "ADDED",
            isInferred: true,
          });
        } else {
          // Ambiguous candidates: multiple files share the same content hash
          limitations.push({
            code: "LIM_AMBIGUOUS_RENAME_CANDIDATES",
            description: `Multiple added/deleted files share identical content hash '${hash.slice(0, 12)}...'; rename inference rejected to avoid false certainty.`,
            domain: "file",
            affectedEntityCount: adds.length + dels.length,
          });
        }
      }
    }

    // Sort changes deterministically by path ASC
    initialChanges.sort((a, b) => a.path.localeCompare(b.path));

    return {
      result: {
        changes: initialChanges,
        addedCount,
        modifiedCount,
        deletedCount,
        unchangedCount,
      },
      evidence,
      limitations,
    };
  }
}
