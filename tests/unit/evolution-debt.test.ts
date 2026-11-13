import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import { EvolutionAnalyzer } from "../../scripts/evolution/evolution-analyzer.ts";

describe("evolution-debt (Stage 4 Deterministic Engineering Debt Intelligence)", () => {
  let tmpDir: string;
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let repoId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-evo-debt-"));
    connectionManager = new ConnectionManager({
      workspaceRoot: tmpDir,
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    repoId = connectionManager.getRepository().id;
  });

  afterEach(() => {
    connectionManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createScan(startedAt: string): number {
    const res = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, 'COMPLETE', 10, 10, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
      )
      .run(repoId, startedAt, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  function insertFile(
    scanId: number,
    normalizedPath: string,
    hash = "h1",
    classification = "source",
  ): number {
    const ext = path.posix.extname(normalizedPath) || ".ts";
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, 'typescript', ?, 200, 1700000000000, ?, 'SAFE', 'INDEXED', ?)`,
      )
      .run(
        repoId,
        scanId,
        normalizedPath,
        normalizedPath,
        ext,
        classification,
        hash,
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  }

  function insertImport(
    scanId: number,
    sourceFileId: number,
    specifier: string,
    resolvedFileId: number | null,
    status: "RESOLVED" | "UNRESOLVED" | "EXTERNAL",
    line = 1,
  ): void {
    db.prepare(
      `INSERT INTO imports (
        repository_id, scan_id, source_file_id, imported_specifier,
        import_kind, resolved_file_id, resolution_status, start_line, end_line
      ) VALUES (?, ?, ?, ?, 'es_import', ?, ?, ?, ?)`,
    ).run(repoId, scanId, sourceFileId, specifier, resolvedFileId, status, line, line);
  }

  it("EVO-DEBT-01 & EVO-DEBT-02: tracks INTRODUCED, WORSENED, PERSISTING, and RESOLVED debt across snapshots", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");

    // --- Scan 1 ---
    // Cycle 1: c1a <-> c1b (persisting across 1->2)
    const c1a_1 = insertFile(scan1, "src/core/c1a.ts");
    const c1b_1 = insertFile(scan1, "src/core/c1b.ts");
    insertImport(scan1, c1a_1, "./c1b", c1b_1, "RESOLVED", 1);
    insertImport(scan1, c1b_1, "./c1a", c1a_1, "RESOLVED", 1);

    // Unresolved import in src/api/handler.ts (1 unresolved) + Express import (backend) + Test covers handler.ts
    const h1 = insertFile(scan1, "src/api/handler.ts");
    insertImport(scan1, h1, "express", null, "EXTERNAL", 1);
    insertImport(scan1, h1, "./missing1", null, "UNRESOLVED", 2);
    const t1 = insertFile(scan1, "tests/handler.test.ts");
    insertImport(scan1, t1, "../../src/api/handler", h1, "RESOLVED", 1);

    // Active memory pinned to src/obsolete.ts
    insertFile(scan1, "src/obsolete.ts");
    const memStore = new MemoryStore(db);
    const mem = memStore.createMemory({
      repositoryId: repoId,
      memoryKey: "obsolete_mem",
      category: "project_context",
      title: "Obsolete File",
      content: "Legacy helper",
      firstSeenScanId: scan1,
      lastSeenScanId: scan1,
    });
    memStore.addEvidence({
      repositoryId: repoId,
      memoryId: mem.id,
      scanId: scan1,
      evidenceType: "source_file",
      sourcePath: "src/obsolete.ts",
      description: "Pinned to src/obsolete.ts",
    });

    // --- Scan 2 ---
    // Cycle 1 persists; Cycle 2 introduced (x <-> y)
    const c1a_2 = insertFile(scan2, "src/core/c1a.ts");
    const c1b_2 = insertFile(scan2, "src/core/c1b.ts");
    insertImport(scan2, c1a_2, "./c1b", c1b_2, "RESOLVED", 1);
    insertImport(scan2, c1b_2, "./c1a", c1a_2, "RESOLVED", 1);

    const x2 = insertFile(scan2, "src/core/x.ts");
    const y2 = insertFile(scan2, "src/core/y.ts");
    insertImport(scan2, x2, "./y", y2, "RESOLVED", 1);
    insertImport(scan2, y2, "./x", x2, "RESOLVED", 1);

    // Unresolved imports worsen in src/api/handler.ts (1 -> 3), plus untested new file in src/api
    const h2 = insertFile(scan2, "src/api/handler.ts");
    insertImport(scan2, h2, "express", null, "EXTERNAL", 1);
    insertImport(scan2, h2, "./missing1", null, "UNRESOLVED", 2);
    insertImport(scan2, h2, "./missing2", null, "UNRESOLVED", 3);
    insertImport(scan2, h2, "./missing3", null, "UNRESOLVED", 4);
    insertFile(scan2, "src/api/untested1.ts");
    const t2 = insertFile(scan2, "tests/handler.test.ts");
    insertImport(scan2, t2, "../../src/api/handler", h2, "RESOLVED", 1);
    // src/obsolete.ts deleted -> obsolete_mem becomes STALE

    const analyzer = new EvolutionAnalyzer(db);
    const res12 = analyzer.analyze(scan1, scan2);

    const c1 = res12.debt.items.find(
      (d) => d.category === "DEBT_CIRCULAR_DEPENDENCY" && d.state === "PERSISTING",
    );
    const c2 = res12.debt.items.find(
      (d) => d.category === "DEBT_CIRCULAR_DEPENDENCY" && d.state === "INTRODUCED",
    );
    const unresolvedWorsened = res12.debt.items.find(
      (d) =>
        d.category === "DEBT_UNRESOLVED_IMPORTS" &&
        d.subjectEntity === "src/api/handler.ts" &&
        d.state === "WORSENED",
    );
    const untestedDebt = res12.debt.items.find(
      (d) => d.category === "DEBT_UNTESTED_COMPONENT_GROWTH" && d.subjectEntity === "comp:src/api",
    );
    const staleMemDebt = res12.debt.items.find(
      (d) => d.category === "DEBT_STALE_OR_DISPUTED_MEMORY" && d.subjectEntity === "obsolete_mem",
    );

    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(unresolvedWorsened).toBeDefined();
    expect(unresolvedWorsened?.severity).toBe("HIGH");
    expect(untestedDebt).toBeDefined();
    expect(untestedDebt?.confidenceTier).toBe("INFERRED"); // Must never be CONFIRMED!
    expect(untestedDebt?.state).toBe("INTRODUCED");
    expect(staleMemDebt).toBeDefined();
    expect(staleMemDebt?.state).toBe("INTRODUCED");

    // --- Scan 3: Break Cycle 2 and resolve unresolved imports ---
    const c1a_3 = insertFile(scan3, "src/core/c1a.ts");
    const c1b_3 = insertFile(scan3, "src/core/c1b.ts");
    insertImport(scan3, c1a_3, "./c1b", c1b_3, "RESOLVED", 1);
    insertImport(scan3, c1b_3, "./c1a", c1a_3, "RESOLVED", 1);

    const x3 = insertFile(scan3, "src/core/x.ts");
    const y3 = insertFile(scan3, "src/core/y.ts");
    insertImport(scan3, x3, "./y", y3, "RESOLVED", 1); // y -> x removed!

    const h3 = insertFile(scan3, "src/api/handler.ts");
    insertImport(scan3, h3, "express", null, "EXTERNAL", 1); // All unresolved removed!

    const res23 = analyzer.analyze(scan2, scan3);
    expect(
      res23.debt.items.some(
        (d) => d.category === "DEBT_CIRCULAR_DEPENDENCY" && d.state === "RESOLVED",
      ),
    ).toBe(true);
    expect(
      res23.debt.items.some(
        (d) => d.category === "DEBT_UNRESOLVED_IMPORTS" && d.state === "RESOLVED",
      ),
    ).toBe(true);
  });

  it("EVO-DEBT-REMEDIATION-01: keeps static fanout hotspots and uncorroborated layer violations below CONFIRMED and downgrades barrel index files to CANDIDATE", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    insertFile(scan1, "src/ui/App.tsx", "u1");
    insertFile(scan1, "src/db/schema.sql", "d1", "database");

    const ui2 = insertFile(scan2, "src/ui/App.tsx", "u2");
    const db2 = insertFile(scan2, "src/db/conn.ts", "d2");
    insertFile(scan2, "src/db/schema.sql", "d1", "database");
    insertImport(scan2, ui2, "../db/conn", db2, "RESOLVED", 1);

    const svc2 = insertFile(scan2, "src/core/service.ts", "s2");
    const barrel2 = insertFile(scan2, "src/core/index.ts", "b2");
    for (let i = 1; i <= 11; i++) {
      const leaf = insertFile(scan2, `src/core/leaf${i}.ts`, `l${i}`);
      insertImport(scan2, svc2, `./leaf${i}`, leaf, "RESOLVED", i);
      insertImport(scan2, barrel2, `./leaf${i}`, leaf, "RESOLVED", i);
    }

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2);
    const svcHotspot = res.debt.items.find(
      (d) => d.category === "DEBT_HIGH_FANOUT_HOTSPOT" && d.subjectEntity === "src/core/service.ts",
    );
    const barrelHotspot = res.debt.items.find(
      (d) => d.category === "DEBT_HIGH_FANOUT_HOTSPOT" && d.subjectEntity === "src/core/index.ts",
    );
    const layerDebt = res.debt.items.find((d) => d.category === "DEBT_LAYER_BOUNDARY_VIOLATION");

    expect(svcHotspot?.confidenceTier).toBe("INFERRED");
    expect(barrelHotspot?.confidenceTier).toBe("CANDIDATE");
    expect(barrelHotspot?.severity).toBe("LOW");
    expect(barrelHotspot?.details.aggregatorOrEntrypoint).toBe(true);
    expect(layerDebt?.confidenceTier).toBe("INFERRED");
  });
});
