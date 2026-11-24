/**
 * Phase 8.2A — Active Engineering Memory Authoring
 * Encapsulates deterministic key generation, input validation, content deduplication,
 * provenance attachment, and atomic authoring operations (record, supersede, archive).
 */

import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import type {
  EngineeringMemoryRecord,
  MemoryCategory,
  MemoryConfidenceTier,
  MemoryEvidenceType,
  MemoryEvidenceRecord,
} from "../storage/types.ts";

export const VALID_CATEGORIES: MemoryCategory[] = [
  "architectural_knowledge",
  "engineering_convention",
  "architectural_decision",
  "technical_debt",
  "project_context",
  "evolution_record",
];

export const VALID_CONFIDENCE_TIERS: MemoryConfidenceTier[] = [
  "CONFIRMED",
  "INFERRED",
  "CANDIDATE",
  "UNRESOLVED",
];

export const CATEGORY_PREFIX_MAP: Record<MemoryCategory, string> = {
  engineering_convention: "conv_",
  architectural_decision: "dec_",
  technical_debt: "debt_",
  project_context: "ctx_",
  architectural_knowledge: "arch_",
  evolution_record: "evo_",
};

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Generates a deterministic category-prefixed key from a title.
 * Lowercase alphanumeric characters separated by underscores.
 */
export function generateMemoryKey(
  category: MemoryCategory,
  title: string,
  adrNumber?: number,
): string {
  if (adrNumber !== undefined && Number.isInteger(adrNumber) && adrNumber > 0) {
    const slug = slugify(title);
    return `adr_${String(adrNumber).padStart(3, "0")}_${slug}`;
  }

  const prefix = CATEGORY_PREFIX_MAP[category] ?? "mem_";
  const slug = slugify(title);
  return `${prefix}${slug}`;
}

export function slugify(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/, "");
  return normalized.length > 0 ? normalized : "entry";
}

export interface RecordMemoryInput {
  repositoryId: number;
  category: MemoryCategory;
  title: string;
  content: string;
  key?: string;
  confidence?: number;
  confidenceTier?: MemoryConfidenceTier;
  scanId?: number | null;
  evidence?: Array<{
    evidenceType: MemoryEvidenceType;
    sourcePath: string;
    lineStart?: number | null;
    lineEnd?: number | null;
    sourceHash?: string | null;
    symbolIdentity?: string | null;
    graphNodeId?: number | null;
    graphEdgeId?: number | null;
    description: string;
    confidence?: number;
    isContradictory?: boolean;
  }>;
}

export interface RecordMemoryResult {
  success: boolean;
  memory: EngineeringMemoryRecord;
  warning?: string;
  evidenceCount: number;
}

export interface SupersedeMemoryInput {
  repositoryId: number;
  targetIdOrKey: string | number;
  replacementIdOrKey: string | number;
  reason: string;
  sourceScanId?: number | null;
}

export interface SupersedeMemoryResult {
  success: boolean;
  targetMemory: EngineeringMemoryRecord;
  replacementMemory: EngineeringMemoryRecord;
  previousVersion: number;
  currentVersion: number;
  supersededById: number;
  changeReason: string;
}

export interface ArchiveMemoryInput {
  repositoryId: number;
  targetIdOrKey: string | number;
  reason: string;
  sourceScanId?: number | null;
}

export interface ArchiveMemoryResult {
  success: boolean;
  memory: EngineeringMemoryRecord;
  previousVersion: number;
  currentVersion: number;
  changeReason: string;
}

