/**
 * Phase 8.6B-2: Telemetry Query Engine, Aggregator, Diagnostics & Formatter Unit Tests
 * Comprehensive verification of query filtering, deterministic sorting, pagination,
 * aggregation metrics, structural integrity inspection, and JSON/Markdown formatting.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateTelemetry,
  analyzeTelemetryIntegrity,
  escapeMarkdownCell,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  INTEGRITY_LIMITATIONS,
  queryTelemetryRecords,
  type NormalizedTelemetryRecord,
  type ParseDiagnostic,
} from "../../scripts/telemetry/index.ts";

function createMockRecord(
  overrides: Partial<NormalizedTelemetryRecord> = {},
): NormalizedTelemetryRecord {
  const line = overrides.provenance?.lineNumber ?? 1;
  return {
    provenance: {
      filePath: "execution.jsonl",
      fileName: "execution.jsonl",
      lineNumber: line,
      generation: "modern-v1",
      ...overrides.provenance,
    },
    raw: {},
    schemaVersion: 1,
    eventId: `event-${line}`,
    timestamp: "2026-11-17T12:00:00.000Z",
    eventType: "PreToolUse",
    source: "production",
    correlationId: "conv-1",
    hookId: "frontier-pre-tool-safety",
    status: "info",
    ...overrides,
  };
}

describe("Phase 8.6B-2: Telemetry Query Engine, Aggregator & Diagnostics", () => {
  describe("1. Telemetry Query Engine: Filtering & Text Search", () => {
    const dataset: NormalizedTelemetryRecord[] = [
      createMockRecord({
        provenance: {
          filePath: "f1.jsonl",
          fileName: "f1.jsonl",
          lineNumber: 1,
          generation: "modern-v1",
        },
        eventId: "ev-1",
        timestamp: "2026-11-17T10:00:00.000Z",
        eventType: "SessionStart",
        source: "production",
        correlationId: "session-alpha",
        status: "info",
      }),
      createMockRecord({
        provenance: {
          filePath: "f1.jsonl",
          fileName: "f1.jsonl",
          lineNumber: 2,
          generation: "modern-v1",
        },
        eventId: "ev-2",
        timestamp: "2026-11-17T10:01:00.000Z",
        eventType: "PreToolUse",
        source: "production",
        correlationId: "session-alpha",
        toolName: "run_command",
        status: "denied",
        policyDecision: {
          decision: "deny",
          category: "destructive_filesystem",
          reason: "Destructive rm command blocked",
        },
        normalizedSummary: {
          toolKind: "command",
          commandBin: "rm",
          summary: "command:rm",
        },
      }),
      createMockRecord({
        provenance: {
          filePath: "f1.jsonl",
          fileName: "f1.jsonl",
          lineNumber: 3,
          generation: "modern-v1",
        },
        eventId: "ev-3",
        timestamp: "2026-11-17T10:02:00.000Z",
        eventType: "PostToolUse",
        source: "test",
        correlationId: "session-beta",
        toolName: "read_file",
        status: "success",
        durationMs: 15.5,
        policyDecision: {
          decision: "allow",
          category: "safe",
          reason: "Safe read",
        },
      }),
      createMockRecord({
        provenance: {
          filePath: "f1.jsonl",
          fileName: "f1.jsonl",
          lineNumber: 4,
          generation: "legacy",
        },
        schemaVersion: undefined,
        eventId: undefined,
        timestamp: "2026-11-17T10:03:00.000Z",
        eventType: "Stop",
        eventAlias: "Stop",
        source: "legacy",
        correlationId: "session-beta",
        conversationAlias: "session-beta",
        status: "info",
        agentId: undefined, // missing specialist field
      }),
    ];

    it("filters by single criteria: eventType, source, status, toolName, policyDecision", () => {
      expect(queryTelemetryRecords(dataset, { eventType: "PreToolUse" }).records).toHaveLength(1);
      expect(queryTelemetryRecords(dataset, { source: "test" }).records).toHaveLength(1);
      expect(queryTelemetryRecords(dataset, { status: "denied" }).records).toHaveLength(1);
      expect(queryTelemetryRecords(dataset, { toolName: "read_file" }).records).toHaveLength(1);
      expect(queryTelemetryRecords(dataset, { policyDecision: "deny" }).records).toHaveLength(1);
    });

    it("combines multiple filters using strict AND semantics", () => {
      const res = queryTelemetryRecords(dataset, {
        eventType: "PreToolUse",
        source: "production",
        toolName: "run_command",
        policyDecision: "deny",
      });
      expect(res.records).toHaveLength(1);
      expect(res.records[0].eventId).toBe("ev-2");

      // Non-matching AND combination
      const noMatch = queryTelemetryRecords(dataset, {
        eventType: "PreToolUse",
        source: "test", // Dataset item is production
      });
      expect(noMatch.records).toHaveLength(0);
    });

    it("filters by correlationId and legacy conversationId alias", () => {
      const res1 = queryTelemetryRecords(dataset, { correlationId: "session-alpha" });
      expect(res1.records).toHaveLength(2);

      const res2 = queryTelemetryRecords(dataset, { conversationId: "session-beta" });
      expect(res2.records).toHaveLength(2);
    });

    it("handles missing optional specialist fields correctly without negative matches for unfiltered records", () => {
      // Filtering for an agentId that does not exist on legacy records
      const res = queryTelemetryRecords(dataset, { agentId: "specialist-architect" });
      expect(res.records).toHaveLength(0);

      // Filtering by generation
      const modernOnly = queryTelemetryRecords(dataset, { generation: "modern-v1" });
      expect(modernOnly.records).toHaveLength(3);

      const legacyOnly = queryTelemetryRecords(dataset, { generation: "legacy" });
      expect(legacyOnly.records).toHaveLength(1);
      expect(legacyOnly.records[0].eventType).toBe("Stop");
    });

    it("filters across time ranges: startTime, endTime, and exactTime", () => {
      const inRange = queryTelemetryRecords(dataset, {
        startTime: "2026-11-17T10:01:00.000Z",
        endTime: "2026-11-17T10:02:00.000Z",
      });
      expect(inRange.records).toHaveLength(2);
      expect(inRange.records.map((r) => r.eventId)).toEqual(["ev-2", "ev-3"]);

      const exact = queryTelemetryRecords(dataset, {
        exactTime: "2026-11-17T10:02:00.000Z",
      });
      expect(exact.records).toHaveLength(1);
      expect(exact.records[0].eventId).toBe("ev-3");
    });

    it("validates time range inputs and rejects inverted or unparseable ranges", () => {
      expect(() =>
        queryTelemetryRecords(dataset, {
          startTime: "2026-11-17T12:00:00Z",
          endTime: "2026-11-17T10:00:00Z", // inverted
        }),
      ).toThrowError(/cannot be after endTime/);

      expect(() =>
        queryTelemetryRecords(dataset, {
          startTime: "not-a-timestamp",
        }),
      ).toThrowError(/not a valid timestamp/);
    });

    it("performs case-insensitive text search exclusively across approved fields", () => {
      // Matches reason in policyDecision
      const r1 = queryTelemetryRecords(dataset, { textSearch: "destructive rm" });
      expect(r1.records).toHaveLength(1);
      expect(r1.records[0].eventId).toBe("ev-2");

      // Matches toolKind/commandBin in summary
      const r2 = queryTelemetryRecords(dataset, { textSearch: "command:rm" });
      expect(r2.records).toHaveLength(1);

      // Matches correlationId
      const r3 = queryTelemetryRecords(dataset, { textSearch: "session-alpha" });
      expect(r3.records).toHaveLength(2);

      // Non-matching text
      const r4 = queryTelemetryRecords(dataset, { textSearch: "unrelated query" });
      expect(r4.records).toHaveLength(0);
    });

    it("preserves input immutability during query operations", () => {
      const originalCopy = JSON.parse(JSON.stringify(dataset));
      queryTelemetryRecords(dataset, {
        eventType: "PreToolUse",
        sortBy: "durationMs",
        sortOrder: "desc",
      });
      expect(dataset).toEqual(originalCopy);
    });
  });

  describe("2. Telemetry Query Engine: Deterministic Sorting & Pagination", () => {
    const list: NormalizedTelemetryRecord[] = [
      createMockRecord({
        provenance: {
          filePath: "a.jsonl",
          fileName: "a.jsonl",
          lineNumber: 10,
          generation: "modern-v1",
        },
        eventId: "e3",
        timestamp: "2026-11-17T10:00:00.000Z", // identical timestamp
        eventType: "B",
        stepIdx: 3,
      }),
      createMockRecord({
        provenance: {
          filePath: "a.jsonl",
          fileName: "a.jsonl",
          lineNumber: 5,
          generation: "modern-v1",
        },
        eventId: "e1",
        timestamp: "2026-11-17T10:00:00.000Z", // identical timestamp
        eventType: "A",
        stepIdx: 1,
      }),
      createMockRecord({
        provenance: {
          filePath: "b.jsonl",
          fileName: "b.jsonl",
          lineNumber: 2,
          generation: "modern-v1",
        },
        eventId: "e2",
        timestamp: "2026-11-17T10:00:00.000Z", // identical timestamp
        eventType: "C",
        stepIdx: 2,
      }),
      createMockRecord({
        provenance: {
          filePath: "b.jsonl",
          fileName: "b.jsonl",
          lineNumber: 8,
          generation: "modern-v1",
        },
        eventId: "e4",
        timestamp: "2026-11-17T11:00:00.000Z", // later timestamp
        eventType: "D",
        stepIdx: 4,
      }),
    ];

    it("sorts by timestamp with deterministic tie-breaking by filePath and lineNumber", () => {
      const res = queryTelemetryRecords(list, { sortBy: "timestamp", sortOrder: "asc" });
      // e1 (a.jsonl:5) precedes e3 (a.jsonl:10) precedes e2 (b.jsonl:2), followed by later e4
      expect(res.records.map((r) => r.eventId)).toEqual(["e1", "e3", "e2", "e4"]);
    });

    it("sorts descending deterministically", () => {
      const res = queryTelemetryRecords(list, { sortBy: "timestamp", sortOrder: "desc" });
      expect(res.records[0].eventId).toBe("e4");
    });

    it("paginates records cleanly with metadata (totalMatched, page, totalPages, hasMore)", () => {
      const page1 = queryTelemetryRecords(list, { page: 1, pageSize: 2 });
      expect(page1.records).toHaveLength(2);
      expect(page1.pagination).toEqual({
        totalMatched: 4,
        page: 1,
        pageSize: 2,
        totalPages: 2,
        hasMore: true,
      });

      const page2 = queryTelemetryRecords(list, { page: 2, pageSize: 2 });
      expect(page2.records).toHaveLength(2);
      expect(page2.pagination).toEqual({
        totalMatched: 4,
        page: 2,
        pageSize: 2,
        totalPages: 2,
        hasMore: false,
      });

      // Beyond page boundary
      const page3 = queryTelemetryRecords(list, { page: 3, pageSize: 2 });
      expect(page3.records).toHaveLength(0);
      expect(page3.pagination.hasMore).toBe(false);
    });

    it("rejects invalid pagination parameters", () => {
      expect(() => queryTelemetryRecords(list, { page: 0 })).toThrowError(
        /page must be an integer >= 1/,
      );
      expect(() => queryTelemetryRecords(list, { pageSize: 0 })).toThrowError(
        /pageSize must be an integer/,
      );
      expect(() => queryTelemetryRecords(list, { pageSize: 5000 })).toThrowError(
        /between 1 and 1000/,
      );
    });
  });

  describe("3. Telemetry Aggregator: Summary Metrics & Breakdown", () => {
    it("aggregates empty record set into a valid zeroed summary", () => {
      const agg = aggregateTelemetry([]);
      expect(agg.totalValidRecords).toBe(0);
      expect(agg.countsByGeneration).toEqual({ modernV1: 0, legacy: 0 });
      expect(agg.distinctCorrelationCount).toBe(0);
      expect(agg.distinctToolCount).toBe(0);
      expect(agg.firstTimestamp).toBeUndefined();
      expect(agg.lastTimestamp).toBeUndefined();
      expect(agg.countsByEventType).toEqual({});
    });

    it("computes accurate counts across event types, decisions, tools, and generations", () => {
      const records: NormalizedTelemetryRecord[] = [
        createMockRecord({
          eventType: "SessionStart",
          source: "production",
          status: "info",
          correlationId: "c1",
          timestamp: "2026-11-17T01:00:00Z",
        }),
        createMockRecord({
          eventType: "PreToolUse",
          source: "production",
          status: "denied",
          correlationId: "c1",
          toolName: "run_command",
          policyDecision: { decision: "deny" },
          normalizedSummary: { summary: "cmd:rm" },
          timestamp: "2026-11-17T01:01:00Z",
        }),
        createMockRecord({
          provenance: {
            filePath: "hist.jsonl",
            fileName: "hist.jsonl",
            lineNumber: 1,
            generation: "legacy",
          },
          schemaVersion: undefined,
          eventType: "Stop",
          source: "legacy",
          status: "info",
          correlationId: "c2",
          timestamp: "2026-11-17T01:02:00Z",
        }),
      ];

      const diagnostics: ParseDiagnostic[] = [
        {
          severity: "error",
          code: "INVALID_JSON",
          message: "Bad JSON",
          filePath: "f.jsonl",
          lineNumber: 10,
        },
        {
          severity: "warning",
          code: "IO_ERROR",
          message: "Stat warning",
          filePath: "f.jsonl",
          lineNumber: 0,
        },
      ];

      const agg = aggregateTelemetry(records, diagnostics);

      expect(agg.totalValidRecords).toBe(3);
      expect(agg.countsByGeneration).toEqual({ modernV1: 2, legacy: 1 });
      expect(agg.countsByEventType).toEqual(
        {
          PostToolUse: 0, // not in input
          PreToolUse: 1,
          SessionStart: 1,
          Stop: 1,
        }.PreToolUse
          ? { PreToolUse: 1, SessionStart: 1, Stop: 1 }
          : expect.anything(),
      );
      expect(agg.countsByPolicyDecision).toEqual({
        deny: 1,
        none: 2,
      });
      expect(agg.countsByTool).toEqual({
        run_command: 1,
      });
      expect(agg.distinctCorrelationCount).toBe(2);
      expect(agg.firstTimestamp).toBe("2026-11-17T01:00:00Z");
      expect(agg.lastTimestamp).toBe("2026-11-17T01:02:00Z");
      expect(agg.diagnosticSummary).toEqual({
        totalDiagnostics: 2,
        errorCount: 1,
        warningCount: 1,
        countsByCode: {
          INVALID_JSON: 1,
          IO_ERROR: 1,
        },
      });
    });
  });

  describe("4. Telemetry Integrity Engine: Structural & Continuity Diagnostics", () => {
    it("reports EMPTY_AUDIT_LOG when no records or diagnostics are present", () => {
      const rep = analyzeTelemetryIntegrity([]);
      expect(rep.totalFindings).toBe(1);
      expect(rep.findings[0].code).toBe("EMPTY_AUDIT_LOG");
      expect(rep.findings[0].severity).toBe("info");
      expect(rep.limitations).toEqual(INTEGRITY_LIMITATIONS);
    });

    it("integrates parser error diagnostics into structural error findings", () => {
      const parseDiags: ParseDiagnostic[] = [
        {
          severity: "error",
          code: "SCHEMA_VIOLATION",
          message: "Missing required property eventId",
          filePath: "execution.jsonl",
          lineNumber: 4,
          rawSnippet: '{"schemaVersion":1}',
        },
      ];

      const rep = analyzeTelemetryIntegrity([], parseDiags);
      expect(rep.totalFindings).toBe(1);
      expect(rep.countsByCategory.structural).toBe(1);
      expect(rep.findings[0].severity).toBe("error");
      expect(rep.findings[0].code).toBe("SCHEMA_VIOLATION");
      expect(rep.findings[0].lineNumber).toBe(4);
    });

    it("detects duplicate eventId instances across records as consistency warnings", () => {
      const dupId = "same-uuid-1111";
      const records = [
        createMockRecord({
          eventId: dupId,
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 1,
            generation: "modern-v1",
          },
        }),
        createMockRecord({
          eventId: dupId,
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 2,
            generation: "modern-v1",
          },
        }),
      ];

      const rep = analyzeTelemetryIntegrity(records);
      const dupFinding = rep.findings.find((f) => f.code === "DUPLICATE_EVENT_ID");
      expect(dupFinding).toBeDefined();
      expect(dupFinding!.severity).toBe("warning");
      expect(dupFinding!.category).toBe("consistency");
      expect(dupFinding!.message).toContain(
        "Duplicate identifiers are not automatically proof of malicious activity",
      );
    });

    it("detects non-monotonic timestamps within the same correlation session", () => {
      const records = [
        createMockRecord({
          correlationId: "sess-1",
          timestamp: "2026-11-17T12:05:00.000Z", // later
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 1,
            generation: "modern-v1",
          },
        }),
        createMockRecord({
          correlationId: "sess-1",
          timestamp: "2026-11-17T12:01:00.000Z", // earlier in file sequence!
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 2,
            generation: "modern-v1",
          },
        }),
      ];

      const rep = analyzeTelemetryIntegrity(records);
      const nonMonotonic = rep.findings.find((f) => f.code === "NON_MONOTONIC_TIMESTAMP");
      expect(nonMonotonic).toBeDefined();
      expect(nonMonotonic!.severity).toBe("warning");
      expect(nonMonotonic!.category).toBe("consistency");
      expect(nonMonotonic!.message).toContain(
        "Clock skew or concurrent processes do not constitute proof of tampering",
      );
    });

    it("detects stepIdx discontinuities within a session", () => {
      const records = [
        createMockRecord({
          correlationId: "sess-2",
          stepIdx: 1,
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 1,
            generation: "modern-v1",
          },
        }),
        createMockRecord({
          correlationId: "sess-2",
          stepIdx: 5, // Gap: expected 2, got 5
          provenance: {
            filePath: "f.jsonl",
            fileName: "f.jsonl",
            lineNumber: 2,
            generation: "modern-v1",
          },
        }),
      ];

      const rep = analyzeTelemetryIntegrity(records);
      const stepGap = rep.findings.find((f) => f.code === "STEP_INDEX_GAP");
      expect(stepGap).toBeDefined();
      expect(stepGap!.severity).toBe("warning");
      expect(stepGap!.message).toContain("Discontinuity in stepIdx detected");
    });

    it("detects suspected unredacted secrets in text fields", () => {
      const records = [
        createMockRecord({
          policyDecision: {
            decision: "deny",
            reason: "Bearer secret-token-xyz-12345678901234567890", // unredacted bearer pattern
          },
        }),
      ];

      const rep = analyzeTelemetryIntegrity(records);
      const secretFinding = rep.findings.find((f) => f.code === "UNREDACTED_SECRET_SUSPECTED");
      expect(secretFinding).toBeDefined();
      expect(secretFinding!.severity).toBe("warning");
    });
  });

  describe("5. Telemetry Output Formatters: JSON & Markdown", () => {
    const mockRecord = createMockRecord({
      eventId: "test-id-1",
      timestamp: "2026-11-17T12:00:00.000Z",
      eventType: "PreToolUse",
      toolName: "run_command",
      status: "info",
      policyDecision: { decision: "allow" },
    });

    it("formats data to valid JSON with sorted keys and secret redaction", () => {
      const rawData = {
        zProperty: "ghp_111111111111111111111111111111111111", // secret
        aProperty: "normal",
        bProperty: 42,
      };

      const json = formatTelemetryJson(rawData, { pretty: true });
      expect(json).toBeDefined();
      const parsed = JSON.parse(json);
      expect(parsed.aProperty).toBe("normal");
      expect(parsed.zProperty).toContain("[REDACTED]");

      // Check key ordering in JSON output
      const keys = Object.keys(parsed);
      expect(keys).toEqual(["aProperty", "bProperty", "zProperty"]);
    });

    it("handles circular references in JSON serialization safely", () => {
      const circ: any = { name: "loop" };
      circ.self = circ;

      const json = formatTelemetryJson(circ);
      expect(json).toContain('"[Circular]"');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("formats query results, aggregations, and integrity diagnostics to Markdown cleanly", () => {
      const queryResult = queryTelemetryRecords([mockRecord]);
      const aggregation = aggregateTelemetry([mockRecord]);
      const integrityReport = analyzeTelemetryIntegrity([mockRecord]);

      const md = formatTelemetryMarkdown({
        title: "Test Audit Report",
        queryResult,
        aggregation,
        integrityReport,
      });

      expect(md).toContain("# Test Audit Report");
      expect(md).toContain("## Summary Statistics");
      expect(md).toContain("## Structural Integrity Diagnostics");
      expect(md).toContain("## Telemetry Query Results");
      expect(md).toContain("| Total Valid Records | **1** |");
      expect(md).toContain("`run_command`");
    });

    it("escapes Markdown table characters and handles cell truncation", () => {
      const raw =
        "Bad | Table | Injection \n with newline and very long string that should be truncated properly";
      const escaped = escapeMarkdownCell(raw, 30);
      expect(escaped).toContain("\\|"); // pipe is escaped
      expect(escaped).not.toContain("\n");
      expect(escaped.endsWith("...")).toBe(true);
      expect(escaped.length).toBeLessThanOrEqual(30);
    });

    it("formats empty query results with a helpful fallback message", () => {
      const emptyResult = queryTelemetryRecords([], { eventType: "NonExistent" });
      const md = formatTelemetryMarkdown({ queryResult: emptyResult });
      expect(md).toContain("No telemetry records matched the query criteria.");
    });

    describe("AUD-86B2-01: Markdown injection remediation regression tests", () => {
      it("escapes script tags to prevent HTML injection", () => {
        expect(escapeMarkdownCell("<script>alert(1)</script>")).toBe(
          "&lt;script&gt;alert(1)&lt;/script&gt;",
        );
      });

      it("escapes arbitrary HTML tags and entities in correct order", () => {
        expect(escapeMarkdownCell("<div>Hello & welcome <foo>", 60)).toBe(
          "&lt;div&gt;Hello &amp; welcome &lt;foo&gt;",
        );
      });

      it("escapes Markdown link syntax to prevent hyperlink injection", () => {
        expect(escapeMarkdownCell("[Click](https://evil.example)")).toBe(
          "\\[Click\\](https://evil.example)",
        );
      });

      it("escapes Markdown image syntax to prevent image injection", () => {
        expect(escapeMarkdownCell("![image](https://evil.example/image.png)", 60)).toBe(
          "!\\[image\\](https://evil.example/image.png)",
        );
      });

      it("escapes backticks and inline-code syntax", () => {
        expect(escapeMarkdownCell("`code` and ``more``")).toBe("\\`code\\` and \\`\\`more\\`\\`");
      });

      it("escapes pipes and handles multiline values without injecting table columns or rows", () => {
        expect(escapeMarkdownCell("col1 | col2 | col3\nnextline")).toBe(
          "col1 \\| col2 \\| col3 nextline",
        );
      });

      it("normalizes CR, LF, and CRLF newlines to single spaces", () => {
        expect(escapeMarkdownCell("a\r\nb\rc\nd")).toBe("a b c d");
      });

      it("preserves Unicode characters and ordinary readable text", () => {
        expect(escapeMarkdownCell("日本語 🚀 äöü — special test")).toBe(
          "日本語 🚀 äöü — special test",
        );
        expect(escapeMarkdownCell("Simple plain status message 123")).toBe(
          "Simple plain status message 123",
        );
      });

      it("truncates long values cleanly without leaving broken trailing entities or dangling backslashes", () => {
        const longVal = "This is a very long text that must truncate gracefully and cleanly";
        const res = escapeMarkdownCell(longVal, 20);
        expect(res.length).toBeLessThanOrEqual(20);
        expect(res.endsWith("...")).toBe(true);

        // Trailing cut entity handling
        expect(escapeMarkdownCell("foo &lt; bar", 10)).toBe("foo...");
        // Trailing dangling backslash handling
        expect(escapeMarkdownCell("foo | bar", 7)).toBe("foo...");
      });

      it("applies escaping consistently across full Markdown report tables and headers", () => {
        const maliciousReport: any = {
          timestamp: "2026-11-17T12:00:00.000Z",
          totalRecordsAnalyzed: 1,
          totalFindings: 1,
          countsByCategory: { structural: 1, consistency: 0, informational: 0 },
          countsBySeverity: { error: 1, warning: 0, info: 0 },
          findings: [
            {
              code: "INJ_TEST",
              severity: "error",
              category: "structural",
              message: "<script>alert(1)</script> [Click](url) `code` | col",
            },
          ],
          limitations: [],
        };

        const mdReport = formatTelemetryMarkdown({
          title: "Malicious <title>\n## Injected Heading",
          integrityReport: maliciousReport,
        });

        expect(mdReport).toContain("# Malicious &lt;title&gt; ## Injected Heading");
        expect(mdReport).not.toContain("<script>");
        expect(mdReport).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(mdReport).toContain("\\[Click\\](url)");
        expect(mdReport).toContain("\\`code\\`");
        expect(mdReport).toContain("\\| col");
        expect(mdReport).not.toContain("\n## Injected Heading");

        const maliciousRecord = createMockRecord({
          eventType: "<tag>",
          toolName: "[tool](url)",
          correlationId: "s`1`",
          status: "den|inj",
        });
        const mdQuery = formatTelemetryMarkdown({
          queryResult: queryTelemetryRecords([maliciousRecord]),
        });
        expect(mdQuery).toContain("&lt;tag&gt;");
        expect(mdQuery).toContain("\\[tool\\](url)");
        expect(mdQuery).toContain("den\\|inj");
        expect(mdQuery).toContain("s\\`1\\`");
      });
    });

    describe("AUD-86B2-02: JSON active-recursion DAG serialization regression tests", () => {
      it("1. serializes the same nested object referenced by two sibling properties normally", () => {
        const shared = { count: 42, detail: "context-value" };
        const input = { a: shared, b: shared };
        const json = formatTelemetryJson(input);
        const parsed = JSON.parse(json);
        expect(parsed.a).toEqual({ count: 42, detail: "context-value" });
        expect(parsed.b).toEqual({ count: 42, detail: "context-value" });
        expect(json).not.toContain("[Circular]");
      });

      it("2. serializes the same object referenced multiple times in arrays without false circular detection", () => {
        const shared = { item: "entry" };
        const input = { items: [shared, shared, shared] };
        const json = formatTelemetryJson(input);
        const parsed = JSON.parse(json);
        expect(parsed.items).toEqual([{ item: "entry" }, { item: "entry" }, { item: "entry" }]);
        expect(json).not.toContain("[Circular]");
      });

      it("3. detects and flags a genuine direct self-reference", () => {
        const selfRef: Record<string, unknown> = { name: "direct-loop" };
        selfRef.self = selfRef;
        const json = formatTelemetryJson(selfRef);
        const parsed = JSON.parse(json);
        expect(parsed.name).toBe("direct-loop");
        expect(parsed.self).toBe("[Circular]");
      });

      it("4. detects and flags multi-object circular references across deep cycles", () => {
        const nodeA: Record<string, unknown> = { name: "A" };
        const nodeB: Record<string, unknown> = { name: "B" };
        const nodeC: Record<string, unknown> = { name: "C" };
        nodeA.next = nodeB;
        nodeB.next = nodeC;
        nodeC.next = nodeA;

        const json = formatTelemetryJson(nodeA);
        const parsed = JSON.parse(json);
        expect(parsed.name).toBe("A");
        expect(parsed.next.name).toBe("B");
        expect(parsed.next.next.name).toBe("C");
        expect(parsed.next.next.next).toBe("[Circular]");
      });

      it("5. correctly serializes mixed graphs containing both shared DAG references and genuine cycles", () => {
        const shared = { tag: "shared-node" };
        const loopNode: Record<string, unknown> = { id: "loop", shared };
        loopNode.self = loopNode;

        const graph = {
          firstRef: shared,
          loop: loopNode,
          secondRef: shared,
        };

        const json = formatTelemetryJson(graph);
        const parsed = JSON.parse(json);
        expect(parsed.firstRef).toEqual({ tag: "shared-node" });
        expect(parsed.secondRef).toEqual({ tag: "shared-node" });
        expect(parsed.loop.shared).toEqual({ tag: "shared-node" });
        expect(parsed.loop.self).toBe("[Circular]");
      });

      it("6. correctly handles deeply nested supported values, dates, and secret redaction", () => {
        const nested = {
          l1: {
            l2: {
              l3: {
                active: true,
                date: new Date("2026-11-17T00:00:00.000Z"),
                nums: [1, 2, 3],
                token: "ghp_111111111111111111111111111111111111",
              },
            },
          },
        };

        const json = formatTelemetryJson(nested);
        const parsed = JSON.parse(json);
        expect(parsed.l1.l2.l3.token).toContain("[REDACTED]");
        expect(parsed.l1.l2.l3.date).toBe("2026-11-17T00:00:00.000Z");
        expect(parsed.l1.l2.l3.nums).toEqual([1, 2, 3]);
        expect(parsed.l1.l2.l3.active).toBe(true);
      });

      it("7. guarantees input immutability during traversal", () => {
        const inner = { original: "value" };
        const input = { a: inner, b: inner, list: [inner] };
        const deepCloneBefore = JSON.parse(JSON.stringify(input));

        formatTelemetryJson(input);
        expect(input).toEqual(deepCloneBefore);
      });
    });
  });

  describe("6. Telemetry Scale & Performance Verification", () => {
    it("filters and sorts 10,000 in-memory records within tight time bounds", () => {
      const size = 10000;
      const records: NormalizedTelemetryRecord[] = [];
      const baseEpoch = Date.parse("2026-11-17T00:00:00.000Z");

      for (let i = 0; i < size; i++) {
        records.push(
          createMockRecord({
            provenance: {
              filePath: "exec.jsonl",
              fileName: "exec.jsonl",
              lineNumber: i + 1,
              generation: "modern-v1",
            },
            eventId: `scale-event-${i}`,
            timestamp: new Date(baseEpoch + (i % 1000) * 1000).toISOString(),
            eventType: i % 2 === 0 ? "PreToolUse" : "PostToolUse",
            toolName: i % 3 === 0 ? "run_command" : "read_file",
            status: i % 5 === 0 ? "denied" : "info",
            correlationId: `session-${i % 50}`,
          }),
        );
      }

      const t0 = performance.now();
      const res = queryTelemetryRecords(records, {
        eventType: "PreToolUse",
        toolName: "run_command",
        status: "denied",
        page: 1,
        pageSize: 100,
        sortBy: "timestamp",
        sortOrder: "desc",
      });
      const t1 = performance.now();

      expect(res.records.length).toBeLessThanOrEqual(100);
      expect(res.pagination.totalMatched).toBeGreaterThan(0);
      // Ensure processing 10k items takes under 150ms
      expect(t1 - t0).toBeLessThan(150);
    });

    it("aggregates and analyzes integrity of 10,000 in-memory records efficiently", () => {
      const size = 10000;
      const records: NormalizedTelemetryRecord[] = [];
      const baseEpoch = Date.parse("2026-11-17T00:00:00.000Z");

      for (let i = 0; i < size; i++) {
        records.push(
          createMockRecord({
            provenance: {
              filePath: "exec.jsonl",
              fileName: "exec.jsonl",
              lineNumber: i + 1,
              generation: "modern-v1",
            },
            eventId: `scale-event-${i}`,
            timestamp: new Date(baseEpoch + i * 100).toISOString(),
            eventType: i % 4 === 0 ? "SessionStart" : "PreToolUse",
            correlationId: `session-${i % 20}`,
            stepIdx: i % 10,
          }),
        );
      }

      const tAgg0 = performance.now();
      const agg = aggregateTelemetry(records);
      const tAgg1 = performance.now();

      expect(agg.totalValidRecords).toBe(size);
      expect(tAgg1 - tAgg0).toBeLessThan(150);

      const tDiag0 = performance.now();
      const report = analyzeTelemetryIntegrity(records);
      const tDiag1 = performance.now();

      expect(report.totalRecordsAnalyzed).toBe(size);
      expect(tDiag1 - tDiag0).toBeLessThan(250);
    });
  });
});
