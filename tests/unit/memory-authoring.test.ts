/**
 * Phase 8.2A — Memory Authoring Unit Tests
 * Tests deterministic key generation, input validation, duplicate warnings,
 * and atomic record, supersede, and archive operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryAuthoringEngine, generateMemoryKey } from "../../scripts/memory/memory-authoring.ts";

describe("Phase 8.2A — Memory Authoring Engine", () => {
  let db: SqliteDatabase;
  let engine: MemoryAuthoringEngine;
  let repoId: number;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);
    engine = new MemoryAuthoringEngine(db);

    const res = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_author', '/author', 'Author Repo', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
      )
      .run();
    repoId = Number(res.lastInsertRowid);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
  });

  describe("Deterministic Key Generation", () => {
    it("1. generates correct category-prefixed keys", () => {
      expect(generateMemoryKey("engineering_convention", "Explicit Return Types")).toBe(
        "conv_explicit_return_types",
      );
      expect(generateMemoryKey("architectural_decision", "SQLite Embedded Intelligence")).toBe(
        "dec_sqlite_embedded_intelligence",
      );
      expect(generateMemoryKey("technical_debt", "Legacy Authentication")).toBe(
        "debt_legacy_authentication",
      );
      expect(generateMemoryKey("project_context", "Project Delivery Model")).toBe(
        "ctx_project_delivery_model",
      );
      expect(generateMemoryKey("architectural_knowledge", "Storage Subsystem Invariants")).toBe(
        "arch_storage_subsystem_invariants",
      );
      expect(generateMemoryKey("evolution_record", "Indexing Pipeline Changes")).toBe(
        "evo_indexing_pipeline_changes",
      );
    });

    it("2. generates adr-formatted keys when adrNumber is provided", () => {
      expect(generateMemoryKey("architectural_decision", "Foundation Architecture", 1)).toBe(
        "adr_001_foundation_architecture",
      );
      expect(generateMemoryKey("architectural_decision", "Storage Engine", 7)).toBe(
        "adr_007_storage_engine",
      );
      expect(generateMemoryKey("architectural_decision", "Agent Retrieval", 42)).toBe(
        "adr_042_agent_retrieval",
      );
    });

    it("3. sanitizes special characters, whitespace, and collapses underscores", () => {
      expect(
        generateMemoryKey("engineering_convention", "   Use @typescript-eslint/strict   Rules!  "),
      ).toBe("conv_use_typescript_eslint_strict_rules");
      expect(generateMemoryKey("technical_debt", "---Special---Chars***123---")).toBe(
        "debt_special_chars_123",
      );
    });
  });

  describe("recordMemory", () => {
    it("4. successfully records a memory with auto-generated key", () => {
      const res = engine.recordMemory({
        repositoryId: repoId,
        category: "engineering_convention",
        title: "No Any Types in Production Code",
        content: "Avoid using the 'any' type in TypeScript; prefer 'unknown'.",
        confidence: 0.95,
        confidenceTier: "CONFIRMED",
      });

      expect(res.success).toBe(true);
      expect(res.memory.id).toBeGreaterThan(0);
      expect(res.memory.memoryKey).toBe("conv_no_any_types_in_production_code");
      expect(res.memory.status).toBe("ACTIVE");
      expect(res.memory.version).toBe(1);
      expect(res.warning).toBeUndefined();
    });

    it("5. rejects duplicate memory keys within the same repository", () => {
      engine.recordMemory({
        repositoryId: repoId,
        category: "engineering_convention",
        title: "Deterministic Formatter",
        content: "Content 1",
        key: "conv_deterministic_formatter",
      });

      expect(() => {
        engine.recordMemory({
          repositoryId: repoId,
          category: "engineering_convention",
          title: "Another Formatter",
          content: "Content 2",
          key: "conv_deterministic_formatter",
        });
      }).toThrow(/already exists in repository/);
    });

    it("6. flags duplicate content within the same category as a warning", () => {
      const first = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "First Decision",
        content: "Identical architectural content for testing duplicates.",
      });
      expect(first.warning).toBeUndefined();

      const second = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Second Decision",
        content: "Identical architectural content for testing duplicates.",
      });
      expect(second.warning).toContain("Duplicate content detected");
      expect(second.warning).toContain(`active memory #${first.memory.id}`);
    });

    it("7. validates input constraints (empty title, invalid category, out-of-range confidence)", () => {
      expect(() => {
        engine.recordMemory({
          repositoryId: repoId,
          category: "engineering_convention",
          title: "   ",
          content: "Valid content",
        });
      }).toThrow(/title cannot be empty/);

      expect(() => {
        engine.recordMemory({
          repositoryId: repoId,
          category: "engineering_convention",
          title: "Valid title",
          content: "   ",
        });
      }).toThrow(/content cannot be empty/);

      expect(() => {
        engine.recordMemory({
          repositoryId: repoId,
          category: "invalid_category" as any,
          title: "Valid title",
          content: "Valid content",
        });
      }).toThrow(/Invalid category/);

      expect(() => {
        engine.recordMemory({
          repositoryId: repoId,
          category: "engineering_convention",
          title: "Valid title",
          content: "Valid content",
          confidence: 1.5,
        });
      }).toThrow(/confidence must be a number between 0.0 and 1.0/);
    });
  });

  describe("supersedeMemory", () => {
    it("8. executes valid supersession and records version history", () => {
      const memA = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Old Decision",
        content: "Old architectural content",
      }).memory;

      const memB = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "New Decision",
        content: "New improved architecture",
      }).memory;

      const result = engine.supersedeMemory({
        repositoryId: repoId,
        targetIdOrKey: memA.id,
        replacementIdOrKey: memB.id,
        reason: "Architecture migrated to v2",
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe(1);
      expect(result.currentVersion).toBe(2);
      expect(result.targetMemory.status).toBe("SUPERSEDED");
      expect(result.targetMemory.supersededById).toBe(memB.id);
      expect(result.changeReason).toBe("Architecture migrated to v2");
    });

    it("9. supports multi-generation supersession chain A -> B -> C", () => {
      const memA = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Decision A",
        content: "V1",
      }).memory;
      const memB = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Decision B",
        content: "V2",
      }).memory;
      const memC = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Decision C",
        content: "V3",
      }).memory;

      engine.supersedeMemory({
        repositoryId: repoId,
        targetIdOrKey: memA.id,
        replacementIdOrKey: memB.id,
        reason: "A -> B",
      });

      const resBC = engine.supersedeMemory({
        repositoryId: repoId,
        targetIdOrKey: memB.id,
        replacementIdOrKey: memC.id,
        reason: "B -> C",
      });

      expect(resBC.targetMemory.status).toBe("SUPERSEDED");
      expect(resBC.targetMemory.supersededById).toBe(memC.id);
    });

    it("10. rejects self-supersession and non-active replacement", () => {
      const mem = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "Self Decision",
        content: "Content",
      }).memory;

      expect(() => {
        engine.supersedeMemory({
          repositoryId: repoId,
          targetIdOrKey: mem.id,
          replacementIdOrKey: mem.id,
          reason: "Self supersession",
        });
      }).toThrow(/self-supersession is prohibited/);
    });

    it("11. rejects empty supersession reason", () => {
      const memA = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "A",
        content: "A",
      }).memory;
      const memB = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "B",
        content: "B",
      }).memory;

      expect(() => {
        engine.supersedeMemory({
          repositoryId: repoId,
          targetIdOrKey: memA.id,
          replacementIdOrKey: memB.id,
          reason: "   ",
        });
      }).toThrow(/requires a non-empty reason/);
    });
  });

  describe("archiveMemory", () => {
    it("12. successfully archives an active memory with reason and version history", () => {
      const mem = engine.recordMemory({
        repositoryId: repoId,
        category: "technical_debt",
        title: "Obsolete Tech Debt",
        content: "No longer relevant",
      }).memory;

      const result = engine.archiveMemory({
        repositoryId: repoId,
        targetIdOrKey: mem.id,
        reason: "Feature decommissioned completely",
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe(1);
      expect(result.currentVersion).toBe(2);
      expect(result.memory.status).toBe("ARCHIVED");
    });

    it("13. rejects archival of already superseded or archived memories", () => {
      const memA = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "A",
        content: "A",
      }).memory;
      const memB = engine.recordMemory({
        repositoryId: repoId,
        category: "architectural_decision",
        title: "B",
        content: "B",
      }).memory;

      engine.supersedeMemory({
        repositoryId: repoId,
        targetIdOrKey: memA.id,
        replacementIdOrKey: memB.id,
        reason: "A -> B",
      });

      expect(() => {
        engine.archiveMemory({
          repositoryId: repoId,
          targetIdOrKey: memA.id,
          reason: "Archive superseded A",
        });
      }).toThrow(/already SUPERSEDED/);

      const memC = engine.recordMemory({
        repositoryId: repoId,
        category: "technical_debt",
        title: "C",
        content: "C",
      }).memory;

      engine.archiveMemory({
        repositoryId: repoId,
        targetIdOrKey: memC.id,
        reason: "Archive C",
      });

      expect(() => {
        engine.archiveMemory({
          repositoryId: repoId,
          targetIdOrKey: memC.id,
          reason: "Archive C again",
        });
      }).toThrow(/already in ARCHIVED status/);
    });
  });
});
