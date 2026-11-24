/**
 * Phase 8.2B — ADR Ingestion Pipeline Unit Tests
 * Tests ADR parsing, discovery, idempotent ingestion, versioned updates,
 * supersession linking, and security containment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDatabase } from "../../scripts/storage/database.ts";
import { runMigrations } from "../../scripts/storage/schema/migration-runner.ts";
import {
  AdrIngestEngine,
  parseAdrMarkdown,
  discoverAdrFiles,
  validateWorkspaceContainment,
  MAX_ADR_FILE_BYTES,
} from "../../scripts/memory/adr-ingest.ts";
import { MemoryStore } from "../../scripts/storage/repositories/memory-store.ts";

describe("Phase 8.2B — ADR Ingestion Pipeline", () => {
  let db: SqliteDatabase;
  let engine: AdrIngestEngine;
  let store: MemoryStore;
  let repoId: number;
  let tempWs: string;

  beforeEach(() => {
    tempWs = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-adr-ingest-"));
    fs.mkdirSync(path.join(tempWs, "docs", "adr"), { recursive: true });

    db = new SqliteDatabase({ path: ":memory:" });
    runMigrations(db.rawDb);
    store = new MemoryStore(db);
    engine = new AdrIngestEngine(db);

    const res = db.rawDb
      .prepare(
        "INSERT INTO repositories (identity, root_path, display_name, created_at, updated_at, schema_version) VALUES ('repo_adr', '/adr', 'ADR Repo', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4)",
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

  describe("parseAdrMarkdown", () => {
    it("1. parses standard bullet-metadata ADR", () => {
      const content = `# ADR-001: Foundation Architecture

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Engineering Team
- **Related:** [docs/20-REPO.md](docs/20-REPO.md)

## Context
Initial foundation context.

## Decisions
Use Antigravity as the primary runtime.

## Consequences
Direct plugin validation works.
`;

      const parsed = parseAdrMarkdown(content, "docs/adr/ADR-001-foundation.md");
      expect(parsed.number).toBe(1);
      expect(parsed.title).toBe("Foundation Architecture");
      expect(parsed.status).toBe("Accepted");
      expect(parsed.normalizedStatus).toBe("ACTIVE");
      expect(parsed.date).toBe("2026-11-10");
      expect(parsed.deciders).toBe("Engineering Team");
      expect(parsed.relatedRefs).toContain("docs/20-REPO.md");
      expect(parsed.normalizedBody).toContain("Use Antigravity as the primary runtime.");
    });

    it("2. parses YAML frontmatter ADR", () => {
      const content = `---
id: ADR-005
title: MCP Integration Architecture
status: Proposed
date: 2026-11-12
supersedes: ADR-001
---
# Overridden Header Title

## Context
MCP server hosting architecture.
`;

      const parsed = parseAdrMarkdown(content, "docs/adr/ADR-005-mcp.md");
      expect(parsed.number).toBe(5);
      expect(parsed.title).toBe("MCP Integration Architecture");
      expect(parsed.status).toBe("Proposed");
      expect(parsed.normalizedStatus).toBe("ACTIVE");
      expect(parsed.supersedesRef).toBe("ADR-001");
      expect(parsed.normalizedBody).toContain("MCP server hosting architecture.");
    });

    it("3. rejects files exceeding maximum size", () => {
      const hugeContent = "X".repeat(MAX_ADR_FILE_BYTES + 1024);
      expect(() => {
        parseAdrMarkdown(hugeContent, "test.md");
      }).toThrow(/exceeds maximum permitted size/);
    });
  });

  describe("Workspace Path Containment", () => {
    it("4. validates and canonicalizes paths inside workspace", () => {
      const adrPath = path.join(tempWs, "docs", "adr", "ADR-001.md");
      fs.writeFileSync(adrPath, "# ADR-001: Test", "utf8");

      const canonical = validateWorkspaceContainment(tempWs, "docs/adr/ADR-001.md");
      expect(canonical).toBe(fs.realpathSync(adrPath));
    });

    it("5. rejects path traversal outside workspace root", () => {
      expect(() => {
        validateWorkspaceContainment(tempWs, "../../../etc/passwd");
      }).toThrow(/Security Error: Path.*resolves outside workspace root/);
    });
  });

  describe("Ingest Execution", () => {
    it("6. ingests ADR files into active engineering memories", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
      fs.writeFileSync(
        adr1,
        `# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nContent 1`,
        "utf8",
      );

      const adr2 = path.join(tempWs, "docs", "adr", "ADR-002-agents.md");
      fs.writeFileSync(
        adr2,
        `# ADR-002: Agent System\n- **Status:** Accepted\n\nContent 2`,
        "utf8",
      );

      const report = engine.ingest(repoId, tempWs);
      expect(report.success).toBe(true);
      expect(report.totalScanned).toBe(2);
      expect(report.created).toHaveLength(2);
      expect(report.created.map((c) => c.key)).toEqual([
        "adr_001_foundation_architecture",
        "adr_002_agent_system",
      ]);

      const mem1 = store.getMemoryByKey(repoId, "adr_001_foundation_architecture")!;
      expect(mem1).toBeDefined();
      expect(mem1.status).toBe("ACTIVE");
      expect(mem1.version).toBe(1);
    });

    it("7. repeated ingestion is idempotent (0 updates, 0 duplicates)", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
      fs.writeFileSync(
        adr1,
        `# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nContent 1`,
        "utf8",
      );

      const rep1 = engine.ingest(repoId, tempWs);
      expect(rep1.created).toHaveLength(1);

      const rep2 = engine.ingest(repoId, tempWs);
      expect(rep2.created).toHaveLength(0);
      expect(rep2.updated).toHaveLength(0);
      expect(rep2.unchanged).toHaveLength(1);
      expect(rep2.unchanged[0].key).toBe("adr_001_foundation_architecture");

      const all = store.listMemories(repoId);
      expect(all).toHaveLength(1);
      expect(all[0].version).toBe(1);
    });

    it("8. records version history when ADR content changes on disk", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-001-foundation.md");
      fs.writeFileSync(
        adr1,
        `# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nInitial Decision`,
        "utf8",
      );

      engine.ingest(repoId, tempWs);

      // Modify ADR on disk
      fs.writeFileSync(
        adr1,
        `# ADR-001: Foundation Architecture\n- **Status:** Accepted\n\nUpdated Decision with New Consequences`,
        "utf8",
      );

      const report2 = engine.ingest(repoId, tempWs);
      expect(report2.updated).toHaveLength(1);
      expect(report2.updated[0].previousVersion).toBe(1);
      expect(report2.updated[0].currentVersion).toBe(2);

      const mem = store.getMemoryByKey(repoId, "adr_001_foundation_architecture")!;
      expect(mem.version).toBe(2);
      expect(mem.content).toContain("Updated Decision with New Consequences");

      const versions = store.getMemoryVersions(mem.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].content).toContain("Initial Decision");
      expect(versions[0].changeReason).toContain("ADR source content updated on disk");
    });

    it("9. links supersession references between ADRs automatically", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-001-v1.md");
      fs.writeFileSync(
        adr1,
        `# ADR-001: Monolith System\n- **Status:** Accepted\n\nV1 Monolith`,
        "utf8",
      );

      const adr2 = path.join(tempWs, "docs", "adr", "ADR-002-v2.md");
      fs.writeFileSync(
        adr2,
        `# ADR-002: Modular System\n- **Status:** Accepted\n- **Supersedes:** ADR-001\n\nV2 Modular`,
        "utf8",
      );

      const report = engine.ingest(repoId, tempWs);
      expect(report.success).toBe(true);

      const mem1 = store.getMemoryByKey(repoId, "adr_001_monolith_system")!;
      const mem2 = store.getMemoryByKey(repoId, "adr_002_modular_system")!;

      expect(mem1.status).toBe("SUPERSEDED");
      expect(mem1.supersededById).toBe(mem2.id);
      expect(mem2.status).toBe("ACTIVE");
    });

    it("10. reports unresolved supersession references safely", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-009-orphan.md");
      fs.writeFileSync(
        adr1,
        `# ADR-009: Orphan Decision\n- **Status:** Accepted\n- **Supersedes:** ADR-999\n\nContent`,
        "utf8",
      );

      const report = engine.ingest(repoId, tempWs);
      expect(report.unresolvedSupersessions).toHaveLength(1);
      expect(report.unresolvedSupersessions[0].targetRef).toBe("ADR-999");
      expect(report.unresolvedSupersessions[0].reason).toContain("Target memory not found");

      const mem = store.getMemoryByKey(repoId, "adr_009_orphan_decision")!;
      expect(mem.status).toBe("ACTIVE");
    });

    it("11. dry run reports changes without modifying the database", () => {
      const adr1 = path.join(tempWs, "docs", "adr", "ADR-001-test.md");
      fs.writeFileSync(adr1, `# ADR-001: Dry Run Test\n- **Status:** Accepted\n\nContent`, "utf8");

      const report = engine.ingest(repoId, tempWs, { dryRun: true });
      expect(report.dryRun).toBe(true);
      expect(report.created).toHaveLength(1);

      const all = store.listMemories(repoId);
      expect(all).toHaveLength(0);
    });
  });
});
