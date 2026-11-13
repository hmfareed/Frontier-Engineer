/**
 * Phase 7.5 Stage 3 — Deterministic Comparison Serializer
 * Produces deterministic, stable-ordered JSON representations of snapshot comparisons.
 */

import type { SnapshotComparison } from "./types.ts";

export class ComparisonSerializer {
  public static serialize(comparison: SnapshotComparison, pretty = false): string {
    const normalized = this.normalize(comparison);
    return pretty ? JSON.stringify(normalized, null, 2) : JSON.stringify(normalized);
  }

  private static normalize(obj: any): any {
    if (obj === null || obj === undefined) {
      return null;
    }
    if (typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalize(item));
    }

    // Sort object keys deterministically
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const result: Record<string, any> = {};
    for (const key of sortedKeys) {
      const val = obj[key];
      if (val !== undefined) {
        result[key] = this.normalize(val);
      }
    }
    return result;
  }
}
