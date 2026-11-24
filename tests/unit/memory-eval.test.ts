/**
 * Phase 8.2 — Behavioral Evaluation Scenarios for Active Memory Authoring
 * Evaluates behavioral correctness across authoring, multi-generation supersession,
 * ADR ingestion, projection determinism, and drift detection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryAuthoringEngine } from "../../scripts/memory/memory-authoring.ts";
import { AdrIngestEngine } from "../../scripts/memory/adr-ingest.ts";
import { MemoryProjector } from "../../scripts/memory/memory-projector.ts";
import { MemoryDriftDetector } from "../../scripts/memory/memory-drift.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";

describe("Phase 8.2 — Memory Authoring Behavioral Scenarios", () => {
  let ws: string;
  let db: SqliteDatabase;
  let store: MemoryStore;
  let authoring: MemoryAuthoringEngine;
  let ingest: AdrIngestEngine;
  let projector: MemoryProjector;
  let drift: MemoryDriftDetector;
  let repoId: number;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-mem-eval-"));
    fs.mkdirSync(path.join(ws, "docs", "adr"), { recursive: true });

    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);
    store = new MemoryStore(db);
    authoring = new MemoryAuthoringEngine(db);
    ingest = new AdrIngestEngine(db);
    projector = new MemoryProjector(db);
    drift = new MemoryDriftDetector(db);

    const res = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('eval_repo', '/eval', 'Eval Repo', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
      )
      .run();
    repoId = Number(res.lastInsertRowid);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
    if (ws && fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("Scenario 1: End-to-end multi-generation architectural supersession lifecycle", () => {
    // 1. Author initial architecture convention
    const mem1 = authoring.recordMemory({
      repositoryId: repoId,
      category: "architectural_decision",
      title: "Stateful Session Storage",
      content: "Store user sessions in-memory on application server.",
    }).memory;
    expect(mem1.version).toBe(1);
    expect(mem1.status).toBe("ACTIVE");

    // 2. Supersede with Redis cluster
    const mem2 = authoring.recordMemory({
      repositoryId: repoId,
      category: "architectural_decision",
      title: "Redis Session Storage",
      content: "Store user sessions in shared Redis cache cluster.",
    }).memory;

    const sup1 = authoring.supersedeMemory({
      repositoryId: repoId,
      targetIdOrKey: mem1.id,
      replacementIdOrKey: mem2.id,
      reason: "Scaling requires stateless application instances",
    });
    expect(sup1.targetMemory.status).toBe("SUPERSEDED");
    expect(sup1.targetMemory.supersededById).toBe(mem2.id);

    // 3. Supersede Redis with JWT tokens (multi-generation chain: mem1 -> mem2 -> mem3)
    const mem3 = authoring.recordMemory({
      repositoryId: repoId,
      category: "architectural_decision",
      title: "Stateless JWT Sessions",
      content: "Issue signed asymmetric JWTs with short expiry.",
    }).memory;

    const sup2 = authoring.supersedeMemory({
      repositoryId: repoId,
      targetIdOrKey: mem2.id,
      replacementIdOrKey: mem3.id,
      reason: "Edge deployment requires zero-lookup token verification",
    });
    expect(sup2.targetMemory.status).toBe("SUPERSEDED");
    expect(sup2.targetMemory.supersededById).toBe(mem3.id);

    // Verify historical lineage is intact
    const check1 = store.getMemory(repoId, mem1.id)!;
    const check2 = store.getMemory(repoId, mem2.id)!;
    const check3 = store.getMemory(repoId, mem3.id)!;

    expect(check1.status).toBe("SUPERSEDED");
    expect(check1.supersededById).toBe(mem2.id);

    expect(check2.status).toBe("SUPERSEDED");
    expect(check2.supersededById).toBe(mem3.id);

    expect(check3.status).toBe("ACTIVE");
    expect(check3.supersededById).toBeNull();

    // Verify cycle protection: mem3 cannot be superseded by mem1 or mem2
    expect(() => {
      authoring.supersedeMemory({
        repositoryId: repoId,
        targetIdOrKey: mem3.id,
        replacementIdOrKey: mem1.id,
        reason: "Illegal loop attempt",
      });
    }).toThrow(/Illegal supersession/);
  });

  it("Scenario 2: ADR ingestion with idempotent updates and supersession linking", () => {
    // Write ADR-001 and ADR-002 to disk
    const adr1Path = path.join(ws, "docs", "adr", "ADR-001-monolith.md");
    fs.writeFileSync(
      adr1Path,
      "# ADR-001: Monolith System Architecture\n- **Status:** Accepted\n\nInitial Monolith Decision.",
      "utf8",
    );

    const adr2Path = path.join(ws, "docs", "adr", "ADR-002-modular.md");
    fs.writeFileSync(
      adr2Path,
      "# ADR-002: Modular System Architecture\n- **Status:** Accepted\n- **Supersedes:** ADR-001\n\nModular Architecture Decision.",
      "utf8",
    );

    // Initial ingestion
    const report1 = ingest.ingest(repoId, ws);
    expect(report1.created).toHaveLength(2);

    const m1 = store.getMemoryByKey(repoId, "adr_001_monolith_system_architecture")!;
    const m2 = store.getMemoryByKey(repoId, "adr_002_modular_system_architecture")!;
    expect(m1.status).toBe("SUPERSEDED");
    expect(m1.supersededById).toBe(m2.id);

    // Re-ingest without changes -> 0 updates, 2 unchanged
    const report2 = ingest.ingest(repoId, ws);
    expect(report2.created).toHaveLength(0);
    expect(report2.updated).toHaveLength(0);
    expect(report2.unchanged).toHaveLength(2);

    // Update ADR-002 on disk -> exactly 1 update, version incremented
    fs.appendFileSync(adr2Path, "\n\n## Consequences\nUpdated consequences on modularity.");
    const report3 = ingest.ingest(repoId, ws);
    expect(report3.updated).toHaveLength(1);
    expect(report3.updated[0].currentVersion).toBe(2);

    const m2Updated = store.getMemory(repoId, m2.id)!;
    expect(m2Updated.version).toBe(2);
    expect(m2Updated.content).toContain("Updated consequences on modularity.");
  });

  it("Scenario 3: Memory projection determinism and collision avoidance", () => {
    authoring.recordMemory({
      repositoryId: repoId,
      category: "engineering_convention",
      title: "Deterministic Hashes",
      content: "All hash operations must use SHA-256.",
    });

    authoring.recordMemory({
      repositoryId: repoId,
      category: "technical_debt",
      title: "Legacy Polyfills",
      content: "Remove core-js polyfills after Node 22 upgrade.",
    });

    // Project memories
    const projReport = projector.project(repoId, ws);
    expect(projReport.totalProjected).toBe(2);

    const convPath = path.join(
      ws,
      ".frontier",
      "memories",
      "engineering_convention",
      "conv_deterministic_hashes.md",
    );
    const debtPath = path.join(
      ws,
      ".frontier",
      "memories",
      "technical_debt",
      "debt_legacy_polyfills.md",
    );

    expect(fs.existsSync(convPath)).toBe(true);
    expect(fs.existsSync(debtPath)).toBe(true);

    const contentBefore = fs.readFileSync(convPath, "utf8");

    // Re-projecting identical state yields UNCHANGED without file rewrite
    const projReport2 = projector.project(repoId, ws);
    expect(projReport2.files.every((f) => f.status === "UNCHANGED")).toBe(true);
    expect(fs.readFileSync(convPath, "utf8")).toBe(contentBefore);
  });

  it("Scenario 4: Drift detection and isolation across ADRs and projections", () => {
    // Author convention & project
    authoring.recordMemory({
      repositoryId: repoId,
      category: "engineering_convention",
      title: "Immutable Snapshots",
      content: "Snapshots must remain immutable.",
    });
    projector.project(repoId, ws);

    // Initial drift check -> zero drift
    const drift1 = drift.detect(repoId, ws);
    expect(drift1.hasDrift).toBe(false);

    // Simulate rogue manual modification of projected file
    const projFile = path.join(
      ws,
      ".frontier",
      "memories",
      "engineering_convention",
      "conv_immutable_snapshots.md",
    );
    fs.appendFileSync(projFile, "\n<!-- Unauthorized manual modification -->");

    const drift2 = drift.detect(repoId, ws);
    expect(drift2.hasDrift).toBe(true);
    expect(drift2.findings.some((f) => f.code === "PROJECTION_CONTENT_DRIFT")).toBe(true);
  });
});
