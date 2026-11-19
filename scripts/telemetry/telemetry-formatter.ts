/**
 * Phase 8.6B-2: Telemetry Output Formatters
 * Deterministic JSON and Markdown formatters for telemetry query results,
 * aggregate metrics, and structural integrity diagnostics.
 */

import { redactString } from "../hooks/lib/secret-redactor.ts";
import type {
  JsonFormatterOptions,
  MarkdownFormatterOptions,
  TelemetryAggregation,
  TelemetryIntegrityReport,
  TelemetryQueryResult,
} from "./types.ts";

export interface TelemetryFormatInput {
  title?: string;
  queryResult?: TelemetryQueryResult;
  aggregation?: TelemetryAggregation;
  integrityReport?: TelemetryIntegrityReport;
}

/**
 * Recursively canonicalizes object keys in alphabetical order, redacts secrets,
 * and detects circular references via active recursion path tracking.
 */
function canonicalizeJsonValue(value: unknown, activeStack = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      return redactString(value);
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (activeStack.has(value)) {
    return "[Circular]";
  }
  activeStack.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalizeJsonValue(item, activeStack));
    }

    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      const val = (value as Record<string, unknown>)[k];
      if (val !== undefined) {
        sorted[k] = canonicalizeJsonValue(val, activeStack);
      }
    }
    return sorted;
  } finally {
    activeStack.delete(value);
  }
}

/**
 * Formats telemetry data to deterministic JSON with canonical key ordering and secret redaction.
 */
export function formatTelemetryJson(data: unknown, options?: JsonFormatterOptions): string {
  const canonical = canonicalizeJsonValue(data);
  const indent = options?.pretty ? 2 : undefined;
  return JSON.stringify(canonical, null, indent);
}

/**
 * Safely escapes characters that could break Markdown table syntax, inject HTML,
 * or introduce unauthorized links, images, or inline code spans.
 *
 * Protection Scope:
 * - Sanitizes HTML-sensitive characters (&, <, >) to named entities to mitigate HTML injection.
 * - Escapes Markdown table delimiters (|) to prevent cell/column splitting.
 * - Escapes link/image delimiters ([, ]) and inline code backticks (`) to prevent formatting injection.
 * - Normalizes CR, LF, and CRLF newlines to spaces to prevent table row injection.
 * - Preserves Unicode and human-readable text.
 * - Truncates cleanly to maxLen without leaving broken trailing entities or dangling escape backslashes.
 *
 * Scope Limitations:
 * Markdown escaping mitigates injection in compliant Markdown and CommonMark/GFM renderers.
 * It cannot guarantee absolute safety in downstream renderers that perform raw, unescaped HTML
 * rendering or non-standard Markdown extensions.
 */
