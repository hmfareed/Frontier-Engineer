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
  MemoryEvidenceRecord,
  MemoryRelationshipRecord,
  CreateMemoryInput,
  CreateMemoryEvidenceInput,
  CreateMemoryRelationshipInput,
  TransitionLifecycleInput,
  MemoryFilterOptions,
} from "../types.ts";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class MemoryStore {
  private db: DatabaseSync;
  private sqliteDb?: SqliteDatabase;
  private savepointSeq = 0;

  constructor(db: SqliteDatabase | DatabaseSync) {
    if ("rawDb" in db && typeof (db as SqliteDatabase).rawDb === "object") {
      this.sqliteDb = db as SqliteDatabase;
      this.db = this.sqliteDb.rawDb;
    } else {
      this.db = db as DatabaseSync;
    }
  }

  private runAtomic<T>(fn: () => T): T {
    if (this.sqliteDb) {
      return this.sqliteDb.transaction(fn);
    }
    const spName = `sp_memory_store_${++this.savepointSeq}`;
    this.db.exec(`SAVEPOINT ${spName};`);
    try {
      const result = fn();
      this.db.exec(`RELEASE SAVEPOINT ${spName};`);
      return result;
    } catch (err) {
      try {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${spName};`);
        this.db.exec(`RELEASE SAVEPOINT ${spName};`);
      } catch {
        // Rollback suppressed if already aborted
      }
      throw err;
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
  public getMemoryVersions(memoryId: number): MemoryVersionRecord[];
  public getMemoryVersions(repositoryId: number, memoryId: number): MemoryVersionRecord[];
  public getMemoryVersions(idOrRepoId: number, maybeMemoryId?: number): MemoryVersionRecord[] {
    if (maybeMemoryId !== undefined) {
      return this.db
        .prepare(
          `SELECT
            id, repository_id AS repositoryId, memory_id AS memoryId,
            version, title, content, status,
            previous_content_hash AS previousContentHash, new_content_hash AS newContentHash,
            change_reason AS changeReason, source_scan_id AS sourceScanId, created_at AS createdAt
          FROM memory_versions
          WHERE repository_id = ? AND memory_id = ?
          ORDER BY version ASC`,
        )
        .all(idOrRepoId, maybeMemoryId) as unknown as MemoryVersionRecord[];
    }
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
      .all(idOrRepoId) as unknown as MemoryVersionRecord[];
  }

  /**
   * Transitions a memory's lifecycle state atomically inside an immediate transaction (or nested savepoint):
   * 1. Reads current state and checks for no-op.
   * 2. Validates requested state transition and supersession rules.
   * 3. Captures prior state as an immutable record in memory_versions.
   * 4. Updates parent memory with new status, version, and timestamps.
   * 5. Synchronizes SUPERSEDES relationship when transitioning to SUPERSEDED.
   * 6. Rolls back all changes if any step or database trigger fails.
   */
  public transitionLifecycle(
    params: TransitionLifecycleInput,
    simulateFailure = false,
  ): EngineeringMemoryRecord {
    return this.runAtomic(() => {
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

      // DEFECT-LC-02: Only positively verified ACTIVE transitions advance last_verified_at / last_seen_scan_id.
      const isVerifiedActive = params.targetStatus === "ACTIVE" ? 1 : 0;

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
            last_verified_at = CASE WHEN ? = 1 THEN ? ELSE last_verified_at END,
            last_seen_scan_id = CASE WHEN ? = 1 THEN COALESCE(?, last_seen_scan_id) ELSE last_seen_scan_id END
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
          isVerifiedActive,
          now,
          isVerifiedActive,
          sourceScanId,
          params.repositoryId,
          current.id,
        );

      if (params.targetStatus === "SUPERSEDED" && supersededById !== null) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO memory_relationships (
              repository_id, source_memory_id, target_memory_id, relationship_type, created_at
            ) VALUES (?, ?, ?, 'SUPERSEDES', ?)`,
          )
          .run(params.repositoryId, supersededById, current.id, now);
      }

      const updated = this.getMemory(params.repositoryId, current.id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated memory ${current.id}`);
      }
      return updated;
    });
  }

  /**
   * Advances last_seen_scan_id and last_verified_at for a verified non-terminal memory
   * without incrementing version or writing a redundant memory_versions record.
   */
  public recordScanVerification(
    repositoryId: number,
    memoryId: number,
    scanId: number,
    verifiedAt?: string,
  ): EngineeringMemoryRecord {
    return this.runAtomic(() => {
      const current = this.getMemory(repositoryId, memoryId);
      if (!current) {
        throw new Error(`Engineering memory ${memoryId} not found in repository ${repositoryId}`);
      }
      if (current.status === "SUPERSEDED" || current.status === "ARCHIVED") {
        throw new Error(
          `Cannot record scan verification on terminal memory ${memoryId} in status ${current.status}`,
        );
      }

      const timestamp = verifiedAt ?? new Date().toISOString();
      this.db
        .prepare(
          `UPDATE engineering_memories
           SET last_seen_scan_id = ?, last_verified_at = ?, updated_at = ?
           WHERE repository_id = ? AND id = ?`,
        )
        .run(scanId, timestamp, timestamp, repositoryId, memoryId);

      const updated = this.getMemory(repositoryId, memoryId);
      if (!updated) {
        throw new Error(`Failed to retrieve verified memory ${memoryId}`);
      }
      return updated;
    });
  }

  /**
   * Attaches supporting or contradictory evidence to an engineering memory.
   */
  public addEvidence(params: CreateMemoryEvidenceInput): MemoryEvidenceRecord {
    return this.runAtomic(() => {
      const memory = this.getMemory(params.repositoryId, params.memoryId);
      if (!memory) {
        throw new Error(
          `Engineering memory ${params.memoryId} not found in repository ${params.repositoryId}`,
        );
      }

      const now = new Date().toISOString();
      const isContradictoryInt = params.isContradictory ? 1 : 0;
      const res = this.db
        .prepare(
          `INSERT INTO memory_evidence (
            repository_id, memory_id, scan_id, evidence_type, source_path,
            line_start, line_end, source_hash, symbol_identity,
            graph_node_id, graph_edge_id, description, confidence,
            is_contradictory, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.repositoryId,
          params.memoryId,
          params.scanId,
          params.evidenceType,
          params.sourcePath,
          params.lineStart ?? null,
          params.lineEnd ?? null,
          params.sourceHash ?? null,
          params.symbolIdentity ?? null,
          params.graphNodeId ?? null,
          params.graphEdgeId ?? null,
          params.description,
          params.confidence ?? 1.0,
          isContradictoryInt,
          now,
        );

      const evidenceId = Number(res.lastInsertRowid);
      const row = this.db
        .prepare(
          `SELECT
            id, repository_id AS repositoryId, memory_id AS memoryId, scan_id AS scanId,
            evidence_type AS evidenceType, source_path AS sourcePath,
            line_start AS lineStart, line_end AS lineEnd, source_hash AS sourceHash,
            symbol_identity AS symbolIdentity, graph_node_id AS graphNodeId,
            graph_edge_id AS graphEdgeId, description, confidence,
            is_contradictory AS isContradictory, created_at AS createdAt
          FROM memory_evidence
          WHERE repository_id = ? AND id = ?`,
        )
        .get(params.repositoryId, evidenceId) as
        (Omit<MemoryEvidenceRecord, "isContradictory"> & { isContradictory: number }) | undefined;

      if (!row) {
        throw new Error(`Failed to retrieve newly created memory evidence ${evidenceId}`);
      }

      return {
        ...row,
        isContradictory: Boolean(row.isContradictory),
      };
    });
  }

  /**
   * Retrieves all evidence records attached to an engineering memory.
   */
  public getMemoryEvidence(repositoryId: number, memoryId: number): MemoryEvidenceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, memory_id AS memoryId, scan_id AS scanId,
          evidence_type AS evidenceType, source_path AS sourcePath,
          line_start AS lineStart, line_end AS lineEnd, source_hash AS sourceHash,
          symbol_identity AS symbolIdentity, graph_node_id AS graphNodeId,
          graph_edge_id AS graphEdgeId, description, confidence,
          is_contradictory AS isContradictory, created_at AS createdAt
        FROM memory_evidence
        WHERE repository_id = ? AND memory_id = ?
        ORDER BY id ASC`,
      )
      .all(repositoryId, memoryId) as unknown as (Omit<MemoryEvidenceRecord, "isContradictory"> & {
      isContradictory: number;
    })[];

    return rows.map((row) => ({
      ...row,
      isContradictory: Boolean(row.isContradictory),
    }));
  }

  /**
   * Creates a typed relationship between two engineering memories in the same repository.
   * Enforces same-repo membership, no self-loops, conflict guards, and acyclicity on
   * hierarchical edge types (SUPERSEDES, DEPENDS_ON, IMPLEMENTS).
   */
  public createRelationship(params: CreateMemoryRelationshipInput): MemoryRelationshipRecord {
    return this.runAtomic(() => {
      if (params.sourceMemoryId === params.targetMemoryId) {
        throw new Error("Self-referential memory relationship is prohibited");
      }

      const sourceMem = this.getMemory(params.repositoryId, params.sourceMemoryId);
      const targetMem = this.getMemory(params.repositoryId, params.targetMemoryId);
      if (!sourceMem || !targetMem) {
        throw new Error(
          `Cross-repository or non-existent memory in relationship (${params.sourceMemoryId} -> ${params.targetMemoryId})`,
        );
      }

      // Conflict guards between CONTRADICTS and IMPLEMENTS / DOCUMENTS
      if (params.relationshipType === "CONTRADICTS") {
        const conflict = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM memory_relationships
             WHERE repository_id = ?
               AND relationship_type IN ('IMPLEMENTS', 'DOCUMENTS')
               AND ((source_memory_id = ? AND target_memory_id = ?)
                    OR (source_memory_id = ? AND target_memory_id = ?))`,
          )
          .get(
            params.repositoryId,
            params.sourceMemoryId,
            params.targetMemoryId,
            params.targetMemoryId,
            params.sourceMemoryId,
          ) as { count: number };
        if (conflict.count > 0) {
          throw new Error(
            `Conflicting memory relationship between ${params.sourceMemoryId} and ${params.targetMemoryId}`,
          );
        }
      } else if (
        params.relationshipType === "IMPLEMENTS" ||
        params.relationshipType === "DOCUMENTS"
      ) {
        const conflict = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM memory_relationships
             WHERE repository_id = ?
               AND relationship_type = 'CONTRADICTS'
               AND ((source_memory_id = ? AND target_memory_id = ?)
                    OR (source_memory_id = ? AND target_memory_id = ?))`,
          )
          .get(
            params.repositoryId,
            params.sourceMemoryId,
            params.targetMemoryId,
            params.targetMemoryId,
            params.sourceMemoryId,
          ) as { count: number };
        if (conflict.count > 0) {
          throw new Error(
            `Conflicting memory relationship between ${params.sourceMemoryId} and ${params.targetMemoryId}`,
          );
        }
      }

      // Acyclicity check for directed hierarchy types
      if (
        params.relationshipType === "SUPERSEDES" ||
        params.relationshipType === "DEPENDS_ON" ||
        params.relationshipType === "IMPLEMENTS"
      ) {
        const MAX_DEPTH = 32;
        const visited = new Set<number>([params.targetMemoryId]);
        const queue: { id: number; depth: number }[] = [{ id: params.targetMemoryId, depth: 0 }];
        const nextStmt = this.db.prepare(
          `SELECT target_memory_id AS targetMemoryId
           FROM memory_relationships
           WHERE repository_id = ? AND source_memory_id = ? AND relationship_type = ?
           ORDER BY id ASC`,
        );

        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.id === params.sourceMemoryId) {
            throw new Error(
              `ERR_MEMORY_RELATIONSHIP_CYCLE: Cycle detected in ${params.relationshipType} relationship graph`,
            );
          }
          const nextRows = nextStmt.all(
            params.repositoryId,
            item.id,
            params.relationshipType,
          ) as unknown as { targetMemoryId: number }[];
          for (const nr of nextRows) {
            if (nr.targetMemoryId === params.sourceMemoryId) {
              throw new Error(
                `ERR_MEMORY_RELATIONSHIP_CYCLE: Cycle detected in ${params.relationshipType} relationship graph`,
              );
            }
            if (!visited.has(nr.targetMemoryId)) {
              if (item.depth + 1 > MAX_DEPTH) {
                throw new Error(
                  `ERR_MEMORY_RELATIONSHIP_DEPTH_EXCEEDED: Cycle check for ${params.relationshipType} relationship exceeded MAX_DEPTH=${MAX_DEPTH}; failing closed`,
                );
              }
              visited.add(nr.targetMemoryId);
              queue.push({ id: nr.targetMemoryId, depth: item.depth + 1 });
            }
          }
        }
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT OR IGNORE INTO memory_relationships (
            repository_id, source_memory_id, target_memory_id, relationship_type, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          params.repositoryId,
          params.sourceMemoryId,
          params.targetMemoryId,
          params.relationshipType,
          now,
        );

      const row = this.db
        .prepare(
          `SELECT
            id, repository_id AS repositoryId, source_memory_id AS sourceMemoryId,
            target_memory_id AS targetMemoryId, relationship_type AS relationshipType,
            created_at AS createdAt
          FROM memory_relationships
          WHERE repository_id = ? AND source_memory_id = ? AND target_memory_id = ? AND relationship_type = ?`,
        )
        .get(
          params.repositoryId,
          params.sourceMemoryId,
          params.targetMemoryId,
          params.relationshipType,
        ) as MemoryRelationshipRecord | undefined;

      if (!row) {
        throw new Error(
          `Failed to retrieve memory relationship (${params.sourceMemoryId} -> ${params.targetMemoryId})`,
        );
      }
      return row;
    });
  }

  /**
   * Lists relationships in a repository, optionally scoped to edges involving a specific memoryId.
   */
  public getRelationships(repositoryId: number, memoryId?: number): MemoryRelationshipRecord[] {
    if (memoryId !== undefined) {
      return this.db
        .prepare(
          `SELECT
            id, repository_id AS repositoryId, source_memory_id AS sourceMemoryId,
            target_memory_id AS targetMemoryId, relationship_type AS relationshipType,
            created_at AS createdAt
          FROM memory_relationships
          WHERE repository_id = ? AND (source_memory_id = ? OR target_memory_id = ?)
          ORDER BY id ASC`,
        )
        .all(repositoryId, memoryId, memoryId) as unknown as MemoryRelationshipRecord[];
    }

    return this.db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, source_memory_id AS sourceMemoryId,
          target_memory_id AS targetMemoryId, relationship_type AS relationshipType,
          created_at AS createdAt
        FROM memory_relationships
        WHERE repository_id = ?
        ORDER BY id ASC`,
      )
      .all(repositoryId) as unknown as MemoryRelationshipRecord[];
  }
}
