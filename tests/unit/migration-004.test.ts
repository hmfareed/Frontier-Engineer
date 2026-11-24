/**
 * Phase 8.2 — Migration 004 & Multi-Generation Supersession Chain Tests
 * Verifies Option B multi-generation supersession, cycle detection,
 * cross-repository isolation, and replacement archival guards.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import {
  runMigrations,
  getCurrentSchemaVersion,
} from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";

describe("Phase 8.2 — Migration 004 & Multi-Generation Supersession", () => {
  let db: SqliteDatabase;
  let store: MemoryStore;
  let repoId1: number;
  let repoId2: number;

  beforeEach(() => {
    // Isolated in-memory database
    db = new SqliteDatabase({ path: ":memory:" });
    const { applied, currentVersion } = runMigrations(db.rawDb);
    expect(currentVersion).toBe(4);
    expect(applied).toBe(4);

    store = new MemoryStore(db);

    // Seed two repositories
    const res1 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_alpha', '/alpha', 'Alpha', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
      )
      .run();
    repoId1 = Number(res1.lastInsertRowid);

    const res2 = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_beta', '/beta', 'Beta', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
      )
      .run();
    repoId2 = Number(res2.lastInsertRowid);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
  });

  it("1. reports current schema version as 4 after migration", () => {
    expect(getCurrentSchemaVersion(db.rawDb)).toBe(4);
  });

  it("2. supports multi-generation supersession chain A -> B -> C -> D", () => {
    const memA = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "dec_gen_a",
      category: "architectural_decision",
      title: "Decision Gen A",
      content: "Monolith Architecture",
    });

    const memB = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "dec_gen_b",
      category: "architectural_decision",
      title: "Decision Gen B",
      content: "Microservices Architecture",
    });

    const memC = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "dec_gen_c",
      category: "architectural_decision",
      title: "Decision Gen C",
      content: "Modular Monolith Architecture",
    });

    const memD = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "dec_gen_d",
      category: "architectural_decision",
      title: "Decision Gen D",
      content: "Event-Driven System Architecture",
    });

    // Step 1: A superseded by B
    const supA = store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memA.id,
      targetStatus: "SUPERSEDED",
      supersededById: memB.id,
      changeReason: "Adopted microservices",
    });
    expect(supA.status).toBe("SUPERSEDED");
    expect(supA.supersededById).toBe(memB.id);

    // Step 2: B superseded by C (Option B: B was replacement for A, now superseded by C)
    const supB = store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memB.id,
      targetStatus: "SUPERSEDED",
      supersededById: memC.id,
      changeReason: "Adopted modular monolith",
    });
    expect(supB.status).toBe("SUPERSEDED");
    expect(supB.supersededById).toBe(memC.id);

    // Step 3: C superseded by D
    const supC = store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memC.id,
      targetStatus: "SUPERSEDED",
      supersededById: memD.id,
      changeReason: "Adopted event-driven architecture",
    });
    expect(supC.status).toBe("SUPERSEDED");
    expect(supC.supersededById).toBe(memD.id);

    // Verify all direct successor pointers are preserved
    const checkA = store.getMemory(repoId1, memA.id)!;
    const checkB = store.getMemory(repoId1, memB.id)!;
    const checkC = store.getMemory(repoId1, memC.id)!;
    const checkD = store.getMemory(repoId1, memD.id)!;

    expect(checkA.supersededById).toBe(memB.id);
    expect(checkB.supersededById).toBe(memC.id);
    expect(checkC.supersededById).toBe(memD.id);
    expect(checkD.supersededById).toBeNull();
    expect(checkD.status).toBe("ACTIVE");

    // Verify SUPERSEDES relationships recorded in memory_relationships
    const relsB = store.getRelationships(repoId1, memB.id);
    expect(
      relsB.some(
        (r) =>
          r.sourceMemoryId === memB.id &&
          r.targetMemoryId === memA.id &&
          r.relationshipType === "SUPERSEDES",
      ),
    ).toBe(true);

    const relsC = store.getRelationships(repoId1, memC.id);
    expect(
      relsC.some(
        (r) =>
          r.sourceMemoryId === memC.id &&
          r.targetMemoryId === memB.id &&
          r.relationshipType === "SUPERSEDES",
      ),
    ).toBe(true);
  });

  it("3. rejects supersession cycles (e.g. C -> A or C -> B when A -> B -> C)", () => {
    const memA = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "cycle_a",
      category: "architectural_decision",
      title: "Cycle A",
      content: "A",
    });
    const memB = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "cycle_b",
      category: "architectural_decision",
      title: "Cycle B",
      content: "B",
    });
    const memC = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "cycle_c",
      category: "architectural_decision",
      title: "Cycle C",
      content: "C",
    });

    store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memA.id,
      targetStatus: "SUPERSEDED",
      supersededById: memB.id,
      changeReason: "A -> B",
    });

    store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memB.id,
      targetStatus: "SUPERSEDED",
      supersededById: memC.id,
      changeReason: "B -> C",
    });

    // Attempting cycle C -> A
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId1,
        memoryId: memC.id,
        targetStatus: "SUPERSEDED",
        supersededById: memA.id,
        changeReason: "Cycle attempt C -> A",
      });
    }).toThrow(/Illegal supersession/);

    // Attempting cycle C -> B
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId1,
        memoryId: memC.id,
        targetStatus: "SUPERSEDED",
        supersededById: memB.id,
        changeReason: "Cycle attempt C -> B",
      });
    }).toThrow(/Illegal supersession/);

    // State of C must remain unchanged
    const checkC = store.getMemory(repoId1, memC.id)!;
    expect(checkC.status).toBe("ACTIVE");
    expect(checkC.supersededById).toBeNull();
  });

  it("4. rejects cross-repository supersession", () => {
    const memAlpha = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "cross_alpha",
      category: "architectural_decision",
      title: "Alpha Mem",
      content: "Alpha",
    });

    const memBeta = store.createMemory({
      repositoryId: repoId2,
      memoryKey: "cross_beta",
      category: "architectural_decision",
      title: "Beta Mem",
      content: "Beta",
    });

    // At store layer
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId1,
        memoryId: memAlpha.id,
        targetStatus: "SUPERSEDED",
        supersededById: memBeta.id,
        changeReason: "Cross repo attempt",
      });
    }).toThrow(/Replacement memory \d+ not found in repository/);

    // At SQLite trigger layer
    expect(() => {
      db.rawDb
        .prepare(
          "UPDATE engineering_memories SET status = 'SUPERSEDED', superseded_by_id = ? WHERE id = ?",
        )
        .run(memBeta.id, memAlpha.id);
    }).toThrow(/Illegal supersession: replacement memory must belong to the same repository/);
  });

  it("5. rejects direct archival of an active replacement", () => {
    const memA = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "arch_guard_a",
      category: "architectural_decision",
      title: "A",
      content: "A",
    });
    const memB = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "arch_guard_b",
      category: "architectural_decision",
      title: "B",
      content: "B",
    });

    store.transitionLifecycle({
      repositoryId: repoId1,
      memoryId: memA.id,
      targetStatus: "SUPERSEDED",
      supersededById: memB.id,
      changeReason: "A -> B",
    });

    // Attempting to archive B directly without a replacement
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId1,
        memoryId: memB.id,
        targetStatus: "ARCHIVED",
        changeReason: "Archive replacement B",
      });
    }).toThrow(
      /cannot transition memory \d+ to ARCHIVED because it is currently an active replacement/,
    );

    const checkB = store.getMemory(repoId1, memB.id)!;
    expect(checkB.status).toBe("ACTIVE");
  });

  it("6. rolls back transaction on constraint failure", () => {
    const memA = store.createMemory({
      repositoryId: repoId1,
      memoryKey: "rollback_mem_a",
      category: "architectural_decision",
      title: "A",
      content: "A",
    });

    expect(() => {
      store.transitionLifecycle(
        {
          repositoryId: repoId1,
          memoryId: memA.id,
          targetStatus: "ARCHIVED",
          changeReason: "Simulate failure",
        },
        true, // simulate failure mid-transaction
      );
    }).toThrow(/Simulated mid-transaction failure/);

    const checkA = store.getMemory(repoId1, memA.id)!;
    expect(checkA.status).toBe("ACTIVE");
    expect(checkA.version).toBe(1);
    expect(store.getMemoryVersions(memA.id)).toHaveLength(0);
  });
});
