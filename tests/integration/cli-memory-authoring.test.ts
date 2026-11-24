/**
 * Phase 8.2 — CLI Memory Authoring Integration Tests
 * Tests memory CLI commands end-to-end: record, supersede, archive,
 * ingest-adr, project-markdown, drift, and inspection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../scripts/cli/frontier-cli.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";

describe("Phase 8.2 — CLI Memory Authoring Integration", () => {
  let ws: string;
  let cm: ConnectionManager;
  let sm: StorageManager;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];
  let origStdoutWrite: typeof process.stdout.write;
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-cli-mem-"));
    fs.mkdirSync(path.join(ws, "docs", "adr"), { recursive: true });

    // Initialize isolated temporary connection
    cm = new ConnectionManager({ workspaceRoot: ws });
    sm = new StorageManager(cm);
    await sm.initialize();

    stdoutChunks = [];
    stderrChunks = [];
    origStdoutWrite = process.stdout.write;
    origStderrWrite = process.stderr.write;

    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any;

    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;
  });

  afterEach(async () => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;

    if (cm && cm.getDatabase().isOpen()) {
      cm.getDatabase().rawDb.close();
    }
    if (ws && fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  const getStdout = () => stdoutChunks.join("");
  const getStderr = () => stderrChunks.join("");

  it("1. records a new engineering memory via CLI", async () => {
    const exitCode = await runCli([
      "--workspace",
      ws,
      "memory",
      "record",
      "--title",
      "Strict Return Types",
      "--content",
      "All public functions must declare return types.",
      "--category",
      "engineering_convention",
    ]);

    expect(exitCode).toBe(0);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — Engineering Memory Recorded");
    expect(output).toContain("conv_strict_return_types");
    expect(output).toContain("ACTIVE (v1)");
  });

  it("2. records a memory emitting structured JSON", async () => {
    const exitCode = await runCli([
      "--workspace",
      ws,
      "--format",
      "json",
      "memory",
      "record",
      "--title",
      "Explicit Error Enums",
      "--content",
      "Error types must be explicit enums.",
      "--category",
      "engineering_convention",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.memory.memoryKey).toBe("conv_explicit_error_enums");
    expect(parsed.memory.category).toBe("engineering_convention");
    expect(parsed.memory.version).toBe(1);
  });

  it("3. supersedes an existing memory via CLI", async () => {
    // Record A
    await runCli([
      "--workspace",
      ws,
      "memory",
      "record",
      "--key",
      "dec_auth_v1",
      "--title",
      "Auth V1",
      "--content",
      "Session cookies",
      "--category",
      "architectural_decision",
    ]);

    // Record B
    await runCli([
      "--workspace",
      ws,
      "memory",
      "record",
      "--key",
      "dec_auth_v2",
      "--title",
      "Auth V2",
      "--content",
      "JWT bearer tokens",
      "--category",
      "architectural_decision",
    ]);

    stdoutChunks = [];

    // Supersede A with B
    const exitCode = await runCli([
      "--workspace",
      ws,
      "memory",
      "supersede",
      "dec_auth_v1",
      "dec_auth_v2",
      "--reason",
      "Migrated to stateless tokens",
    ]);

    expect(exitCode).toBe(0);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — Memory Superseded");
    expect(output).toContain("dec_auth_v1");
    expect(output).toContain("SUPERSEDED (v2)");
    expect(output).toContain("dec_auth_v2");
  });

  it("4. archives an active memory via CLI", async () => {
    await runCli([
      "--workspace",
      ws,
      "memory",
      "record",
      "--key",
      "debt_old_bundler",
      "--title",
      "Old Bundler Debt",
      "--content",
      "Webpack config deprecated",
      "--category",
      "technical_debt",
    ]);

    stdoutChunks = [];

    const exitCode = await runCli([
      "--workspace",
      ws,
      "memory",
      "archive",
      "debt_old_bundler",
      "--reason",
      "Vite migration complete",
    ]);

    expect(exitCode).toBe(0);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — Memory Archived");
    expect(output).toContain("debt_old_bundler");
    expect(output).toContain("ARCHIVED (v2)");
  });

  it("5. ingests ADR files via CLI", async () => {
    const adrPath = path.join(ws, "docs", "adr", "ADR-001-plugin.md");
    fs.writeFileSync(
      adrPath,
      "# ADR-001: Plugin Layout\n- **Status:** Accepted\n\nContent",
      "utf8",
    );

    const exitCode = await runCli(["--workspace", ws, "memory", "ingest-adr"]);

    expect(exitCode).toBe(0);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — ADR Ingestion Report");
    expect(output).toContain("Created:    1");
    expect(output).toContain("adr_001_plugin_layout");
  });

  it("6. projects memories to Markdown files via CLI", async () => {
    await runCli([
      "--workspace",
      ws,
      "memory",
      "record",
      "--title",
      "Safe Concurrency",
      "--content",
      "Use bounded workers.",
      "--category",
      "engineering_convention",
    ]);

    stdoutChunks = [];

    const exitCode = await runCli(["--workspace", ws, "memory", "project-markdown"]);

    expect(exitCode).toBe(0);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — Memory Markdown Projection");
    expect(output).toContain("Projected:  1 memories");

    const expectedFile = path.join(
      ws,
      ".frontier",
      "memories",
      "engineering_convention",
      "conv_safe_concurrency.md",
    );
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it("7. reports memory drift via CLI", async () => {
    // Clean state
    const cleanExit = await runCli(["--workspace", ws, "memory", "drift"]);
    if (cleanExit !== 0) console.log("STDERR:", getStderr());
    expect(cleanExit).toBe(0);

    // Create ADR, ingest, then modify on disk to cause drift
    const adrPath = path.join(ws, "docs", "adr", "ADR-001-test.md");
    fs.writeFileSync(adrPath, "# ADR-001: Drift Test\n- **Status:** Accepted\n\nOriginal", "utf8");

    await runCli(["--workspace", ws, "memory", "ingest-adr"]);

    // Mutate disk ADR
    fs.writeFileSync(
      adrPath,
      "# ADR-001: Drift Test\n- **Status:** Accepted\n\nMutated Content",
      "utf8",
    );

    stdoutChunks = [];

    const driftExit = await runCli(["--workspace", ws, "memory", "drift"]);

    expect(driftExit).toBe(1);
    const output = getStdout();
    expect(output).toContain("Frontier Engineer — Memory Drift Report");
    expect(output).toContain("ADR_CONTENT_CHANGED");
  });
});
