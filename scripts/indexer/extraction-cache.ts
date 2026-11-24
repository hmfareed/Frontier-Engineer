/**
 * Phase 8.1-R1 — Safe Extraction Cache for Incremental Refresh
 * Keyed by content hash and extractor version to ensure deterministic, isolated reuse.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExtractionResult } from "../extractor/types.ts";

export interface ExtractionCacheEntry {
  extractorVersion: string;
  contentHash: string;
  result: ExtractionResult;
}

export interface ExtractionCacheData {
  version: number;
  entries: Record<string, ExtractionCacheEntry>;
}

export class ExtractionCache {
  private cacheFilePath: string;
  private entries: Map<string, ExtractionCacheEntry> = new Map();
  private dirty = false;

  constructor(workspaceRoot: string) {
    this.cacheFilePath = path.join(workspaceRoot, ".frontier", "cache", "ast-extractions.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, "utf8");
        const parsed = JSON.parse(raw) as ExtractionCacheData;
        if (parsed && parsed.version === 1 && typeof parsed.entries === "object") {
          for (const [hash, entry] of Object.entries(parsed.entries)) {
            if (entry && entry.contentHash === hash && entry.result) {
              this.entries.set(hash, entry);
            }
          }
        }
      }
    } catch {
      // Safe fallback: start with empty cache if read/parse fails
      this.entries.clear();
    }
  }

  public get(contentHash: string, extractorVersion: string): ExtractionResult | null {
    const entry = this.entries.get(contentHash);
    if (!entry) return null;
    if (entry.extractorVersion !== extractorVersion) return null;
    return entry.result;
  }

  public set(contentHash: string, extractorVersion: string, result: ExtractionResult): void {
    if (!contentHash || result.status === "FAILED") return;
    this.entries.set(contentHash, {
      extractorVersion,
      contentHash,
      result,
    });
    this.dirty = true;
  }

  public save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: ExtractionCacheData = {
        version: 1,
        entries: Object.fromEntries(this.entries.entries()),
      };
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), "utf8");
      this.dirty = false;
    } catch {
      // Non-fatal if cache write fails
    }
  }
}
