/**
 * Phase 7.5 Stage 3 — Deterministic Symbol Diff Engine
 * AST fingerprint comparison, line-shift invariance, deterministic relocation, and ambiguity isolation.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type {
  SymbolDiffItem,
  SymbolDiffResult,
  ComparisonEvidence,
  ComparisonLimitation,
  ComparatorOptions,
} from "./types.ts";

interface JoinedSymbolRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  fileId: number;
  normalizedPath: string;
  symbolIdentity: string;
  name: string;
  kind: string;
  scope: string | null;
  parentSymbolId: number | null;
  isExported: boolean;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  fingerprint: string;
  confidence: number;
  extractionStatus: string;
}

export class SymbolDiffEngine {
  public static diff(
    db: SqliteDatabase,
    repositoryId: number,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): {
    result: SymbolDiffResult;
    evidence: ComparisonEvidence[];
    limitations: ComparisonLimitation[];
  } {
    const detectRelocations = options.detectRelocations ?? true;
    const includeUnchanged = options.includeUnchanged ?? false;
    const evidence: ComparisonEvidence[] = [];
    const limitations: ComparisonLimitation[] = [];

    // Query base symbols with file path
    const baseRows = db
      .prepare(
        `SELECT
          s.id, s.repository_id AS repositoryId, s.scan_id AS scanId,
          s.file_id AS fileId, f.normalized_path AS normalizedPath,
          s.symbol_identity AS symbolIdentity, s.name, s.kind, s.scope,
          s.parent_symbol_id AS parentSymbolId, s.is_exported AS isExported,
          s.start_line AS startLine, s.end_line AS endLine,
          s.start_column AS startColumn, s.end_column AS endColumn,
          s.fingerprint, s.confidence, s.extraction_status AS extractionStatus
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.scan_id = ?
        ORDER BY s.symbol_identity ASC`,
      )
      .all(baseScanId) as unknown as JoinedSymbolRecord[];

    // Query target symbols with file path
    const targetRows = db
      .prepare(
        `SELECT
          s.id, s.repository_id AS repositoryId, s.scan_id AS scanId,
          s.file_id AS fileId, f.normalized_path AS normalizedPath,
          s.symbol_identity AS symbolIdentity, s.name, s.kind, s.scope,
          s.parent_symbol_id AS parentSymbolId, s.is_exported AS isExported,
          s.start_line AS startLine, s.end_line AS endLine,
          s.start_column AS startColumn, s.end_column AS endColumn,
          s.fingerprint, s.confidence, s.extraction_status AS extractionStatus
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.scan_id = ?
        ORDER BY s.symbol_identity ASC`,
      )
      .all(targetScanId) as unknown as JoinedSymbolRecord[];

    const baseById = new Map<string, JoinedSymbolRecord>();
    for (const r of baseRows) {
      baseById.set(r.symbolIdentity, r);
    }

    const targetById = new Map<string, JoinedSymbolRecord>();
    for (const r of targetRows) {
      targetById.set(r.symbolIdentity, r);
    }

    const processedBaseIdentities = new Set<string>();
    const processedTargetIdentities = new Set<string>();

    const changes: SymbolDiffItem[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let relocatedCount = 0;
    let unchangedCount = 0;

    // 1. Same-identity matching (matches within the same file & identity)
    for (const [id, baseSym] of baseById.entries()) {
      const targetSym = targetById.get(id);
      if (targetSym) {
        processedBaseIdentities.add(id);
        processedTargetIdentities.add(id);

        if (baseSym.fingerprint === targetSym.fingerprint) {
          // Invariant: Comments, whitespace, and line shifts do not alter AST fingerprint
          unchangedCount++;
          if (includeUnchanged) {
            changes.push({
              symbolIdentity: id,
              name: baseSym.name,
              kind: baseSym.kind,
              changeType: "UNCHANGED",
              basePath: baseSym.normalizedPath,
              targetPath: targetSym.normalizedPath,
              baseFingerprint: baseSym.fingerprint,
              targetFingerprint: targetSym.fingerprint,
              baseLines: { startLine: baseSym.startLine, endLine: baseSym.endLine },
              targetLines: { startLine: targetSym.startLine, endLine: targetSym.endLine },
              baseConfidence: baseSym.confidence,
              targetConfidence: targetSym.confidence,
            });
          }
        } else {
          // Modified definition
          modifiedCount++;
          changes.push({
            symbolIdentity: id,
            name: baseSym.name,
            kind: baseSym.kind,
            changeType: "MODIFIED",
            basePath: baseSym.normalizedPath,
            targetPath: targetSym.normalizedPath,
            baseFingerprint: baseSym.fingerprint,
            targetFingerprint: targetSym.fingerprint,
            baseLines: { startLine: baseSym.startLine, endLine: baseSym.endLine },
            targetLines: { startLine: targetSym.startLine, endLine: targetSym.endLine },
            baseConfidence: baseSym.confidence,
            targetConfidence: targetSym.confidence,
          });

          evidence.push({
            evidenceId: `ev:sym:mod:${targetScanId}:${id}`,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: targetSym.normalizedPath,
            sourceHash: targetSym.fingerprint,
            entityIdentity: `symbol:${id}`,
            evidenceType: "symbol_fingerprint_modification",
            lineRange: [targetSym.startLine, targetSym.endLine],
            confidence: targetSym.confidence,
            supportedClassification: "MODIFIED",
          });
        }
      }
    }

    // 2. Collect remaining unmatched candidates for relocation and add/remove
    const unmatchedBase: JoinedSymbolRecord[] = [];
    for (const [id, b] of baseById.entries()) {
      if (!processedBaseIdentities.has(id)) {
        unmatchedBase.push(b);
      }
    }

    const unmatchedTarget: JoinedSymbolRecord[] = [];
    for (const [id, t] of targetById.entries()) {
      if (!processedTargetIdentities.has(id)) {
        unmatchedTarget.push(t);
      }
    }

    // 3. Relocation Detection (across files)
    const relocatedTargetIds = new Set<string>();
    const relocatedBaseIds = new Set<string>();

    if (detectRelocations && unmatchedBase.length > 0 && unmatchedTarget.length > 0) {
      // Group unmatched candidates by semantic key: name + "::" + kind + "::" + (scope ?? "") + "::" + fingerprint
      const makeKey = (s: JoinedSymbolRecord) =>
        `${s.name}::${s.kind}::${s.scope ?? ""}::${s.fingerprint}`;

      const baseByKey = new Map<string, JoinedSymbolRecord[]>();
      for (const b of unmatchedBase) {
        const k = makeKey(b);
        if (!baseByKey.has(k)) baseByKey.set(k, []);
        baseByKey.get(k)!.push(b);
      }

      const targetByKey = new Map<string, JoinedSymbolRecord[]>();
      for (const t of unmatchedTarget) {
        const k = makeKey(t);
        if (!targetByKey.has(k)) targetByKey.set(k, []);
        targetByKey.get(k)!.push(t);
      }

      for (const [key, tList] of targetByKey.entries()) {
        const bList = baseByKey.get(key);
        if (!bList) continue;

        if (tList.length === 1 && bList.length === 1) {
          // Exactly unique relocation match across files!
          const b = bList[0];
          const t = tList[0];

          relocatedBaseIds.add(b.symbolIdentity);
          relocatedTargetIds.add(t.symbolIdentity);
          relocatedCount++;

          changes.push({
            symbolIdentity: t.symbolIdentity,
            name: t.name,
            kind: t.kind,
            changeType: "RELOCATED",
            basePath: b.normalizedPath,
            targetPath: t.normalizedPath,
            baseFingerprint: b.fingerprint,
            targetFingerprint: t.fingerprint,
            baseLines: { startLine: b.startLine, endLine: b.endLine },
            targetLines: { startLine: t.startLine, endLine: t.endLine },
            baseConfidence: b.confidence,
            targetConfidence: t.confidence,
          });

          evidence.push({
            evidenceId: `ev:sym:reloc:${targetScanId}:${t.symbolIdentity}`,
            repositoryId,
            snapshotId: targetScanId,
            sourcePath: t.normalizedPath,
            sourceHash: t.fingerprint,
            entityIdentity: `symbol:${t.symbolIdentity}`,
            evidenceType: "symbol_relocation",
            lineRange: [t.startLine, t.endLine],
            confidence: 0.9,
            supportedClassification: "RELOCATED",
            isInferred: true,
          });
        } else {
          // Ambiguous candidates: multiple matching symbols with same fingerprint and signature
          limitations.push({
            code: "LIM_AMBIGUOUS_SYMBOL_RELOCATION",
            description: `Multiple symbols with name '${tList[0].name}' match relocation key across files; kept as separate addition/removal records to avoid false certainty.`,
            domain: "symbol",
            affectedEntityCount: tList.length + bList.length,
          });
        }
      }
    }

    // 4. Process remaining unmatched base symbols as REMOVED
    for (const b of unmatchedBase) {
      if (relocatedBaseIds.has(b.symbolIdentity)) continue;
      removedCount++;

      changes.push({
        symbolIdentity: b.symbolIdentity,
        name: b.name,
        kind: b.kind,
        changeType: "REMOVED",
        basePath: b.normalizedPath,
        baseFingerprint: b.fingerprint,
        baseLines: { startLine: b.startLine, endLine: b.endLine },
        baseConfidence: b.confidence,
      });

      evidence.push({
        evidenceId: `ev:sym:rem:${baseScanId}:${b.symbolIdentity}`,
        repositoryId,
        snapshotId: baseScanId,
        sourcePath: b.normalizedPath,
        sourceHash: b.fingerprint,
        entityIdentity: `symbol:${b.symbolIdentity}`,
        evidenceType: "symbol_removal",
        lineRange: [b.startLine, b.endLine],
        confidence: b.confidence,
        supportedClassification: "REMOVED",
      });
    }

    // 5. Process remaining unmatched target symbols as ADDED
    for (const t of unmatchedTarget) {
      if (relocatedTargetIds.has(t.symbolIdentity)) continue;
      addedCount++;

      changes.push({
        symbolIdentity: t.symbolIdentity,
        name: t.name,
        kind: t.kind,
        changeType: "ADDED",
        targetPath: t.normalizedPath,
        targetFingerprint: t.fingerprint,
        targetLines: { startLine: t.startLine, endLine: t.endLine },
        targetConfidence: t.confidence,
      });

      evidence.push({
        evidenceId: `ev:sym:add:${targetScanId}:${t.symbolIdentity}`,
        repositoryId,
        snapshotId: targetScanId,
        sourcePath: t.normalizedPath,
        sourceHash: t.fingerprint,
        entityIdentity: `symbol:${t.symbolIdentity}`,
        evidenceType: "symbol_addition",
        lineRange: [t.startLine, t.endLine],
        confidence: t.confidence,
        supportedClassification: "ADDED",
      });
    }

    // Deterministic sorting: by symbolIdentity ASC, then name ASC
    changes.sort((a, b) => a.symbolIdentity.localeCompare(b.symbolIdentity));

    return {
      result: {
        changes,
        addedCount,
        removedCount,
        modifiedCount,
        relocatedCount,
        unchangedCount,
      },
      evidence,
      limitations,
    };
  }
}
