import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { EvolutionAnalyzer, EvolutionSerializer } from "../../scripts/evolution/index.ts";

describe("evolution-drift (Stage 4 Architectural Drift & ADR Correlation)", () => {
  let tmpDir: string;
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let repoId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-evo-drift-"));
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

  function createScan(startedAt: string, status = "COMPLETE"): number {
    const res = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, ?, 10, 10, 0, 0, 0, '0.6.3', '0.6.3', 0)`,
      )
      .run(repoId, startedAt, new Date().toISOString(), status);
    return Number(res.lastInsertRowid);
  }

  function insertFile(
    scanId: number,
    normalizedPath: string,
    contentHash: string | null = "h1",
    classification = "source",
  ): number {
    const ext = path.posix.extname(normalizedPath) || ".ts";
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 200, 1700000000000, ?, 'SAFE', 'INDEXED', ?)`,
      )
      .run(
        repoId,
        scanId,
        normalizedPath,
        normalizedPath,
        ext,
        ext === ".md" ? "markdown" : ext === ".sql" ? "sql" : "typescript",
        classification,
        contentHash,
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  }

  function insertImport(
    scanId: number,
    sourceFileId: number,
    specifier: string,
    resolvedFileId: number | null,
    status: "RESOLVED" | "EXTERNAL" | "UNRESOLVED" = "RESOLVED",
    line = 1,
  ): void {
    db.prepare(
      `INSERT INTO imports (
        repository_id, scan_id, source_file_id, imported_specifier,
        import_kind, resolved_file_id, resolution_status, start_line, end_line
      ) VALUES (?, ?, ?, ?, 'es_import', ?, ?, ?, ?)`,
    ).run(repoId, scanId, sourceFileId, specifier, resolvedFileId, status, line, line);
  }

  function insertAdrMetadata(
    scanId: number,
    fileId: number,
    meta: {
      adrId: string;
      number: number;
      title: string;
      status: string;
      governedComponents: string[];
    },
  ): void {
    db.prepare(
      `INSERT INTO source_evidence (
        repository_id, scan_id, file_id, evidence_type,
        start_line, end_line, start_column, end_column, confidence, evidence_description
      ) VALUES (?, ?, ?, 'ADR_METADATA_JSON', 1, 1, 0, 1, 1.0, ?)`,
    ).run(repoId, scanId, fileId, JSON.stringify(meta));
  }

  it("EVO-DRIFT-01: detects component additions, removals, and reclassifications deterministically", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    // Scan 1: src/ui (frontend), src/lib (shared_lib), src/api (CANDIDATE backend)
    insertFile(scan1, "src/ui/App.tsx", "h_ui");
    insertFile(scan1, "src/lib/util.ts", "h_lib");
    insertFile(scan1, "src/api/handler.ts", "h_api");

    // Scan 2: src/ui unchanged, src/lib removed, src/db added (database), src/api becomes frontend (tsx)
    insertFile(scan2, "src/ui/App.tsx", "h_ui");
    insertFile(scan2, "src/db/schema.sql", "h_sql");
    insertFile(scan2, "src/api/Page.tsx", "h_api_tsx");

    const analyzer = new EvolutionAnalyzer(db);
    const res = analyzer.analyze(scan1, scan2);

    expect(
      res.drift.findings.some(
        (f) => f.driftType === "DRIFT_COMPONENT_ADDED" && f.subjectEntity === "comp:src/db",
      ),
    ).toBe(true);
    expect(
      res.drift.findings.some(
        (f) => f.driftType === "DRIFT_COMPONENT_REMOVED" && f.subjectEntity === "comp:src/lib",
      ),
    ).toBe(true);
    expect(
      res.drift.findings.some(
        (f) => f.driftType === "DRIFT_COMPONENT_RECLASSIFIED" && f.subjectEntity === "comp:src/api",
      ),
    ).toBe(true);

    // Deterministic canonical serialization across repeated runs
    const resAgain = analyzer.analyze(scan1, scan2);
    expect(EvolutionSerializer.serializeCanonical(res)).toBe(
      EvolutionSerializer.serializeCanonical(resAgain),
    );
  });

  it("EVO-DRIFT-02: detects cross-component boundary creation and frontend->database layer violation", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    // Scan 1: ui -> api (valid), db exists separately
    const ui1 = insertFile(scan1, "src/ui/App.tsx", "ui1");
    const api1 = insertFile(scan1, "src/api/routes.ts", "api1");
    insertFile(scan1, "src/db/schema.sql", "sql1");
    insertImport(scan1, ui1, "../api/routes", api1, "RESOLVED", 1);
    insertImport(scan1, api1, "express", null, "EXTERNAL", 1);

    // Scan 2: ui -> db added directly (layer violation!)
    const ui2 = insertFile(scan2, "src/ui/App.tsx", "ui2");
    const api2 = insertFile(scan2, "src/api/routes.ts", "api1");
    const db2 = insertFile(scan2, "src/db/connection.ts", "db2");
    insertFile(scan2, "src/db/schema.sql", "sql1");
    insertImport(scan2, ui2, "../api/routes", api2, "RESOLVED", 1);
    insertImport(scan2, ui2, "../db/connection", db2, "RESOLVED", 2);
    insertImport(scan2, api2, "express", null, "EXTERNAL", 1);

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2);

    const boundaryCreated = res.drift.findings.find(
      (f) =>
        f.driftType === "DRIFT_COMPONENT_BOUNDARY_CREATED" &&
        f.subjectEntity === "comp:src/ui->comp:src/db",
    );
    expect(boundaryCreated).toBeDefined();

    const layerViolation = res.drift.findings.find(
      (f) =>
        f.driftType === "DRIFT_LAYER_VIOLATION_INTRODUCED" &&
        f.subjectEntity === "comp:src/ui->comp:src/db",
    );
    expect(layerViolation).toBeDefined();
    expect(layerViolation?.severity).toBe("HIGH");
    expect(layerViolation?.confidenceTier).toBe("INFERRED");
    expect(layerViolation?.details.basis).toBe("heuristic_layer_rule");
  });

  it("EVO-DRIFT-03: detects cycle resolution, introduction, expansion, and SCC growth", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");

    // Scan 1: a <-> b cycle
    const a1 = insertFile(scan1, "src/a.ts", "a1");
    const b1 = insertFile(scan1, "src/b.ts", "b1");
    insertImport(scan1, a1, "./b", b1, "RESOLVED", 1);
    insertImport(scan1, b1, "./a", a1, "RESOLVED", 1);

    // Scan 2: a <-> b resolved; x -> y -> z -> x introduced
    const a2 = insertFile(scan2, "src/a.ts", "a2");
    const b2 = insertFile(scan2, "src/b.ts", "b2");
    insertImport(scan2, a2, "./b", b2, "RESOLVED", 1);
    const x2 = insertFile(scan2, "src/x.ts", "x2");
    const y2 = insertFile(scan2, "src/y.ts", "y2");
    const z2 = insertFile(scan2, "src/z.ts", "z2");
    insertImport(scan2, x2, "./y", y2, "RESOLVED", 1);
    insertImport(scan2, y2, "./z", z2, "RESOLVED", 1);
    insertImport(scan2, z2, "./x", x2, "RESOLVED", 1);

    // Scan 3: x -> y -> z -> w -> x expanded
    const x3 = insertFile(scan3, "src/x.ts", "x3");
    const y3 = insertFile(scan3, "src/y.ts", "y3");
    const z3 = insertFile(scan3, "src/z.ts", "z3");
    const w3 = insertFile(scan3, "src/w.ts", "w3");
    insertImport(scan3, x3, "./y", y3, "RESOLVED", 1);
    insertImport(scan3, y3, "./z", z3, "RESOLVED", 1);
    insertImport(scan3, z3, "./w", w3, "RESOLVED", 1);
    insertImport(scan3, w3, "./x", x3, "RESOLVED", 1);

    const analyzer = new EvolutionAnalyzer(db);
    const cmp12 = analyzer.analyze(scan1, scan2);
    expect(cmp12.drift.findings.some((f) => f.driftType === "DRIFT_CYCLE_RESOLVED")).toBe(true);
    expect(cmp12.drift.findings.some((f) => f.driftType === "DRIFT_CYCLE_INTRODUCED")).toBe(true);
    expect(cmp12.drift.findings.some((f) => f.driftType === "DRIFT_SCC_GROWTH")).toBe(true);

    const cmp23 = analyzer.analyze(scan2, scan3);
    expect(cmp23.drift.findings.some((f) => f.driftType === "DRIFT_CYCLE_EXPANDED")).toBe(true);
    expect(cmp23.drift.findings.some((f) => f.driftType === "DRIFT_SCC_GROWTH")).toBe(true);
  });

  it("EVO-DRIFT-04: detects coupling fan-out hotspot threshold crossing", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    const hub1 = insertFile(scan1, "src/core/hub.ts", "hub1");
    for (let i = 1; i <= 4; i++) {
      const leaf = insertFile(scan1, `src/core/mod${i}.ts`, `m${i}`);
      insertImport(scan1, hub1, `./mod${i}`, leaf, "RESOLVED", i);
    }

    const hub2 = insertFile(scan2, "src/core/hub.ts", "hub2");
    for (let i = 1; i <= 11; i++) {
      const leaf = insertFile(scan2, `src/core/mod${i}.ts`, `m${i}`);
      insertImport(scan2, hub2, `./mod${i}`, leaf, "RESOLVED", i);
    }

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2);
    const hotspot = res.drift.findings.find(
      (f) =>
        f.driftType === "DRIFT_COUPLING_HOTSPOT_INTRODUCED" &&
        f.subjectEntity === "src/core/hub.ts",
    );
    expect(hotspot).toBeDefined();
    expect(hotspot?.confidenceTier).toBe("CONFIRMED");
    expect(hotspot?.details.baseFanOut).toBe(4);
    expect(hotspot?.details.targetFanOut).toBe(11);
  });

  it("EVO-DRIFT-05: correlates orphaned Accepted ADR when its governed component is removed", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    // Scan 1: Accepted ADR-001 governing comp:src/auth
    const adr1File = insertFile(scan1, "docs/adr/ADR-001.md", "adr_h1", "documentation");
    insertFile(scan1, "src/auth/middleware.ts", "auth_h1");
    insertAdrMetadata(scan1, adr1File, {
      adrId: "ADR-001",
      number: 1,
      title: "JWT Authentication",
      status: "Accepted",
      governedComponents: ["comp:src/auth"],
    });

    // Scan 2: ADR-001 remains unchanged & Accepted, while src/auth is completely removed
    const adr2File = insertFile(scan2, "docs/adr/ADR-001.md", "adr_h1", "documentation");
    insertAdrMetadata(scan2, adr2File, {
      adrId: "ADR-001",
      number: 1,
      title: "JWT Authentication",
      status: "Accepted",
      governedComponents: ["comp:src/auth"],
    });

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2);
    const orphan = res.decisions.correlations.find(
      (c) =>
        c.correlationType === "DECISION_GOVERNED_COMPONENT_REMOVED" &&
        c.adrId === "ADR-001" &&
        c.componentIdentity === "comp:src/auth",
    );
    expect(orphan).toBeDefined();
    expect(orphan?.severity).toBe("HIGH");
    expect(orphan?.confidenceTier).toBe("CONFIRMED");
  });

  it("EVO-DRIFT-REMEDIATION-01: promotes layer violation to CONFIRMED only with Accepted ADR and keeps component reclassification INFERRED", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    const ui1 = insertFile(scan1, "src/ui/App.tsx", "ui1");
    insertFile(scan1, "src/db/schema.sql", "sql1");
    const adr1 = insertFile(scan1, "docs/adr/ADR-010.md", "adr10", "documentation");
    insertAdrMetadata(scan1, adr1, {
      adrId: "ADR-010",
      number: 10,
      title: "Forbid direct frontend database imports across layer boundary",
      status: "Accepted",
      governedComponents: ["comp:src/ui", "comp:src/db"],
    });

    const ui2 = insertFile(scan2, "src/ui/App.tsx", "ui2");
    const db2 = insertFile(scan2, "src/db/connection.ts", "db2");
    insertFile(scan2, "src/db/schema.sql", "sql1");
    insertImport(scan2, ui2, "../db/connection", db2, "RESOLVED", 1);
    const adr2 = insertFile(scan2, "docs/adr/ADR-010.md", "adr10", "documentation");
    insertAdrMetadata(scan2, adr2, {
      adrId: "ADR-010",
      number: 10,
      title: "Forbid direct frontend database imports across layer boundary",
      status: "Accepted",
      governedComponents: ["comp:src/ui", "comp:src/db"],
    });

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2);
    const layerViolation = res.drift.findings.find(
      (f) => f.driftType === "DRIFT_LAYER_VIOLATION_INTRODUCED",
    );
    expect(layerViolation).toBeDefined();
    expect(layerViolation?.confidenceTier).toBe("CONFIRMED");
    expect(layerViolation?.details.governingAdrId).toBe("ADR-010");
  });

  it("EVO-DRIFT-REMEDIATION-02: suppresses DRIFT_UNRESOLVED_IMPORT_SPIKE when unresolved imports do not grow and detects net spike", () => {
    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");
    const scan3 = createScan("2026-11-03T10:00:00.000Z");

    const f1 = insertFile(scan1, "src/app.ts", "h1");
    insertImport(scan1, f1, "./missing_a", null, "UNRESOLVED", 1);
    insertImport(scan1, f1, "./missing_b", null, "UNRESOLVED", 2);

    // Scan 2 modifies another line so edge changes in diff, but total unresolved drops (2 -> 1)
    const f2 = insertFile(scan2, "src/app.ts", "h2");
    insertImport(scan2, f2, "./missing_c", null, "UNRESOLVED", 5);

    const noSpike = new EvolutionAnalyzer(db).analyze(scan1, scan2);
    expect(
      noSpike.drift.findings.some((f) => f.driftType === "DRIFT_UNRESOLVED_IMPORT_SPIKE"),
    ).toBe(false);

    // Scan 3 grows unresolved imports (1 -> 3)
    const f3 = insertFile(scan3, "src/app.ts", "h3");
    insertImport(scan3, f3, "./missing_c", null, "UNRESOLVED", 5);
    insertImport(scan3, f3, "./missing_d", null, "UNRESOLVED", 6);
    insertImport(scan3, f3, "./missing_e", null, "UNRESOLVED", 7);

    const spike = new EvolutionAnalyzer(db).analyze(scan2, scan3);
    const spikeFinding = spike.drift.findings.find(
      (f) => f.driftType === "DRIFT_UNRESOLVED_IMPORT_SPIKE",
    );
    expect(spikeFinding).toBeDefined();
    expect(spikeFinding?.details.unresolvedGrowth).toBe(2);
  });

  it("EVO-DRIFT-REMEDIATION-03: blocks live disk ADR leakage on hash mismatch and detects DECISION_CONFLICTING_GOVERNANCE", () => {
    const adrDir = path.join(tmpDir, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });
    const adr1Path = path.join(adrDir, "ADR-020.md");
    const adr1Original = "# ADR-020: Legacy Auth\n\n- **Status:** Proposed\n";
    fs.writeFileSync(adr1Path, adr1Original, "utf8");
    const adr1Hash = createHash("sha256").update(adr1Original).digest("hex");

    // Tamper disk file AFTER indexing so live disk pretends ADR-020 is Accepted & governs auth
    fs.writeFileSync(
      adr1Path,
      "# ADR-020: Legacy Auth\n\n- **Status:** Accepted\n\nGoverns src/auth.\n",
      "utf8",
    );

    const scan1 = createScan("2026-11-01T10:00:00.000Z");
    const scan2 = createScan("2026-11-02T10:00:00.000Z");

    insertFile(scan1, "src/auth/login.ts", "a1");
    insertFile(scan1, "docs/adr/ADR-020.md", adr1Hash, "documentation");
    // Scan 2 removes src/auth; live tampered disk must NOT trigger Accepted orphan correlation!
    insertFile(scan2, "docs/adr/ADR-020.md", adr1Hash, "documentation");

    // Two conflicting hash-verified Accepted ADRs in scan 2 via ADR_METADATA_JSON
    const adrA = insertFile(scan2, "docs/adr/ADR-030.md", "h30", "documentation");
    const adrB = insertFile(scan2, "docs/adr/ADR-031.md", "h31", "documentation");
    insertAdrMetadata(scan2, adrA, {
      adrId: "ADR-030",
      number: 30,
      title: "Allow direct access between comp:src/ui and comp:src/db",
      status: "Accepted",
      governedComponents: ["comp:src/ui", "comp:src/db"],
    });
    insertAdrMetadata(scan2, adrB, {
      adrId: "ADR-031",
      number: 31,
      title: "Supersedes ADR-030: prohibit direct access between comp:src/ui and comp:src/db",
      status: "Accepted",
      governedComponents: ["comp:src/ui", "comp:src/db"],
    });

    const res = new EvolutionAnalyzer(db).analyze(scan1, scan2, { workspaceRoot: tmpDir });
    expect(
      res.decisions.correlations.some(
        (c) => c.adrId === "ADR-020" && c.correlationType === "DECISION_GOVERNED_COMPONENT_REMOVED",
      ),
    ).toBe(false);

    const conflict = res.decisions.correlations.find(
      (c) => c.correlationType === "DECISION_CONFLICTING_GOVERNANCE",
    );
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe("HIGH");
    expect(conflict?.details.conflictingAdrIds).toEqual(["ADR-030", "ADR-031"]);
  });
});
