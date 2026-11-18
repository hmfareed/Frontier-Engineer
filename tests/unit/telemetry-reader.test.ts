/**
 * Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer Unit Tests
 * Comprehensive verification of streaming reader, log rotation discovery,
 * modern v1 validation, legacy normalization, and corruption tolerance.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";
import {
  discoverAuditFiles,
  normalizeTelemetryRecord,
  parseTelemetryLine,
  readTelemetryLog,
  readTelemetryStream,
  resolveTargetAuditDir,
  type NormalizedTelemetryRecord,
} from "../../scripts/telemetry/index.ts";

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

describe("Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer", () => {
  let tempRoot: string;
  let auditDir: string;
  const root = repoRoot();
  const repoAuditFile = path.join(root, ".frontier", "audit", "execution.jsonl");
  const repoDbFile = path.join(root, ".frontier", "intelligence", "index.sqlite");

  const initialAuditHash = fs.existsSync(repoAuditFile) ? sha256(repoAuditFile) : null;
  const initialDbHash = fs.existsSync(repoDbFile) ? sha256(repoDbFile) : null;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fe-86b1-telemetry-"));
    auditDir = path.join(tempRoot, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });

    // Isolation assertion: verify protected assets are completely untouched
    if (initialAuditHash) {
      expect(sha256(repoAuditFile)).toBe(initialAuditHash);
    }
    if (initialDbHash) {
      expect(sha256(repoDbFile)).toBe(initialDbHash);
    }
  });

  describe("1. Telemetry Parser: Modern v1 vs Historical Legacy Normalization", () => {
    it("parses valid modern v1 records, validates against canonical schema, and preserves all fields", () => {
      const modernRecord = {
        schemaVersion: 1,
        eventId: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-11-17T10:00:00.000Z",
        eventType: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        source: "production",
        correlationId: "conv-modern-100",
        status: "denied",
        stepIdx: 2,
        invocationNum: 1,
        toolName: "run_command",
        durationMs: 4.125,
        policyDecision: {
          decision: "deny",
          semanticClass: "destructive",
          category: "destructive_filesystem",
          reason: "Destructive command rejected",
          fallbackUsed: false,
        },
        normalizedSummary: {
          toolKind: "command",
          commandBin: "rm",
          targetCount: 1,
          workspaceStatus: "verified",
          summary: "command:rm (count=1)",
        },
      };

      const line = JSON.stringify(modernRecord);
      const res = parseTelemetryLine(line, {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.diagnostics).toEqual([]);
      expect(res.record).toBeDefined();
      const rec = res.record!;

      expect(rec.provenance.generation).toBe("modern-v1");
      expect(rec.schemaVersion).toBe(1);
      expect(rec.eventId).toBe("33333333-3333-4333-8333-333333333333");
      expect(rec.eventType).toBe("PreToolUse");
      expect(rec.source).toBe("production");
      expect(rec.correlationId).toBe("conv-modern-100");
      expect(rec.status).toBe("denied");
      expect(rec.policyDecision?.decision).toBe("deny");
      expect(rec.policyDecision?.category).toBe("destructive_filesystem");
      expect(rec.normalizedSummary?.commandBin).toBe("rm");
      expect(rec.raw).toEqual(modernRecord);
    });

    it("parses historical legacy records, normalizes event and conversation aliases, and extracts policy decision", () => {
      const legacyRecord = {
        event: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        conversationId: "conv-legacy-200",
        timestamp: "2026-11-12T14:30:00.123Z",
        stepIdx: 1,
        toolName: "run_command",
        status: "info",
        metadata: {
          decision: "allow",
          category: "safe",
          reason: "Read-only command",
        },
      };

      const line = JSON.stringify(legacyRecord);
      const res = parseTelemetryLine(line, {
        filePath: "execution.jsonl",
        fileName: "execution.jsonl",
        lineNumber: 42,
      });

      expect(res.diagnostics).toEqual([]);
      expect(res.record).toBeDefined();
      const rec = res.record!;

      expect(rec.provenance.generation).toBe("legacy");
      expect(rec.schemaVersion).toBeUndefined(); // NEVER fabricated
      expect(rec.eventId).toBeUndefined(); // NEVER fabricated
      expect(rec.eventType).toBe("PreToolUse"); // Normalized from event
      expect(rec.eventAlias).toBe("PreToolUse");
      expect(rec.correlationId).toBe("conv-legacy-200"); // Normalized from conversationId
      expect(rec.conversationAlias).toBe("conv-legacy-200");
      expect(rec.source).toBe("legacy");
      expect(rec.policyDecision?.decision).toBe("allow"); // Extracted from metadata.decision
      expect(rec.policyDecision?.category).toBe("safe");
      expect(rec.policyDecision?.reason).toBe("Read-only command");
      expect(rec.agentId).toBeUndefined(); // NEVER fabricated
      expect(rec.executionId).toBeUndefined(); // NEVER fabricated
      expect(rec.skillId).toBeUndefined(); // NEVER fabricated
    });

    it("refuses to convert unsupported modern schemaVersion into a legacy record", () => {
      const unsupported = {
        schemaVersion: 2, // Unsupported future version
        eventId: "future-event-99",
        timestamp: "2027-01-01T00:00:00.000Z",
        eventType: "PreToolUse",
        source: "production",
      };

      const res = parseTelemetryLine(JSON.stringify(unsupported), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 10,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics).toHaveLength(1);
      expect(res.diagnostics[0].code).toBe("UNSUPPORTED_VERSION");
      expect(res.diagnostics[0].severity).toBe("error");
      expect(res.diagnostics[0].message).toContain("Unsupported schemaVersion '2'");
    });

    it("detects schema violations in modern records while capturing structured diagnostics", () => {
      const badModern = {
        schemaVersion: 1,
        eventId: "", // Empty eventId violates schema
        timestamp: "not-a-valid-date",
        eventType: "UnknownEventType",
        hookId: "frontier-pre-tool-safety",
        source: "invalid_source",
        correlationId: "corr-1",
        status: "info",
      };

      const res = parseTelemetryLine(JSON.stringify(badModern), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 5,
      });

      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(res.diagnostics.some((d) => d.code === "SCHEMA_VIOLATION")).toBe(true);
    });

    it("detects and flags contradictory aliases in modern records", () => {
      const contradictory = {
        schemaVersion: 1,
        eventId: "44444444-4444-4444-8444-444444444444",
        timestamp: "2026-11-17T12:00:00.000Z",
        eventType: "PreToolUse",
        event: "Stop", // Contradicts eventType
        hookId: "frontier-pre-tool-safety",
        source: "test",
        correlationId: "corr-10",
        conversationId: "corr-20", // Contradicts correlationId
        status: "info",
      };

      const res = parseTelemetryLine(JSON.stringify(contradictory), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 7,
      });

      expect(res.diagnostics.length).toBeGreaterThanOrEqual(2);
      expect(res.diagnostics.some((d) => d.message.includes("must match"))).toBe(true);
    });
  });

  describe("2. Telemetry Reader: File Discovery & Chronological Ordering", () => {
    it("discovers active log only when includeRotated is false", () => {
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), '{"event":"PreToolUse"}\n');
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.1"), '{"event":"SessionStart"}\n');

      const { files, diagnostics } = discoverAuditFiles(auditDir, false);
      expect(diagnostics).toEqual([]);
      expect(files).toHaveLength(1);
      expect(files[0].fileName).toBe("execution.jsonl");
      expect(files[0].isRotated).toBe(false);
    });

    it("orders rotated archives chronologically: .3 -> .2 -> .1 -> execution.jsonl", () => {
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), '{"id":"active"}\n');
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.1"), '{"id":"rot1"}\n');
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.2"), '{"id":"rot2"}\n');
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.3"), '{"id":"rot3"}\n');

      const { files, diagnostics } = discoverAuditFiles(auditDir, true);
      expect(diagnostics).toEqual([]);
      expect(files).toHaveLength(4);
      expect(files.map((f) => f.fileName)).toEqual([
        "execution.jsonl.3",
        "execution.jsonl.2",
        "execution.jsonl.1",
        "execution.jsonl",
      ]);
      expect(files[0].rotationIndex).toBe(3);
      expect(files[1].rotationIndex).toBe(2);
      expect(files[2].rotationIndex).toBe(1);
      expect(files[3].isRotated).toBe(false);
    });

    it("skips non-existent optional rotated files gracefully", () => {
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), '{"id":"active"}\n');
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.2"), '{"id":"rot2"}\n');

      const { files, diagnostics } = discoverAuditFiles(auditDir, true);
      expect(diagnostics).toEqual([]);
      expect(files.map((f) => f.fileName)).toEqual(["execution.jsonl.2", "execution.jsonl"]);
    });

    it("returns empty result with clean diagnostic when audit directory does not exist", () => {
      const nonExistent = path.join(tempRoot, "missing-audit-dir");
      const { files, diagnostics } = discoverAuditFiles(nonExistent, true);
      expect(files).toEqual([]);
      expect(diagnostics).toEqual([]);
    });

    it("rejects path traversal or escaping symlinks inside the audit directory", () => {
      // Create a target file outside the audit directory
      const outsideDir = path.join(tempRoot, "outside");
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, "secret.jsonl");
      fs.writeFileSync(outsideFile, '{"leaked":true}\n');

      // Create a symlink named execution.jsonl.1 pointing outside
      const symlinkPath = path.join(auditDir, "execution.jsonl.1");
      try {
        fs.symlinkSync(outsideFile, symlinkPath, "file");
      } catch {
        // Skip symlink assertion on systems without symlink creation rights (e.g. non-dev Windows)
        return;
      }

      const { files, diagnostics } = discoverAuditFiles(auditDir, true);
      expect(files.some((f) => f.fileName === "execution.jsonl.1")).toBe(false);
      expect(diagnostics.some((d) => d.code === "IO_ERROR")).toBe(true);
      expect(diagnostics.some((d) => d.message.includes("Disallowed symlink"))).toBe(true);
    });
  });

  describe("3. Telemetry Reader: Stream Reading, Malformed Lines & Resilience", () => {
    it("skips blank lines and parses valid records across multiple lines", async () => {
      const content = [
        '{"event":"SessionStart","timestamp":"2026-11-17T01:00:00Z","conversationId":"c1"}',
        "",
        "   ",
        '{"event":"PreToolUse","timestamp":"2026-11-17T01:00:01Z","conversationId":"c1"}',
        "",
      ].join("\n");

      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), content, "utf8");

      const res = await readTelemetryLog({ auditDir });
      expect(res.records).toHaveLength(2);
      expect(res.records[0].eventType).toBe("SessionStart");
      expect(res.records[1].eventType).toBe("PreToolUse");
      expect(res.malformedLineCount).toBe(0);
    });

    it("recovers from malformed JSON between valid records without aborting the scan", async () => {
      const content = [
        '{"event":"SessionStart","timestamp":"2026-11-17T01:00:00Z","conversationId":"c1"}',
        "{this is corrupt json",
        '{"event":"PreToolUse","timestamp":"2026-11-17T01:00:01Z","conversationId":"c1"}',
        '{"not_json_object: true',
        '{"event":"Stop","timestamp":"2026-11-17T01:00:02Z","conversationId":"c1"}',
      ].join("\n");

      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), content, "utf8");

      const res = await readTelemetryLog({ auditDir });
      expect(res.records).toHaveLength(3);
      expect(res.records.map((r) => r.eventType)).toEqual(["SessionStart", "PreToolUse", "Stop"]);
      expect(res.malformedLineCount).toBe(2);
      expect(res.diagnostics.filter((d) => d.code === "INVALID_JSON")).toHaveLength(2);
    });

    it("handles truncated final lines gracefully", async () => {
      const content = [
        '{"event":"SessionStart","timestamp":"2026-11-17T01:00:00Z","conversationId":"c1"}',
        '{"event":"PreToolUse","timestamp":"2026-11-17T01:00:01Z"', // truncated
      ].join("\n");

      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), content, "utf8");

      const res = await readTelemetryLog({ auditDir });
      expect(res.records).toHaveLength(1);
      expect(res.records[0].eventType).toBe("SessionStart");
      expect(res.malformedLineCount).toBe(1);
      expect(res.diagnostics.some((d) => d.code === "INVALID_JSON")).toBe(true);
    });

    it("respects maxLines option", async () => {
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(
          JSON.stringify({
            event: "PreToolUse",
            timestamp: `2026-11-17T01:00:${String(i).padStart(2, "0")}Z`,
            conversationId: `c-${i}`,
          }),
        );
      }
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), lines.join("\n"), "utf8");

      const res = await readTelemetryLog({ auditDir, maxLines: 5 });
      expect(res.records).toHaveLength(5);
    });

    it("supports AbortSignal cancellation gracefully", async () => {
      const lines: string[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(
          JSON.stringify({
            event: "PreToolUse",
            timestamp: `2026-11-17T01:00:${String(i).padStart(2, "0")}Z`,
            conversationId: `c-${i}`,
          }),
        );
      }
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), lines.join("\n"), "utf8");

      const controller = new AbortController();
      const records: NormalizedTelemetryRecord[] = [];

      let count = 0;
      for await (const item of readTelemetryStream({ auditDir, signal: controller.signal })) {
        if (item.type === "record") {
          records.push(item.record);
          count++;
          if (count === 3) {
            controller.abort();
          }
        }
      }

      expect(records.length).toBeLessThanOrEqual(4);
    });

    it("streams large synthetic log of 10,000 records with bounded memory", async () => {
      const targetFile = path.join(auditDir, "execution.jsonl");
      const writeStream = fs.createWriteStream(targetFile, { encoding: "utf8" });

      const count = 10000;
      for (let i = 0; i < count; i++) {
        const item = {
          schemaVersion: 1,
          eventId: `event-uuid-${i}`,
          timestamp: "2026-11-17T12:00:00.000Z",
          eventType: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          source: "test",
          correlationId: `conv-batch-${Math.floor(i / 100)}`,
          status: "info",
          stepIdx: i % 10,
        };
        writeStream.write(JSON.stringify(item) + "\n");
      }
      await new Promise<void>((resolve) => writeStream.end(resolve));

      const initialMem = process.memoryUsage().heapUsed;
      const res = await readTelemetryLog({ auditDir });

      expect(res.records).toHaveLength(count);
      expect(res.malformedLineCount).toBe(0);

      const memDiffMb = (process.memoryUsage().heapUsed - initialMem) / (1024 * 1024);
      // Ensure reading 10k items does not cause runaway memory growth
      expect(memDiffMb).toBeLessThan(120);
    });
  });

  describe("4. Historical Parity & Non-Pollution Verification", () => {
    it("safely reads the real repository audit log without mutating it or changing its hash", async () => {
      if (!fs.existsSync(repoAuditFile)) {
        return;
      }

      const beforeHash = sha256(repoAuditFile);
      const res = await readTelemetryLog({ auditDir: path.dirname(repoAuditFile) });

      // Historical log has 2,311 records
      expect(res.records.length).toBeGreaterThanOrEqual(2300);
      expect(res.records[0].provenance.generation).toBe("legacy");
      expect(res.records[0].eventType).toBeDefined();

      const afterHash = sha256(repoAuditFile);
      expect(afterHash).toBe(beforeHash);
    });
  });

  describe("5. Phase 8.6B-1-R1: AUD-86B1-01 Physical Line Counting & Diagnostic Deduplication", () => {
    it("counts physical lines accurately when a single line yields multiple schema diagnostics", async () => {
      // 1 invalid modern line with 6+ schema errors (empty eventId, bad timestamp, bad eventType, bad source, empty hookId, status mismatch)
      const invalidModern = {
        schemaVersion: 1,
        eventId: "",
        timestamp: "invalid-time",
        eventType: "InvalidEventType",
        hookId: "",
        source: "invalid_source",
        correlationId: "corr-1",
        status: "invalid_status",
      };

      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        JSON.stringify(invalidModern) + "\n",
      );

      const res = await readTelemetryLog({ auditDir });
      // Invariant: exactly 1 physical line read
      expect(res.totalLinesRead).toBe(1);
      // Multiple diagnostics emitted for that single line
      expect(res.diagnostics.length).toBeGreaterThanOrEqual(5);
      // Quarantined: no valid records
      expect(res.records).toHaveLength(0);
      expect(res.validRecordCount).toBe(0);
    });

    it("counts exact physical lines across a mix of valid, invalid, blank, and malformed lines", async () => {
      const lines = [
        JSON.stringify({
          event: "SessionStart",
          timestamp: "2026-11-17T01:00:00Z",
          conversationId: "c1",
        }), // line 1 (valid legacy)
        "", // line 2 (blank)
        JSON.stringify({ schemaVersion: 1, eventId: "bad", source: "bad", eventType: "bad" }), // line 3 (invalid modern, multiple diagnostics)
        "{malformed-json-here", // line 4 (malformed)
        "   ", // line 5 (blank)
        JSON.stringify({ event: "Stop", timestamp: "2026-11-17T01:00:02Z", conversationId: "c1" }), // line 6 (valid legacy)
      ];

      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), lines.join("\n") + "\n");

      const res = await readTelemetryLog({ auditDir });
      // 6 lines written before trailing newline
      expect(res.totalLinesRead).toBe(6);
      expect(res.validRecordCount).toBe(2);
      expect(res.records).toHaveLength(2);
      expect(res.malformedLineCount).toBe(1); // line 4 was INVALID_JSON
      expect(res.diagnostics.some((d) => d.code === "INVALID_JSON")).toBe(true);
      expect(res.diagnostics.some((d) => d.code === "SCHEMA_VIOLATION")).toBe(true);
    });

    it("emits discovery failure diagnostics exactly once without duplication in readTelemetryLog", async () => {
      // Create a sub-file with a path traversal symlink if permitted, or test unreadable file
      const outsideDir = path.join(tempRoot, "outside-dedup");
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, "escape.jsonl");
      fs.writeFileSync(outsideFile, '{"escaped":true}\n');

      const symlinkPath = path.join(auditDir, "execution.jsonl");
      try {
        fs.symlinkSync(outsideFile, symlinkPath, "file");
      } catch {
        return; // Skip on platforms without symlink privilege
      }

      const res = await readTelemetryLog({ auditDir });
      // Invariant: Traversal diagnostic must appear exactly once, not twice
      const traversalDiags = res.diagnostics.filter(
        (d) => d.code === "IO_ERROR" && d.message.includes("Disallowed symlink"),
      );
      expect(traversalDiags).toHaveLength(1);
    });

    it("aggregates physical line counts correctly across multiple rotated files", async () => {
      const rot2Content =
        [
          JSON.stringify({
            event: "SessionStart",
            timestamp: "2026-11-17T01:00:00Z",
            conversationId: "c1",
          }),
          JSON.stringify({
            event: "PreToolUse",
            timestamp: "2026-11-17T01:00:01Z",
            conversationId: "c1",
          }),
        ].join("\n") + "\n"; // 2 lines

      const rot1Content =
        [
          JSON.stringify({
            event: "PostToolUse",
            timestamp: "2026-11-17T01:00:02Z",
            conversationId: "c1",
          }),
        ].join("\n") + "\n"; // 1 line

      const activeContent =
        [
          JSON.stringify({
            event: "Stop",
            timestamp: "2026-11-17T01:00:03Z",
            conversationId: "c1",
          }),
          JSON.stringify({
            event: "Diagnostic",
            timestamp: "2026-11-17T01:00:04Z",
            conversationId: "c1",
          }),
          JSON.stringify({
            event: "SessionStart",
            timestamp: "2026-11-17T01:00:05Z",
            conversationId: "c2",
          }),
        ].join("\n") + "\n"; // 3 lines

      fs.writeFileSync(path.join(auditDir, "execution.jsonl.2"), rot2Content);
      fs.writeFileSync(path.join(auditDir, "execution.jsonl.1"), rot1Content);
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), activeContent);

      const res = await readTelemetryLog({ auditDir, includeRotated: true });
      // Total lines = 2 + 1 + 3 = 6
      expect(res.totalLinesRead).toBe(6);
      expect(res.records).toHaveLength(6);
      expect(res.filesScanned).toHaveLength(3);
    });

    it("handles empty files and files without trailing newlines with exact line counts", async () => {
      // Empty 0-byte file
      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), "");
      const emptyRes = await readTelemetryLog({ auditDir });
      expect(emptyRes.totalLinesRead).toBe(0);
      expect(emptyRes.records).toHaveLength(0);

      // Single line without trailing newline
      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        JSON.stringify({
          event: "SessionStart",
          timestamp: "2026-11-17T01:00:00Z",
          conversationId: "c1",
        }),
      );
      const singleRes = await readTelemetryLog({ auditDir });
      expect(singleRes.totalLinesRead).toBe(1);
      expect(singleRes.records).toHaveLength(1);

      // Two lines without trailing newline on the second
      fs.writeFileSync(
        path.join(auditDir, "execution.jsonl"),
        [
          JSON.stringify({
            event: "SessionStart",
            timestamp: "2026-11-17T01:00:00Z",
            conversationId: "c1",
          }),
          JSON.stringify({
            event: "Stop",
            timestamp: "2026-11-17T01:00:01Z",
            conversationId: "c1",
          }),
        ].join("\n"),
      );
      const twoRes = await readTelemetryLog({ auditDir });
      expect(twoRes.totalLinesRead).toBe(2);
      expect(twoRes.records).toHaveLength(2);
    });
  });

  describe("6. Phase 8.6B-1-R1: AUD-86B1-02 Canonical Path & TOCTOU Protection", () => {
    it("stores the verified canonical path candidateReal in file metadata", () => {
      const activeFile = path.join(auditDir, "execution.jsonl");
      fs.writeFileSync(activeFile, '{"event":"SessionStart"}\n');

      const { files, diagnostics } = discoverAuditFiles(auditDir, false);
      expect(diagnostics).toHaveLength(0);
      expect(files).toHaveLength(1);

      const expectedCanonical = fs.realpathSync(activeFile);
      expect(files[0].filePath).toBe(expectedCanonical);
    });

    it("handles a candidate symlink resolving inside the audit directory correctly", () => {
      const realFile = path.join(auditDir, "actual-target.jsonl");
      fs.writeFileSync(
        realFile,
        '{"event":"SessionStart","timestamp":"2026-11-17T01:00:00Z","conversationId":"c1"}\n',
      );

      const symlinkFile = path.join(auditDir, "execution.jsonl");
      try {
        fs.symlinkSync(realFile, symlinkFile, "file");
      } catch {
        return; // Skip if symlink not supported
      }

      const { files, diagnostics } = discoverAuditFiles(auditDir, false);
      expect(diagnostics).toHaveLength(0);
      expect(files).toHaveLength(1);
      // The filePath must be the real canonical path of actual-target.jsonl
      expect(files[0].filePath).toBe(fs.realpathSync(realFile));
    });

    it("opens verified canonical path even if original candidate path is substituted post-discovery", async () => {
      const realFile = path.join(auditDir, "canonical-source.jsonl");
      fs.writeFileSync(
        realFile,
        JSON.stringify({
          event: "PreToolUse",
          timestamp: "2026-11-17T01:00:00Z",
          conversationId: "conv-canonical",
        }) + "\n",
      );

      const symlinkFile = path.join(auditDir, "execution.jsonl");
      try {
        fs.symlinkSync(realFile, symlinkFile, "file");
      } catch {
        return; // Skip if symlink not supported
      }

      // 1. Discover file metadata (stores canonical-source.jsonl)
      const discovery = discoverAuditFiles(auditDir, false);
      expect(discovery.files).toHaveLength(1);
      expect(discovery.files[0].filePath).toBe(fs.realpathSync(realFile));

      // 2. Simulate TOCTOU attempt: delete the symlink and replace execution.jsonl with adversarial content
      fs.unlinkSync(symlinkFile);
      fs.writeFileSync(
        symlinkFile,
        JSON.stringify({
          event: "PoisonedEvent",
          timestamp: "2026-11-17T01:00:00Z",
          conversationId: "conv-poisoned",
        }) + "\n",
      );

      // 3. Stream using the discovered metadata
      const items: NormalizedTelemetryRecord[] = [];
      for await (const item of readTelemetryStream({
        auditDir,
        discovered: discovery,
      } as any)) {
        if (item.type === "record") {
          items.push(item.record);
        }
      }

      // Invariant: The reader opened canonical-source.jsonl directly, immune to candidate substitution
      expect(items).toHaveLength(1);
      expect(items[0].eventType).toBe("PreToolUse");
      expect(items[0].correlationId).toBe("conv-canonical");
    });
  });

  describe("7. Phase 8.6B-1-R1: AUD-86B1-03 Strict Modern Record Quarantine & Non-Reclassification", () => {
    const validModernBase = {
      schemaVersion: 1,
      eventId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-11-17T12:00:00.000Z",
      eventType: "PreToolUse",
      hookId: "frontier-pre-tool-safety",
      source: "production",
      correlationId: "corr-modern-01",
      status: "info",
    };

    it("accepts and normalizes fully valid modern-v1 records", () => {
      const res = parseTelemetryLine(JSON.stringify(validModernBase), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.diagnostics).toHaveLength(0);
      expect(res.record).toBeDefined();
      expect(res.record!.provenance.generation).toBe("modern-v1");
      expect(res.record!.schemaVersion).toBe(1);
      expect(res.record!.source).toBe("production");
    });

    it("quarantines modern records with invalid source enum (diagnostics only, no record, no legacy fallback)", () => {
      const badSource = { ...validModernBase, source: "invalid_source_value" };
      const res = parseTelemetryLine(JSON.stringify(badSource), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(
        res.diagnostics.some(
          (d) => d.code === "SCHEMA_VIOLATION" && d.message.includes("Invalid source"),
        ),
      ).toBe(true);
    });

    it("quarantines modern records with invalid eventType (diagnostics only, no record)", () => {
      const badType = { ...validModernBase, eventType: "UnknownNonExistentType" };
      const res = parseTelemetryLine(JSON.stringify(badType), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(
        res.diagnostics.some(
          (d) => d.code === "SCHEMA_VIOLATION" && d.message.includes("Invalid eventType"),
        ),
      ).toBe(true);
    });

    it("quarantines modern records with contradictory event / eventType aliases", () => {
      const contradictEvent = { ...validModernBase, event: "Stop" }; // eventType is PreToolUse
      const res = parseTelemetryLine(JSON.stringify(contradictEvent), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(res.diagnostics.some((d) => d.message.includes("must match"))).toBe(true);
    });

    it("quarantines modern records with contradictory correlationId / conversationId aliases", () => {
      const contradictCorr = { ...validModernBase, conversationId: "different-corr-id" };
      const res = parseTelemetryLine(JSON.stringify(contradictCorr), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(res.diagnostics.some((d) => d.message.includes("must match"))).toBe(true);
    });

    it("quarantines modern records missing required modern fields", () => {
      const missingHook = { ...validModernBase };
      delete (missingHook as any).hookId;

      const res = parseTelemetryLine(JSON.stringify(missingHook), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics.some((d) => d.message.includes("hookId"))).toBe(true);
    });

    it("quarantines modern records with empty string eventId or bad ISO timestamp", () => {
      const badId = { ...validModernBase, eventId: "" };
      const resId = parseTelemetryLine(JSON.stringify(badId), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });
      expect(resId.record).toBeUndefined();

      const badTime = { ...validModernBase, timestamp: "not-iso-format" };
      const resTime = parseTelemetryLine(JSON.stringify(badTime), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 2,
      });
      expect(resTime.record).toBeUndefined();
    });

    it("rejects unsupported schemaVersion with UNSUPPORTED_VERSION and no legacy fallback", () => {
      const future = { ...validModernBase, schemaVersion: 2 };
      const res = parseTelemetryLine(JSON.stringify(future), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.record).toBeUndefined();
      expect(res.diagnostics).toHaveLength(1);
      expect(res.diagnostics[0].code).toBe("UNSUPPORTED_VERSION");
    });

    it("correctly accepts and normalizes genuine historical legacy records without schemaVersion", () => {
      const legacy = {
        event: "PreToolUse",
        hookId: "frontier-pre-tool-safety",
        conversationId: "legacy-conv-999",
        timestamp: "2026-11-10T08:00:00.000Z",
        metadata: { decision: "deny", reason: "Blocked by policy" },
      };

      const res = parseTelemetryLine(JSON.stringify(legacy), {
        filePath: "dummy.jsonl",
        fileName: "dummy.jsonl",
        lineNumber: 1,
      });

      expect(res.diagnostics).toHaveLength(0);
      expect(res.record).toBeDefined();
      expect(res.record!.provenance.generation).toBe("legacy");
      expect(res.record!.schemaVersion).toBeUndefined();
      expect(res.record!.eventId).toBeUndefined();
      expect(res.record!.eventType).toBe("PreToolUse");
      expect(res.record!.correlationId).toBe("legacy-conv-999");
      expect(res.record!.policyDecision?.decision).toBe("deny");
    });

    it("verifies readTelemetryLog excludes invalid modern records from records while retaining diagnostics and line count", async () => {
      const lines = [
        JSON.stringify(validModernBase), // Line 1: valid modern
        JSON.stringify({ ...validModernBase, source: "invalid_source", event: "Stop" }), // Line 2: invalid modern (2+ errors)
        JSON.stringify({
          event: "SessionStart",
          timestamp: "2026-11-17T12:00:01.000Z",
          conversationId: "c1",
        }), // Line 3: valid legacy
        JSON.stringify({ event: "PreToolUse", timestamp: "2026-11-17T12:00:02.000Z" }), // Line 4: valid legacy (missing conversationId falls back to unknown-session)
      ];

      fs.writeFileSync(path.join(auditDir, "execution.jsonl"), lines.join("\n") + "\n");

      const res = await readTelemetryLog({ auditDir });

      // Total physical lines = 4
      expect(res.totalLinesRead).toBe(4);
      // Valid records = 3 (Lines 1, 3, 4); Line 2 was quarantined!
      expect(res.records).toHaveLength(3);
      expect(res.validRecordCount).toBe(3);
      // Line 2 was NOT included in records
      expect(res.records.some((r) => r.source === "invalid_source")).toBe(false);
      // Line 2 diagnostics ARE retained
      expect(res.diagnostics.length).toBeGreaterThanOrEqual(2);
      expect(res.diagnostics.some((d) => d.message.includes("Invalid source"))).toBe(true);
      expect(res.diagnostics.some((d) => d.message.includes("must match"))).toBe(true);
    });
  });
});
