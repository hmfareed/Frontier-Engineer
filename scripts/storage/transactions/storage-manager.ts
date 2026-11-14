/**
 * Phase 7.3 — Intelligence Storage Manager
 * Main facade coordinating storage lifecycle, snapshot promotion, integrity validation, and recovery.
 */

import type { ConnectionManager } from "../connection-manager.ts";
import { ScanStore } from "../repositories/scan-store.ts";
import { SnapshotWriter } from "./snapshot-writer.ts";
import { GraphStore } from "../../graph/graph-store.ts";
import { GraphValidator } from "../../graph/graph-validator.ts";
import type {
  IntelligenceStorage,
  RepositoryRecord,
  ScanRecord,
  SnapshotInput,
  SnapshotResult,
  IntegrityReport,
  IntegrityIssue,
} from "../types.ts";

export class StorageManager implements IntelligenceStorage {
  private connectionManager: ConnectionManager;
  private scanStore: ScanStore | null = null;
  private graphStore: GraphStore | null = null;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  public async initialize(): Promise<void> {
    await this.connectionManager.initialize();
    const db = this.connectionManager.getDatabase();
    this.scanStore = new ScanStore(db);
    this.graphStore = new GraphStore(db);
  }

  public async getRepository(repositoryIdentity: string): Promise<RepositoryRecord | null> {
    const db = this.connectionManager.getDatabase();
    const row = db
      .prepare(
        `SELECT
          id, identity, root_path AS rootPath, display_name AS displayName,
          created_at AS createdAt, updated_at AS updatedAt,
          schema_version AS schemaVersion, active_scan_id AS activeScanId
        FROM repositories WHERE identity = ?`,
      )
      .get(repositoryIdentity) as RepositoryRecord | undefined;

    return row ?? null;
  }

  public async getActiveScan(repositoryId: number): Promise<ScanRecord | null> {
    if (!this.scanStore) throw new Error("StorageManager not initialized.");
    return this.scanStore.getActiveScan(repositoryId);
  }

  public async persistSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
    const db = this.connectionManager.getDatabase();
    let repo = await this.getRepository(input.repositoryIdentity);
    if (!repo) {
      repo = this.connectionManager.getRepository();
    }