export class MemoryAuthoringEngine {
  private db: SqliteDatabase;
  private store: MemoryStore;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.store = new MemoryStore(db);
  }

  /**
   * Records a new active engineering memory with validation, duplicate detection,
   * key generation, and optional evidence attachments.
   */
  public recordMemory(input: RecordMemoryInput): RecordMemoryResult {
    // 1. Validation
    if (!input.repositoryId || typeof input.repositoryId !== "number" || input.repositoryId <= 0) {
      throw new Error(`Invalid repositoryId: ${input.repositoryId}`);
    }
    if (!input.title || input.title.trim().length === 0) {
      throw new Error("Memory title cannot be empty or whitespace");
    }
    if (!input.content || input.content.trim().length === 0) {
      throw new Error("Memory content cannot be empty or whitespace");
    }
    if (!VALID_CATEGORIES.includes(input.category)) {
      throw new Error(
        `Invalid category '${input.category}'. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      );
    }
    if (input.confidenceTier && !VALID_CONFIDENCE_TIERS.includes(input.confidenceTier)) {
      throw new Error(
        `Invalid confidence tier '${input.confidenceTier}'. Must be one of: ${VALID_CONFIDENCE_TIERS.join(", ")}`,
      );
    }
    if (
      input.confidence !== undefined &&
      (typeof input.confidence !== "number" || input.confidence < 0.0 || input.confidence > 1.0)
    ) {
      throw new Error("Memory confidence must be a number between 0.0 and 1.0");
    }

    const title = input.title.trim();
    const content = input.content.trim();
    const memoryKey =
      input.key && input.key.trim().length > 0
        ? input.key
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_")
        : generateMemoryKey(input.category, title);

    // 2. Uniqueness check for key
    const existingKey = this.store.getMemoryByKey(input.repositoryId, memoryKey);
    if (existingKey) {
      throw new Error(
        `A memory with key '${memoryKey}' already exists in repository ${input.repositoryId} (#${existingKey.id}: ${existingKey.title})`,
      );
    }

    // 3. Content deduplication warning
    let warning: string | undefined;
    const contentHash = sha256(content);
    const existingSameCategory = this.store.listMemories(input.repositoryId, {
      category: input.category,
      status: "ACTIVE",
    });
    const duplicate = existingSameCategory.find((m) => sha256(m.content) === contentHash);
    if (duplicate) {
      warning = `Duplicate content detected: identical to existing active memory #${duplicate.id} ('${duplicate.memoryKey}': "${duplicate.title}")`;
    }

    // 4. Atomic insertion of memory and evidence
    const memory = this.db.transaction(() => {
      const created = this.store.createMemory({
        repositoryId: input.repositoryId,
        memoryKey,
        category: input.category,
        title,
        content,
        confidence: input.confidence ?? 1.0,
        confidenceTier: input.confidenceTier ?? "CONFIRMED",
        firstSeenScanId: input.scanId ?? null,
        lastSeenScanId: input.scanId ?? null,
      });

      if (input.evidence && input.evidence.length > 0 && input.scanId) {
        for (const ev of input.evidence) {
          this.store.addEvidence({
            repositoryId: input.repositoryId,
            memoryId: created.id,
            scanId: input.scanId,
            evidenceType: ev.evidenceType,
            sourcePath: ev.sourcePath,
            lineStart: ev.lineStart ?? null,
            lineEnd: ev.lineEnd ?? null,
            sourceHash: ev.sourceHash ?? null,
            symbolIdentity: ev.symbolIdentity ?? null,
            graphNodeId: ev.graphNodeId ?? null,
            graphEdgeId: ev.graphEdgeId ?? null,
            description: ev.description,
            confidence: ev.confidence ?? 1.0,
            isContradictory: ev.isContradictory ?? false,
          });
        }
      }

      return created;
    });

    const attachedEvidence = this.store.getMemoryEvidence(input.repositoryId, memory.id);

    return {
      success: true,
      memory,
      warning,
      evidenceCount: attachedEvidence.length,
    };
  }

  /**
   * Supersedes an existing memory with an active replacement, recording version history
   * and establishing the direct SUPERSEDES relationship atomically.
   */
  public supersedeMemory(input: SupersedeMemoryInput): SupersedeMemoryResult {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error("Superseding an engineering memory requires a non-empty reason");
    }

    const target = this.resolveMemory(input.repositoryId, input.targetIdOrKey);
    if (!target) {
      throw new Error(
        `Target memory '${input.targetIdOrKey}' not found in repository ${input.repositoryId}`,
      );
    }

    const replacement = this.resolveMemory(input.repositoryId, input.replacementIdOrKey);
    if (!replacement) {
      throw new Error(
        `Replacement memory '${input.replacementIdOrKey}' not found in repository ${input.repositoryId}`,
      );
    }

    if (target.id === replacement.id) {
      throw new Error("Illegal supersession: self-supersession is prohibited");
    }

    if (replacement.status !== "ACTIVE") {
      throw new Error(
        `Illegal supersession: replacement memory #${replacement.id} must be in ACTIVE status (current: ${replacement.status})`,
      );
    }

    const previousVersion = target.version;
    const reason = input.reason.trim();

    const updatedTarget = this.store.transitionLifecycle({
      repositoryId: input.repositoryId,
      memoryId: target.id,
      targetStatus: "SUPERSEDED",
      supersededById: replacement.id,
      changeReason: reason,
      sourceScanId: input.sourceScanId ?? null,
    });

    return {
      success: true,
      targetMemory: updatedTarget,
      replacementMemory: replacement,
      previousVersion,
      currentVersion: updatedTarget.version,
      supersededById: replacement.id,
      changeReason: reason,
    };
  }

  /**
   * Archives an existing memory with a recorded reason, preserving version history.
   */
  public archiveMemory(input: ArchiveMemoryInput): ArchiveMemoryResult {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error("Archiving an engineering memory requires a non-empty reason");
    }

    const target = this.resolveMemory(input.repositoryId, input.targetIdOrKey);
    if (!target) {
      throw new Error(
        `Memory '${input.targetIdOrKey}' not found in repository ${input.repositoryId}`,
      );
    }

    if (target.status === "ARCHIVED") {
      throw new Error(`Memory #${target.id} is already in ARCHIVED status`);
    }

    if (target.status === "SUPERSEDED") {
      throw new Error(
        `Cannot archive memory #${target.id}: memory is already SUPERSEDED by #${target.supersededById}`,
      );
    }

    const previousVersion = target.version;
    const reason = input.reason.trim();

    const updated = this.store.transitionLifecycle({
      repositoryId: input.repositoryId,
      memoryId: target.id,
      targetStatus: "ARCHIVED",
      changeReason: reason,
      sourceScanId: input.sourceScanId ?? null,
    });

    return {
      success: true,
      memory: updated,
      previousVersion,
      currentVersion: updated.version,
      changeReason: reason,
    };
  }

  private resolveMemory(
    repositoryId: number,
    idOrKey: string | number,
  ): EngineeringMemoryRecord | null {
    if (typeof idOrKey === "number" || /^\d+$/.test(String(idOrKey).trim())) {
      const id = typeof idOrKey === "number" ? idOrKey : parseInt(String(idOrKey).trim(), 10);
      return this.store.getMemory(repositoryId, id);
    }
    return this.store.getMemoryByKey(repositoryId, String(idOrKey).trim());
  }
}
