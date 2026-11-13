/**
 * Phase 7.5 — Engineering Memory Repository Store
 * Encapsulates persistent engineering memories, atomic lifecycle state transitions,
 * immutable historical version recording, and supersession integrity.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../database.ts";
import type {
  EngineeringMemoryRecord,
  MemoryVersionRecord,
  CreateMemoryInput,
  TransitionLifecycleInput,
  MemoryFilterOptions,
} from "../types.ts";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class MemoryStore {
  private db: DatabaseSync;

  constructor(db: SqliteDatabase | DatabaseSync) {
    if ("rawDb" in db && typeof (db as SqliteDatabase).rawDb === "object") {
      this.db = (db as SqliteDatabase).rawDb;
    } else {
      this.db = db as DatabaseSync;
    }
  }

  /**
   * Inserts a new engineering memory.
   * By invariant and database trigger, newly created memories must start in ACTIVE status
   * with version 1 and superseded_by_id = NULL.
   */
  public createMemory(params: CreateMemoryInput): EngineeringMemoryRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO engineering_memories (
        repository_id, memory_key, category, title, content,
        confidence, confidence_tier, status, version,
        first_seen_scan_id, last_seen_scan_id, created_at, updated_at, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?)`,
    );

    const res = stmt.run(
      params.repositoryId,
      params.memoryKey,
      params.category,
      params.title,
      params.content,
      params.confidence ?? 1.0,
      params.confidenceTier ?? "CONFIRMED",
      params.firstSeenScanId ?? null,
      params.lastSeenScanId ?? null,
      now,
      now,
      now,
    );

    const memoryId = Number(res.lastInsertRowid);
    const created = this.getMemory(params.repositoryId, memoryId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created memory ${memoryId}`);
    }
    return created;
  }

  /**
   * Retrieves an engineering memory by its repository and numeric id.
   */
  public getMemory(repositoryId: number, id: number): EngineeringMemoryRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, memory_key AS memoryKey,
          category, title, content, confidence, confidence_tier AS confidenceTier,
          status, first_seen_scan_id AS firstSeenScanId, last_seen_scan_id AS lastSeenScanId,
          superseded_by_id AS supersededById, version,
          created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt
        FROM engineering_memories
        WHERE repository_id = ? AND id = ?`,
      )
      .get(repositoryId, id) as EngineeringMemoryRecord | undefined;

    return row ?? null;
  }

  /**
   * Retrieves an engineering memory by its repository and unique memory key.
   */
  public getMemoryByKey(repositoryId: number, memoryKey: string): EngineeringMemoryRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, memory_key AS memoryKey,
          category, title, content, confidence, confidence_tier AS confidenceTier,
          status, first_seen_scan_id AS firstSeenScanId, last_seen_scan_id AS lastSeenScanId,
          superseded_by_id AS supersededById, version,
          created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt
        FROM engineering_memories
        WHERE repository_id = ? AND memory_key = ?`,
      )
      .get(repositoryId, memoryKey) as EngineeringMemoryRecord | undefined;

    return row ?? null;
  }

  /**
   * Lists engineering memories for a repository matching optional filters.
   */
  public listMemories(
    repositoryId: number,
    options: MemoryFilterOptions = {},
  ): EngineeringMemoryRecord[] {
    const conditions: string[] = ["repository_id = ?"];
    const params: (number | string)[] = [repositoryId];

    if (options.category) {
      conditions.push("category = ?");
      params.push(options.category);
    }
    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }
    if (options.confidenceTier) {
      conditions.push("confidence_tier = ?");
      params.push(options.confidenceTier);
    }

    const sql = `SELECT
      id, repository_id AS repositoryId, memory_key AS memoryKey,
      category, title, content, confidence, confidence_tier AS confidenceTier,
      status, first_seen_scan_id AS firstSeenScanId, last_seen_scan_id AS lastSeenScanId,
      superseded_by_id AS supersededById, version,
      created_at AS createdAt, updated_at AS updatedAt, last_verified_at AS lastVerifiedAt
    FROM engineering_memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC`;

    return this.db.prepare(sql).all(...params) as unknown as EngineeringMemoryRecord[];
  }

  /**
   * Retrieves the immutable historical version records for a memory.
   */
  public getMemoryVersions(memoryId: number): MemoryVersionRecord[] {
    return this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, memory_id AS memoryId,
          version, title, content, status,
          previous_content_hash AS previousContentHash, new_content_hash AS newContentHash,
          change_reason AS changeReason, source_scan_id AS sourceScanId, created_at AS createdAt
        FROM memory_versions
        WHERE memory_id = ?
        ORDER BY version ASC`,
      )
      .all(memoryId) as unknown as MemoryVersionRecord[];
  }

  /**
   * Transitions a memory's lifecycle state atomically inside an immediate transaction:
   * 1. Reads current state and checks for no-op.
   * 2. Validates requested state transition and supersession rules.
   * 3. Captures prior state as an immutable record in memory_versions.
   * 4. Updates parent memory with new status, version, and timestamps.
   * 5. Rolls back all changes if any step or database trigger fails.
   */
  public transitionLifecycle(
    params: TransitionLifecycleInput,
    simulateFailure = false,
  ): EngineeringMemoryRecord {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.getMemory(params.repositoryId, params.memoryId);
      if (!current) {
        throw new Error(
          `Engineering memory ${params.memoryId} not found in repository ${params.repositoryId}`,
        );
      }

      // No-op check: do not create duplicate history records for redundant requests
      const isNoOp =
        current.status === params.targetStatus &&
        (params.targetStatus !== "SUPERSEDED" ||
          current.supersededById === (params.supersededById ?? null)) &&
        (params.newTitle === undefined || params.newTitle === current.title) &&
        (params.newContent === undefined || params.newContent === current.content);

      if (isNoOp) {
        this.db.exec("COMMIT;");
        return current;
      }

      // Terminal status protection
      if (current.status === "SUPERSEDED") {
        throw new Error(
          "Illegal status transition: SUPERSEDED is a terminal state and cannot be reactivated or changed",
        );
      }
      if (current.status === "ARCHIVED") {
        throw new Error(
          "Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed",
        );
      }

      // Supersession validation
      if (params.targetStatus === "SUPERSEDED") {
        if (!params.supersededById) {
          throw new Error("A SUPERSEDED memory requires a non-null supersededById replacement");
        }
        if (params.supersededById === current.id) {
          throw new Error("Illegal supersession: self-supersession is prohibited");
        }
        const replacement = this.getMemory(params.repositoryId, params.supersededById);
        if (!replacement) {
          throw new Error(
            `Replacement memory ${params.supersededById} not found in repository ${params.repositoryId}`,
          );
        }
        if (replacement.status === "SUPERSEDED" || replacement.status === "ARCHIVED") {
          throw new Error(
            `Illegal supersession: replacement memory cannot be in ${replacement.status} status`,
          );
        }
      }

      // Replacement lifecycle protection: a memory referenced by SUPERSEDED memories cannot become SUPERSEDED or ARCHIVED
      if (params.targetStatus === "SUPERSEDED" || params.targetStatus === "ARCHIVED") {
        const row = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM engineering_memories
             WHERE repository_id = ? AND superseded_by_id = ? AND status = 'SUPERSEDED' AND id != ?`,
          )
          .get(params.repositoryId, current.id, current.id) as { count: number } | undefined;

        if (row && row.count > 0) {
          throw new Error(
            `Illegal status transition: cannot transition memory ${current.id} to ${params.targetStatus} because it is currently an active replacement for superseded memories`,
          );
        }
      }

      const now = new Date().toISOString();
      const prevHash = sha256(current.content);
      const newContent = params.newContent ?? current.content;
      const nextHash = sha256(newContent);

      const sourceScanId: number | null = params.sourceScanId ?? current.lastSeenScanId ?? null;

      // Record immutable historical version of the PRIOR state
      this.db
        .prepare(
          `INSERT INTO memory_versions (
            repository_id, memory_id, version, title, content, status,
            previous_content_hash, new_content_hash, change_reason, source_scan_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.repositoryId,
          current.id,
          current.version,
          current.title,
          current.content,
          current.status,
          prevHash,
          nextHash,
          params.changeReason,
          sourceScanId,
          now,
        );

      if (simulateFailure) {
        throw new Error("Simulated mid-transaction failure for rollback verification");
      }

      const nextVersion = current.version + 1;
      const newTitle = params.newTitle ?? current.title;
      const newConfidence = params.newConfidence ?? current.confidence;
      const newConfidenceTier = params.newConfidenceTier ?? current.confidenceTier;
      const supersededById: number | null =
        params.targetStatus === "SUPERSEDED" ? (params.supersededById ?? null) : null;

      this.db
        .prepare(
          `UPDATE engineering_memories SET
            status = ?,
            superseded_by_id = ?,
            version = ?,
            title = ?,
            content = ?,
            confidence = ?,
            confidence_tier = ?,
            updated_at = ?,
            last_verified_at = ?,
            last_seen_scan_id = COALESCE(?, last_seen_scan_id)
          WHERE repository_id = ? AND id = ?`,
        )
        .run(
          params.targetStatus,
          supersededById,
          nextVersion,
          newTitle,
          newContent,
          newConfidence,
          newConfidenceTier,
          now,
          now,
          sourceScanId,
          params.repositoryId,
          current.id,
        );

      this.db.exec("COMMIT;");

      const updated = this.getMemory(params.repositoryId, current.id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated memory ${current.id}`);
      }
      return updated;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Rollback suppressed if already aborted
      }
      throw err;
    }
  }
}
