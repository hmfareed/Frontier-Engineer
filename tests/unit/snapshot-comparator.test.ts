import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { SnapshotComparator } from "../../scripts/evolution/snapshot-comparator.ts";
import { ComparisonSerializer } from "../../scripts/evolution/comparison-serializer.ts";

describe("snapshot-comparator (Deterministic Multi-Domain Diff Engine)", () => {
  let connectionManager: ConnectionManager;
  let db: SqliteDatabase;
  let repoId: number;

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    await connectionManager.initialize();
    db = connectionManager.getDatabase();
    repoId = connectionManager.getRepository().id;
  });

  afterEach(async () => {
    connectionManager.close();
  });

  function createScan(startedAt: string, status = "COMPLETE"): number {
    const res = db
      .prepare(
        `INSERT INTO scan_runs (
          repository_id, started_at, completed_at, status, files_discovered,
          files_indexed, files_skipped, files_failed, diagnostic_count,
          scanner_version, extractor_version, is_active
        ) VALUES (?, ?, ?, ?, 10, 10, 0, 0, 0, '1.0.0', '1.0.0', 0)`,
      )
      .run(repoId, startedAt, new Date().toISOString(), status);
    return Number(res.lastInsertRowid);
  }

  function insertFile(
    scanId: number,
    normalizedPath: string,
    contentHash: string | null,
    options: {
      classification?: string;
      sensitivityStatus?: string;
      sizeBytes?: number;
      modifiedAt?: number;
    } = {},
  ): number {
    const ext = normalizedPath.slice(normalizedPath.lastIndexOf("."));
    const res = db
      .prepare(
        `INSERT INTO files (
          repository_id, scan_id, relative_path, normalized_path, extension,
          language, classification, size_bytes, modified_at, content_hash,
          sensitivity_status, index_status, indexed_at
        ) VALUES (?, ?, ?, ?, ?, 'typescript', ?, ?, ?, ?, ?, 'INDEXED', ?)`,
      )
      .run(
        repoId,
        scanId,
        normalizedPath,
        normalizedPath,
        ext,
        options.classification ?? "source",
        options.sizeBytes ?? 200,
        options.modifiedAt ?? 1700000000000,
        contentHash,
        options.sensitivityStatus ?? (contentHash === null ? "SENSITIVE" : "SAFE"),
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  }

  function insertSymbol(
    scanId: number,
    fileId: number,
    symbolIdentity: string,
    name: string,
    kind: string,
    fingerprint: string,
    options: {
      scope?: string | null;
      startLine?: number;
      endLine?: number;
      confidence?: number;
    } = {},
  ): number {
    const res = db
      .prepare(
        `INSERT INTO symbols (
          repository_id, scan_id, file_id, symbol_identity, name,
          kind, scope, parent_symbol_id, is_exported, start_line,
          end_line, start_column, end_column, fingerprint, confidence,
          extraction_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, null, 1, ?, ?, 0, 1, ?, ?, 'SUCCESS')`,
      )
      .run(
        repoId,
        scanId,
        fileId,
        symbolIdentity,
        name,
        kind,
        options.scope ?? null,
        options.startLine ?? 1,
        options.endLine ?? 10,
        fingerprint,
        options.confidence ?? 1.0,
      );
    return Number(res.lastInsertRowid);
  }

  function insertImport(
    scanId: number,
    sourceFileId: number,
    specifier: string,
    resolvedFileId: number | null,
    resolutionStatus: "RESOLVED" | "UNRESOLVED" | "EXTERNAL" | "BUILTIN" | "DEGRADED" = "RESOLVED",
    importKind = "static",
  ): number {
    const res = db
      .prepare(
        `INSERT INTO imports (
          repository_id, scan_id, source_file_id, imported_specifier,
          import_kind, resolved_file_id, resolution_status, start_line,
          end_line, evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 2, null)`,
      )
      .run(repoId, scanId, sourceFileId, specifier, importKind, resolvedFileId, resolutionStatus);
    return Number(res.lastInsertRowid);
  }

  describe("File Diff Domain", () => {
    it("classifies added, deleted, modified, and unchanged files accurately", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // File unchanged
      insertFile(baseScan, "src/common.ts", "hash_common_1");
      insertFile(targetScan, "src/common.ts", "hash_common_1");

      // File modified
      insertFile(baseScan, "src/index.ts", "hash_index_1");
      insertFile(targetScan, "src/index.ts", "hash_index_2");

      // File deleted
      insertFile(baseScan, "src/legacy.ts", "hash_legacy_1");

      // File added
      insertFile(targetScan, "src/new-feature.ts", "hash_new_1");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      expect(comparison.summary.files.added).toBe(1);
      expect(comparison.summary.files.modified).toBe(1);
      expect(comparison.summary.files.deleted).toBe(1);
      expect(comparison.summary.files.unchanged).toBe(1);

      const changes = comparison.files.changes;
      expect(changes.find((c) => c.path === "src/new-feature.ts")?.changeType).toBe("ADDED");
      expect(changes.find((c) => c.path === "src/legacy.ts")?.changeType).toBe("DELETED");
      expect(changes.find((c) => c.path === "src/index.ts")?.changeType).toBe("MODIFIED");
    });

    it("treats timestamp-only changes with identical content hash as UNCHANGED (no false modifications)", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // Same hash, but modifiedAt changed by 10 minutes
      insertFile(baseScan, "src/touch.ts", "hash_same", { modifiedAt: 1700000000000 });
      insertFile(targetScan, "src/touch.ts", "hash_same", { modifiedAt: 1700000600000 });

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { includeUnchanged: true });

      expect(comparison.summary.files.modified).toBe(0);
      expect(comparison.summary.files.unchanged).toBe(1);

      const item = comparison.files.changes.find((c) => c.path === "src/touch.ts");
      expect(item?.changeType).toBe("UNCHANGED");
    });

    it("protects sensitive files: suppresses secret hashes and handles metadata shifts safely", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // Sensitive file with size change (e.g. .env.vault)
      insertFile(baseScan, ".env.vault", null, {
        sensitivityStatus: "SENSITIVE",
        classification: "sensitive",
        sizeBytes: 100,
      });
      insertFile(targetScan, ".env.vault", null, {
        sensitivityStatus: "SENSITIVE",
        classification: "sensitive",
        sizeBytes: 150,
      });

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      const item = comparison.files.changes.find((c) => c.path === ".env.vault");
      expect(item?.changeType).toBe("MODIFIED");
      expect(item?.baseHash).toBeNull();
      expect(item?.targetHash).toBeNull();

      expect(
        comparison.limitations.some((l) => l.code === "LIM_SENSITIVE_FILE_CONTENT_UNINSPECTABLE"),
      ).toBe(true);
    });

    it("detects exact unique renames deterministically and rejects ambiguous candidates", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // Unique rename: old-utils.ts -> utils.ts with exact matching hash
      insertFile(baseScan, "src/old-utils.ts", "hash_unique_utils");
      insertFile(targetScan, "src/utils.ts", "hash_unique_utils");

      // Ambiguous rename: two deleted files and two added files all sharing 'hash_empty_barrel'
      insertFile(baseScan, "src/a/empty.ts", "hash_empty_barrel");
      insertFile(baseScan, "src/b/empty.ts", "hash_empty_barrel");
      insertFile(targetScan, "src/c/empty.ts", "hash_empty_barrel");
      insertFile(targetScan, "src/d/empty.ts", "hash_empty_barrel");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { detectRenames: true });

      // Unique rename detected
      const renamed = comparison.files.changes.find((c) => c.path === "src/utils.ts");
      expect(renamed?.isInferredRename).toBe(true);
      expect(renamed?.renameSourcePath).toBe("src/old-utils.ts");
      expect(renamed?.renameConfidence).toBe(0.95);
      expect(comparison.summary.files.renamed).toBe(1);

      // Ambiguous candidates preserved as separate ADDED and DELETED without false inference
      const ambAdd = comparison.files.changes.find((c) => c.path === "src/c/empty.ts");
      expect(ambAdd?.isInferredRename).toBeUndefined();
      expect(comparison.limitations.some((l) => l.code === "LIM_AMBIGUOUS_RENAME_CANDIDATES")).toBe(
        true,
      );
    });
  });

  describe("Symbol Diff Domain", () => {
    it("preserves AST fingerprint invariance: comment-only and line shifts are UNCHANGED", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      const f1Base = insertFile(baseScan, "src/calc.ts", "hash1");
      const f1Target = insertFile(targetScan, "src/calc.ts", "hash2");

      // Symbol in base: lines 1-10, fingerprint fp_calc
      insertSymbol(baseScan, f1Base, "sym:src/calc.ts#add", "add", "function", "fp_calc", {
        startLine: 1,
        endLine: 10,
      });

      // Symbol in target: comments added above shifted lines to 15-24, but fingerprint remains fp_calc
      insertSymbol(targetScan, f1Target, "sym:src/calc.ts#add", "add", "function", "fp_calc", {
        startLine: 15,
        endLine: 24,
      });

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { includeUnchanged: true });

      expect(comparison.summary.symbols.modified).toBe(0);
      expect(comparison.summary.symbols.unchanged).toBe(1);

      const sym = comparison.symbols.changes.find(
        (s) => s.symbolIdentity === "sym:src/calc.ts#add",
      );
      expect(sym?.changeType).toBe("UNCHANGED");
      expect(sym?.baseLines?.startLine).toBe(1);
      expect(sym?.targetLines?.startLine).toBe(15);
    });

    it("detects unique symbol relocation across files and rejects ambiguous candidates", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      const fOld = insertFile(baseScan, "src/helpers.ts", "h1");
      const fNew = insertFile(targetScan, "src/core/helpers.ts", "h2");

      // Unique relocation: helperFunc moved from helpers.ts to core/helpers.ts
      insertSymbol(
        baseScan,
        fOld,
        "sym:src/helpers.ts#helperFunc",
        "helperFunc",
        "function",
        "fp_helper_func",
      );
      insertSymbol(
        targetScan,
        fNew,
        "sym:src/core/helpers.ts#helperFunc",
        "helperFunc",
        "function",
        "fp_helper_func",
      );

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { detectRelocations: true });

      expect(comparison.summary.symbols.relocated).toBe(1);
      const reloc = comparison.symbols.changes.find(
        (s) => s.symbolIdentity === "sym:src/core/helpers.ts#helperFunc",
      );
      expect(reloc?.changeType).toBe("RELOCATED");
      expect(reloc?.basePath).toBe("src/helpers.ts");
      expect(reloc?.targetPath).toBe("src/core/helpers.ts");
    });

    it("marks ambiguous relocation across files without inventing relationships", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      const fOld1 = insertFile(baseScan, "src/mod1.ts", "h1");
      const fOld2 = insertFile(baseScan, "src/mod2.ts", "h2");
      const fNew1 = insertFile(targetScan, "src/dest1.ts", "h3");
      const fNew2 = insertFile(targetScan, "src/dest2.ts", "h4");

      // Duplicate symbol signatures with same fingerprint across files
      insertSymbol(baseScan, fOld1, "sym:src/mod1.ts#init", "init", "function", "fp_common_init");
      insertSymbol(baseScan, fOld2, "sym:src/mod2.ts#init", "init", "function", "fp_common_init");
      insertSymbol(
        targetScan,
        fNew1,
        "sym:src/dest1.ts#init",
        "init",
        "function",
        "fp_common_init",
      );
      insertSymbol(
        targetScan,
        fNew2,
        "sym:src/dest2.ts#init",
        "init",
        "function",
        "fp_common_init",
      );

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { detectRelocations: true });

      // Ambiguity prevents false relocation pairing
      expect(comparison.summary.symbols.relocated).toBe(0);
      expect(comparison.summary.symbols.removed).toBe(2);
      expect(comparison.summary.symbols.added).toBe(2);
      expect(comparison.limitations.some((l) => l.code === "LIM_AMBIGUOUS_SYMBOL_RELOCATION")).toBe(
        true,
      );
    });
  });

  describe("Dependency Diff Domain", () => {
    it("preserves unresolved imports explicitly and detects target changes", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      const fAppBase = insertFile(baseScan, "src/app.ts", "h_app1");
      const fTarget1 = insertFile(baseScan, "src/lib/v1.ts", "h_v1");

      const fAppTarget = insertFile(targetScan, "src/app.ts", "h_app2");
      const fTarget2 = insertFile(targetScan, "src/lib/v2.ts", "h_v2");

      // Import modified: switched from v1.ts to v2.ts
      insertImport(baseScan, fAppBase, "./lib", fTarget1, "RESOLVED");
      insertImport(targetScan, fAppTarget, "./lib", fTarget2, "RESOLVED");

      // Unresolved import newly added
      insertImport(targetScan, fAppTarget, "./missing-pkg", null, "UNRESOLVED");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      expect(comparison.summary.dependencies.modified).toBe(1);
      expect(comparison.summary.dependencies.unresolved).toBe(1);

      const mod = comparison.dependencies.changes.find((d) => d.specifier === "./lib");
      expect(mod?.changeType).toBe("MODIFIED");
      expect(mod?.baseResolvedPath).toBe("src/lib/v1.ts");
      expect(mod?.targetResolvedPath).toBe("src/lib/v2.ts");

      const unres = comparison.dependencies.changes.find((d) => d.specifier === "./missing-pkg");
      expect(unres?.changeType).toBe("UNRESOLVED");
    });
  });

  describe("Component & ADR Diff Domain", () => {
    it("detects architectural component membership changes", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // Base component files
      insertFile(baseScan, "src/api/users.ts", "h1");
      insertFile(baseScan, "src/api/auth.ts", "h2");

      // Target component files: auth.ts removed, billing.ts added
      insertFile(targetScan, "src/api/users.ts", "h1");
      insertFile(targetScan, "src/api/billing.ts", "h3");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      const comp = comparison.components.changes.find(
        (c) => c.componentIdentity === "comp:src/api",
      );
      expect(comp?.changeType).toBe("MODIFIED");
      expect(comp?.addedMemberFiles).toContain("src/api/billing.ts");
      expect(comp?.removedMemberFiles).toContain("src/api/auth.ts");
      expect(comp?.unchangedMemberFiles).toContain("src/api/users.ts");
    });

    it("detects ADR additions, removals, and content hash modifications without interpretation", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // ADR modified
      insertFile(baseScan, "docs/adr/ADR-001-architecture.md", "hash_adr1_v1");
      insertFile(targetScan, "docs/adr/ADR-001-architecture.md", "hash_adr1_v2");

      // ADR added
      insertFile(targetScan, "docs/adr/ADR-002-persistence.md", "hash_adr2_v1");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      expect(comparison.summary.adrs.added).toBe(1);
      expect(comparison.summary.adrs.modified).toBe(1);

      const adr1 = comparison.adrs.changes.find((a) => a.number === 1);
      expect(adr1?.changeType).toBe("MODIFIED");

      const adr2 = comparison.adrs.changes.find((a) => a.number === 2);
      expect(adr2?.changeType).toBe("ADDED");
    });
  });

  describe("Determinism & Serialization", () => {
    it("produces identical comparison results and ordering when insertion order is shuffled", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      // Insert files in reverse order
      insertFile(baseScan, "src/z.ts", "hz");
      insertFile(baseScan, "src/a.ts", "ha");
      insertFile(targetScan, "src/a.ts", "ha_mod");
      insertFile(targetScan, "src/z.ts", "hz");

      const comparator = new SnapshotComparator(db);
      const res1 = comparator.compare(baseScan, targetScan);
      const res2 = comparator.compare(baseScan, targetScan);

      expect(res1.comparisonId).toBe(res2.comparisonId);
      expect(res1.summary).toEqual(res2.summary);

      // Verify strict path ordering in output
      expect(res1.files.changes[0].path).toBe("src/a.ts");
      expect(res1.files.changes.length).toBe(1); // modified 'src/a.ts', unchanged excluded by default

      // Serialized output match (normalizing the runtime execution timestamp)
      res1.comparedAt = "2026-11-13T00:00:00.000Z";
      res2.comparedAt = "2026-11-13T00:00:00.000Z";
      const json1 = ComparisonSerializer.serialize(res1);
      const json2 = ComparisonSerializer.serialize(res2);
      expect(json1).toBe(json2);

      // Serializer omits undefined optional keys cleanly instead of turning them into null
      const parsed = JSON.parse(json1);
      expect("isInferredRename" in parsed.files.changes[0]).toBe(false);
    });
  });

  describe("Historical Correctness, Partial Snapshots & Summary Reconciliation", () => {
    it("verifies ADR disk content against indexed SHA-256 hash and isolates stale disk rewrites", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-adr-history-"));
      try {
        const adrDir = path.join(tempDir, "docs", "adr");
        fs.mkdirSync(adrDir, { recursive: true });

        const adrV1 = `# ADR-001: Storage Engine\n\n- **Status:** Proposed\n- **Date:** 2026-11-01\n\nInitial proposal.\n`;
        const adrV2 = `# ADR-001: Storage Engine\n\n- **Status:** Accepted\n- **Date:** 2026-11-02\n\nAccepted design.\n`;
        const hashV1 = createHash("sha256").update(adrV1, "utf8").digest("hex");
        const hashV2 = createHash("sha256").update(adrV2, "utf8").digest("hex");

        // Current disk holds v2 (simulating a workspace at target snapshot state while comparing historical snapshots)
        fs.writeFileSync(path.join(adrDir, "ADR-001-storage.md"), adrV2, "utf8");

        const baseScan = createScan("2026-11-01T10:00:00.000Z");
        const targetScan = createScan("2026-11-02T10:00:00.000Z");

        insertFile(baseScan, "docs/adr/ADR-001-storage.md", hashV1, { classification: "doc" });
        insertFile(targetScan, "docs/adr/ADR-001-storage.md", hashV2, { classification: "doc" });

        const comparator = new SnapshotComparator(db);
        const comparison = comparator.compare(baseScan, targetScan, { workspaceRoot: tempDir });

        expect(comparison.summary.adrs.modified).toBe(1);
        const adrChange = comparison.adrs.changes.find((a) => a.adrId === "ADR-001");
        expect(adrChange?.changeType).toBe("MODIFIED");
        // Target matches disk v2 so its parsed status is Accepted; base hash != disk v2 so base MUST NOT inherit disk "Accepted" or fabricate "PROPOSED"
        expect(adrChange?.targetStatus).toBe("Accepted");
        expect(adrChange?.baseStatus).toBeUndefined();
        expect(adrChange?.isFallback).toBe(true);
        expect(
          comparison.limitations.some((l) => l.code === "LIM_ADR_HISTORICAL_CONTENT_FALLBACK"),
        ).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("withholds verified MODIFIED/UNCHANGED classification when non-sensitive file or ADR lacks historical hash", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      insertFile(baseScan, "src/nohash.ts", null, { sensitivityStatus: "SAFE" });
      insertFile(targetScan, "src/nohash.ts", "h_target", { sensitivityStatus: "SAFE" });

      insertFile(baseScan, "docs/adr/ADR-003-missing-hash.md", null, {
        sensitivityStatus: "SAFE",
        classification: "doc",
      });
      insertFile(targetScan, "docs/adr/ADR-003-missing-hash.md", "h_adr3_target", {
        sensitivityStatus: "SAFE",
        classification: "doc",
      });

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { includeUnchanged: true });

      expect(comparison.summary.files.modified).toBe(0);
      expect(comparison.summary.files.unchanged).toBe(0);
      expect(comparison.files.changes.length).toBe(0);
      expect(
        comparison.limitations.some((l) => l.code === "LIM_FILE_MISSING_HISTORICAL_HASH"),
      ).toBe(true);

      expect(comparison.summary.adrs.modified).toBe(0);
      expect(comparison.summary.adrs.unchanged).toBe(0);
      expect(comparison.adrs.changes.length).toBe(0);
      expect(comparison.limitations.some((l) => l.code === "LIM_ADR_MISSING_HISTORICAL_HASH")).toBe(
        true,
      );
    });

    it("marks comparison status PARTIAL and emits LIM_PARTIAL_SNAPSHOT_COMPARISON when comparing partial scans", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z", "PARTIAL");
      const targetScan = createScan("2026-11-02T10:00:00.000Z", "COMPLETE");

      insertFile(baseScan, "src/a.ts", "h1");
      insertFile(targetScan, "src/a.ts", "h2");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan, { allowPartial: true });

      expect(comparison.status).toBe("PARTIAL");
      expect(comparison.baseSnapshot.status).toBe("PARTIAL");
      expect(comparison.targetSnapshot.status).toBe("COMPLETE");
      const partialLim = comparison.limitations.find(
        (l) => l.code === "LIM_PARTIAL_SNAPSHOT_COMPARISON",
      );
      expect(partialLim).toBeDefined();
      expect(partialLim?.domain).toBe("snapshot");
      expect(partialLim?.affectedEntityCount).toBe(1);
    });

    it("reconciles summary counts with detailed change collections across all 5 domains", () => {
      const baseScan = createScan("2026-11-01T10:00:00.000Z");
      const targetScan = createScan("2026-11-02T10:00:00.000Z");

      const fKeepBase = insertFile(baseScan, "src/api/keep.ts", "h_keep");
      const fModBase = insertFile(baseScan, "src/api/mod.ts", "h_mod_1");
      insertFile(baseScan, "src/api/del.ts", "h_del");
      insertFile(baseScan, "docs/adr/ADR-001-base.md", "h_adr1_1", { classification: "doc" });

      const fKeepTarget = insertFile(targetScan, "src/api/keep.ts", "h_keep");
      const fModTarget = insertFile(targetScan, "src/api/mod.ts", "h_mod_2");
      insertFile(targetScan, "src/api/add.ts", "h_add");
      insertFile(targetScan, "docs/adr/ADR-001-base.md", "h_adr1_2", { classification: "doc" });
      insertFile(targetScan, "docs/adr/ADR-002-new.md", "h_adr2_1", { classification: "doc" });

      insertSymbol(baseScan, fModBase, "sym:mod", "fnMod", "function", "fp1");
      insertSymbol(targetScan, fModTarget, "sym:mod", "fnMod", "function", "fp2");

      // Persistent unresolved import AND newly added unresolved import
      insertImport(baseScan, fKeepBase, "./still-missing", null, "UNRESOLVED");
      insertImport(targetScan, fKeepTarget, "./still-missing", null, "UNRESOLVED");
      insertImport(targetScan, fModTarget, "./new-missing", null, "UNRESOLVED");

      const comparator = new SnapshotComparator(db);
      const comparison = comparator.compare(baseScan, targetScan);

      expect(comparison.summary.files.added).toBe(
        comparison.files.changes.filter((c) => c.changeType === "ADDED").length,
      );
      expect(comparison.summary.files.modified).toBe(
        comparison.files.changes.filter((c) => c.changeType === "MODIFIED").length,
      );
      expect(comparison.summary.files.deleted).toBe(
        comparison.files.changes.filter((c) => c.changeType === "DELETED").length,
      );

      expect(comparison.summary.symbols.modified).toBe(
        comparison.symbols.changes.filter((c) => c.changeType === "MODIFIED").length,
      );

      // Persistent + newly added UNRESOLVED imports must reconcile and not double-count into ADDED
      expect(comparison.summary.dependencies.added).toBe(
        comparison.dependencies.changes.filter((d) => d.changeType === "ADDED").length,
      );
      expect(comparison.summary.dependencies.added).toBe(0);
      expect(comparison.summary.dependencies.unresolved).toBe(2);
      expect(
        comparison.dependencies.changes.filter((d) => d.changeType === "UNRESOLVED").length,
      ).toBe(comparison.summary.dependencies.unresolved);

      expect(comparison.summary.components.modified).toBe(
        comparison.components.changes.filter((c) => c.changeType === "MODIFIED").length,
      );

      expect(comparison.summary.adrs.added).toBe(
        comparison.adrs.changes.filter((a) => a.changeType === "ADDED").length,
      );
      expect(comparison.summary.adrs.modified).toBe(
        comparison.adrs.changes.filter((a) => a.changeType === "MODIFIED").length,
      );
    });
  });
});
