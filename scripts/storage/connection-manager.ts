/**
 * Phase 7.3 — Database Connection & Workspace Manager
 * Bounded workspace path resolution, repository identity verification, and safe lifecycle management.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SqliteDatabase } from "./database.ts";
import { runMigrations, CURRENT_SCHEMA_VERSION } from "./schema/migration-runner.ts";
import type { RepositoryRecord } from "./types.ts";

export interface WorkspaceMetadata {
  repositoryIdentity: string;
  rootPath: string;
  displayName: string;
  createdAt: string;
  schemaVersion: number;
}

export interface ConnectionManagerOptions {
  workspaceRoot: string;
  inMemory?: boolean; // For isolated unit testing
  overrideIdentity?: string;
  overrideDisplayName?: string;
}

export class ConnectionManager {
  private readonly workspaceRoot: string;
  private readonly inMemory: boolean;
  private readonly dbPath: string;
  private readonly metadataPath: string;
  private db: SqliteDatabase | null = null;
  private repositoryRecord: RepositoryRecord | null = null;
  private metadata: WorkspaceMetadata | null = null;

  constructor(options: ConnectionManagerOptions) {
    if (!options.workspaceRoot || typeof options.workspaceRoot !== "string") {
      throw new Error("Invalid workspace root: path must be a non-empty string.");
    }

    const resolved = path.resolve(options.workspaceRoot);
    if (!options.inMemory && !fs.existsSync(resolved)) {
      throw new Error(`Workspace root does not exist: ${resolved}`);
    }

    this.workspaceRoot = resolved;
    this.inMemory = options.inMemory ?? false;

    if (this.inMemory) {
      this.dbPath = ":memory:";
      this.metadataPath = "";
    } else {
      const frontierDir = path.join(this.workspaceRoot, ".frontier", "intelligence");
      this.dbPath = path.join(frontierDir, "index.sqlite");
      this.metadataPath = path.join(frontierDir, "metadata.json");
    }
  }

  public getDatabase(): SqliteDatabase {
    if (!this.db || !this.db.isOpen()) {
      throw new Error("ConnectionManager is not initialized. Call initialize() first.");
    }
    return this.db;
  }

  public getRepository(): RepositoryRecord {
    if (!this.repositoryRecord) {
      throw new Error("Repository record is not initialized.");
    }
    return this.repositoryRecord;
  }

  public getWorkspaceMetadata(): WorkspaceMetadata | null {
    return this.metadata;
  }

  public async initialize(
    options: { overrideIdentity?: string; overrideDisplayName?: string } = {},
  ): Promise<void> {
    if (this.db && this.db.isOpen()) {
      return;
    }

    if (!this.inMemory) {
      this.verifyFilesystemBoundaries();

      const frontierDir = path.dirname(this.dbPath);
      const backupsDir = path.join(frontierDir, "backups");
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }

      // Re-verify after directory creation to prevent TOCTOU symlink injection
      this.verifyFilesystemBoundaries();
    }

    // Initialize database wrapper
    this.db = new SqliteDatabase({
      path: this.dbPath,
      enableWal: !this.inMemory,
    });

    // Check database integrity before running migrations
    const integrity = this.db.integrityCheck();
    if (!integrity.ok) {
      throw new Error(`Corrupt database detected at ${this.dbPath}: ${integrity.message}`);
    }

    // Run database migrations
    runMigrations(this.db.rawDb);

    // Verify and synchronize repository identity
    this.repositoryRecord = this.resolveAndSyncRepository(options);
  }

  private verifyFilesystemBoundaries(): void {
    if (this.inMemory) return;

    const realWs = fs.realpathSync(this.workspaceRoot);

    const dotFrontier = path.join(this.workspaceRoot, ".frontier");
    const intelligenceDir = path.join(dotFrontier, "intelligence");
    const targets = [dotFrontier, intelligenceDir, this.dbPath, this.metadataPath];

    for (const targetPath of targets) {
      if (fs.existsSync(targetPath)) {
        const lstat = fs.lstatSync(targetPath);
        if (lstat.isSymbolicLink()) {
          const realTarget = fs.realpathSync(targetPath);
          const rel = path.relative(realWs, realTarget);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(
              `Filesystem boundary violation: symlink '${targetPath}' resolves outside workspace root to '${realTarget}'.`,
            );
          }
        }
      }
    }
  }

  private resolveAndSyncRepository(options: {
    overrideIdentity?: string;
    overrideDisplayName?: string;
  }): RepositoryRecord {
    if (!this.db) {
      throw new Error("Database not available.");
    }

    const now = new Date().toISOString();
    let identity = options.overrideIdentity;
    let displayName = options.overrideDisplayName || path.basename(this.workspaceRoot);

    if (!this.inMemory) {
      if (fs.existsSync(this.metadataPath)) {
        try {
          const raw = fs.readFileSync(this.metadataPath, "utf8");
          const parsed = JSON.parse(raw) as WorkspaceMetadata;
          if (
            parsed &&
            typeof parsed.repositoryIdentity === "string" &&
            /^[a-zA-Z0-9_\-]+$/.test(parsed.repositoryIdentity) &&
            typeof parsed.rootPath === "string" &&
            !Object.prototype.hasOwnProperty.call(parsed, "__proto__")
          ) {
            this.metadata = parsed;
            if (!identity) {
              identity = parsed.repositoryIdentity;
            }
            if (
              !options.overrideDisplayName &&
              typeof parsed.displayName === "string" &&
              parsed.displayName.trim().length > 0
            ) {
              displayName = parsed.displayName.trim();
            }
          }
        } catch {
          // Metadata file unreadable or invalid JSON; fallback to computed identity
        }
      }
    }

    if (!identity) {
      // Deterministically derive a repository identity
      const hash = crypto.createHash("sha256");
      hash.update(this.workspaceRoot);
      hash.update(displayName);
      identity = `repo_${hash.digest("hex").slice(0, 16)}`;
    }

    // Persist / update metadata.json if file-based
    if (!this.inMemory) {
      const meta: WorkspaceMetadata = {
        repositoryIdentity: identity,
        rootPath: this.workspaceRoot,
        displayName,
        createdAt: this.metadata?.createdAt ?? now,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      this.metadata = meta;
      try {
        fs.writeFileSync(this.metadataPath, JSON.stringify(meta, null, 2), "utf8");
      } catch {
        // Non-fatal if metadata write fails
      }
    }

    // Query repository record in database
    const selectStmt = this.db.prepare(
      "SELECT id, identity, root_path AS rootPath, display_name AS displayName, created_at AS createdAt, updated_at AS updatedAt, schema_version AS schemaVersion, active_scan_id AS activeScanId FROM repositories WHERE identity = ?",
    );
    const existing = selectStmt.get(identity) as RepositoryRecord | undefined;

    if (existing) {
      // If rootPath has changed, update it (repo was moved)
      if (existing.rootPath !== this.workspaceRoot) {
        const updateStmt = this.db.prepare(
          "UPDATE repositories SET root_path = ?, updated_at = ? WHERE id = ?",
        );
        updateStmt.run(this.workspaceRoot, now, existing.id);
        existing.rootPath = this.workspaceRoot;
        existing.updatedAt = now;
      }
      return existing;
    }

    // Insert new repository record
    const insertStmt = this.db.prepare(
      "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version, active_scan_id) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    );
    const res = insertStmt.run(
      identity,
      this.workspaceRoot,
      displayName,
      now,
      now,
      CURRENT_SCHEMA_VERSION,
    );

    return {
      id: Number(res.lastInsertRowid),
      identity,
      rootPath: this.workspaceRoot,
      displayName,
      createdAt: now,
      updatedAt: now,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      activeScanId: null,
    };
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
