/**
 * Phase 7.5 Stage 3 — Snapshot Validator
 * Validates repository identity, snapshot existence, status completeness, chronology, and relational integrity.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { ScanRecord } from "../storage/types.ts";
import type { SnapshotValidationResult, ComparatorOptions } from "./types.ts";

export class SnapshotValidator {
  public static validate(
    db: SqliteDatabase,
    baseScanId: number,
    targetScanId: number,
    options: ComparatorOptions = {},
  ): SnapshotValidationResult {
    const passedChecks: string[] = [];
    const failedChecks: string[] = [];

    // 1. Identity distinctness check
    if (baseScanId === targetScanId) {
      failedChecks.push("IDENTICAL_SNAPSHOT_IDS");
      return {
        isValid: false,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_IDENTICAL_SNAPSHOTS",
        errorMessage: `Base snapshot and target snapshot cannot be identical (scan ID: ${baseScanId}).`,
      };
    }
    passedChecks.push("DISTINCT_SNAPSHOT_IDS");

    // 2. Fetch base snapshot
    const baseRow = db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, started_at AS startedAt,
          completed_at AS completedAt, status, files_discovered AS filesDiscovered,
          files_indexed AS filesIndexed, files_skipped AS filesSkipped,
          files_failed AS filesFailed, diagnostic_count AS diagnosticCount,
          scanner_version AS scannerVersion, extractor_version AS extractorVersion,
          is_active AS isActive, failure_reason AS failureReason
        FROM scan_runs WHERE id = ?`,
      )
      .get(baseScanId) as ScanRecord | undefined;

    if (!baseRow) {
      failedChecks.push("BASE_SNAPSHOT_EXISTS");
      return {
        isValid: false,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_BASE_SNAPSHOT_NOT_FOUND",
        errorMessage: `Base snapshot record not found for scan ID ${baseScanId}.`,
      };
    }
    passedChecks.push("BASE_SNAPSHOT_EXISTS");

    // 3. Fetch target snapshot
    const targetRow = db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, started_at AS startedAt,
          completed_at AS completedAt, status, files_discovered AS filesDiscovered,
          files_indexed AS filesIndexed, files_skipped AS filesSkipped,
          files_failed AS filesFailed, diagnostic_count AS diagnosticCount,
          scanner_version AS scannerVersion, extractor_version AS extractorVersion,
          is_active AS isActive, failure_reason AS failureReason
        FROM scan_runs WHERE id = ?`,
      )
      .get(targetScanId) as ScanRecord | undefined;

    if (!targetRow) {
      failedChecks.push("TARGET_SNAPSHOT_EXISTS");
      return {
        isValid: false,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_TARGET_SNAPSHOT_NOT_FOUND",
        errorMessage: `Target snapshot record not found for scan ID ${targetScanId}.`,
      };
    }
    passedChecks.push("TARGET_SNAPSHOT_EXISTS");

    // 4. Repository identity match
    if (baseRow.repositoryId !== targetRow.repositoryId) {
      failedChecks.push("REPOSITORY_IDENTITY_MATCH");
      return {
        isValid: false,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_CROSS_REPOSITORY_COMPARISON",
        errorMessage: `Cannot compare snapshots belonging to different repositories (base repo: ${baseRow.repositoryId}, target repo: ${targetRow.repositoryId}).`,
      };
    }
    passedChecks.push("REPOSITORY_IDENTITY_MATCH");
    const repositoryId = baseRow.repositoryId;

    if (
      options.expectedRepositoryId !== undefined &&
      repositoryId !== options.expectedRepositoryId
    ) {
      failedChecks.push("EXPECTED_REPOSITORY_MATCH");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_REPOSITORY_MISMATCH",
        errorMessage: `Snapshots belong to repository ${repositoryId}, expected active workspace repository ${options.expectedRepositoryId}.`,
      };
    }
    if (options.expectedRepositoryId !== undefined) {
      passedChecks.push("EXPECTED_REPOSITORY_MATCH");
    }

    // Verify repository record exists
    const repoRow = db
      .prepare("SELECT id, identity, root_path AS rootPath FROM repositories WHERE id = ?")
      .get(repositoryId) as { id: number; identity: string; rootPath: string } | undefined;

    if (!repoRow) {
      failedChecks.push("REPOSITORY_RECORD_EXISTS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_REPOSITORY_RECORD_MISSING",
        errorMessage: `Repository record ${repositoryId} could not be resolved in database.`,
      };
    }
    passedChecks.push("REPOSITORY_RECORD_EXISTS");

    // 5. Completeness check
    const allowPartial = options.allowPartial ?? false;

    // Base scan status
    if (baseRow.status === "FAILED" || baseRow.status === "CANCELLED") {
      failedChecks.push("BASE_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_BASE_SNAPSHOT_INCOMPLETE",
        errorMessage: `Base snapshot ${baseScanId} has non-completable status '${baseRow.status}'.`,
      };
    }
    if (baseRow.status === "RUNNING" || baseRow.status === "VALIDATING") {
      failedChecks.push("BASE_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_BASE_SNAPSHOT_IN_PROGRESS",
        errorMessage: `Base snapshot ${baseScanId} is currently in progress (${baseRow.status}).`,
      };
    }
    if (baseRow.status === "PARTIAL" && !allowPartial) {
      failedChecks.push("BASE_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_BASE_SNAPSHOT_PARTIAL",
        errorMessage: `Base snapshot ${baseScanId} is PARTIAL and allowPartial is false.`,
      };
    }
    passedChecks.push("BASE_SNAPSHOT_COMPLETENESS");

    // Target scan status
    if (targetRow.status === "FAILED" || targetRow.status === "CANCELLED") {
      failedChecks.push("TARGET_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_TARGET_SNAPSHOT_INCOMPLETE",
        errorMessage: `Target snapshot ${targetScanId} has non-completable status '${targetRow.status}'.`,
      };
    }
    if (targetRow.status === "RUNNING" || targetRow.status === "VALIDATING") {
      failedChecks.push("TARGET_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_TARGET_SNAPSHOT_IN_PROGRESS",
        errorMessage: `Target snapshot ${targetScanId} is currently in progress (${targetRow.status}).`,
      };
    }
    if (targetRow.status === "PARTIAL" && !allowPartial) {
      failedChecks.push("TARGET_SNAPSHOT_COMPLETENESS");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_TARGET_SNAPSHOT_PARTIAL",
        errorMessage: `Target snapshot ${targetScanId} is PARTIAL and allowPartial is false.`,
      };
    }
    passedChecks.push("TARGET_SNAPSHOT_COMPLETENESS");

    // 6. Chronology check
    const baseTime = Date.parse(baseRow.startedAt);
    const targetTime = Date.parse(targetRow.startedAt);

    if (isNaN(baseTime) || isNaN(targetTime)) {
      failedChecks.push("CHRONOLOGY_PARSEABLE");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_INVALID_SCAN_TIMESTAMP",
        errorMessage:
          "One or more snapshot timestamps could not be parsed as valid ISO 8601 dates.",
      };
    }
    passedChecks.push("CHRONOLOGY_PARSEABLE");

    if (targetTime < baseTime) {
      failedChecks.push("CHRONOLOGICAL_ORDER");
      return {
        isValid: false,
        repositoryId,
        baseScanId,
        targetScanId,
        passedChecks,
        failedChecks,
        errorCode: "ERR_CHRONOLOGY_VIOLATION",
        errorMessage: `Chronology violation: target snapshot started at ${targetRow.startedAt}, which is earlier than base snapshot started at ${baseRow.startedAt}.`,
      };
    }
    passedChecks.push("CHRONOLOGICAL_ORDER");

    return {
      isValid: true,
      repositoryId,
      baseScanId,
      targetScanId,
      passedChecks,
      failedChecks: [],
    };
  }
}