export function escapeMarkdownCell(val: unknown, maxLen = 40): string {
  if (val === null || val === undefined) return "-";
  let str = typeof val === "string" ? val : String(val);
  str = redactString(str);

  // 1. Normalize line endings (CRLF, CR, LF) to spaces to prevent row injection
  str = str.replace(/\r\n|[\r\n]/g, " ");

  // 2. Escape HTML-sensitive characters in correct order (& first, then < and >)
  str = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 3. Escape Markdown syntax capable of altering structure, injecting links/images, or inline code
  str = str.replace(/\|/g, "\\|").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/`/g, "\\`");

  str = str.trim();

  // 4. Bounded truncation preserving valid entities and escaping
  if (str.length > maxLen) {
    if (maxLen <= 3) {
      return "...".slice(0, maxLen);
    }
    let sliced = str.slice(0, maxLen - 3);
    // Avoid leaving an incomplete HTML entity cut off at the truncation boundary
    sliced = sliced.replace(/&(?:[a-zA-Z]+|#\d+)?$/, "");
    // Avoid leaving an odd trailing backslash that would escape the ellipsis dot
    sliced = sliced.replace(/\\+$/, (match) =>
      match.length % 2 === 1 ? match.slice(0, -1) : match,
    );
    return sliced.trimEnd() + "...";
  }

  return str || "-";
}

/**
 * Formats telemetry query results, aggregations, or integrity reports to clean GitHub Markdown.
 */
export function formatTelemetryMarkdown(
  data: TelemetryFormatInput,
  options?: MarkdownFormatterOptions,
): string {
  const lines: string[] = [];
  const rawTitle = data.title ?? options?.title ?? "Frontier Engineer Telemetry Report";
  const title = escapeMarkdownCell(rawTitle, 120);
  lines.push(`# ${title}`, "");

  const maxRows = options?.maxRows ?? 50;

  // 1. Aggregation Section
  if (data.aggregation) {
    const agg = data.aggregation;
    lines.push("## Summary Statistics", "");
    lines.push("| Metric | Value |");
    lines.push("| :--- | :--- |");
    lines.push(`| Total Valid Records | **${agg.totalValidRecords}** |`);
    lines.push(`| Modern (v1) Records | ${agg.countsByGeneration.modernV1} |`);
    lines.push(`| Historical Legacy Records | ${agg.countsByGeneration.legacy} |`);
    lines.push(`| Distinct Sessions / Correlations | ${agg.distinctCorrelationCount} |`);
    lines.push(`| Distinct Tools Used | ${agg.distinctToolCount} |`);
    lines.push(`| Earliest Timestamp | ${escapeMarkdownCell(agg.firstTimestamp ?? "None", 30)} |`);
    lines.push(`| Latest Timestamp | ${escapeMarkdownCell(agg.lastTimestamp ?? "None", 30)} |`);
    lines.push("");

    // Event types breakdown
    const eventKeys = Object.keys(agg.countsByEventType);
    if (eventKeys.length > 0) {
      lines.push("### Event Type Breakdown", "");
      lines.push("| Event Type | Count |");
      lines.push("| :--- | :--- |");
      for (const k of eventKeys) {
        lines.push(`| \`${escapeMarkdownCell(k)}\` | ${agg.countsByEventType[k]} |`);
      }
      lines.push("");
    }

    // Policy decisions breakdown
    const decisionKeys = Object.keys(agg.countsByPolicyDecision);
    if (decisionKeys.length > 0) {
      lines.push("### Policy Decisions", "");
      lines.push("| Decision | Count |");
      lines.push("| :--- | :--- |");
      for (const k of decisionKeys) {
        lines.push(`| \`${escapeMarkdownCell(k)}\` | ${agg.countsByPolicyDecision[k]} |`);
      }
      lines.push("");
    }

    // Tools breakdown
    const toolKeys = Object.keys(agg.countsByTool);
    if (toolKeys.length > 0) {
      lines.push("### Tool Invocations", "");
      lines.push("| Tool Name | Invocations |");
      lines.push("| :--- | :--- |");
      for (const k of toolKeys) {
        lines.push(`| \`${escapeMarkdownCell(k)}\` | ${agg.countsByTool[k]} |`);
      }
      lines.push("");
    }

    // Diagnostic summary if present
    if (agg.diagnosticSummary) {
      const ds = agg.diagnosticSummary;
      lines.push("### Ingestion Diagnostics", "");
      lines.push(
        `Total diagnostics: ${ds.totalDiagnostics} (Errors: ${ds.errorCount}, Warnings: ${ds.warningCount})`,
      );
      lines.push("");
      const codeKeys = Object.keys(ds.countsByCode);
      if (codeKeys.length > 0) {
        lines.push("| Diagnostic Code | Count |");
        lines.push("| :--- | :--- |");
        for (const k of codeKeys) {
          lines.push(`| \`${escapeMarkdownCell(k)}\` | ${ds.countsByCode[k]} |`);
        }
        lines.push("");
      }
    }
  }

  // 2. Integrity Diagnostics Section
  if (data.integrityReport) {
    const ir = data.integrityReport;
    lines.push("## Structural Integrity Diagnostics", "");
    lines.push(
      `Analyzed: ${ir.totalRecordsAnalyzed} records | Total findings: ${ir.totalFindings}`,
    );
    lines.push("");
    lines.push(
      `- **By Category:** Structural: ${ir.countsByCategory.structural}, Consistency: ${ir.countsByCategory.consistency}, Informational: ${ir.countsByCategory.informational}`,
    );
    lines.push(
      `- **By Severity:** Errors: ${ir.countsBySeverity.error}, Warnings: ${ir.countsBySeverity.warning}, Info: ${ir.countsBySeverity.info}`,
    );
    lines.push("");

    if (ir.findings.length > 0) {
      lines.push("| Severity | Code | Category | Location | Message |");
      lines.push("| :--- | :--- | :--- | :--- | :--- |");
      const displayed = ir.findings.slice(0, maxRows);
      for (const f of displayed) {
        const loc = f.filePath ? `${escapeMarkdownCell(f.filePath, 20)}:${f.lineNumber ?? 0}` : "-";
        lines.push(
          `| **${escapeMarkdownCell(f.severity.toUpperCase(), 10)}** | \`${escapeMarkdownCell(f.code, 25)}\` | ${escapeMarkdownCell(f.category, 20)} | ${loc} | ${escapeMarkdownCell(f.message, 80)} |`,
        );
      }
      lines.push("");
      if (ir.findings.length > maxRows) {
        lines.push(`*Showing ${maxRows} of ${ir.findings.length} findings.*`, "");
      }
    } else {
      lines.push("No structural integrity issues detected.", "");
    }

    if (ir.limitations.length > 0) {
      lines.push("### Limitations & Scope", "");
      for (const lim of ir.limitations) {
        lines.push(`- ${lim}`);
      }
      lines.push("");
    }
  }

  // 3. Query Results Section
  if (data.queryResult) {
    const qr = data.queryResult;
    lines.push("## Telemetry Query Results", "");
    const { totalMatched, page, pageSize, totalPages, hasMore } = qr.pagination;

    if (qr.records.length === 0) {
      lines.push("No telemetry records matched the query criteria.", "");
    } else {
      lines.push(
        `Showing page ${page} of ${totalPages} (${qr.records.length} of ${totalMatched} matched records):`,
        "",
      );
      lines.push(
        "| # | Timestamp | Event Type | Source | Status | Decision | Tool | Correlation ID |",
      );
      lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |");

      for (let i = 0; i < qr.records.length; i++) {
        const r = qr.records[i];
        const rowNum = (page - 1) * pageSize + i + 1;
        lines.push(
          `| ${rowNum} | ${escapeMarkdownCell(r.timestamp, 24)} | \`${escapeMarkdownCell(r.eventType, 16)}\` | ${escapeMarkdownCell(r.source, 12)} | ${escapeMarkdownCell(r.status, 10)} | ${escapeMarkdownCell(r.policyDecision?.decision, 10)} | ${escapeMarkdownCell(r.toolName, 16)} | \`${escapeMarkdownCell(r.correlationId, 20)}\` |`,
        );
      }
      lines.push("");

      if (hasMore) {
        lines.push(`*More records available on page ${page + 1}.*`, "");
      }
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
