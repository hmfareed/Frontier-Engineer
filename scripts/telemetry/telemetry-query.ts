/**
 * Phase 8.6B-2: Telemetry Query Engine
 * Reusable, deterministic query, filtering, sorting, and pagination layer
 * for normalized audit telemetry records.
 */

import type {
  NormalizedTelemetryRecord,
  TelemetryPaginationMeta,
  TelemetryQueryResult,
  TelemetryQuerySpec,
  TelemetrySortField,
  TelemetrySortOrder,
} from "./types.ts";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;

function parseEpoch(val: string | number | Date | undefined, label: string): number | undefined {
  if (val === undefined) return undefined;
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new Error(`Invalid time filter: ${label} must be a finite number.`);
    }
    return val;
  }
  if (val instanceof Date) {
    const ms = val.getTime();
    if (Number.isNaN(ms)) {
      throw new Error(`Invalid time filter: ${label} is an invalid Date.`);
    }
    return ms;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) {
      throw new Error(`Invalid time filter: ${label} ('${trimmed}') is not a valid timestamp.`);
    }
    return ms;
  }
  throw new Error(`Invalid time filter: ${label} has unsupported type '${typeof val}'.`);
}

function matchStringOrArray(
  actual: string | undefined,
  expected: string | string[] | undefined,
  caseInsensitive: boolean = false,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;

  const actualNorm = caseInsensitive ? actual.toLowerCase() : actual;

  if (Array.isArray(expected)) {
    if (expected.length === 0) return true;
    return expected.some((exp) => {
      const expNorm = caseInsensitive ? exp.toLowerCase() : exp;
      return actualNorm === expNorm;
    });
  }

  const expNorm = caseInsensitive ? expected.toLowerCase() : expected;
  return actualNorm === expNorm;
}

/**
 * Approved searchable text fields to prevent secret exposure or metadata pollution.
 */
