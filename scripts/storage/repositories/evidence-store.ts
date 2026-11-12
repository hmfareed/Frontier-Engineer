/**
 * Phase 7.3 — Source Evidence Repository Store
 * Persists granular AST provenance and structural evidence with secret sanitization.
 */

import type { SqliteDatabase } from "../database.ts";
import type { SourceEvidence } from "../../extractor/types.ts";
import type { SourceEvidenceRecord } from "../types.ts";

export class EvidenceStore {
  constructor(private db: SqliteDatabase) {}

  public insertEvidence(params: {
    repositoryId: number;
    scanId: number;
    fileId: number;
    symbolId?: number | null;
    evidence: SourceEvidence;
    evidenceType: string;
    description: string;
    confidence?: number;
  }): number {
    const sanitizedDescription = this.sanitizeDescription(params.description);
    const confidence = params.confidence ?? 1.0;

    const stmt = this.db.prepare(
      `INSERT INTO source_evidence (
        repository_id, scan_id, file_id, symbol_id, evidence_type,
        start_line, end_line, start_column, end_column, confidence,
        evidence_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const res = stmt.run(
      params.repositoryId,
      params.scanId,
      params.fileId,
      params.symbolId ?? null,
      params.evidenceType,
      params.evidence.lineStart,
      params.evidence.lineEnd,
      params.evidence.colStart,
      params.evidence.colEnd,
      confidence,
      sanitizedDescription,
    );

    return Number(res.lastInsertRowid);
  }

  public getEvidenceById(id: number): SourceEvidenceRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_id AS symbolId, evidence_type AS evidenceType,
          start_line AS startLine, end_line AS endLine,
          start_column AS startColumn, end_column AS endColumn,
          confidence, evidence_description AS evidenceDescription
        FROM source_evidence WHERE id = ?`,
      )
      .get(id) as SourceEvidenceRecord | undefined;

    return row ?? null;
  }

  public getEvidenceForFile(fileId: number): SourceEvidenceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          file_id AS fileId, symbol_id AS symbolId, evidence_type AS evidenceType,
          start_line AS startLine, end_line AS endLine,
          start_column AS startColumn, end_column AS endColumn,
          confidence, evidence_description AS evidenceDescription
        FROM source_evidence WHERE file_id = ?`,
      )
      .all(fileId) as unknown as SourceEvidenceRecord[];

    return rows;
  }

  private sanitizeDescription(desc: string): string {
    // Redact credential patterns if any
    return desc
      .replace(/(?:password|secret|key|token|auth)\s*[:=]\s*['"][^'"]+['"]/gi, "$1: [REDACTED]")
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi, "Bearer [REDACTED]");
  }
}
