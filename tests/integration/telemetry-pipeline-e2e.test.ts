import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeAuditLog } from "../../scripts/hooks/runtime/logger.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import {
  aggregateTelemetry,
  analyzeTelemetryIntegrity,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  queryTelemetryRecords,
  readTelemetryLog,
  readTelemetryStream,
  type NormalizedTelemetryRecord,
} from "../../scripts/telemetry/index.ts";

const root = repoRoot();

describe("Phase 8.6B-4: Telemetry End-to-End Pipeline & Integration", () => {
  const cliPath = path.resolve(root, "scripts", "cli", "frontier-cli.ts");
  const tempDirs: string[] = [];

  function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-e2e-pipeline-"));
    fs.mkdirSync(path.join(dir, ".frontier", "audit"), { recursive: true });
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
        // Ignore cleanup errors on Windows temp dirs
      }
    }
  });

  describe("1. Full lifecycle pipeline: Hook emission -> JSONL -> Reader -> Query -> Diagnostics -> CLI", () => {
    it("executes the full lifecycle seamlessly from emission to CLI display", async () => {
      const ws = makeTempWorkspace();
      const sessionId = "fe-sess-e2e-100";

      // 1. Hook emission: Emit SessionStart
      writeAuditLog(
        {
          eventType: "SessionStart",
          hookId: "frontier-session-init",
          source: "production",
          status: "info",
          correlationId: sessionId,
          conversationId: sessionId,
          timestamp: "2026-11-18T12:00:00.000Z",
          stepIdx: 1,
        },
        ws,
      );

      // 2. Hook emission: Emit PreToolUse (allowed safe read)
      writeAuditLog(
        {
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "success",
          correlationId: sessionId,
          conversationId: sessionId,
          timestamp: "2026-11-18T12:01:00.000Z",
          stepIdx: 2,
          toolName: "read_file",
          durationMs: 45,
          normalizedSummary: {
            toolKind: "file",
            summary: "Reading configuration file",
          },
          policyDecision: {
            decision: "allow",
            category: "safe",
            reason: "Safe workspace read",
          },
        },
        ws,
      );

      // 3. Hook emission: Emit PreToolUse (blocked destructive command)
      writeAuditLog(
        {
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "denied",
          correlationId: sessionId,
          conversationId: sessionId,
          timestamp: "2026-11-18T12:02:00.000Z",
          stepIdx: 3,
          toolName: "run_command",
          durationMs: 120,
          normalizedSummary: {
            toolKind: "command",
            commandBin: "rm",
            summary: "Blocked command",
          },
          policyDecision: {
            decision: "deny",
            category: "destructive_filesystem",
            reason: "Blocked recursive deletion of root",
          },
        },
        ws,
      );

      // 4. Hook emission: Emit PostToolUse
      writeAuditLog(
        {
          eventType: "PostToolUse",
          hookId: "frontier-post-tool-audit",
          source: "production",
          status: "success",
          correlationId: sessionId,
          conversationId: sessionId,
          timestamp: "2026-11-18T12:03:00.000Z",
          stepIdx: 4,
          toolName: "read_file",
          durationMs: 50,
        },
        ws,
      );

      // 5. Hook emission: Emit Stop
      writeAuditLog(
        {
          eventType: "Stop",
          hookId: "frontier-session-stop",
          source: "production",
          status: "info",
          correlationId: sessionId,
          conversationId: sessionId,
          timestamp: "2026-11-18T12:04:00.000Z",
          stepIdx: 5,
        },
        ws,
      );

      // 6. Verify JSONL file exists and contains 5 lines
      const logFile = path.join(ws, ".frontier", "audit", "execution.jsonl");
      expect(fs.existsSync(logFile)).toBe(true);
      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
      expect(lines).toHaveLength(5);

      // 7. Core Reader verification
      const readResult = await readTelemetryLog({ workspaceRoot: ws });
      expect(readResult.records).toHaveLength(5);
      expect(readResult.diagnostics).toHaveLength(0);
      expect(readResult.totalLinesRead).toBe(5);

      // 8. Query engine verification
      const queryDenied = queryTelemetryRecords(readResult.records, {
        policyDecision: ["deny"],
      });
      expect(queryDenied.records).toHaveLength(1);
      expect(queryDenied.records[0].toolName).toBe("run_command");
      expect(queryDenied.records[0].policyDecision?.decision).toBe("deny");

      // 9. Aggregation verification
      const agg = aggregateTelemetry(readResult.records, readResult.diagnostics);
      expect(agg.totalValidRecords).toBe(5);
      expect(agg.countsByGeneration.modernV1).toBe(5);
      expect(agg.countsByGeneration.legacy).toBe(0);
      expect(agg.countsByPolicyDecision.allow).toBe(1);
      expect(agg.countsByPolicyDecision.deny).toBe(1);
      expect(agg.countsByTool.read_file).toBe(2);
      expect(agg.countsByTool.run_command).toBe(1);

      // 10. Integrity diagnostics verification
      const diag = analyzeTelemetryIntegrity(readResult.records, readResult.diagnostics);
      expect(diag.countsBySeverity.error).toBe(0);
      expect(diag.totalRecordsAnalyzed).toBe(5);

      // 11. Formatters verification
      const jsonOutput = formatTelemetryJson({ queryResult: queryDenied }, { pretty: true });
      expect(jsonOutput).toContain('"decision": "deny"');

      const mdOutput = formatTelemetryMarkdown({ aggregation: agg });
      expect(mdOutput).toContain("Summary Statistics");
      expect(mdOutput).toContain("**5**");

      // 12. CLI execution: default list query
      const cliList = runCli(["telemetry", "--workspace", ws, "--format", "json"]);
      expect(cliList.status).toBe(0);
      const parsedList = JSON.parse(cliList.stdout);
      expect(parsedList.queryResult.records).toHaveLength(5);

      // 13. CLI execution: audit alias parity
      const cliAudit = runCli(["audit", "--workspace", ws, "--format", "json"]);
      expect(cliAudit.status).toBe(0);
      const parsedAudit = JSON.parse(cliAudit.stdout);
      expect(parsedAudit.queryResult.records).toHaveLength(5);

      // 14. CLI execution: summary mode
      const cliSummary = runCli(["telemetry", "summary", "--workspace", ws, "--format", "json"]);
      expect(cliSummary.status).toBe(0);
      const parsedSummary = JSON.parse(cliSummary.stdout);
      expect(parsedSummary.aggregation.totalValidRecords).toBe(5);

      // 15. CLI execution: verify / diagnostics mode
      const cliVerify = runCli(["telemetry", "verify", "--workspace", ws, "--format", "json"]);
      expect(cliVerify.status).toBe(0);
      const parsedVerify = JSON.parse(cliVerify.stdout);
      expect(parsedVerify.integrityReport.countsBySeverity.error).toBe(0);

      // 16. CLI execution: show <id> lookup
      const targetId = readResult.records[1].eventId!;
      const cliShow = runCli([
        "telemetry",
        "show",
        targetId,
        "--workspace",
        ws,
        "--format",
        "json",
      ]);
      expect(cliShow.status).toBe(0);
      const parsedShow = JSON.parse(cliShow.stdout);
      expect(parsedShow.queryResult.records).toHaveLength(1);
      expect(parsedShow.queryResult.records[0].eventId).toBe(targetId);
    });
  });

  describe("2. Hybrid multi-generation & rotated archives pipeline", () => {
    it("correctly reads, sorts, and aggregates active and rotated logs across generations", async () => {
      const ws = makeTempWorkspace();
      const auditDir = path.join(ws, ".frontier", "audit");

      // Oldest archive: execution.jsonl.2 (Legacy events from 2026-11-15)
      const archive2 = [
        JSON.stringify({
          timestamp: "2026-11-15T08:00:00.000Z",
          event: "SessionStart",
          hookId: "frontier-session-init",
          conversationId: "legacy-sess-1",
          status: "info",
          stepIdx: 1,
        }),
        JSON.stringify({
          timestamp: "2026-11-15T08:01:00.000Z",
          event: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          toolName: "read_file",
          conversationId: "legacy-sess-1",
          status: "info",
          stepIdx: 2,
          metadata: { decision: "allow", category: "safe" },
        }),
      ];
      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl.2"),
        archive2.join("\n") + "\n",
        "utf8",
      );

      // Mid archive: execution.jsonl.1 (Modern events from 2026-11-16)
      const archive1 = [
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-mod-rot-01",
          timestamp: "2026-11-16T08:00:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "success",
          correlationId: "mod-sess-1",
          durationMs: 30,
          stepIdx: 1,
          toolName: "view_file",
          policyDecision: { decision: "allow", category: "safe" },
        }),
      ];
      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl.1"),
        archive1.join("\n") + "\n",
        "utf8",
      );

      // Active log: execution.jsonl (Modern events from 2026-11-17)
      const active = [
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-mod-act-01",
          timestamp: "2026-11-17T08:00:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "denied",
          correlationId: "mod-sess-2",
          durationMs: 80,
          stepIdx: 1,
          toolName: "run_command",
          policyDecision: { decision: "deny", category: "destructive_filesystem" },
        }),
      ];
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), active.join("\n") + "\n", "utf8");

      // Query without --include-rotated: only active
      const cliActiveOnly = runCli(["telemetry", "--workspace", ws, "--format", "json"]);
      expect(cliActiveOnly.status).toBe(0);
      const parsedActive = JSON.parse(cliActiveOnly.stdout);
      expect(parsedActive.queryResult.records).toHaveLength(1);
      expect(parsedActive.queryResult.records[0].eventId).toBe("fe-mod-act-01");

      // Query with --include-rotated: all 4 records in strict chronological order
      const cliAll = runCli([
        "telemetry",
        "--workspace",
        ws,
        "--include-rotated",
        "--format",
        "json",
      ]);
      expect(cliAll.status).toBe(0);
      const parsedAll = JSON.parse(cliAll.stdout);
      expect(parsedAll.queryResult.records).toHaveLength(4);

      // Verify chronological order: .2 (2026-11-15) -> .1 (2026-11-16) -> active (2026-11-17)
      expect(parsedAll.queryResult.records[0].provenance.fileName).toBe("execution.jsonl.2");
      expect(parsedAll.queryResult.records[1].provenance.fileName).toBe("execution.jsonl.2");
      expect(parsedAll.queryResult.records[2].provenance.fileName).toBe("execution.jsonl.1");
      expect(parsedAll.queryResult.records[3].provenance.fileName).toBe("execution.jsonl");

      // Verify generation aggregation via CLI summary
      const cliSummary = runCli([
        "telemetry",
        "summary",
        "--workspace",
        ws,
        "--include-rotated",
        "--format",
        "json",
      ]);
      expect(cliSummary.status).toBe(0);
      const parsedSummary = JSON.parse(cliSummary.stdout);
      expect(parsedSummary.aggregation.totalValidRecords).toBe(4);
      expect(parsedSummary.aggregation.countsByGeneration.modernV1).toBe(2);
      expect(parsedSummary.aggregation.countsByGeneration.legacy).toBe(2);
    });
  });

  describe("3. Resilience, malformed records & quarantine pipeline", () => {
    it("quarantines schema-invalid records and tolerates corrupted lines without crashing", async () => {
      const ws = makeTempWorkspace();
      const auditDir = path.join(ws, ".frontier", "audit");

      const mixedLines = [
        "", // Blank line (should be skipped)
        "{ this is invalid json truncated... ", // Truncated / malformed JSON
        "",
        // Modern record with unsupported schemaVersion
        JSON.stringify({
          schemaVersion: 99,
          eventId: "fe-invalid-ver-001",
          timestamp: "2026-11-18T10:00:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          status: "success",
        }),
        // Modern record with schema violation (missing required hookId and status)
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-schema-viol-001",
          timestamp: "2026-11-18T10:01:00.000Z",
          eventType: "PreToolUse",
        }),
        // Valid modern record
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-valid-001",
          timestamp: "2026-11-18T10:02:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "success",
          correlationId: "sess-resilience-1",
          toolName: "read_file",
          policyDecision: { decision: "allow" },
        }),
      ];

      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        mixedLines.join("\n") + "\n",
        "utf8",
      );

      // Direct reader check
      const result = await readTelemetryLog({ workspaceRoot: ws });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].eventId).toBe("fe-valid-001");
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);

      // Verify specific diagnostic codes
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain("INVALID_JSON");
      expect(codes).toContain("UNSUPPORTED_VERSION");
      expect(codes).toContain("SCHEMA_VIOLATION");

      // Verify CLI execution succeeds and returns the 1 valid record
      const cliRes = runCli(["telemetry", "--workspace", ws, "--format", "json"]);
      expect(cliRes.status).toBe(0);
      const parsed = JSON.parse(cliRes.stdout);
      expect(parsed.queryResult.records).toHaveLength(1);
      expect(parsed.queryResult.records[0].eventId).toBe("fe-valid-001");

      // Verify CLI diagnostics reports the integrity findings
      const cliDiag = runCli(["telemetry", "verify", "--workspace", ws, "--format", "json"]);
      expect(cliDiag.status).toBe(0);
      const parsedDiag = JSON.parse(cliDiag.stdout);
      expect(parsedDiag.integrityReport.countsBySeverity.error).toBeGreaterThan(0);
    });
  });

  describe("4. End-to-end secret redaction verification", () => {
    it("redacts credentials at hook emission, persistence, query, and formatted CLI output", () => {
      const ws = makeTempWorkspace();
      const rawSecret = "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890-XYZ";
      const ghToken = "ghp_123456789012345678901234567890123456";

      // Emit event containing sensitive tokens in reason and commandBin
      writeAuditLog(
        {
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "denied",
          correlationId: "sess-secret-redact",
          conversationId: "sess-secret-redact",
          timestamp: "2026-11-18T14:00:00.000Z",
          stepIdx: 1,
          toolName: "run_command",
          normalizedSummary: {
            toolKind: "command",
            commandBin: `curl -H "Authorization: Bearer ${rawSecret}" https://api.anthropic.com`,
            summary: `Execution with token ${ghToken}`,
          },
          policyDecision: {
            decision: "deny",
            category: "secret_exposure",
            reason: `Disallowed: token ${rawSecret} detected in command`,
          },
        },
        ws,
      );

      // Verify JSONL file on disk does NOT contain the raw secret
      const logFile = path.join(ws, ".frontier", "audit", "execution.jsonl");
      const diskContent = fs.readFileSync(logFile, "utf8");
      expect(diskContent).not.toContain(rawSecret);
      expect(diskContent).not.toContain(ghToken);
      expect(diskContent).toContain("[REDACTED]");

      // Verify CLI Markdown output does NOT contain the raw secret
      const cliMd = runCli(["telemetry", "--workspace", ws, "--format", "markdown"]);
      expect(cliMd.status).toBe(0);
      expect(cliMd.stdout).not.toContain(rawSecret);
      expect(cliMd.stdout).not.toContain(ghToken);

      // Verify CLI JSON output does NOT contain the raw secret
      const cliJson = runCli(["telemetry", "--workspace", ws, "--format", "json"]);
      expect(cliJson.status).toBe(0);
      expect(cliJson.stdout).not.toContain(rawSecret);
      expect(cliJson.stdout).not.toContain(ghToken);
    });
  });

  describe("5. High-volume log & deterministic pagination", () => {
    it("handles 500+ records with deterministic sorting and non-overlapping pagination", async () => {
      const ws = makeTempWorkspace();
      const auditDir = path.join(ws, ".frontier", "audit");
      const totalCount = 500;

      const recordLines: string[] = [];
      const baseTime = 1795000000000;

      for (let i = 0; i < totalCount; i++) {
        const timeIso = new Date(baseTime + i * 1000).toISOString();
        recordLines.push(
          JSON.stringify({
            schemaVersion: 1,
            eventId: `fe-batch-${String(i).padStart(4, "0")}`,
            timestamp: timeIso,
            eventType: "PreToolUse",
            hookId: "frontier-pre-tool-safety",
            source: "production",
            status: i % 2 === 0 ? "success" : "denied",
            correlationId: "batch-session",
            durationMs: i * 10,
            stepIdx: i + 1,
            toolName: i % 3 === 0 ? "read_file" : "run_command",
            policyDecision: {
              decision: i % 2 === 0 ? "allow" : "deny",
              category: "safe",
            },
          }),
        );
      }

      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        recordLines.join("\n") + "\n",
        "utf8",
      );

      // Page 1 with pageSize 50
      const resP1 = runCli([
        "telemetry",
        "--workspace",
        ws,
        "--page",
        "1",
        "--page-size",
        "50",
        "--format",
        "json",
      ]);
      expect(resP1.status).toBe(0);
      const p1 = JSON.parse(resP1.stdout);
      expect(p1.queryResult.records).toHaveLength(50);
      expect(p1.queryResult.pagination.totalMatched).toBe(500);
      expect(p1.queryResult.pagination.totalPages).toBe(10);
      expect(p1.queryResult.records[0].eventId).toBe("fe-batch-0000");
      expect(p1.queryResult.records[49].eventId).toBe("fe-batch-0049");

      // Page 2 with pageSize 50
      const resP2 = runCli([
        "telemetry",
        "--workspace",
        ws,
        "--page",
        "2",
        "--page-size",
        "50",
        "--format",
        "json",
      ]);
      expect(resP2.status).toBe(0);
      const p2 = JSON.parse(resP2.stdout);
      expect(p2.queryResult.records).toHaveLength(50);
      expect(p2.queryResult.records[0].eventId).toBe("fe-batch-0050");
      expect(p2.queryResult.records[49].eventId).toBe("fe-batch-0099");

      // Ensure zero overlap between page 1 and page 2
      const p1Ids = new Set(p1.queryResult.records.map((r: any) => r.eventId));
      const p2Ids = new Set(p2.queryResult.records.map((r: any) => r.eventId));
      for (const id of p1Ids) {
        expect(p2Ids.has(id)).toBe(false);
      }

      // Page 10 (last page)
      const resP10 = runCli([
        "telemetry",
        "--workspace",
        ws,
        "--page",
        "10",
        "--page-size",
        "50",
        "--format",
        "json",
      ]);
      expect(resP10.status).toBe(0);
      const p10 = JSON.parse(resP10.stdout);
      expect(p10.queryResult.records).toHaveLength(50);
      expect(p10.queryResult.records[49].eventId).toBe("fe-batch-0499");
    });
  });

  describe("6. Strict read-only & asset immutability guarantees", () => {
    it("guarantees zero writes or file mutations across multiple operations", () => {
      const ws = makeTempWorkspace();
      const auditDir = path.join(ws, ".frontier", "audit");

      // Write sample active and rotated files
      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl.1"),
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-rot-immut",
          timestamp: "2026-11-18T08:00:00.000Z",
          eventType: "Stop",
          hookId: "frontier-session-stop",
          source: "production",
          status: "info",
        }) + "\n",
        "utf8",
      );

      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-act-immut",
          timestamp: "2026-11-18T09:00:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "production",
          status: "success",
          toolName: "read_file",
        }) + "\n",
        "utf8",
      );

      // Record file stats and hashes before operations
      const activeFile = path.join(auditDir, "execution.jsonl");
      const rotatedFile = path.join(auditDir, "execution.jsonl.1");

      const activeStatBefore = fs.statSync(activeFile);
      const rotatedStatBefore = fs.statSync(rotatedFile);

      const activeContentBefore = fs.readFileSync(activeFile, "utf8");
      const rotatedContentBefore = fs.readFileSync(rotatedFile, "utf8");

      // Execute queries, aggregations, diagnostics, and CLI show commands
      runCli(["telemetry", "--workspace", ws, "--include-rotated"]);
      runCli(["telemetry", "summary", "--workspace", ws, "--include-rotated"]);
      runCli(["telemetry", "verify", "--workspace", ws, "--include-rotated"]);
      runCli(["telemetry", "show", "fe-act-immut", "--workspace", ws]);

      // Verify file stats and contents are completely unchanged
      const activeStatAfter = fs.statSync(activeFile);
      const rotatedStatAfter = fs.statSync(rotatedFile);

      expect(activeStatAfter.size).toBe(activeStatBefore.size);
      expect(activeStatAfter.mtimeMs).toBe(activeStatBefore.mtimeMs);
      expect(fs.readFileSync(activeFile, "utf8")).toBe(activeContentBefore);

      expect(rotatedStatAfter.size).toBe(rotatedStatBefore.size);
      expect(rotatedStatAfter.mtimeMs).toBe(rotatedStatBefore.mtimeMs);
      expect(fs.readFileSync(rotatedFile, "utf8")).toBe(rotatedContentBefore);
    });
  });

  describe("7. Deterministic exit codes and cross-command mutual exclusion", () => {
    it("enforces exit code 2 on invalid CLI options and flag validation errors", () => {
      const ws = makeTempWorkspace();
      // Invalid sort-by
      const resSort = runCli(["telemetry", "--workspace", ws, "--sort-by", "invalid_col"]);
      expect(resSort.status).toBe(2);
      expect(resSort.stderr).toContain("Invalid --sort-by option");

      // Invalid page
      const resPage = runCli(["telemetry", "--workspace", ws, "--page", "0"]);
      expect(resPage.status).toBe(2);
      expect(resPage.stderr).toContain("Invalid --page option");

      // Invalid page-size
      const resPageSize = runCli(["telemetry", "--workspace", ws, "--page-size", "5000"]);
      expect(resPageSize.status).toBe(2);
      expect(resPageSize.stderr).toContain("Invalid --page-size");

      // Inverted time range
      const resTime = runCli([
        "telemetry",
        "--workspace",
        ws,
        "--start-time",
        "2026-11-19T00:00:00.000Z",
        "--end-time",
        "2026-11-18T00:00:00.000Z",
      ]);
      expect(resTime.status).toBe(2);
      expect(resTime.stderr).toContain(
        "Invalid time range: --start-time must be earlier than or equal to --end-time.",
      );
    });

    it("enforces exit code 2 and mutual exclusion between telemetry and intelligence options", () => {
      const ws = makeTempWorkspace();
      // Intelligence option passed to telemetry
      const resIntelToTelem = runCli(["telemetry", "--workspace", ws, "--depth", "3"]);
      expect(resIntelToTelem.status).toBe(2);
      expect(resIntelToTelem.stderr).toContain(
        "Intelligence options are not supported for telemetry/audit",
      );

      // Telemetry option passed to intelligence command
      const resTelemToIntel = runCli(["status", "--workspace", ws, "--include-rotated"]);
      expect(resTelemToIntel.status).toBe(2);
      expect(resTelemToIntel.stderr).toContain(
        "Telemetry options are only supported for 'telemetry' and 'audit'",
      );

      // Markdown format requested for non-telemetry command
      const resMdNonTelem = runCli(["status", "--workspace", ws, "--format", "markdown"]);
      expect(resMdNonTelem.status).toBe(2);
      expect(resMdNonTelem.stderr).toContain("Invalid format option");
    });

    it("enforces exit code 3 when audit directory is unavailable or empty", () => {
      const ws = makeTempWorkspace();
      // Non-existent audit directory
      const resMissing = runCli(["telemetry", "--audit-dir", path.join(ws, "nonexistent-dir")]);
      expect(resMissing.status).toBe(3);
      expect(resMissing.stderr).toContain("Audit directory does not exist or is unavailable");

      // Empty audit directory (no logs written)
      const resEmpty = runCli(["telemetry", "--workspace", ws]);
      expect(resEmpty.status).toBe(3);
      expect(resEmpty.stderr).toContain("No audit log files found");
    });

    it("enforces exit code 4 when target event ID does not exist", () => {
      const ws = makeTempWorkspace();
      fs.writeFileSync(
        path.join(ws, ".frontier", "audit", "execution.jsonl"),
        JSON.stringify({
          schemaVersion: 1,
          eventId: "fe-existing-001",
          timestamp: "2026-11-18T10:00:00.000Z",
          eventType: "SessionStart",
          hookId: "frontier-session-init",
          source: "production",
          status: "info",
        }) + "\n",
        "utf8",
      );

      const resNotFound = runCli(["telemetry", "show", "fe-missing-999", "--workspace", ws]);
      expect(resNotFound.status).toBe(4);
      expect(resNotFound.stderr).toContain("was not found");
    });
  });
});
