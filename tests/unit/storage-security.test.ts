import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { EvidenceStore } from "../../scripts/storage/repositories/evidence-store.ts";
import { FileStore } from "../../scripts/storage/repositories/file-store.ts";
import { ScanStore } from "../../scripts/storage/repositories/scan-store.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import type { ScannedFileRecord } from "../../scripts/scanner/types.ts";

describe("storage-security (Filesystem Boundaries, Symlinks & Secret Hygiene)", () => {
  const tempDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  it("detects and blocks symlink redirection of .frontier outside workspace root", async () => {
    const ws = createTempDir("ws-sec-");
    const externalDir = createTempDir("outside-sec-");

    const dotFrontier = path.join(ws, ".frontier");

    // Attempt to create symlink / junction on Windows
    let symlinkCreated = false;
    try {
      fs.symlinkSync(externalDir, dotFrontier, "junction");
      symlinkCreated = true;
    } catch {
      // Junction/symlink failed due to OS privilege
    }

    if (!symlinkCreated) {
      console.log("[SKIPPED: Symlink creation requires elevated privileges in this environment]");
      return;
    }

    const cm = new ConnectionManager({ workspaceRoot: ws });
    await expect(cm.initialize()).rejects.toThrow(/Filesystem boundary violation/);
  });

  it("detects corrupted SQLite database and reports explicit diagnostic without overwriting", async () => {
    const ws = createTempDir("ws-corrupt-");
    const frontierDir = path.join(ws, ".frontier", "intelligence");
    fs.mkdirSync(frontierDir, { recursive: true });

    // Write corrupted header bytes into index.sqlite
    const dbFile = path.join(frontierDir, "index.sqlite");
    fs.writeFileSync(dbFile, "THIS IS NOT A VALID SQLITE DATABASE FILE - CORRUPT HEADER", "utf8");

    const cm = new ConnectionManager({ workspaceRoot: ws });

    // Initialization MUST fail with corruption error and MUST NOT overwrite file
    await expect(cm.initialize()).rejects.toThrow();

    // Verify original file was preserved and not silently wiped
    const content = fs.readFileSync(dbFile, "utf8");
    expect(content).toContain("THIS IS NOT A VALID SQLITE DATABASE FILE");
  });

  it("safely handles malicious or malformed metadata.json without crashing or prototype pollution", async () => {
    const ws = createTempDir("ws-malicious-meta-");
    const frontierDir = path.join(ws, ".frontier", "intelligence");
    fs.mkdirSync(frontierDir, { recursive: true });

    // Write metadata with prototype pollution attempt and invalid characters
    const metaFile = path.join(frontierDir, "metadata.json");
    fs.writeFileSync(
      metaFile,
      JSON.stringify({
        __proto__: { polluted: true },
        repositoryIdentity: "../../../traversal_id!",
        rootPath: "/fake/root",
        displayName: "safe-name",
      }),
      "utf8",
    );

    const cm = new ConnectionManager({ workspaceRoot: ws });
    await cm.initialize();

    // Verify identity was rejected and safely replaced with a deterministic repo_ identity
    const repo = cm.getRepository();
    expect(repo.identity).toMatch(/^repo_[a-f0-9]+$/);
    expect((Object.prototype as any).polluted).toBeUndefined();

    cm.close();
  });

  it("strictly enforces null content_hash for sensitive and excluded files in persistent storage", () => {
    const db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    const scanStore = new ScanStore(db);
    const fileStore = new FileStore(db);

    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("sec_test", "/repo", "SecTest", new Date().toISOString(), new Date().toISOString(), 1);
    const repoId = Number(repoRes.lastInsertRowid);

    const scan = scanStore.createScanRun({
      repositoryId: repoId,
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    const files: ScannedFileRecord[] = [
      {
        canonicalPath: ".env.production",
        fileExtension: "",
        classification: "sensitive",
        sizeBytes: 120,
        mtimeMs: 1700000000000,
        contentHash: "sh_secret_123",
        hashState: "SKIPPED_SENSITIVE",
        inspectionStatus: "EXCLUDED_CONTENT",
        exclusionStatus: "EXCLUDED_CONTENT",
        exclusionReason: "Secret pattern matched",
      },
      {
        canonicalPath: "src/safe.ts",
        fileExtension: ".ts",
        classification: "source",
        sizeBytes: 250,
        mtimeMs: 1700000000000,
        contentHash: "sh_safe_456",
        hashState: "COMPUTED",
        inspectionStatus: "INCLUDED",
        exclusionStatus: "INCLUDED",
        exclusionReason: null,
      },
    ];

    fileStore.insertFiles(repoId, scan.id, files);

    const sensitiveRow = fileStore.getFileByPath(scan.id, ".env.production");
    expect(sensitiveRow?.contentHash).toBeNull();
    expect(sensitiveRow?.sensitivityStatus).toBe("SENSITIVE");

    const safeRow = fileStore.getFileByPath(scan.id, "src/safe.ts");
    expect(safeRow?.contentHash).toBe("sh_safe_456");
    expect(safeRow?.sensitivityStatus).toBe("SAFE");

    db.close();
  });

  it("redacts sensitive tokens in evidence descriptions before database insertion", () => {
    const db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);

    const evidenceStore = new EvidenceStore(db);

    const repoRes = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "ev_sec_test",
        "/repo",
        "EvSecTest",
        new Date().toISOString(),
        new Date().toISOString(),
        1,
      );
    const repoId = Number(repoRes.lastInsertRowid);

    const scanRes = db.rawDb
      .prepare(
        "INSERT INTO scan_runs (repository_id, started_at, status, scanner_version, extractor_version) VALUES (?, ?, 'RUNNING', '0.6.3', '0.6.3')",
      )
      .run(repoId, new Date().toISOString());
    const scanId = Number(scanRes.lastInsertRowid);

    const fileRes = db.rawDb
      .prepare(
        "INSERT INTO files (repository_id, scan_id, relative_path, normalized_path, extension, language, classification, size_bytes, modified_at, sensitivity_status, index_status, indexed_at) VALUES (?, ?, 'config.ts', 'config.ts', '.ts', 'typescript', 'source', 100, 1700000000, 'SAFE', 'INDEXED', ?)",
      )
      .run(repoId, scanId, new Date().toISOString());
    const fileId = Number(fileRes.lastInsertRowid);

    const evId = evidenceStore.insertEvidence({
      repositoryId: repoId,
      scanId,
      fileId,
      evidence: { lineStart: 1, lineEnd: 2, colStart: 0, colEnd: 50, evidenceHash: "ev_hash" },
      evidenceType: "auth_token_pattern",
      description:
        "Found secret: 'super_secret_api_key_xyz' and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz",
    });

    const saved = evidenceStore.getEvidenceById(evId);
    expect(saved?.evidenceDescription).not.toContain("super_secret_api_key_xyz");
    expect(saved?.evidenceDescription).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(saved?.evidenceDescription).toContain("[REDACTED]");

    db.close();
  });
});
