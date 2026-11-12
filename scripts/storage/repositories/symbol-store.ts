/**
 * Phase 7.3 — Symbol Repository Store
 * Persists extracted AST symbols with stable fingerprints and hierarchical relationships.
 */

import type { SqliteDatabase } from "../database.ts";
import type { ExtractedSymbol } from "../../extractor/types.ts";
import type { SymbolRecord } from "../types.ts";
import type { EvidenceStore } from "./evidence-store.ts";

export class SymbolStore {
  constructor(private db: SqliteDatabase) {}

  public insertSymbols(params: {
    repositoryId: number;
    scanId: number;
    fileId: number;
    symbols: ExtractedSymbol[];
    evidenceStore: EvidenceStore;
  }): Map<string, number> {
    const symbolMap = new Map<string, number>();

    const insertStmt = this.db.prepare(
      `INSERT INTO symbols (
        repository_id, scan_id, file_id, symbol_identity, name,
        kind, scope, parent_symbol_id, is_exported, start_line,
        end_line, start_column, end_column, fingerprint, confidence,
        extraction_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      // First pass: insert all symbols with parentSymbolId null to acquire IDs
      for (const s of params.symbols) {
        const confidence =
          s.kind === "react_component" && s.metadata?.reactComponentConfidence !== undefined
            ? s.metadata.reactComponentConfidence
            : 1.0;

        const res = insertStmt.run(
          params.repositoryId,
          params.scanId,
          params.fileId,
          s.symbolId,
          s.name,
          s.kind,
          s.parentScope ?? null,
          null, // parent_symbol_id populated in second pass if applicable
          s.isExported ? 1 : 0,
          s.sourceEvidence.lineStart,
          s.sourceEvidence.lineEnd,
          s.sourceEvidence.colStart,
          s.sourceEvidence.colEnd,
          s.fingerprint,
          confidence,
          "SUCCESS",
        );

        const symbolDbId = Number(res.lastInsertRowid);
        symbolMap.set(s.symbolId, symbolDbId);

        // Store provenance evidence
        params.evidenceStore.insertEvidence({
          repositoryId: params.repositoryId,
          scanId: params.scanId,
          fileId: params.fileId,
          symbolId: symbolDbId,
          evidence: s.sourceEvidence,
          evidenceType: "symbol_definition",
          description: `Extracted ${s.kind} symbol '${s.name}'`,
          confidence,
        });
      }

      // Second pass: resolve parent_symbol_id where parentScope matches another symbol's name
      const updateParentStmt = this.db.prepare(
        "UPDATE symbols SET parent_symbol_id = ? WHERE id = ?",
      );
      for (const s of params.symbols) {
        if (s.parentScope) {
          // Look up if parent exists in the same file
          const parent = params.symbols.find((p) => p.name === s.parentScope);
          if (parent) {
            const parentId = symbolMap.get(parent.symbolId);
            const currentId = symbolMap.get(s.symbolId);
            if (parentId && currentId) {
              updateParentStmt.run(parentId, currentId);
            }
          }
        }
      }
    });

    return symbolMap;
  }

  public getSymbols(scanId: number, fileId?: number): SymbolRecord[] {
    let sql = `SELECT
        id, repository_id AS repositoryId, scan_id AS scanId,
        file_id AS fileId, symbol_identity AS symbolIdentity,
        name, kind, scope, parent_symbol_id AS parentSymbolId,
        is_exported AS isExported, start_line AS startLine,
        end_line AS endLine, start_column AS startColumn,
        end_column AS endColumn, fingerprint, confidence,
        extraction_status AS extractionStatus
      FROM symbols
      WHERE scan_id = ?`;

    const args: (number | string)[] = [scanId];
    if (fileId !== undefined) {
      sql += " AND file_id = ?";
      args.push(fileId);
    }
    sql += " ORDER BY start_line ASC, start_column ASC";

    const rows = this.db.prepare(sql).all(...args) as unknown as SymbolRecord[];
    return rows.map((r) => ({
      ...r,
      isExported: Boolean(r.isExported),
    }));
  }

  public findByIdentity(scanId: number, symbolIdentity: string): SymbolRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_identity AS symbolIdentity,
          name, kind, scope, parent_symbol_id AS parentSymbolId,
          is_exported AS isExported, start_line AS startLine,
          end_line AS endLine, start_column AS startColumn,
          end_column AS endColumn, fingerprint, confidence,
          extraction_status AS extractionStatus
        FROM symbols
        WHERE scan_id = ? AND symbol_identity = ?`,
      )
      .get(scanId, symbolIdentity) as unknown as SymbolRecord | undefined;

    if (!row) return null;
    return {
      ...row,
      isExported: Boolean(row.isExported),
    };
  }

  public findByName(scanId: number, name: string): SymbolRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_identity AS symbolIdentity,
          name, kind, scope, parent_symbol_id AS parentSymbolId,
          is_exported AS isExported, start_line AS startLine,
          end_line AS endLine, start_column AS startColumn,
          end_column AS endColumn, fingerprint, confidence,
          extraction_status AS extractionStatus
        FROM symbols
        WHERE scan_id = ? AND name = ?`,
      )
      .all(scanId, name) as unknown as SymbolRecord[];

    return rows.map((r) => ({
      ...r,
      isExported: Boolean(r.isExported),
    }));
  }

  public getSymbolCount(scanId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM symbols WHERE scan_id = ?")
      .get(scanId) as { count: number };
    return row.count;
  }
}
