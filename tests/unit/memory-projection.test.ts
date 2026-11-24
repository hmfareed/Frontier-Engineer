/**
 * Phase 8.2C — Memory Projection Unit Tests
 * Tests deterministic Markdown generation, category partitioning,
 * user-authored file protection, and ADR target protection guards.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";
import {
  MemoryProjector,
  renderMemoryMarkdown,
  PROJECTION_BANNER,
} from "../../scripts/memory/memory-projector.ts";

describe("Phase 8.2C — Memory Projector", () => {
  let db: SqliteDatabase;
  let store: MemoryStore;
  let projector: MemoryProjector;
  let repoId: number;
  let tempWs: string;

  beforeEach(() => {
    tempWs = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-proj-test-"));
    fs.mkdirSync(path.join(tempWs, "docs", "adr"), { recursive: true });

    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);
    store = new MemoryStore(db);
    projector = new MemoryProjector(db);

    const res = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_proj', '/proj', 'Proj Repo', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
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

  describe("renderMemoryMarkdown", () => {
    it("1. generates deterministic Markdown with frontmatter and evidence", () => {
      const mem = store.createMemory({
        repositoryId: repoId,
        memoryKey: "conv_no_implicit_any",
        category: "engineering_convention",
        title: "No Implicit Any in TypeScript",
        content: "Always configure noImplicitAny: true in tsconfig.json.",
        confidence: 0.95,
        confidenceTier: "CONFIRMED",
      });

      const md1 = renderMemoryMarkdown(mem);
      const md2 = renderMemoryMarkdown(mem);

      expect(md1).toBe(md2);
      expect(md1).toContain("generator: frontier-engineer");
      expect(md1).toContain('key: "conv_no_implicit_any"');
      expect(md1).toContain('category: "engineering_convention"');
      expect(md1).toContain(PROJECTION_BANNER);
      expect(md1).toContain("# No Implicit Any in TypeScript");
      expect(md1).toContain("Always configure noImplicitAny: true in tsconfig.json.");
    });
  });

  describe("MemoryProjector.project", () => {
    it("2. projects memories into category subdirectories", () => {
      store.createMemory({
        repositoryId: repoId,
        memoryKey: "conv_strict_typing",
        category: "engineering_convention",
        title: "Strict Typing",
        content: "Strict typing rules.",
      });

      store.createMemory({
        repositoryId: repoId,
        memoryKey: "dec_sqlite_engine",
        category: "architectural_decision",
        title: "SQLite Engine",
        content: "Use node:sqlite.",
      });

      const report = projector.project(repoId, tempWs);
      expect(report.success).toBe(true);
      expect(report.totalProjected).toBe(2);

      const convFile = path.join(
        tempWs,
        ".frontier",
        "memories",
        "engineering_convention",
        "conv_strict_typing.md",
      );
      const decFile = path.join(
        tempWs,
        ".frontier",
        "memories",
        "architectural_decision",
        "dec_sqlite_engine.md",
      );

      expect(fs.existsSync(convFile)).toBe(true);
      expect(fs.existsSync(decFile)).toBe(true);
      expect(fs.readFileSync(convFile, "utf8")).toContain("Strict Typing");
    });

    it("3. protects user-authored files without projection banner from overwrite", () => {
      const targetDir = path.join(tempWs, ".frontier", "memories", "engineering_convention");
      fs.mkdirSync(targetDir, { recursive: true });

      const userAuthoredPath = path.join(targetDir, "conv_custom_rule.md");
      fs.writeFileSync(userAuthoredPath, "# My Handwritten Document\nDo not touch!", "utf8");

      store.createMemory({
        repositoryId: repoId,
        memoryKey: "conv_custom_rule",
        category: "engineering_convention",
        title: "Custom Rule",
        content: "Generated content",
      });

      const report = projector.project(repoId, tempWs);
      expect(report.success).toBe(false);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].error).toContain("User-Authored File Protection");

      // Verify file was NOT modified
      expect(fs.readFileSync(userAuthoredPath, "utf8")).toBe(
        "# My Handwritten Document\nDo not touch!",
      );
    });

    it("4. rejects projection directly targeting formal ADR directories", () => {
      expect(() => {
        projector.project(repoId, tempWs, {
          outputDir: "docs/adr",
        });
      }).toThrow(/Security Error: Projection target.*overlaps with formal ADR directory/);
    });

    it("5. dry run reports preview without writing files", () => {
      store.createMemory({
        repositoryId: repoId,
        memoryKey: "debt_old_api",
        category: "technical_debt",
        title: "Old API",
        content: "To be deprecated",
      });

      const report = projector.project(repoId, tempWs, { dryRun: true });
      expect(report.dryRun).toBe(true);
      expect(report.files).toHaveLength(1);
      expect(report.files[0].status).toBe("PREVIEW");

      const expectedPath = path.join(
        tempWs,
        ".frontier",
        "memories",
        "technical_debt",
        "debt_old_api.md",
      );
      expect(fs.existsSync(expectedPath)).toBe(false);
    });
  });
});
