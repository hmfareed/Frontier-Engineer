/**
 * Phase 7.5 — Engineering Memory Store Unit Tests
 * Verifies MemoryStore persistence, atomic lifecycle transitions,
 * immutable historical version creation, rollback safety, and disk persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";

describe("memory-store (Atomic Lifecycle & Historical Consistency)", () => {
  let db: SqliteDatabase;
  let store: MemoryStore;
  let repoId: number;
  let scanId: number;
  const now = new Date().toISOString();

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    const r = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_store', '/repos/store', 'Store Repo', ?, ?, 3)",
      )
      .run(now, now);
    repoId = Number(r.lastInsertRowid);

    const s = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'COMPLETE', '0.6.3', '0.6.3')",
      )
      .run(repoId, now);
    scanId = Number(s.lastInsertRowid);

    store = new MemoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("1. creates memory entities starting strictly in ACTIVE status at version 1", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "auth_middleware",
      category: "architectural_decision",
      title: "Authentication Middleware",
      content: "Use JWT-based bearer authentication middleware on all API routes.",
      confidence: 1.0,
      confidenceTier: "CONFIRMED",
      firstSeenScanId: scanId,
      lastSeenScanId: scanId,
    });

    expect(mem.id).toBeGreaterThan(0);
    expect(mem.repositoryId).toBe(repoId);
    expect(mem.memoryKey).toBe("auth_middleware");
    expect(mem.category).toBe("architectural_decision");
    expect(mem.status).toBe("ACTIVE");
    expect(mem.version).toBe(1);
    expect(mem.supersededById).toBeNull();
    expect(mem.firstSeenScanId).toBe(scanId);
    expect(mem.lastSeenScanId).toBe(scanId);

    // Initial creation should have 0 prior historical versions in memory_versions
    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(0);
  });

  it("2. executes successful ACTIVE -> STALE transition and records immutable version 1 history", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "session_cache",
      category: "engineering_convention",
      title: "Session Cache",
      content: "Cache session tokens in memory cache.",
    });

    const transitioned = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "STALE",
      changeReason: "No longer observed in active entrypoints during rescan",
      sourceScanId: scanId,
    });

    expect(transitioned.status).toBe("STALE");
    expect(transitioned.version).toBe(2);

    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].status).toBe("ACTIVE");
    expect(versions[0].title).toBe("Session Cache");
    expect(versions[0].content).toBe("Cache session tokens in memory cache.");
    expect(versions[0].changeReason).toBe("No longer observed in active entrypoints during rescan");
    expect(versions[0].sourceScanId).toBe(scanId);
  });

  it("3. executes successful STALE -> ACTIVE transition and records immutable version 2 history", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "cache_redis",
      category: "architectural_decision",
      title: "Redis Cache",
      content: "Use Redis cluster for caching.",
    });

    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "STALE",
      changeReason: "Temporary stale state",
    });

    const reactivated = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "ACTIVE",
      changeReason: "Redis connection reaffirmed in entrypoint",
    });

    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.version).toBe(3);

    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[0].status).toBe("ACTIVE");
    expect(versions[1].version).toBe(2);
    expect(versions[1].status).toBe("STALE");
  });

  it("4. ignores no-op status updates without creating redundant history records", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "cors_policy",
      category: "engineering_convention",
      title: "CORS Policy",
      content: "Strict whitelist for origins.",
    });

    // Requesting ACTIVE -> ACTIVE without changes
    const noOp = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "ACTIVE",
      changeReason: "No-op reaffirmation",
    });

    expect(noOp.status).toBe("ACTIVE");
    expect(noOp.version).toBe(1);

    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(0);
  });

  it("5. executes successful ACTIVE -> SUPERSEDED transition with a valid replacement and records history", () => {
    const oldMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "auth_cookie",
      category: "architectural_decision",
      title: "Cookie Auth",
      content: "Use session cookies for authentication.",
    });

    const replacementMem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "auth_oauth2",
      category: "architectural_decision",
      title: "OAuth2 with PKCE",
      content: "Use OAuth2 authorization code with PKCE tokens.",
    });

    const superseded = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: oldMem.id,
      targetStatus: "SUPERSEDED",
      supersededById: replacementMem.id,
      changeReason: "Migrated to OAuth2 with PKCE",
    });

    expect(superseded.status).toBe("SUPERSEDED");
    expect(superseded.supersededById).toBe(replacementMem.id);
    expect(superseded.version).toBe(2);

    const versions = store.getMemoryVersions(oldMem.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].status).toBe("ACTIVE");
  });

  it("6. executes successful transition to ARCHIVED with history", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "legacy_importer",
      category: "technical_debt",
      title: "Legacy Importer",
      content: "CSV batch importer from version 1.",
    });

    const archived = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "ARCHIVED",
      changeReason: "Importer decommissioned after database migration",
    });

    expect(archived.status).toBe("ARCHIVED");
    expect(archived.version).toBe(2);

    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].status).toBe("ACTIVE");
  });

  it("7. rejects invalid transition from terminal states without altering memory or history", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "archived_target",
      category: "technical_debt",
      title: "Dead Code",
      content: "Old dead code.",
    });

    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "ARCHIVED",
      changeReason: "Decommissioned",
    });

    // Attempting to revive ARCHIVED memory
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: mem.id,
        targetStatus: "ACTIVE",
        changeReason: "Attempt to revive",
      });
    }).toThrow(
      /Illegal status transition: ARCHIVED is a terminal state and cannot be reactivated or changed/,
    );

    const current = store.getMemory(repoId, mem.id)!;
    expect(current.status).toBe("ARCHIVED");
    expect(current.version).toBe(2);

    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(1);
  });

  it("8. rejects missing or invalid replacement for SUPERSEDED transition without modifying state", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "mem_need_repl",
      category: "architectural_decision",
      title: "Need Replacement",
      content: "Needs a replacement.",
    });

    // Missing replacement
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: mem.id,
        targetStatus: "SUPERSEDED",
        supersededById: null,
        changeReason: "Missing replacement",
      });
    }).toThrow(/A SUPERSEDED memory requires a non-null supersededById replacement/);

    // Self replacement
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: mem.id,
        targetStatus: "SUPERSEDED",
        supersededById: mem.id,
        changeReason: "Self replacement",
      });
    }).toThrow(/Illegal supersession: self-supersession is prohibited/);

    // Non-existent replacement
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: mem.id,
        targetStatus: "SUPERSEDED",
        supersededById: 999999,
        changeReason: "Non-existent replacement",
      });
    }).toThrow(/Replacement memory 999999 not found/);

    // Verify memory and versions are completely unchanged
    const current = store.getMemory(repoId, mem.id)!;
    expect(current.status).toBe("ACTIVE");
    expect(current.version).toBe(1);
    expect(store.getMemoryVersions(mem.id)).toHaveLength(0);
  });

  it("9. rolls back both parent update and version insertion on mid-transaction failure", () => {
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "rollback_test",
      category: "architectural_knowledge",
      title: "Rollback Invariant",
      content: "Atomic transactional rollback verification.",
    });

    expect(() => {
      store.transitionLifecycle(
        {
          repositoryId: repoId,
          memoryId: mem.id,
          targetStatus: "STALE",
          changeReason: "Simulated failure injection",
        },
        true, // simulate failure
      );
    }).toThrow(/Simulated mid-transaction failure for rollback verification/);

    // Verify parent memory is completely unchanged at version 1 and ACTIVE
    const current = store.getMemory(repoId, mem.id)!;
    expect(current.status).toBe("ACTIVE");
    expect(current.version).toBe(1);

    // Verify zero version history records were persisted
    const versions = store.getMemoryVersions(mem.id);
    expect(versions).toHaveLength(0);
  });

  it("10. persists memory entities and historical version records across database reopen on disk", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-memstore-disk-"));
    const diskPath = path.join(tmpDir, "memory_test.sqlite");

    try {
      const diskDb = new SqliteDatabase({ path: diskPath });
      runMigrations(diskDb.rawDb);

      const r = diskDb.rawDb
        .prepare(
          "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_disk', '/p', 'Disk Repo', ?, ?, 3)",
        )
        .run(now, now);
      const diskRepoId = Number(r.lastInsertRowid);

      const diskStore = new MemoryStore(diskDb);
      const mem = diskStore.createMemory({
        repositoryId: diskRepoId,
        memoryKey: "disk_resilience",
        category: "project_context",
        title: "Disk Resilience",
        content: "Verified on physical disk storage.",
      });

      diskStore.transitionLifecycle({
        repositoryId: diskRepoId,
        memoryId: mem.id,
        targetStatus: "STALE",
        changeReason: "Marked stale prior to database close",
      });

      diskDb.close();

      // Reopen physical database
      const reopenedDb = new SqliteDatabase({ path: diskPath });
      const reopenedStore = new MemoryStore(reopenedDb);

      const retrieved = reopenedStore.getMemory(diskRepoId, mem.id)!;
      expect(retrieved.status).toBe("STALE");
      expect(retrieved.version).toBe(2);
      expect(retrieved.title).toBe("Disk Resilience");

      const versions = reopenedStore.getMemoryVersions(mem.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].status).toBe("ACTIVE");
      expect(versions[0].changeReason).toBe("Marked stale prior to database close");

      reopenedDb.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("11. lists memories matching category, status, and confidence tier filters", () => {
    store.createMemory({
      repositoryId: repoId,
      memoryKey: "filter_1",
      category: "architectural_decision",
      title: "Decision 1",
      content: "C1",
    });

    const m2 = store.createMemory({
      repositoryId: repoId,
      memoryKey: "filter_2",
      category: "technical_debt",
      title: "Debt 1",
      content: "C2",
    });

    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: m2.id,
      targetStatus: "STALE",
      changeReason: "Became stale",
    });

    const all = store.listMemories(repoId);
    expect(all).toHaveLength(2);

    const activeOnly = store.listMemories(repoId, { status: "ACTIVE" });
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0].memoryKey).toBe("filter_1");

    const staleDebt = store.listMemories(repoId, {
      category: "technical_debt",
      status: "STALE",
    });
    expect(staleDebt).toHaveLength(1);
    expect(staleDebt[0].memoryKey).toBe("filter_2");
  });

  it("12. rejects attempts to archive or supersede a referenced replacement via transitionLifecycle and preserves state and history", () => {
    // 1. Create memA, memB, and memC
    const memA = store.createMemory({
      repositoryId: repoId,
      memoryKey: "store_mem_a",
      category: "architectural_decision",
      title: "Store Memory A",
      content: "Initial decision A",
    });

    const memB = store.createMemory({
      repositoryId: repoId,
      memoryKey: "store_mem_b",
      category: "architectural_decision",
      title: "Store Memory B",
      content: "Replacement decision B",
    });

    const memC = store.createMemory({
      repositoryId: repoId,
      memoryKey: "store_mem_c",
      category: "architectural_decision",
      title: "Store Memory C",
      content: "Alternative decision C",
    });

    // 2. Supersede memA pointing to memB
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memA.id,
      targetStatus: "SUPERSEDED",
      supersededById: memB.id,
      changeReason: "Replaced A with B",
    });

    // 3. Attempt to archive B via transitionLifecycle -> MUST FAIL
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: memB.id,
        targetStatus: "ARCHIVED",
        changeReason: "Attempting to archive replacement B",
      });
    }).toThrow(
      /cannot transition memory \d+ to ARCHIVED because it is currently an active replacement for superseded memories/,
    );

    // Verify B's status, version, and versions count
    const checkBAfterArchiveAttempt = store.getMemory(repoId, memB.id)!;
    expect(checkBAfterArchiveAttempt.status).toBe("ACTIVE");
    expect(checkBAfterArchiveAttempt.version).toBe(1);
    expect(store.getMemoryVersions(memB.id)).toHaveLength(0);

    // Verify existing supersession reference on A remains intact
    const checkA1 = store.getMemory(repoId, memA.id)!;
    expect(checkA1.status).toBe("SUPERSEDED");
    expect(checkA1.supersededById).toBe(memB.id);

    // 4. Attempt to supersede B (pointing to C) via transitionLifecycle -> MUST FAIL
    expect(() => {
      store.transitionLifecycle({
        repositoryId: repoId,
        memoryId: memB.id,
        targetStatus: "SUPERSEDED",
        supersededById: memC.id,
        changeReason: "Attempting to supersede replacement B",
      });
    }).toThrow(
      /cannot transition memory \d+ to SUPERSEDED because it is currently an active replacement for superseded memories/,
    );

    // Verify B's status, version, and versions count remain unchanged
    const checkBAfterSupersedeAttempt = store.getMemory(repoId, memB.id)!;
    expect(checkBAfterSupersedeAttempt.status).toBe("ACTIVE");
    expect(checkBAfterSupersedeAttempt.version).toBe(1);
    expect(store.getMemoryVersions(memB.id)).toHaveLength(0);

    // Verify existing supersession reference on A remains intact
    const checkA2 = store.getMemory(repoId, memA.id)!;
    expect(checkA2.status).toBe("SUPERSEDED");
    expect(checkA2.supersededById).toBe(memB.id);

    // 5. Verify B can still transition to an allowed non-terminal status (STALE and back to ACTIVE)
    const staleB = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memB.id,
      targetStatus: "STALE",
      changeReason: "Valid non-terminal transition to STALE",
    });
    expect(staleB.status).toBe("STALE");
    expect(staleB.version).toBe(2);
    expect(store.getMemoryVersions(memB.id)).toHaveLength(1);

    const reactivatedB = store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: memB.id,
      targetStatus: "ACTIVE",
      changeReason: "Valid non-terminal reactivation to ACTIVE",
    });
    expect(reactivatedB.status).toBe("ACTIVE");
    expect(reactivatedB.version).toBe(3);
    expect(store.getMemoryVersions(memB.id)).toHaveLength(2);
  });

  it("13. enforces repository isolation on two-argument getMemoryVersions(repositoryId, memoryId)", () => {
    const otherRepoId = Number(
      db.rawDb
        .prepare(
          "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_iso_ver', '/iso', 'Iso', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 3)",
        )
        .run().lastInsertRowid,
    );
    const mem = store.createMemory({
      repositoryId: repoId,
      memoryKey: "scoped_ver_mem",
      category: "project_context",
      title: "Scoped Version",
      content: "v1",
    });
    store.transitionLifecycle({
      repositoryId: repoId,
      memoryId: mem.id,
      targetStatus: "STALE",
      changeReason: "test isolation",
    });
    expect(store.getMemoryVersions(repoId, mem.id)).toHaveLength(1);
    expect(store.getMemoryVersions(otherRepoId, mem.id)).toHaveLength(0);
  });
});