function extractSearchableText(rec: NormalizedTelemetryRecord): string {
  const parts: string[] = [
    rec.eventType,
    rec.toolName ?? "",
    rec.correlationId,
    rec.policyDecision?.reason ?? "",
    rec.policyDecision?.category ?? "",
    rec.normalizedSummary?.summary ?? "",
    rec.normalizedSummary?.commandBin ?? "",
    rec.error ?? "",
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Queries an array of normalized telemetry records with typed filters, deterministic
 * sorting, and bounded pagination. Operates immutably on supplied records.
 */
export function queryTelemetryRecords(
  records: NormalizedTelemetryRecord[],
  query?: TelemetryQuerySpec,
): TelemetryQueryResult {
  if (!Array.isArray(records)) {
    throw new TypeError("queryTelemetryRecords expects records array as first argument.");
  }

  const q: TelemetryQuerySpec = query ?? {};

  // 1. Pagination parameter validation
  const page = q.page !== undefined ? q.page : 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      `Invalid pagination parameter: page must be an integer >= 1 (received ${page}).`,
    );
  }

  const pageSize = q.pageSize !== undefined ? q.pageSize : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(
      `Invalid pagination parameter: pageSize must be an integer between 1 and ${MAX_PAGE_SIZE} (received ${pageSize}).`,
    );
  }

  // 2. Time filter validation & parsing
  const startEpoch = parseEpoch(q.startTime, "startTime");
  const endEpoch = parseEpoch(q.endTime, "endTime");
  const exactEpoch = parseEpoch(q.exactTime, "exactTime");

  if (startEpoch !== undefined && endEpoch !== undefined && startEpoch > endEpoch) {
    throw new RangeError(
      `Invalid time filter: startTime (${new Date(startEpoch).toISOString()}) cannot be after endTime (${new Date(endEpoch).toISOString()}).`,
    );
  }

  const textQuery = q.textSearch?.trim().toLowerCase();
  const correlationFilter = q.correlationId ?? q.conversationId;

  // 3. Filtering pass (combines all specified filters via AND semantics)
  const filtered = records.filter((rec) => {
    // Event filters
    if (q.eventType !== undefined && !matchStringOrArray(rec.eventType, q.eventType)) {
      return false;
    }
    if (q.eventId !== undefined && rec.eventId !== q.eventId) {
      return false;
    }
    if (
      q.policyDecision !== undefined &&
      !matchStringOrArray(rec.policyDecision?.decision, q.policyDecision, true)
    ) {
      return false;
    }
    if (q.toolName !== undefined && !matchStringOrArray(rec.toolName, q.toolName)) {
      return false;
    }
    if (q.status !== undefined && !matchStringOrArray(rec.status, q.status, true)) {
      return false;
    }
    if (q.source !== undefined && !matchStringOrArray(rec.source, q.source, true)) {
      return false;
    }

    // Correlation filters
    if (correlationFilter !== undefined) {
      const matchesCorrelation =
        rec.correlationId === correlationFilter || rec.conversationAlias === correlationFilter;
      if (!matchesCorrelation) return false;
    }
    if (q.executionId !== undefined && rec.executionId !== q.executionId) {
      return false;
    }
    if (q.agentId !== undefined && rec.agentId !== q.agentId) {
      return false;
    }
    if (q.skillId !== undefined && rec.skillId !== q.skillId) {
      return false;
    }

    // Generation filter
    if (q.generation !== undefined && rec.provenance.generation !== q.generation) {
      return false;
    }

    // Time filters
    if (startEpoch !== undefined || endEpoch !== undefined || exactEpoch !== undefined) {
      const recEpoch = Date.parse(rec.timestamp);
      if (Number.isNaN(recEpoch)) return false;
      if (startEpoch !== undefined && recEpoch < startEpoch) return false;
      if (endEpoch !== undefined && recEpoch > endEpoch) return false;
      if (exactEpoch !== undefined && recEpoch !== exactEpoch) return false;
    }

    // Approved text search
    if (textQuery) {
      const searchable = extractSearchableText(rec);
      if (!searchable.includes(textQuery)) return false;
    }

    return true;
  });

  // 4. Deterministic sorting pass
  const sortBy: TelemetrySortField = q.sortBy ?? "timestamp";
  const sortOrder: TelemetrySortOrder = q.sortOrder ?? "asc";
  const orderMultiplier = sortOrder === "desc" ? -1 : 1;

  filtered.sort((a, b) => {
    let cmp = 0;

    switch (sortBy) {
      case "timestamp": {
        const aEpoch = Date.parse(a.timestamp);
        const bEpoch = Date.parse(b.timestamp);
        const aValid = !Number.isNaN(aEpoch);
        const bValid = !Number.isNaN(bEpoch);
        if (aValid && bValid) {
          cmp = aEpoch - bEpoch;
        } else if (aValid) {
          cmp = -1;
        } else if (bValid) {
          cmp = 1;
        } else {
          cmp = a.timestamp.localeCompare(b.timestamp);
        }
        break;
      }
      case "eventType": {
        cmp = a.eventType.localeCompare(b.eventType);
        break;
      }
      case "durationMs": {
        const aDur = typeof a.durationMs === "number" ? a.durationMs : 0;
        const bDur = typeof b.durationMs === "number" ? b.durationMs : 0;
        cmp = aDur - bDur;
        break;
      }
      case "stepIdx": {
        const aStep = typeof a.stepIdx === "number" ? a.stepIdx : 0;
        const bStep = typeof b.stepIdx === "number" ? b.stepIdx : 0;
        cmp = aStep - bStep;
        break;
      }
    }

    if (cmp !== 0) {
      return cmp * orderMultiplier;
    }

    // Deterministic tie-breaking across identical primary sort keys:
    // 1. File path
    const fileCmp = a.provenance.filePath.localeCompare(b.provenance.filePath);
    if (fileCmp !== 0) return fileCmp;

    // 2. Line number
    const lineCmp = a.provenance.lineNumber - b.provenance.lineNumber;
    if (lineCmp !== 0) return lineCmp;

    // 3. Event identifier if present
    const idA = a.eventId ?? "";
    const idB = b.eventId ?? "";
    return idA.localeCompare(idB);
  });

  // 5. Pagination pass
  const totalMatched = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalMatched / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pageRecords = filtered.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageRecords.length < totalMatched;

  const pagination: TelemetryPaginationMeta = {
    totalMatched,
    page,
    pageSize,
    totalPages,
    hasMore,
  };

  return {
    records: pageRecords,
    pagination,
    appliedQuery: { ...q },
  };
}
