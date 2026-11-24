/**
 * Phase 8.2D — Memory Drift Detection Unit Tests
 * Tests detection of content drift, status mismatches, missing ADRs,
 * projection discrepancies, and broken supersession references.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { AdrIngestEngine } from "../../scripts/memory/adr-ingest.ts";
import { MemoryProjector } from "../../scripts/memory/memory-projector.ts";
import { MemoryDriftDetector } from "../../scripts/memory/memory-drift.ts";

describe("Phase 8.2D — Memory Drift Detection", () => {
  let db: SqliteDatabase;
  let store: MemoryStore;
  let ingestEngine: AdrIngestEngine;
  let projector: MemoryProjector;
  let detector: MemoryDriftDetector;
  let repoId: number;
  let tempWs: string;

  beforeEach(() => {
    tempWs = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-drift-test-"));
    fs.mkdirSync(path.join(tempWs, "docs", "adr"), { recursive: true });

    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);
    store = new MemoryStore(db);
    ingestEngine = new AdrIngestEngine(db);
    projector = new MemoryProjector(db);
    detector = new MemoryDriftDetector(db);

    const res = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_drift', '/drift', 'Drift Repo', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
      )
      .run();
    repoId = Number(res.lastInsertRowid);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.rawDb.close();
    }
    if (tempWs && fs.existsSync(tempWs)) {
      fs.rmSync(tempWs, { recursive: true, force: true });
    }
  });

  it("1. reports zero drift when ADRs, database, and projections are in sync", () => {
    const adrFile = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nContent",
      "utf8",
    );

    ingestEngine.ingest(repoId, tempWs);
    projector.project(repoId, tempWs);

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(false);
    expect(report.totalFindings).toBe(0);
    expect(report.summary.critical).toBe(0);
  });

  it("2. detects ADR_CONTENT_CHANGED when on-disk ADR is modified without ingestion", () => {
    const adrFile = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nOriginal Decision",
      "utf8",
    );

    ingestEngine.ingest(repoId, tempWs);

    // Modify file on disk
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nDrifted Decision",
      "utf8",
    );

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(true);
    const contentFinding = report.findings.find((f) => f.code === "ADR_CONTENT_CHANGED");
    expect(contentFinding).toBeDefined();
    expect(contentFinding?.severity).toBe("WARNING");
    expect(contentFinding?.filePath).toBe("docs/adr/ADR-001-foundation.md");
  });

  it("3. detects ADR_STATUS_MISMATCH when on-disk ADR changes status", () => {
    const adrFile = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nContent",
      "utf8",
    );

    ingestEngine.ingest(repoId, tempWs);

    // Change status on disk to Deprecated
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Deprecated\n\nContent",
      "utf8",
    );

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(true);
    const statusFinding = report.findings.find((f) => f.code === "ADR_STATUS_MISMATCH");
    expect(statusFinding).toBeDefined();
    expect(statusFinding?.expected).toBe("ACTIVE");
    expect(statusFinding?.actual).toBe("SUPERSEDED");
  });

  it("4. detects ADR_FILE_MISSING when linked ADR file is deleted", () => {
    const adrFile = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
    fs.writeFileSync(
      adrFile,
      "# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nContent",
      "utf8",
    );

    // Ingest with scanId so evidence is attached
    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, completed_at, status, scanner_version, extractor_version) VALUES (?, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'COMPLETE', '1.0.0', '1.0.0')",
      )
      .run(repoId);
    const scanId = Number(scanRes.lastInsertRowid);

    ingestEngine.ingest(repoId, tempWs, { scanId });

    // Delete ADR file from disk
    fs.unlinkSync(adrFile);

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(true);
    const missingFinding = report.findings.find((f) => f.code === "ADR_FILE_MISSING");
    expect(missingFinding).toBeDefined();
    expect(missingFinding?.severity).toBe("CRITICAL");
  });

  it("5. detects PROJECTION_CONTENT_DRIFT when projection file is manually edited", () => {
    store.createMemory({
      repositoryId: repoId,
      memoryKey: "conv_testing_rule",
      category: "engineering_convention",
      title: "Testing Rule",
      content: "Rule content",
    });

    projector.project(repoId, tempWs);

    const projPath = path.join(
      tempWs,
      ".frontier",
      "memories",
      "engineering_convention",
      "conv_testing_rule.md",
    );
    expect(fs.existsSync(projPath)).toBe(true);

    // Manually edit projected file
    fs.appendFileSync(projPath, "\n\n<!-- Rogue manual modification -->\n");

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(true);
    const projFinding = report.findings.find((f) => f.code === "PROJECTION_CONTENT_DRIFT");
    expect(projFinding).toBeDefined();
    expect(projFinding?.severity).toBe("WARNING");
  });

  it("6. detects DUPLICATE_CONTENT among active memories", () => {
    store.createMemory({
      repositoryId: repoId,
      memoryKey: "conv_dup_one",
      category: "engineering_convention",
      title: "Duplicate 1",
      content: "Exact duplicate content text.",
    });

    store.createMemory({
      repositoryId: repoId,
      memoryKey: "conv_dup_two",
      category: "engineering_convention",
      title: "Duplicate 2",
      content: "Exact duplicate content text.",
    });

    const report = detector.detect(repoId, tempWs);
    expect(report.hasDrift).toBe(true);
    const dupFinding = report.findings.find((f) => f.code === "DUPLICATE_CONTENT");
    expect(dupFinding).toBeDefined();
    expect(dupFinding?.severity).toBe("WARNING");
  });
});
