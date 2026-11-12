import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { ArchitectureAnalyzer } from "../../scripts/architecture/architecture-analyzer.ts";
import type { SnapshotInput } from "../../scripts/storage/types.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";
import type { ExtractionResult } from "../../scripts/extractor/types.ts";

describe("architecture-analyzer (Deterministic Architecture Intelligence)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  let architectureAnalyzer: ArchitectureAnalyzer;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-arch-test-"));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    connectionManager = new ConnectionManager({
      workspaceRoot: process.cwd(),
      inMemory: true,
    });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const db = connectionManager.getDatabase();
    architectureAnalyzer = new ArchitectureAnalyzer(db);
  });

  afterEach(async () => {
    await storageManager.close();
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  function createMockInventory(files: { path: string; size: number }[]): FileInventoryResult {
    return {
      workspaceRoot: process.cwd(),
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f.path,
        fileExtension: path.posix.extname(f.path),
        classification: "source",
        sizeBytes: f.size,
        mtimeMs: 1700000000000,
        contentHash: `hash_${f.path}`,
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      })),
      summary: {
        totalFilesDiscovered: files.length,
        totalFilesInspected: files.length,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: 1000,
        totalBytesInspected: 1000,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: 1000,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("detects entrypoints from manifests and framework conventions", async () => {
    const ws = createTempWorkspace();
    // Write a mock package.json
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({
        name: "my-service",
        main: "./dist/index.js",
        bin: { "my-cli": "./bin/cli.js" },
        scripts: { start: "node src/server.js" },
      }),
      "utf8",
    );

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory = createMockInventory([
      { path: "dist/index.js", size: 500 },
      { path: "bin/cli.js", size: 300 },
      { path: "src/server.js", size: 800 },
      { path: "app/page.tsx", size: 400 },
    ]);

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "my-service",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const analyzer = new ArchitectureAnalyzer(cm.getDatabase());
    const entrypoints = await analyzer.getEntrypoints(cm.getRepository().id);

    expect(entrypoints.length).toBeGreaterThanOrEqual(4);

    const cliEntry = entrypoints.find((e) => e.filePath === "bin/cli.js")!;
    expect(cliEntry.type).toBe("cli");
    expect(cliEntry.status).toBe("CONFIRMED");

    const srvEntry = entrypoints.find((e) => e.filePath === "src/server.js")!;
    expect(srvEntry.type).toBe("server");
    expect(srvEntry.status).toBe("CONFIRMED");

    const browserEntry = entrypoints.find((e) => e.filePath === "app/page.tsx")!;
    expect(browserEntry.type).toBe("browser");
    expect(browserEntry.status).toBe("CONFIRMED");

    await sm.close();
  });

  it("conservatively classifies components and distinguishes confirmed from inferred", async () => {
    const repo = connectionManager.getRepository();

    const inventory = createMockInventory([
      // Confirmed frontend (has .tsx)
      { path: "src/components/Header.tsx", size: 200 },
      // Confirmed database (has .sql)
      { path: "src/db/schema.sql", size: 500 },
      // Inferred backend (named backend without direct server imports)
      { path: "src/backend/helper.ts", size: 100 },
      // Confirmed test suite
      { path: "tests/unit/header.test.tsx", size: 300 },
    ]);

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const components = await architectureAnalyzer.getComponents(repo.id);

    const compHeader = components.find((c) => c.rootPath === "src/components")!;
    expect(compHeader.category).toBe("frontend");
    expect(compHeader.status).toBe("CONFIRMED");

    const compDb = components.find((c) => c.rootPath === "src/db")!;
    expect(compDb.category).toBe("database");
    expect(compDb.status).toBe("CONFIRMED");

    const compBackend = components.find((c) => c.rootPath === "src/backend")!;
    expect(compBackend.category).toBe("backend");
    expect(compBackend.status).toBe("INFERRED");
    expect(compBackend.confidence).toBeLessThan(0.8);

    const compTest = components.find((c) => c.rootPath === "tests")!;
    expect(compTest.category).toBe("test");
    expect(compTest.status).toBe("CONFIRMED");
  });

  it("detects circular dependencies and reports test associations", async () => {
    const repo = connectionManager.getRepository();

    const inventory = createMockInventory([
      { path: "src/moduleA.ts", size: 200 },
      { path: "src/moduleB.ts", size: 200 },
      { path: "tests/unit/moduleA.test.ts", size: 300 },
    ]);

    const extractions = new Map<string, ExtractionResult>();
    // Circular dependency: moduleA -> moduleB -> moduleA
    extractions.set("src/moduleA.ts", {
      canonicalPath: "src/moduleA.ts",
      symbols: [],
      imports: [
        {
          specifier: "./moduleB.ts",
          resolvedPath: "src/moduleB.ts",
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    extractions.set("src/moduleB.ts", {
      canonicalPath: "src/moduleB.ts",
      symbols: [],
      imports: [
        {
          specifier: "./moduleA.ts",
          resolvedPath: "src/moduleA.ts",
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    // Test file imports moduleA
    extractions.set("tests/unit/moduleA.test.ts", {
      canonicalPath: "tests/unit/moduleA.test.ts",
      symbols: [],
      imports: [
        {
          specifier: "../../src/moduleA.ts",
          resolvedPath: "src/moduleA.ts",
          importedSymbols: "*",
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    await storageManager.persistSnapshot({
      repositoryIdentity: repo.identity,
      rootPath: repo.rootPath,
      displayName: repo.displayName,
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const analysis = await architectureAnalyzer.analyze(repo.id);

    // 1. Check circular dependency detection
    expect(analysis.dependencyReport.circularDependencyCandidates.length).toBeGreaterThan(0);
    const cycle = analysis.dependencyReport.circularDependencyCandidates[0];
    expect(cycle.cycle).toContain("src/moduleA.ts");
    expect(cycle.cycle).toContain("src/moduleB.ts");

    // 2. Check test association
    expect(analysis.testAssociations.length).toBeGreaterThan(0);
    const assoc = analysis.testAssociations.find(
      (a) =>
        a.testFilePath === "tests/unit/moduleA.test.ts" && a.sourceFilePath === "src/moduleA.ts",
    )!;
    expect(assoc.associationStatus).toBe("CONFIRMED");
    expect(assoc.evidenceType).toBe("import_evidence");

    // 3. Check findings conformance
    const cycleFinding = analysis.findings.find((f) => f.category === "circular_dependency");
    expect(cycleFinding).toBeDefined();
    expect(cycleFinding?.status).toBe("CONFIRMED");
  });

  it("distinguishes confirmed from inferred boundaries for database and authentication", async () => {
    const ws = createTempWorkspace();
    fs.writeFileSync(path.join(ws, "package.json"), "{}", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory = createMockInventory([
      // ORM import alone: src/orm-service/client.ts
      { path: "src/orm-service/client.ts", size: 200 },
      // Confirmed DB: src/db-confirmed/schema.sql
      { path: "src/db-confirmed/schema.sql", size: 500 },
      // Auth package import alone: src/auth-service/token.ts
      { path: "src/auth-service/token.ts", size: 300 },
      // Confirmed Auth: src/auth-confirmed/middleware.ts
      { path: "src/auth-confirmed/middleware.ts", size: 400 },
    ]);

    const extractions = new Map<string, ExtractionResult>();

    // orm-service imports @prisma/client alone
    extractions.set("src/orm-service/client.ts", {
      canonicalPath: "src/orm-service/client.ts",
      symbols: [],
      imports: [
        {
          specifier: "@prisma/client",
          resolvedPath: null,
          importedSymbols: [{ name: "PrismaClient" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    // auth-service imports jsonwebtoken alone
    extractions.set("src/auth-service/token.ts", {
      canonicalPath: "src/auth-service/token.ts",
      symbols: [],
      imports: [
        {
          specifier: "jsonwebtoken",
          resolvedPath: null,
          importedSymbols: [{ name: "verify" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    // auth-confirmed imports jsonwebtoken and has middleware.ts
    extractions.set("src/auth-confirmed/middleware.ts", {
      canonicalPath: "src/auth-confirmed/middleware.ts",
      symbols: [],
      imports: [
        {
          specifier: "jsonwebtoken",
          resolvedPath: null,
          importedSymbols: [{ name: "verify" }],
          isTypeOnly: false,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
        },
      ],
      exports: [],
      callExpressions: [],
      status: "SUCCESS",
      diagnostics: [],
    });

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "db-auth-boundaries",
      inventory,
      extractions,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const analyzer = new ArchitectureAnalyzer(cm.getDatabase());
    const components = await analyzer.getComponents(cm.getRepository().id);

    // ORM import alone -> INFERRED database
    const ormComp = components.find((c) => c.rootPath === "src/orm-service")!;
    expect(ormComp.category).toBe("database");
    expect(ormComp.status).toBe("INFERRED");
    expect(ormComp.confidence).toBe(0.7);

    // SQL schema file -> CONFIRMED database
    const dbConfirmed = components.find((c) => c.rootPath === "src/db-confirmed")!;
    expect(dbConfirmed.category).toBe("database");
    expect(dbConfirmed.status).toBe("CONFIRMED");
    expect(dbConfirmed.confidence).toBe(0.95);

    // Auth package import alone -> INFERRED auth
    const authComp = components.find((c) => c.rootPath === "src/auth-service")!;
    expect(authComp.category).toBe("auth");
    expect(authComp.status).toBe("INFERRED");
    expect(authComp.confidence).toBe(0.7);

    // Auth package import + active middleware handler -> CONFIRMED auth
    const authConfirmed = components.find((c) => c.rootPath === "src/auth-confirmed")!;
    expect(authConfirmed.category).toBe("auth");
    expect(authConfirmed.status).toBe("CONFIRMED");
    expect(authConfirmed.confidence).toBe(0.95);

    await sm.close();
  });
});