    return SnapshotWriter.persist(db, repo.id, input);
  }

  public async validateIntegrity(repositoryId: number, scanId?: number): Promise<IntegrityReport> {
    const db = this.connectionManager.getDatabase();
    if (!this.graphStore) throw new Error("StorageManager not initialized.");

    const issues: IntegrityIssue[] = [];

    // 1. SQLite Pragmas & Structural Health
    const fkRow = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys?: number } | undefined;
    if (fkRow?.foreign_keys !== 1) {
      issues.push({
        severity: "error",
        code: "FOREIGN_KEYS_DISABLED",
        message: "SQLite PRAGMA foreign_keys is disabled.",
      });
    }

    const integrity = db.integrityCheck();
    if (!integrity.ok) {
      issues.push({
        severity: "error",
        code: "SQLITE_INTEGRITY_ERROR",
        message: `PRAGMA integrity_check reported: ${integrity.message}`,
      });
    }

    const fkViolations = db.prepare("PRAGMA foreign_key_check;").all() as unknown[];
    if (fkViolations.length > 0) {
      issues.push({
        severity: "error",
        code: "FOREIGN_KEY_VIOLATION",
        message: `Detected ${fkViolations.length} SQLite foreign key violation(s).`,
      });
    }

    // 2. Schema Immutability Triggers & Core Indexes
    const masterRows = db
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'index')")
      .all() as Array<{ type: string; name: string }>;
    const triggerNames = new Set(masterRows.filter((r) => r.type === "trigger").map((r) => r.name));
    const indexNames = new Set(masterRows.filter((r) => r.type === "index").map((r) => r.name));

    const requiredTriggers = [
      "trg_memory_versions_no_update",
      "trg_memory_versions_no_direct_delete",
      "trg_engineering_memories_insert_guard",
      "trg_engineering_memories_update_guard",
      "trg_engineering_memories_no_delete_replacement",
    ];
    for (const trig of requiredTriggers) {
      if (!triggerNames.has(trig)) {
        issues.push({
          severity: "error",
          code: "MISSING_REQUIRED_TRIGGER",
          message: `Required schema immutability trigger '${trig}' is missing.`,
          entityId: trig,
          entityType: "trigger",
        });
      }
    }

    const requiredIndexes = [
      "idx_files_scan_path",
      "idx_symbols_identity",
      "idx_graph_nodes_identity",
      "idx_graph_edges_rel",
      "idx_memories_repo_cat_status",
      "idx_evolution_events_target",
    ];
    for (const idx of requiredIndexes) {
      if (!indexNames.has(idx)) {
        issues.push({
          severity: "error",
          code: "MISSING_REQUIRED_INDEX",
          message: `Required schema performance index '${idx}' is missing.`,
          entityId: idx,
          entityType: "index",
        });
      }
    }

    // 3. Active Scan Ownership & Singularity
    const activeScans = db
      .prepare("SELECT id FROM scan_runs WHERE repository_id = ? AND is_active = 1")
      .all(repositoryId) as Array<{ id: number }>;
    if (activeScans.length > 1) {
      issues.push({
        severity: "error",
        code: "MULTIPLE_ACTIVE_SCANS",
        message: `Repository ${repositoryId} has ${activeScans.length} scans marked is_active = 1.`,
      });
    }

    const repoRow = db
      .prepare("SELECT active_scan_id AS activeScanId FROM repositories WHERE id = ?")
      .get(repositoryId) as { activeScanId: number | null } | undefined;
    if (repoRow?.activeScanId !== null && repoRow?.activeScanId !== undefined) {
      const matchesFlag = activeScans.some((s) => s.id === repoRow.activeScanId);
      if (!matchesFlag) {
        issues.push({
          severity: "error",
          code: "ACTIVE_SCAN_MISMATCH",
          message: `repositories.active_scan_id (${repoRow.activeScanId}) disagrees with scan_runs.is_active.`,
        });
      }
    }

    // 4. Orphaned File Records
    const orphanFiles = db
      .prepare(
        `SELECT COUNT(*) AS count FROM files f
         LEFT JOIN scan_runs s ON s.id = f.scan_id
         WHERE s.id IS NULL AND f.repository_id = ?`,
      )
      .get(repositoryId) as { count: number };
    if (orphanFiles.count > 0) {
      issues.push({
        severity: "error",
        code: "ORPHAN_FILES",
        message: `Detected ${orphanFiles.count} orphaned file records.`,
      });
    }

    let targetScanId = scanId;
    if (targetScanId === undefined) {
      const activeScan = await this.getActiveScan(repositoryId);
      targetScanId = activeScan?.id ?? 0;
    }

    if (targetScanId > 0) {
      const targetScanRow = db
        .prepare("SELECT repository_id AS repositoryId FROM scan_runs WHERE id = ?")
        .get(targetScanId) as { repositoryId: number } | undefined;
      if (!targetScanRow || targetScanRow.repositoryId !== repositoryId) {
        issues.push({
          severity: "error",
          code: "SCAN_REPOSITORY_MISMATCH",
          message: `Scan ${targetScanId} does not belong to repository ${repositoryId}.`,
          entityId: targetScanId,
          entityType: "scan",
        });
      } else {
        const graphIssues = GraphValidator.validate(this.graphStore, targetScanId);
        issues.push(...graphIssues);
      }
    }

    return {
      isValid: issues.filter((i) => i.severity === "error").length === 0,
      scanId: targetScanId,
      repositoryId,
      checkedAt: new Date().toISOString(),
      issues,
    };
  }

  public async recoverInterruptedScans(repositoryId: number): Promise<number> {
    if (!this.scanStore) throw new Error("StorageManager not initialized.");
    return this.scanStore.recoverInterruptedScans(repositoryId);
  }

  public async close(): Promise<void> {
    this.connectionManager.close();
    this.scanStore = null;
    this.graphStore = null;
  }
}
