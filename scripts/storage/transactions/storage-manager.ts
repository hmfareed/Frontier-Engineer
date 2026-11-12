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

    let targetScanId = scanId;
    if (targetScanId === undefined) {
      const activeScan = await this.getActiveScan(repositoryId);
      if (!activeScan) {
        return {
          isValid: true,
          scanId: 0,
          repositoryId,
          checkedAt: new Date().toISOString(),
          issues: [],
        };
      }
      targetScanId = activeScan.id;
    }

    const issues: IntegrityIssue[] = [];

    // Graph validation
    const graphIssues = GraphValidator.validate(this.graphStore, targetScanId);
    issues.push(...graphIssues);

    // Database referential checks
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
