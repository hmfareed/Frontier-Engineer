/**
 * Phase 7.3 — File Inventory Repository Store
 * Persists discovered and inspected repository files with sensitivity awareness.
 */

import type { SqliteDatabase } from "../database.ts";
import type { ScannedFileRecord } from "../../scanner/types.ts";
import type { FileRecord } from "../types.ts";

export class FileStore {
  constructor(private db: SqliteDatabase) {}

  public insertFiles(
    repositoryId: number,
    scanId: number,
    files: ScannedFileRecord[],
  ): Map<string, number> {
    const pathToId = new Map<string, number>();
    const now = new Date().toISOString();

    const insertStmt = this.db.prepare(
      `INSERT INTO files (
        repository_id, scan_id, relative_path, normalized_path, extension,
        language, classification, size_bytes, modified_at, content_hash,
        sensitivity_status, index_status, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const f of files) {
        // Enforce strict sensitivity protection: nullify hash for sensitive files
        const isSensitive =
          f.classification === "sensitive" ||
          f.hashState === "SKIPPED_SENSITIVE" ||
          f.inspectionStatus === "EXCLUDED_CONTENT";

        const contentHash = isSensitive ? null : f.contentHash;
        const sensitivityStatus = isSensitive ? "SENSITIVE" : "SAFE";
        const indexStatus =
          f.inspectionStatus === "INCLUDED" || f.inspectionStatus === "INSPECTED"
            ? "INDEXED"
            : f.inspectionStatus;

        // Detect language from extension
        const language = this.detectLanguage(f.fileExtension);

        const res = insertStmt.run(
          repositoryId,
          scanId,
          f.canonicalPath,
          f.canonicalPath,
          f.fileExtension,
          language,
          f.classification,
          f.sizeBytes,
          f.mtimeMs,
          contentHash,
          sensitivityStatus,
          indexStatus,
          now,
        );

        pathToId.set(f.canonicalPath, Number(res.lastInsertRowid));
      }
    });

    return pathToId;
  }

  public getFileByPath(scanId: number, normalizedPath: string): FileRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, scan_id AS scanId,
          relative_path AS relativePath, normalized_path AS normalizedPath,
          extension, language, classification, size_bytes AS sizeBytes,
          modified_at AS modifiedAt, content_hash AS contentHash,
          sensitivity_status AS sensitivityStatus, index_status AS indexStatus,
          indexed_at AS indexedAt
        FROM files
        WHERE scan_id = ? AND normalized_path = ?`,
      )
      .get(scanId, normalizedPath) as FileRecord | undefined;

    return row ?? null;
  }

  public getFiles(scanId: number): FileRecord[] {
    const rows = this.db
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
      .all(scanId) as unknown as FileRecord[];

    return rows;
  }

  public getFileCount(scanId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM files WHERE scan_id = ?")
      .get(scanId) as { count: number };
    return row.count;
  }

  private detectLanguage(ext: string): string {
    const map: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".json": "json",
      ".md": "markdown",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".sql": "sql",
      ".html": "html",
      ".css": "css",
      ".scss": "scss",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".sh": "shell",
      ".ps1": "powershell",
    };
    return map[ext.toLowerCase()] || "plaintext";
  }
}
