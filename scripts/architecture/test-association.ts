/**
 * Phase 7.3 — Test Association Engine
 * Deterministic mapping between test suites and source modules via import evidence and naming conventions.
 */

import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { TestAssociation } from "./types.ts";

export class TestAssociationEngine {
  public static associate(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
  ): TestAssociation[] {
    const associations: TestAssociation[] = [];
    const seenPairs = new Set<string>();

    // 1. Direct Import Evidence: Test file imports source file
    const importBased = db
      .prepare(
        `SELECT
          testFile.normalized_path AS testPath,
          sourceFile.normalized_path AS sourcePath
         FROM imports i
         JOIN files testFile ON testFile.id = i.source_file_id
         JOIN files sourceFile ON sourceFile.id = i.resolved_file_id
         WHERE i.scan_id = ? AND i.resolution_status = 'RESOLVED'
           AND (testFile.normalized_path LIKE '%.test.%' OR testFile.normalized_path LIKE '%.spec.%' OR testFile.normalized_path LIKE 'tests/%' OR testFile.normalized_path LIKE 'test/%')
           AND NOT (sourceFile.normalized_path LIKE '%.test.%' OR sourceFile.normalized_path LIKE '%.spec.%')
         ORDER BY testFile.normalized_path ASC, sourceFile.normalized_path ASC`,
      )
      .all(scanId) as { testPath: string; sourcePath: string }[];

    for (const row of importBased) {
      const pairKey = `${row.testPath}->${row.sourcePath}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        associations.push({
          testFilePath: row.testPath,
          sourceFilePath: row.sourcePath,
          associationStatus: "CONFIRMED",
          confidence: 1.0,
          evidenceType: "import_evidence",
          evidenceDescription: `Test file imports source module directly`,
        });
      }
    }

    // 2. Naming Convention: tests/unit/foo.test.ts -> src/foo.ts or foo.ts
    const testFiles = db
      .prepare(
        `SELECT normalized_path AS path FROM files
         WHERE scan_id = ? AND (normalized_path LIKE '%.test.%' OR normalized_path LIKE '%.spec.%')`,
      )
      .all(scanId) as { path: string }[];

    const allSourceFiles = db
      .prepare(
        `SELECT normalized_path AS path FROM files
         WHERE scan_id = ? AND NOT (normalized_path LIKE '%.test.%' OR normalized_path LIKE '%.spec.%')`,
      )
      .all(scanId) as { path: string }[];

    const sourceByBase = new Map<string, string[]>();
    for (const sf of allSourceFiles) {
      const ext = path.posix.extname(sf.path);
      const base = path.posix.basename(sf.path, ext);
      if (!sourceByBase.has(base)) {
        sourceByBase.set(base, []);
      }
      sourceByBase.get(base)!.push(sf.path);
    }

    for (const tf of testFiles) {
      const cleanBase = path.posix.basename(tf.path).replace(/\.(test|spec)\.[^.]+$/, "");

      const matchedSources = sourceByBase.get(cleanBase);
      if (matchedSources) {
        for (const sp of matchedSources) {
          const pairKey = `${tf.path}->${sp}`;
          if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            associations.push({
              testFilePath: tf.path,
              sourceFilePath: sp,
              associationStatus: "INFERRED",
              confidence: 0.8,
              evidenceType: "naming_convention",
              evidenceDescription: `Test filename matches source module base name '${cleanBase}'`,
            });
          }
        }
      }
    }

    return associations;
  }
}
