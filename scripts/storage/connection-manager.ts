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
  projectSignature?: string;
}

export interface ConnectionManagerOptions {
  workspaceRoot: string;
  inMemory?: boolean; // For isolated unit testing
  overrideIdentity?: string;
  overrideDisplayName?: string;
  allowSharedIdentity?: boolean;
  allowProjectReplacement?: boolean;
}

export class RepositoryIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryIdentityConflictError";
  }
}

export function computeProjectSignature(workspaceRoot: string): string | null {
  try {
    const pkgPath = path.join(workspaceRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === "string" && parsed.name.trim().length > 0) {
        return `pkg:${parsed.name.trim()}`;
      }
      return "pkg:unnamed";
    }
    const manifests = ["Cargo.toml", "pyproject.toml", "go.mod", "pom.xml"];
    for (const m of manifests) {
      if (fs.existsSync(path.join(workspaceRoot, m))) {
        return `manifest:${m}`;
      }
    }
    if (fs.existsSync(workspaceRoot)) {
      const entries = fs
        .readdirSync(workspaceRoot, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      if (entries.length > 0) {
        return `dir:${crypto.createHash("sha256").update(entries.join(",")).digest("hex").slice(0, 12)}`;
      }
    }
  } catch {
    // Ignore errors reading manifests
  }
  return null;
}

export class ConnectionManager {
  private readonly workspaceRoot: string;
  private readonly inMemory: boolean;
  private readonly dbPath: string;
  private readonly metadataPath: string;
  private readonly options: ConnectionManagerOptions;
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

    this.options = options;
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
    options: {
      overrideIdentity?: string;
      overrideDisplayName?: string;
      allowSharedIdentity?: boolean;
      allowProjectReplacement?: boolean;
    } = {},
  ): Promise<void> {
    if (this.db && this.db.isOpen()) {
      return;
    }

    const mergedOptions = { ...this.options, ...options };

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
    this.repositoryRecord = this.resolveAndSyncRepository(mergedOptions);
  }

  private verifyFilesystemBoundaries(): void {
    if (this.inMemory) return;

    const realWs = fs.realpathSync(this.workspaceRoot);

    const dotFrontier = path.join(this.workspaceRoot, ".frontier");
    const intelligenceDir = path.join(dotFrontier, "intelligence");
    const walPath = `${this.dbPath}-wal`;
    const shmPath = `${this.dbPath}-shm`;
    const targets = [
      dotFrontier,
      intelligenceDir,
      this.dbPath,
      this.metadataPath,
      walPath,
      shmPath,
    ];

    for (const targetPath of targets) {
      if (fs.existsSync(targetPath)) {
        const lstat = fs.lstatSync(targetPath);
        if (lstat.isSymbolicLink()) {
          // Explicit security rule: SQLite sidecars WAL and SHM cannot be symlinks
          if (targetPath === walPath || targetPath === shmPath) {
            throw new Error(
              `Filesystem boundary violation: SQLite sidecar '${targetPath}' cannot be a symlink.`,
            );
          }
        }

        const realTarget = fs.realpathSync(targetPath);
        const rel = path.relative(realWs, realTarget);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new Error(
            `Filesystem boundary violation: path '${targetPath}' resolves outside workspace root to '${realTarget}'.`,
          );
        }
      } else {
        // Target does not exist yet (e.g. initial run before db/wal/shm are created).
        // Verify that the nearest existing parent directory resolves strictly within workspace root.
        let parent = path.dirname(targetPath);
        while (parent && !fs.existsSync(parent) && parent !== path.dirname(parent)) {
          parent = path.dirname(parent);
        }
        if (fs.existsSync(parent)) {
          const realParent = fs.realpathSync(parent);
          const rel = path.relative(realWs, realParent);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(
              `Filesystem boundary violation: parent directory '${parent}' of '${targetPath}' resolves outside workspace root to '${realParent}'.`,
            );
          }
        }
      }
    }
  }

  private resolveAndSyncRepository(options: {
    overrideIdentity?: string;
    overrideDisplayName?: string;
    allowSharedIdentity?: boolean;
    allowProjectReplacement?: boolean;
  }): RepositoryRecord {
    if (!this.db) {
      throw new Error("Database not available.");
    }

    const now = new Date().toISOString();
    let identity = options.overrideIdentity;
    let displayName = options.overrideDisplayName || path.basename(this.workspaceRoot);
    const currentSignature = computeProjectSignature(this.workspaceRoot);

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

            // Scenario D: Unrelated workspace replacement detection
            if (
              parsed.projectSignature &&
              currentSignature &&
              parsed.projectSignature !== currentSignature &&
              !options.allowProjectReplacement &&
              !options.overrideIdentity
            ) {
              throw new RepositoryIdentityConflictError(
                `Repository identity conflict: Workspace contents at '${this.workspaceRoot}' belong to project '${currentSignature}', but existing .frontier metadata belongs to '${parsed.projectSignature}'. Reinitialization or override required to prevent cross-project contamination.`,
              );
            }

            // Check if workspace was moved vs copied (Scenarios A, C, E)
            if (parsed.rootPath !== this.workspaceRoot && !options.overrideIdentity) {
              const originalPathExists = fs.existsSync(parsed.rootPath);
              let isOriginalStillActive = false;

              if (originalPathExists) {
                const origMetaPath = path.join(
                  parsed.rootPath,
                  ".frontier",
                  "intelligence",
                  "metadata.json",
                );
                if (fs.existsSync(origMetaPath)) {
                  try {
                    const origMeta = JSON.parse(fs.readFileSync(origMetaPath, "utf8"));
                    if (origMeta && origMeta.repositoryIdentity === parsed.repositoryIdentity) {
                      isOriginalStillActive = true;
                    }
                  } catch {
                    // ignore read failure
                  }
                }
              }

              if (isOriginalStillActive && !options.allowSharedIdentity) {
                // Scenario C & E: Independent copy with active original workspace!
                // Generate a fresh distinct repository identity for the copy
                const copyHash = crypto.createHash("sha256");
                copyHash.update(this.workspaceRoot);
                copyHash.update(now);
                copyHash.update(crypto.randomUUID());
                identity = `repo_copy_${copyHash.digest("hex").slice(0, 16)}`;
              } else {
                // Scenario A: Verified legitimate relocation (original path no longer exists)
                identity = parsed.repositoryIdentity;
              }
            } else if (!identity) {
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
        } catch (err) {
          if (err instanceof RepositoryIdentityConflictError) {
            throw err;
          }
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
        projectSignature: currentSignature ?? this.metadata?.projectSignature,
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
