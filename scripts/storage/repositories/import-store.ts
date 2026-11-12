/**
 * Phase 7.3 — Import Repository Store
 * Persists module imports with resolved target references and explicit unresolved tracking.
 */

import type { SqliteDatabase } from "../database.ts";
import type { ImportRecord as ExtractorImportRecord } from "../../extractor/types.ts";
import type { ImportRecord } from "../types.ts";
import type { EvidenceStore } from "./evidence-store.ts";

export class ImportStore {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public insertImports(params: {
    repositoryId: number;
    scanId: number;
    sourceFileId: number;
    imports: ExtractorImportRecord[];
    pathToId: Map<string, number>;
    evidenceStore: EvidenceStore;
  }): void {
    const insertStmt = this.db.prepare(
      `INSERT INTO imports (
        repository_id, scan_id, source_file_id, imported_specifier,
        import_kind, resolved_file_id, resolution_status, start_line,
        end_line, evidence_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const imp of params.imports) {
        let resolvedFileId: number | null = null;
        let resolutionStatus: "RESOLVED" | "UNRESOLVED" | "EXTERNAL" | "BUILTIN" | "DEGRADED" =
          "UNRESOLVED";

        if (imp.resolvedPath) {
          const matchedId = params.pathToId.get(imp.resolvedPath);
          if (matchedId !== undefined) {
            resolvedFileId = matchedId;
            resolutionStatus = "RESOLVED";
          }
        }

        if (resolutionStatus === "UNRESOLVED") {
          if (imp.specifier.startsWith("node:")) {
            resolutionStatus = "BUILTIN";
          } else if (
            !imp.specifier.startsWith(".") &&
            !imp.specifier.startsWith("/") &&
            !imp.specifier.startsWith("@/") &&
            !imp.specifier.startsWith("~")
          ) {
            resolutionStatus = "EXTERNAL";
          } else if (imp.evidenceClassification === "external_or_missing") {
            resolutionStatus = "UNRESOLVED";
          }
        }

        const importKind = imp.isTypeOnly ? "type" : imp.isDynamic ? "dynamic" : "static";

        const lineStart = imp.sourceEvidence?.lineStart ?? 1;
        const lineEnd = imp.sourceEvidence?.lineEnd ?? lineStart;

        let evidenceId: number | null = null;
        if (imp.sourceEvidence) {
          evidenceId = params.evidenceStore.insertEvidence({
            repositoryId: params.repositoryId,
            scanId: params.scanId,
            fileId: params.sourceFileId,
            evidence: imp.sourceEvidence,
            evidenceType: "import_statement",
            description: `Import from '${imp.specifier}' (${resolutionStatus})`,
            confidence: resolutionStatus === "RESOLVED" ? 1.0 : 0.8,
          });
        }

        insertStmt.run(
          params.repositoryId,
          params.scanId,
          params.sourceFileId,
          imp.specifier,
          importKind,
          resolvedFileId,
          resolutionStatus,
          lineStart,
          lineEnd,
          evidenceId,
        );
      }
    });
  }

  public getImports(scanId: number, sourceFileId?: number): ImportRecord[] {
    let sql = `SELECT
        id, repository_id AS repositoryId, scan_id AS scanId,
        source_file_id AS sourceFileId, imported_specifier AS importedSpecifier,
        import_kind AS importKind, resolved_file_id AS resolvedFileId,
        resolution_status AS resolutionStatus, start_line AS startLine,
        end_line AS endLine, evidence_id AS evidenceId
      FROM imports
      WHERE scan_id = ?`;

    const args: (number | string)[] = [scanId];
    if (sourceFileId !== undefined) {
      sql += " AND source_file_id = ?";
      args.push(sourceFileId);
    }
    sql += " ORDER BY source_file_id ASC, start_line ASC";

    return this.db.prepare(sql).all(...args) as unknown as ImportRecord[];
  }

  public getUnresolvedImports(scanId: number): ImportRecord[] {
    const sql = `SELECT
        id, repository_id AS repositoryId, scan_id AS scanId,
        source_file_id AS sourceFileId, imported_specifier AS importedSpecifier,
        import_kind AS importKind, resolved_file_id AS resolvedFileId,
        resolution_status AS resolutionStatus, start_line AS startLine,
        end_line AS endLine, evidence_id AS evidenceId
      FROM imports
      WHERE scan_id = ? AND resolution_status = 'UNRESOLVED'
      ORDER BY source_file_id ASC, start_line ASC`;

    return this.db.prepare(sql).all(scanId) as unknown as ImportRecord[];
  }

  public getImportCount(scanId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM imports WHERE scan_id = ?")
      .get(scanId) as { count: number };
    return row.count;
  }
}
