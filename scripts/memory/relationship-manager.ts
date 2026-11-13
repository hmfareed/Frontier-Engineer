/**
 * Phase 7.5 Stage 4 — Memory Relationship Manager
 * Thin policy and query coordinator over MemoryStore relationship guarantees.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import type {
  CreateMemoryRelationshipInput,
  EngineeringMemoryRecord,
  MemoryRelationshipRecord,
} from "../storage/types.ts";

export class RelationshipManager {
  private store: MemoryStore;

  constructor(db: SqliteDatabase) {
    this.store = new MemoryStore(db);
  }

  public linkMemories(input: CreateMemoryRelationshipInput): MemoryRelationshipRecord {
    return this.store.createRelationship(input);
  }

  public getRelationships(repositoryId: number, memoryId?: number): MemoryRelationshipRecord[] {
    return this.store.getRelationships(repositoryId, memoryId);
  }

  /**
   * DEFECT-REL-02: Only an ACTIVE (and, when supplied, positively verified) memory
   * may automatically supersede another memory.
   */
  public canSupersede(
    candidate: EngineeringMemoryRecord | null | undefined,
    targetMemoryId: number,
    positivelyVerifiedIds?: Set<number>,
  ): boolean {
    if (!candidate || candidate.id === targetMemoryId) {
      return false;
    }
    if (candidate.status !== "ACTIVE") {
      return false;
    }
    if (positivelyVerifiedIds !== undefined && !positivelyVerifiedIds.has(candidate.id)) {
      return false;
    }
    return true;
  }

  /**
   * Finds an ACTIVE (and optionally positively verified) incoming SUPERSEDES replacement for a target memory.
   */
  public findSupersedingReplacementId(
    repositoryId: number,
    targetMemoryId: number,
    positivelyVerifiedIds?: Set<number>,
  ): number | null {
    const rels = this.store.getRelationships(repositoryId, targetMemoryId);
    for (const rel of rels) {
      if (rel.targetMemoryId === targetMemoryId && rel.relationshipType === "SUPERSEDES") {
        const candidate = this.store.getMemory(repositoryId, rel.sourceMemoryId);
        if (this.canSupersede(candidate, targetMemoryId, positivelyVerifiedIds)) {
          return candidate!.id;
        }
      }
    }
    return null;
  }
}
