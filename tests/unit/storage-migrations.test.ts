import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  runMigrations,
  getCurrentSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from "../../scripts/storage/schema/migration-runner.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";

describe("storage-migrations (Database Foundation & Schema Integrity)", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("applies migrations cleanly to a fresh database", () => {
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(0);
    const result = runMigrations(db.rawDb);

    expect(result.applied).toBe(1);
    expect(result.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("is idempotent when re-running migrations on an up-to-date schema", () => {
    runMigrations(db.rawDb);
    const result2 = runMigrations(db.rawDb);

    expect(result2.applied).toBe(0);
    expect(result2.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("fails safely when an unsupported newer schema version is detected", () => {
    runMigrations(db.rawDb);
    // Simulate a future version
    db.rawDb
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(999, "999-future-feature", new Date().toISOString());

    expect(() => runMigrations(db.rawDb)).toThrow(/Unsupported newer database schema version 999/);
  });

  it("enforces foreign keys and cascades", () => {
    runMigrations(db.rawDb);

    const now = new Date().toISOString();
    // Insert repository
    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_1", "/test/repo", "Test Repo", now, now, 1);
    const repoId = Number(repoRes.lastInsertRowid);

    // Insert scan run
    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, ?, ?, ?)",
      )
      .run(repoId, now, "RUNNING", "1.0.0", "1.0.0");
    const scanId = Number(scanRes.lastInsertRowid);

    // Foreign key violation: scan_runs with non-existent repository
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, ?, ?, ?)",
        )
        .run(99999, now, "RUNNING", "1.0.0", "1.0.0");
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Insert valid file
    const fileRes = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        repoId,
        scanId,
        "src/app.ts",
        "src/app.ts",
        ".ts",
        "typescript",
        "source",
        120,
        1700000000,
        "NONE",
        "INDEXED",
        now,
      );
    const fileId = Number(fileRes.lastInsertRowid);

    // Verify composite foreign key: symbol referencing correct repo & scan works
    db.rawDb
      .prepare(
        "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        repoId,
        scanId,
        fileId,
        "sym:src/app.ts#main",
        "main",
        "function",
        1,
        10,
        0,
        1,
        "fp_123",
        1.0,
        "SUCCESS",
      );

    // Verify composite foreign key: inserting symbol with mismatched scanId fails
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          repoId,
          999,
          fileId,
          "sym:src/app.ts#bad",
          "bad",
          "function",
          1,
          10,
          0,
          1,
          "fp_456",
          1.0,
          "SUCCESS",
        );
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Deleting scan cascades and deletes file and symbol
    db.rawDb.prepare("DELETE FROM scan_runs WHERE id = ?").run(scanId);
    const remainingFiles = db.rawDb
      .prepare("SELECT COUNT(*) AS count FROM files WHERE scan_id = ?")
      .get(scanId) as { count: number };
    const remainingSymbols = db.rawDb
      .prepare("SELECT COUNT(*) AS count FROM symbols WHERE scan_id = ?")
      .get(scanId) as { count: number };

    expect(remainingFiles.count).toBe(0);
    expect(remainingSymbols.count).toBe(0);
  });

  it("enforces domain constraints and status checks", () => {
    runMigrations(db.rawDb);
    const now = new Date().toISOString();

    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("repo_check", "/repo", "Repo", now, now, 1);
    const repoId = Number(repoRes.lastInsertRowid);

    // Invalid scan run status
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, ?, ?, ?)",
        )
        .run(repoId, now, "INVALID_STATUS", "1.0.0", "1.0.0");
    }).toThrow(/CHECK constraint failed/);

    // Insert valid scan run
    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, ?, ?, ?)",
      )
      .run(repoId, now, "RUNNING", "1.0.0", "1.0.0");
    const scanId = Number(scanRes.lastInsertRowid);

    // Invalid negative file size
    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          repoId,
          scanId,
          "bad.ts",
          "bad.ts",
          ".ts",
          "typescript",
          "source",
          -50,
          now,
          "NONE",
          "INDEXED",
          now,
        );
    }).toThrow(/CHECK constraint failed/);

    // Invalid line bounds (end_line < start_line)
    const fileRes = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        repoId,
        scanId,
        "valid.ts",
        "valid.ts",
        ".ts",
        "typescript",
        "source",
        10,
        1700000000,
        "NONE",
        "INDEXED",
        now,
      );
    const fileId = Number(fileRes.lastInsertRowid);

    expect(() => {
      db.rawDb
        .prepare(
          "INSERT INTO symbols (repository_id, scan_id, file_id, symbol_identity, name, kind, start_line, end_line, start_column, end_column, fingerprint, confidence, extraction_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          repoId,
          scanId,
          fileId,
          "sym:invalid_lines",
          "fn",
          "function",
          10,
          5,
          0,
          0,
          "fp",
          1.0,
          "SUCCESS",
        );
    }).toThrow(/CHECK constraint failed/);
  });
});
