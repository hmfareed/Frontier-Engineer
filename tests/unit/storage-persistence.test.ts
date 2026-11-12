import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import {
  ScanStore,
  FileStore,
  SymbolStore,
  ImportStore,
  ExportStore,
  EvidenceStore,
} from "../../scripts/storage/repositories/index.ts";
import type { ScannedFileRecord } from "../../scripts/scanner/types.ts";
import type {
  ExtractedSymbol,
  ImportRecord as ExtractorImportRecord,
  ExportRecord as ExtractorExportRecord,
} from "../../scripts/extractor/types.ts";

describe("storage-persistence (Structural Repositories & Security Guarantees)", () => {
  let db: SqliteDatabase;
  let scanStore: ScanStore;
  let fileStore: FileStore;
  let symbolStore: SymbolStore;
  let importStore: ImportStore;
  let exportStore: ExportStore;
  let evidenceStore: EvidenceStore;
  let repoId: number;
  let scanId: number;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    scanStore = new ScanStore(db);
    fileStore = new FileStore(db);
    symbolStore = new SymbolStore(db);
    importStore = new ImportStore(db);
    exportStore = new ExportStore(db);
    evidenceStore = new EvidenceStore(db);

    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "repo_persistence_test",
        "/repo",
        "TestRepo",
        new Date().toISOString(),
        new Date().toISOString(),
        1,
      );
    repoId = Number(repoRes.lastInsertRowid);

    const scan = scanStore.createScanRun({
      repositoryId: repoId,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });
    scanId = scan.id;
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  it("persists file inventory and nullifies content_hash for sensitive files", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/main.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 1024,
        mtimeMs: 1700000000000,
        contentHash: "hash_main_123",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: ".env",
        fileExtension: "",
        classification: "sensitive",
        sizeBytes: 50,
        mtimeMs: 1700000000000,
        contentHash: "hash_secret_should_be_nulled",
        hashState: "SKIPPED_SENSITIVE",
        inspectionStatus: "EXCLUDED_CONTENT",
        exclusionStatus: "EXCLUDED_CONTENT",
        exclusionReason: "Sensitive file",
      },
    ];

    const pathToId = fileStore.insertFiles(repoId, scanId, files);
    expect(pathToId.size).toBe(2);

    const mainFile = fileStore.getFileByPath(scanId, "src/main.ts");
    expect(mainFile).not.toBeNull();
    expect(mainFile?.contentHash).toBe("hash_main_123");
    expect(mainFile?.sensitivityStatus).toBe("SAFE");
    expect(mainFile?.language).toBe("typescript");

    const envFile = fileStore.getFileByPath(scanId, ".env");
    expect(envFile).not.toBeNull();
    // Security check: content_hash MUST be null for sensitive files
    expect(envFile?.contentHash).toBeNull();
    expect(envFile?.sensitivityStatus).toBe("SENSITIVE");
  });

  it("persists symbols, builds hierarchy, and associates source evidence", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/service.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 500,
        mtimeMs: 1700000000000,
        contentHash: "hash_srv",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];
    const pathToId = fileStore.insertFiles(repoId, scanId, files);
    const fileId = pathToId.get("src/service.ts")!;

    const symbols: ExtractedSymbol[] = [
      {
        symbolId: "sym:src/service.ts#AuthService",
        name: "AuthService",
        kind: "class",
        parentScope: null,
        fingerprint: "fp_auth_class",
        isExported: true,
        sourceEvidence: {
          lineStart: 5,
          lineEnd: 25,
          colStart: 0,
          colEnd: 1,
          evidenceHash: "ev_1",
        },
      },
      {
        symbolId: "sym:src/service.ts#AuthService.login",
        name: "login",
        kind: "method",
        parentScope: "AuthService",
        fingerprint: "fp_auth_login",
        isExported: false,
        sourceEvidence: {
          lineStart: 10,
          lineEnd: 15,
          colStart: 2,
          colEnd: 3,
          evidenceHash: "ev_2",
        },
      },
    ];

    const symbolMap = symbolStore.insertSymbols({
      repositoryId: repoId,
      scanId,
      fileId,
      symbols,
      evidenceStore,
    });

    expect(symbolMap.size).toBe(2);
    const allSymbols = symbolStore.getSymbols(scanId, fileId);
    expect(allSymbols.length).toBe(2);

    const classSym = allSymbols.find((s) => s.name === "AuthService")!;
    const methodSym = allSymbols.find((s) => s.name === "login")!;

    expect(classSym.isExported).toBe(true);
    expect(methodSym.parentSymbolId).toBe(classSym.id);

    // Verify evidence created
    const evidenceList = evidenceStore.getEvidenceForFile(fileId);
    expect(evidenceList.length).toBe(2);
    expect(evidenceList[0].evidenceDescription).toContain("AuthService");
  });

  it("persists imports, resolves internal targets, and tracks unresolved imports explicitly", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/index.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 200,
        mtimeMs: 1700000000000,
        contentHash: "hash_idx",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
      {
        canonicalPath: "src/utils.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 150,
        mtimeMs: 1700000000000,
        contentHash: "hash_utl",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];
    const pathToId = fileStore.insertFiles(repoId, scanId, files);
    const indexFileId = pathToId.get("src/index.ts")!;

    const imports: ExtractorImportRecord[] = [
      {
        specifier: "./utils.ts",
        resolvedPath: "src/utils.ts",
        importedSymbols: [{ name: "formatDate" }],
        isTypeOnly: false,
        isDynamic: false,
        evidenceClassification: "syntactic_ast",
        sourceEvidence: {
          lineStart: 1,
          lineEnd: 1,
          colStart: 0,
          colEnd: 30,
          evidenceHash: "ev_imp1",
        },
      },
      {
        specifier: "node:fs",
        resolvedPath: null,
        importedSymbols: [{ name: "readFileSync" }],
        isTypeOnly: false,
        isDynamic: false,
        evidenceClassification: "external_or_missing",
      },
      {
        specifier: "./missing-module.ts",
        resolvedPath: null,
        importedSymbols: "*",
        isTypeOnly: false,
        isDynamic: false,
        evidenceClassification: "external_or_missing",
      },
    ];

    importStore.insertImports({
      repositoryId: repoId,
      scanId,
      sourceFileId: indexFileId,
      imports,
      pathToId,
      evidenceStore,
    });

    const allImports = importStore.getImports(scanId, indexFileId);
    expect(allImports.length).toBe(3);

    const resolved = allImports.find((i) => i.importedSpecifier === "./utils.ts")!;
    expect(resolved.resolutionStatus).toBe("RESOLVED");
    expect(resolved.resolvedFileId).toBe(pathToId.get("src/utils.ts"));

    const builtin = allImports.find((i) => i.importedSpecifier === "node:fs")!;
    expect(builtin.resolutionStatus).toBe("BUILTIN");

    const unresolved = importStore.getUnresolvedImports(scanId);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].importedSpecifier).toBe("./missing-module.ts");
    expect(unresolved[0].resolutionStatus).toBe("UNRESOLVED");
  });

  it("persists exports and sanitizes secret descriptions in evidence", () => {
    const files: ScannedFileRecord[] = [
      {
        canonicalPath: "src/api.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 200,
        mtimeMs: 1700000000000,
        contentHash: "hash_api",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];
    const pathToId = fileStore.insertFiles(repoId, scanId, files);
    const fileId = pathToId.get("src/api.ts")!;

    const exports: ExtractorExportRecord[] = [
      {
        name: "default",
        localName: "apiHandler",
        isReExport: false,
        sourceModule: null,
        isTypeOnly: false,
        isWildcard: false,
        sourceEvidence: {
          lineStart: 20,
          lineEnd: 20,
          colStart: 0,
          colEnd: 25,
          evidenceHash: "ev_exp",
        },
      },
    ];

    exportStore.insertExports({
      repositoryId: repoId,
      scanId,
      fileId,
      exports,
      symbolMap: new Map(),
      evidenceStore,
    });

    const allExports = exportStore.getExports(scanId, fileId);
    expect(allExports.length).toBe(1);
    expect(allExports[0].exportName).toBe("default");
    expect(allExports[0].isDefault).toBe(true);
    expect(allExports[0].exportKind).toBe("default");

    // Test secret sanitization in evidenceStore
    const evId = evidenceStore.insertEvidence({
      repositoryId: repoId,
      scanId,
      fileId,
      evidence: { lineStart: 1, lineEnd: 1, colStart: 0, colEnd: 10, evidenceHash: "ev_sec" },
      evidenceType: "config",
      description: 'Found apiKey: "super_secret_token_12345" in header',
    });

    const ev = evidenceStore.getEvidenceById(evId);
    expect(ev?.evidenceDescription).not.toContain("super_secret_token_12345");
    expect(ev?.evidenceDescription).toContain("[REDACTED]");
  });
});
