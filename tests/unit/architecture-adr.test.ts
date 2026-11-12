import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { AdrDetector } from "../../scripts/architecture/adr-detector.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

describe("architecture-adr (Architecture Decision Record Extraction & Association)", () => {
  let connectionManager: ConnectionManager;
  let storageManager: StorageManager;
  const tempDirs: string[] = [];

  function createTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-adr-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    if (storageManager) await storageManager.close();
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  function createMockInventory(ws: string, files: string[]): FileInventoryResult {
    return {
      workspaceRoot: ws,
      scannedAt: new Date().toISOString(),
      scanStatus: "COMPLETE",
      files: files.map((f) => ({
        canonicalPath: f,
        fileExtension: path.posix.extname(f),
        classification: f.endsWith(".md") ? "documentation" : "source",
        sizeBytes: 500,
        mtimeMs: 1700000000000,
        contentHash: `hash_${f}`,
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
        totalBytesDiscovered: files.length * 500,
        totalBytesInspected: files.length * 500,
      },
      totalFilesScanned: files.length,
      totalBytesScanned: files.length * 500,
      limitExceeded: false,
      scanDurationMs: 10,
    };
  }

  it("extracts ADR metadata, status, date, phase, and links governed components", async () => {
    const ws = createTempWorkspace();
    const adrDir = path.join(ws, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });

    // Write sample ADR file
    const adrContent = `# ADR-007: Storage Engine, Deterministic Graph, and Architecture Intelligence

- **Status:** Accepted
- **Date:** 2026-11-12
- **Phase:** 7.3
- **Related:** [Part 14 Engineering Principles](../14-ENGINEERING-PRINCIPLES.md), [Storage Architecture](../34-STORAGE-ARCHITECTURE.md)

## Context
Frontier Engineer requires a durable storage layer in src/storage and graph engine in src/graph.
`;
    fs.writeFileSync(path.join(adrDir, "ADR-007-storage-and-graph-engine.md"), adrContent, "utf8");

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, [
      "docs/adr/ADR-007-storage-and-graph-engine.md",
      "src/storage/database.ts",
      "src/graph/graph-engine.ts",
    ]);

    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "adr-test",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();
    const adrs = AdrDetector.detect(db, repo.id, repo.activeScanId!, ws);

    expect(adrs.length).toBe(1);
    const adr = adrs[0];
    expect(adr.adrId).toBe("ADR-007");
    expect(adr.number).toBe(7);
    expect(adr.title).toBe("Storage Engine, Deterministic Graph, and Architecture Intelligence");
    expect(adr.status).toBe("Accepted");
    expect(adr.date).toBe("2026-11-12");
    expect(adr.phase).toBe("7.3");
    expect(adr.filePath).toBe("docs/adr/ADR-007-storage-and-graph-engine.md");
    expect(adr.confidence).toBe(1.0);
    expect(adr.relatedDocuments).toContain("../14-ENGINEERING-PRINCIPLES.md");
  });

  it("handles malformed or empty ADR files cleanly without throwing", async () => {
    const ws = createTempWorkspace();
    const adrDir = path.join(ws, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });

    // Empty file
    fs.writeFileSync(path.join(adrDir, "ADR-001-empty.md"), "", "utf8");
    // Non-standard file without headers
    fs.writeFileSync(
      path.join(adrDir, "ADR-002-no-meta.md"),
      "Just plain text without headers",
      "utf8",
    );

    connectionManager = new ConnectionManager({ workspaceRoot: ws });
    storageManager = new StorageManager(connectionManager);
    await storageManager.initialize();

    const inventory = createMockInventory(ws, [
      "docs/adr/ADR-001-empty.md",
      "docs/adr/ADR-002-no-meta.md",
    ]);

    await storageManager.persistSnapshot({
      repositoryIdentity: connectionManager.getRepository().identity,
      rootPath: ws,
      displayName: "adr-test-empty",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const db = connectionManager.getDatabase();
    const repo = connectionManager.getRepository();
    const adrs = AdrDetector.detect(db, repo.id, repo.activeScanId!, ws);

    // ADR-002 fallback-matches number 2 from filename, ADR-001 empty is skipped
    expect(adrs.length).toBe(1);
    expect(adrs[0].number).toBe(2);
    expect(adrs[0].status).toBe("Proposed");
  });
});
