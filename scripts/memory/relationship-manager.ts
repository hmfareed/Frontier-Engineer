/**
 * Phase 7.5 Stage 4 — Memory Relationship Manager
 * Thin policy and query coordinator over MemoryStore relationship guarantees.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import type { CreateMemoryRelationshipInput, MemoryRelationshipRecord } from "../storage/types.ts";

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
   * Finds an active incoming SUPERSEDES replacement for a target memory, if any.
   */
  public findSupersedingReplacementId(repositoryId: number, targetMemoryId: number): number | null {
    const rels = this.store.getRelationships(repositoryId, targetMemoryId);
    for (const rel of rels) {
      if (rel.targetMemoryId === targetMemoryId && rel.relationshipType === "SUPERSEDES") {
        const candidate = this.store.getMemory(repositoryId, rel.sourceMemoryId);
        if (candidate && candidate.status !== "SUPERSEDED" && candidate.status !== "ARCHIVED") {
          return candidate.id;
        }
      }
    }
    return null;
  }
}
