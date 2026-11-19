import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("CLI Integration: frontier telemetry & frontier audit (Phase 8.6B-3)", () => {
  const cliPath = path.resolve(root, "scripts", "cli", "frontier-cli.ts");
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function runCli(args: string[], cwd: string = root) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure on Windows temp dirs
      }
    }
  });

  // Seed fixture helper for isolated custom audit directory
  function seedAuditFixture(auditDir: string): { modernId1: string; modernId2: string } {
    fs.mkdirSync(auditDir, { recursive: true });

    const modernId1 = "fe-mod-evt-001";
    const modernId2 = "fe-mod-evt-002";

    const records = [
      JSON.stringify({
        schemaVersion: 1,
        eventId: modernId1,
        timestamp: "2026-11-18T10:00:00.000Z",
        eventType: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        source: "production",
        status: "success",
        correlationId: "corr-sess-001",
        conversationId: "corr-sess-001",
        executionId: "exec-001",
        agentId: "frontier-engineer",
        durationMs: 150,
        stepIdx: 1,
        toolName: "read_file",
        normalizedSummary: {
          toolKind: "file",
          summary: "Reading source file",
        },
        policyDecision: {
          decision: "allow",
          category: "safe",
          reason: "Permitted safe read",
        },
      }),
      JSON.stringify({
        schemaVersion: 1,
        eventId: modernId2,
        timestamp: "2026-11-18T10:05:00.000Z",
        eventType: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        source: "production",
        status: "denied",
        correlationId: "corr-sess-001",
        conversationId: "corr-sess-001",
        executionId: "exec-001",
        agentId: "frontier-engineer",
        durationMs: 2200,
        stepIdx: 2,
        toolName: "run_command",
        normalizedSummary: {
          toolKind: "command",
          commandBin: "rm",
          summary: "Blocked command",
        },
        policyDecision: {
          decision: "deny",
          category: "destructive_filesystem",
          reason: "Blocked destructive file removal command",
        },
      }),
      // Legacy format record
      JSON.stringify({
        timestamp: "2026-11-18T10:10:00.000Z",
        event: "Stop",
        hookId: "frontier-pre-tool-safety",
        toolName: "run_command",
        status: "info",
        stepIdx: 3,
        conversationId: "corr-sess-002",
        metadata: {
          decision: "allow",
          category: "safe",
        },
      }),
    ];

    fs.writeFileSync(path.join(auditDir, "execution.jsonl"), records.join("\n") + "\n", "utf8");
    return { modernId1, modernId2 };
  }

  describe("1. Command dispatch & aliases", () => {
    it("runs 'frontier telemetry' against repository default audit logs", () => {
      const res = runCli(["telemetry", "--page-size", "5"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Frontier Engineer Telemetry Query Report");
      expect(res.stdout).toContain("Telemetry Query Results");
    });

    it("runs 'frontier audit' as an exact alias for 'frontier telemetry'", () => {
      const res = runCli(["audit", "--page-size", "5"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Frontier Engineer Telemetry Query Report");
      expect(res.stdout).toContain("Telemetry Query Results");
    });

    it("supports 'frontier telemetry list' sub-action", () => {
      const res = runCli(["telemetry", "list", "--page-size", "3"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Telemetry Query Results");
    });

    it("supports 'frontier audit summary' sub-action", () => {
      const res = runCli(["audit", "summary"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Summary Statistics");
      expect(res.stdout).toContain("Event Type Breakdown");
    });

    it("supports 'frontier telemetry verify' sub-action", () => {
      const res = runCli(["telemetry", "verify"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Structural Integrity Diagnostics");
    });

    it("rejects unknown telemetry sub-action with exit code 2", () => {
      const res = runCli(["telemetry", "invalid_action"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('Unknown telemetry action: "invalid_action"');
    });
  });

  describe("2. Output formatting: Markdown, JSON, Text", () => {
    it("emits valid formatted JSON when --format json is specified", () => {
      const res = runCli(["telemetry", "--format", "json", "--page-size", "2"]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveProperty("title");
      expect(parsed).toHaveProperty("queryResult");
      expect(parsed.queryResult.records).toHaveLength(2);
      expect(parsed.queryResult.pagination.pageSize).toBe(2);
    });

    it("emits valid Markdown when --format markdown is specified", () => {
      const res = runCli(["telemetry", "--format", "markdown", "--page-size", "2"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("# Frontier Engineer Telemetry Query Report");
      expect(res.stdout).toContain("| # | Timestamp | Event Type |");
    });

    it("rejects unsupported format with exit code 2", () => {
      const res = runCli(["telemetry", "--format", "xml"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid format option: must be 'text', 'json', or 'markdown'.");
    });

    it("emits JSON error payload on stderr or stdout when --format json has validation error", () => {
      const res = runCli(["telemetry", "--format", "json", "--page-size", "9999"]);
      expect(res.status).toBe(2);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.exitCode).toBe(2);
      expect(parsed.error).toContain("Invalid --page-size");
    });
  });

  describe("3. Query filtering & criteria", () => {
    it("filters records by --event-type", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--event-type",
        "PreToolUse",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(2);
      for (const rec of parsed.queryResult.records) {
        expect(rec.eventType).toBe("PreToolUse");
      }
    });

    it("filters records by --decision", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--decision",
        "deny",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].policyDecision.decision).toBe("deny");
    });

    it("filters records by --tool", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--tool",
        "read_file",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].toolName).toBe("read_file");
    });

    it("filters records by --status", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--status",
        "denied",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].status).toBe("denied");
    });

    it("filters records by approved --text search", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--text",
        "destructive",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].policyDecision.reason).toContain("destructive");
    });

    it("filters records by --generation modern-v1 vs legacy", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const resModern = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--generation",
        "modern-v1",
        "--format",
        "json",
      ]);
      expect(resModern.status).toBe(0);
      const parsedMod = JSON.parse(resModern.stdout);
      expect(parsedMod.queryResult.records).toHaveLength(2);

      const resLegacy = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--generation",
        "legacy",
        "--format",
        "json",
      ]);
      expect(resLegacy.status).toBe(0);
      const parsedLeg = JSON.parse(resLegacy.stdout);
      expect(parsedLeg.queryResult.records).toHaveLength(1);
    });

    it("filters records by time range (--start-time, --end-time)", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--start-time",
        "2026-11-18T10:04:00.000Z",
        "--end-time",
        "2026-11-18T10:06:00.000Z",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].timestamp).toBe("2026-11-18T10:05:00.000Z");
    });
  });

  describe("4. Sorting & deterministic pagination", () => {
    it("sorts records by --sort-by durationMs --sort-order desc", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--sort-by",
        "durationMs",
        "--sort-order",
        "desc",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records[0].durationMs).toBe(2200);
      expect(parsed.queryResult.records[1].durationMs).toBe(150);
    });

    it("paginates records deterministically with --page and --page-size", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const resPage1 = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--page",
        "1",
        "--page-size",
        "1",
        "--format",
        "json",
      ]);
      expect(resPage1.status).toBe(0);
      const p1 = JSON.parse(resPage1.stdout);
      expect(p1.queryResult.records).toHaveLength(1);
      expect(p1.queryResult.pagination.totalMatched).toBe(3);
      expect(p1.queryResult.pagination.totalPages).toBe(3);

      const resPage2 = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--page",
        "2",
        "--page-size",
        "1",
        "--format",
        "json",
      ]);
      expect(resPage2.status).toBe(0);
      const p2 = JSON.parse(resPage2.stdout);
      expect(p2.queryResult.records).toHaveLength(1);
      expect(p2.queryResult.records[0].timestamp).not.toBe(p1.queryResult.records[0].timestamp);
    });
  });

  describe("5. Telemetry show action & target lookup", () => {
    it("shows a specific record by event ID: 'frontier telemetry show <id>'", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      const { modernId1 } = seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "show",
        modernId1,
        "--audit-dir",
        tempDir,
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].eventId).toBe(modernId1);
    });

    it("fails with exit code 4 when requested event ID does not exist", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli(["telemetry", "show", "non-existent-evt-id-999", "--audit-dir", tempDir]);
      expect(res.status).toBe(4);
      expect(res.stderr).toContain(
        "Telemetry event with ID 'non-existent-evt-id-999' was not found.",
      );
    });

    it("fails with exit code 2 when show action is missing event ID argument", () => {
      const res = runCli(["telemetry", "show"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Missing required event ID for 'show' action");
    });
  });

  describe("6. Aggregation & integrity diagnostics modes", () => {
    it("generates summary metrics via --aggregate", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli(["telemetry", "--audit-dir", tempDir, "--aggregate", "--format", "json"]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveProperty("aggregation");
      expect(parsed.aggregation.totalValidRecords).toBe(3);
      expect(parsed.aggregation.countsByGeneration.modernV1).toBe(2);
      expect(parsed.aggregation.countsByGeneration.legacy).toBe(1);
    });

    it("generates integrity diagnostics via --diagnostics", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--diagnostics",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveProperty("integrityReport");
      expect(parsed.integrityReport.totalRecordsAnalyzed).toBe(3);
    });

    it("generates both aggregation and diagnostics when combined", () => {
      const tempDir = makeTempDir("fe-cli-tel-test-");
      seedAuditFixture(tempDir);

      const res = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--aggregate",
        "--diagnostics",
        "--format",
        "json",
      ]);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveProperty("aggregation");
      expect(parsed).toHaveProperty("integrityReport");
    });
  });

  describe("7. Rotated logs & custom audit directory", () => {
    it("scans rotated logs when --include-rotated is specified", () => {
      const tempDir = makeTempDir("fe-cli-tel-rotated-");
      fs.mkdirSync(tempDir, { recursive: true });

      const rotatedRecord = JSON.stringify({
        schemaVersion: 1,
        eventId: "fe-rot-001",
        timestamp: "2026-11-17T09:00:00.000Z",
        eventType: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        source: "production",
        status: "success",
        correlationId: "rot-corr-1",
        durationMs: 10,
        stepIdx: 1,
      });

      const activeRecord = JSON.stringify({
        schemaVersion: 1,
        eventId: "fe-act-001",
        timestamp: "2026-11-18T09:00:00.000Z",
        eventType: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        source: "production",
        status: "success",
        correlationId: "act-corr-1",
        durationMs: 20,
        stepIdx: 1,
      });

      fs.writeFileSync(path.join(tempDir, "execution.jsonl.1"), rotatedRecord + "\n", "utf8");
      fs.writeFileSync(path.join(tempDir, "execution.jsonl"), activeRecord + "\n", "utf8");

      // Without --include-rotated: only active
      const resWithout = runCli(["telemetry", "--audit-dir", tempDir, "--format", "json"]);
      expect(resWithout.status).toBe(0);
      const parsedWithout = JSON.parse(resWithout.stdout);
      expect(parsedWithout.queryResult.pagination.totalMatched).toBe(1);

      // With --include-rotated: both active and rotated
      const resWith = runCli([
        "telemetry",
        "--audit-dir",
        tempDir,
        "--include-rotated",
        "--format",
        "json",
      ]);
      expect(resWith.status).toBe(0);
      const parsedWith = JSON.parse(resWith.stdout);
      expect(parsedWith.queryResult.pagination.totalMatched).toBe(2);
      expect(parsedWith.queryResult.records[0].provenance.fileName).toBe("execution.jsonl.1");
      expect(parsedWith.queryResult.records[1].provenance.fileName).toBe("execution.jsonl");
    });

    it("returns exit code 3 when custom audit directory does not exist", () => {
      const res = runCli(["telemetry", "--audit-dir", "/path/to/nonexistent/directory/xyz"]);
      expect(res.status).toBe(3);
      expect(res.stderr).toContain("Audit directory does not exist or is unavailable");
    });

    it("returns exit code 3 when audit directory has no log files", () => {
      const emptyDir = makeTempDir("fe-cli-tel-empty-");
      const res = runCli(["telemetry", "--audit-dir", emptyDir]);
      expect(res.status).toBe(3);
      expect(res.stderr).toContain("No audit log files found");
    });
  });

  describe("8. Strict argument validation (Exit code 2)", () => {
    it("rejects invalid --sort-by with exit code 2", () => {
      const res = runCli(["telemetry", "--sort-by", "notAField"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --sort-by option");
    });

    it("rejects invalid --sort-order with exit code 2", () => {
      const res = runCli(["telemetry", "--sort-order", "upwards"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --sort-order option");
    });

    it("rejects invalid --generation with exit code 2", () => {
      const res = runCli(["telemetry", "--generation", "future-v9"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --generation option");
    });

    it("rejects invalid --page (<1) with exit code 2", () => {
      const res = runCli(["telemetry", "--page", "0"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --page option");
    });

    it("rejects invalid --page-size (>1000) with exit code 2", () => {
      const res = runCli(["telemetry", "--page-size", "1001"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --page-size");
    });

    it("rejects invalid --start-time format with exit code 2", () => {
      const res = runCli(["telemetry", "--start-time", "not-a-date"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("Invalid --start-time option");
    });

    it("rejects inverted time range (--start-time after --end-time) with exit code 2", () => {
      const res = runCli([
        "telemetry",
        "--start-time",
        "2026-11-19T00:00:00.000Z",
        "--end-time",
        "2026-11-18T00:00:00.000Z",
      ]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain(
        "Invalid time range: --start-time must be earlier than or equal to --end-time.",
      );
    });
  });

  describe("9. Cross-subcommand flag safety & isolation", () => {
    it("rejects telemetry flags passed to intelligence subcommands", () => {
      const res = runCli(["status", "--event-type", "PreToolUse"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain(
        "Telemetry options are only supported for 'telemetry' and 'audit' subcommands (got 'status').",
      );
    });

    it("rejects intelligence flags passed to telemetry subcommand", () => {
      const res = runCli(["telemetry", "--depth", "4"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain(
        "Intelligence options are not supported for telemetry/audit commands.",
      );
    });

    it("ensures telemetry command is strictly read-only and mutates zero files", () => {
      const tempDir = makeTempDir("fe-cli-tel-readonly-");
      seedAuditFixture(tempDir);

      const filesBefore = fs.readdirSync(tempDir);
      const statBefore = fs.statSync(path.join(tempDir, "execution.jsonl"));

      const res = runCli(["telemetry", "--audit-dir", tempDir, "--aggregate", "--diagnostics"]);
      expect(res.status).toBe(0);

      const filesAfter = fs.readdirSync(tempDir);
      const statAfter = fs.statSync(path.join(tempDir, "execution.jsonl"));

      expect(filesAfter).toEqual(filesBefore);
      expect(statAfter.size).toBe(statBefore.size);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });
});
