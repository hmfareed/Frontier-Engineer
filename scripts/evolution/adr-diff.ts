/**
 * Phase 7.5 Stage 3 — Deterministic Architecture Decision Record (ADR) Diff Engine
 * Discovers and compares documented decisions, status transitions, and content hash modifications without interpretation.
 */

import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import { AdrDetector } from "../architecture/adr-detector.ts";
import type { AdrFinding } from "../architecture/types.ts";
import type {
  AdrDiffItem,
  AdrDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

interface AdrFileRecord {
  id: number;
  normalizedPath: string;
  contentHash: string | null;
}

export class AdrDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: AdrDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Resolve workspace root from options or repositories table
    let rootPath = options.workspaceRoot;
    if (!rootPath) {
      const repoRow = db
        .prepare("SELECT root_path AS rootPath FROM repositories WHERE id = ?")
        .get(repositoryId) as { rootPath: string } | undefined;
      rootPath = repoRow?.rootPath ?? process.cwd();
    }

    // 1. Detect ADRs via AdrDetector
    const baseDetected = AdrDetector.detect(db, repositoryId, baseScanId, rootPath);
    const targetDetected = AdrDetector.detect(db, repositoryId, targetScanId, rootPath);

    // 2. Also query indexed ADR files to acquire content hashes and catch ADR files if unreadable from disk
    const baseFiles = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, content_hash AS contentHash
         FROM files
         WHERE scan_id = ?
           AND (
             normalized_path LIKE 'docs/adr/ADR-%.md'
             OR normalized_path LIKE 'docs/%/ADR-%.md'
             OR normalized_path LIKE 'adr/ADR-%.md'
             OR normalized_path LIKE 'ADR-%.md'
           )
         ORDER BY normalized_path ASC`,
      )
      .all(baseScanId) as unknown as AdrFileRecord[];

    const targetFiles = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, content_hash AS contentHash
         FROM files
         WHERE scan_id = ?
           AND (
             normalized_path LIKE 'docs/adr/ADR-%.md'
             OR normalized_path LIKE 'docs/%/ADR-%.md'
             OR normalized_path LIKE 'adr/ADR-%.md'
             OR normalized_path LIKE 'ADR-%.md'
           )
         ORDER BY normalized_path ASC`,
      )
      .all(targetScanId) as unknown as AdrFileRecord[];

    const baseFileHashMap = new Map<string, string | null>();
    for (const f of baseFiles) {
      baseFileHashMap.set(f.normalizedPath, f.contentHash);
    }

    const targetFileHashMap = new Map<string, string | null>();
    for (const f of targetFiles) {
      targetFileHashMap.set(f.normalizedPath, f.contentHash);
    }

    // Build synthesized ADR map for base
    const baseMap = new Map<string, { adr: AdrFinding; contentHash: string | null }>();
    for (const d of baseDetected) {
      baseMap.set(d.adrId, {
        adr: d,
        contentHash: baseFileHashMap.get(d.filePath) ?? null,
      });
    }

    // Fallback: If any file was in baseFiles but not in baseDetected (e.g. disk file unreadable or in-memory)
    for (const f of baseFiles) {
      const basename = path.basename(f.normalizedPath);
      const match = basename.match(/^ADR-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const adrId = `ADR-${match[1].padStart(3, "0")}`;
        if (!baseMap.has(adrId)) {
          baseMap.set(adrId, {
            adr: {
              adrId,
              number: num,
              title: basename.replace(/\.md$/i, ""),
              status: "PROPOSED",
              filePath: f.normalizedPath,
              governedComponents: [],
              relatedDocuments: [],
              evidenceDescription: `ADR file indexed at ${f.normalizedPath}`,
              confidence: 0.9,
            },
            contentHash: f.contentHash,
          });
        }
      }
    }

    // Build synthesized ADR map for target
    const targetMap = new Map<string, { adr: AdrFinding; contentHash: string | null }>();
    for (const d of targetDetected) {
      targetMap.set(d.adrId, {
        adr: d,
        contentHash: targetFileHashMap.get(d.filePath) ?? null,
      });
    }

    // Fallback for target
    for (const f of targetFiles) {
      const basename = path.basename(f.normalizedPath);
      const match = basename.match(/^ADR-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const adrId = `ADR-${match[1].padStart(3, "0")}`;
        if (!targetMap.has(adrId)) {
          targetMap.set(adrId, {
            adr: {
              adrId,
              number: num,
              title: basename.replace(/\.md$/i, ""),
              status: "PROPOSED",
              filePath: f.normalizedPath,
              governedComponents: [],
              relatedDocuments: [],
              evidenceDescription: `ADR file indexed at ${f.normalizedPath}`,
              confidence: 0.9,
            },
            contentHash: f.contentHash,
          });
        }
      }
    }

    const allIds = new Set<string>([...baseMap.keys(), ...targetMap.keys()]);
    const sortedIds = Array.from(allIds).sort((a, b) => {
      const itemA = baseMap.get(a) ?? targetMap.get(a);
      const itemB = baseMap.get(b) ?? targetMap.get(b);
      const numA = itemA?.adr.number ?? 0;
      const numB = itemB?.adr.number ?? 0;
      return numA - numB || a.localeCompare(b);
    });

    const changes: AdrDiffItem[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;

    for (const id of sortedIds) {
      const baseItem = baseMap.get(id);
      const targetItem = targetMap.get(id);

      if (!baseItem && targetItem) {
        // ADDED
        addedCount++;
        changes.push({
          adrId: id,
          number: targetItem.adr.number,
          title: targetItem.adr.title,
          changeType: "ADDED",
          targetPath: targetItem.adr.filePath,
          targetStatus: targetItem.adr.status,
          targetContentHash: targetItem.contentHash,
          date: targetItem.adr.date,
          governedComponents: targetItem.adr.governedComponents,
          evidenceDescription: targetItem.adr.evidenceDescription,
        });

        evidence.push({
          evidenceId: `ev:adr:add:${targetScanId}:${id}`,
          repositoryId,
          snapshotId: targetScanId,
          sourcePath: targetItem.adr.filePath,
          sourceHash: targetItem.contentHash,
          entityIdentity: `adr:${id}`,
          evidenceType: "adr_addition",
          confidence: targetItem.adr.confidence,
          supportedClassification: "ADDED",
        });
      } else if (baseItem && !targetItem) {
        // REMOVED
        removedCount++;
        changes.push({
          adrId: id,
          number: baseItem.adr.number,
          title: baseItem.adr.title,
          changeType: "REMOVED",
          basePath: baseItem.adr.filePath,
          baseStatus: baseItem.adr.status,
          baseContentHash: baseItem.contentHash,
          date: baseItem.adr.date,
          governedComponents: baseItem.adr.governedComponents,
          evidenceDescription: baseItem.adr.evidenceDescription,
        });

        evidence.push({
          evidenceId: `ev:adr:rem:${baseScanId}:${id}`,
          repositoryId,
          snapshotId: baseScanId,
          sourcePath: baseItem.adr.filePath,
          sourceHash: baseItem.contentHash,
          entityIdentity: `adr:${id}`,
          evidenceType: "adr_removal",
          confidence: baseItem.adr.confidence,
          supportedClassification: "REMOVED",
        });
      } else if (baseItem && targetItem) {
        // BOTH PRESENT: compare content hash, status, title, path
        const hashChanged =
          baseItem.contentHash &&
          targetItem.contentHash &&
          baseItem.contentHash !== targetItem.contentHash;
        const statusChanged = baseItem.adr.status !== targetItem.adr.status;
        const titleChanged = baseItem.adr.title !== targetItem.adr.title;
        const pathChanged = baseItem.adr.filePath !== targetItem.adr.filePath;

        const isModified = hashChanged || statusChanged || titleChanged || pathChanged;

        if (isModified) {
          modifiedCount++;
          changes.push({
            adrId: id,
            number: targetItem.adr.number,
            title: targetItem.adr.title,
            changeType: "MODIFIED",
            basePath: baseItem.adr.filePath,
            targetPath: targetItem.adr.filePath,
            baseStatus: baseItem.adr.status,
            targetStatus: targetItem.adr.status,
            baseContentHash: baseItem.contentHash,
            targetContentHash: targetItem.contentHash,
            date: targetItem.adr.date,
            governedComponents: targetItem.adr.governedComponents,
            evidenceDescription: targetItem.adr.evidenceDescription,
          });

          evidence.push({
            evidenceId: `ev:adr:mod:${targetScanId}:${id}`,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: targetItem.adr.filePath,
            sourceHash: targetItem.contentHash,
            entityIdentity: `adr:${id}`,
            evidenceType: "adr_modification",
            confidence: targetItem.adr.confidence,
            supportedClassification: "MODIFIED",
          });
        } else {
          unchangedCount++;
          if (includeUnchanged) {
            changes.push({
              adrId: id,
              number: targetItem.adr.number,
              title: targetItem.adr.title,
              changeType: "UNCHANGED",
              basePath: baseItem.adr.filePath,
              targetPath: targetItem.adr.filePath,
              baseStatus: baseItem.adr.status,
              targetStatus: targetItem.adr.status,
              baseContentHash: baseItem.contentHash,
              targetContentHash: targetItem.contentHash,
              date: targetItem.adr.date,
              governedComponents: targetItem.adr.governedComponents,
              evidenceDescription: targetItem.adr.evidenceDescription,
            });
          }
        }
      }
    }

    // Sort deterministically: number ASC, then adrId ASC
    changes.sort((a, b) => a.number - b.number || a.adrId.localeCompare(b.adrId));

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
