/**
 * Phase 7.3 — Export Repository Store
 * Persists exported declarations, default exports, and re-exports.
 */

import type { SqliteDatabase } from "../database.ts";
import type { ExportRecord as ExtractorExportRecord } from "../../extractor/types.ts";
import type { ExportRecord } from "../types.ts";
import type { EvidenceStore } from "./evidence-store.ts";

export class ExportStore {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public insertExports(params: {
    repositoryId: number;
    scanId: number;
    fileId: number;
    exports: ExtractorExportRecord[];
    symbolMap: Map<string, number>;
    evidenceStore: EvidenceStore;
  }): void {
    const insertStmt = this.db.prepare(
      `INSERT INTO exports (
        repository_id, scan_id, file_id, symbol_id, export_name,
        export_kind, is_default, start_line, end_line, evidence_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const exp of params.exports) {
        const isDefault = exp.name === "default" || exp.localName === "default";
        const exportKind = exp.isWildcard
          ? "wildcard"
          : exp.isReExport
            ? "reexport"
            : isDefault
              ? "default"
              : "named";

        // Attempt symbol association
        let symbolId: number | null = null;
        for (const [symIdentity, sId] of params.symbolMap.entries()) {
          if (symIdentity.endsWith(`#${exp.localName}`) || symIdentity.endsWith(`#${exp.name}`)) {
            symbolId = sId;
            break;
          }
        }

        const lineStart = exp.sourceEvidence?.lineStart ?? 1;
        const lineEnd = exp.sourceEvidence?.lineEnd ?? lineStart;

        let evidenceId: number | null = null;
        if (exp.sourceEvidence) {
          evidenceId = params.evidenceStore.insertEvidence({
            repositoryId: params.repositoryId,
            scanId: params.scanId,
            fileId: params.fileId,
            symbolId,
            evidence: exp.sourceEvidence,
            evidenceType: "export_declaration",
            description: `Export '${exp.name}' (${exportKind})`,
            confidence: 1.0,
          });
        }

        insertStmt.run(
          params.repositoryId,
          params.scanId,
          params.fileId,
          symbolId,
          exp.name,
          exportKind,
          isDefault ? 1 : 0,
          lineStart,
          lineEnd,
          evidenceId,
        );
      }
    });
  }

  public getExports(scanId: number, fileId?: number): ExportRecord[] {
    let sql = `SELECT
        id, repository_id AS repositoryId, scan_id AS scanId,
        file_id AS fileId, symbol_id AS symbolId, export_name AS exportName,
        export_kind AS exportKind, is_default AS isDefault,
        start_line AS startLine, end_line AS endLine, evidence_id AS evidenceId
      FROM exports
      WHERE scan_id = ?`;

    const args: (number | string)[] = [scanId];
    if (fileId !== undefined) {
      sql += " AND file_id = ?";
      args.push(fileId);
    }
    sql += " ORDER BY file_id ASC, start_line ASC";

    const rows = this.db.prepare(sql).all(...args) as unknown as ExportRecord[];
    return rows.map((r) => ({
      ...r,
      isDefault: Boolean(r.isDefault),
    }));
  }

  public getExportCount(scanId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM exports WHERE scan_id = ?")
      .get(scanId) as { count: number };
    return row.count;
  }
}
