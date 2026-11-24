/**
 * Phase 8.2C — Deterministic Markdown Memory Projector
 * Projects SQLite-owned engineering memories to standardized, deterministic Markdown files.
 * Enforces atomic file writing, safe directory partitioning, and user-authored file protection.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../storage/database.ts";
import { MemoryStore } from "../storage/repositories/memory-store.ts";
import { validateWorkspaceContainment } from "./adr-ingest.ts";
import type {
  EngineeringMemoryRecord,
  MemoryCategory,
  MemoryEvidenceRecord,
  MemoryVersionRecord,
} from "../storage/types.ts";

export const PROJECTION_BANNER =
  "<!-- Frontier Engineer Generated Memory Projection. Do not edit directly; modify via 'frontier memory' CLI. -->";

export interface ProjectMemoriesOptions {
  key?: string;
  category?: MemoryCategory;
  outputDir?: string; // Defaults to '.frontier/memories'
  dryRun?: boolean;
}

export interface ProjectedFileResult {
  memoryId: number;
  memoryKey: string;
  category: string;
  filePath: string;
  contentHash: string;
  isNew: boolean;
  status: "WRITTEN" | "UNCHANGED" | "PREVIEW";
}

export interface ProjectionReport {
  success: boolean;
  dryRun: boolean;
  outputDirectory: string;
  totalProjected: number;
  files: ProjectedFileResult[];
  errors: Array<{ key: string; error: string }>;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Renders a memory record deterministically to standard Markdown with frontmatter.
 */
export function renderMemoryMarkdown(
  memory: EngineeringMemoryRecord,
  evidence: MemoryEvidenceRecord[] = [],
  versions: MemoryVersionRecord[] = [],
): string {
  const lines: string[] = [];

  // Frontmatter block
  lines.push("---");
  lines.push("generator: frontier-engineer");
  lines.push(`id: ${memory.id}`);
  lines.push(`key: "${memory.memoryKey}"`);
  lines.push(`category: "${memory.category}"`);
  lines.push(`status: "${memory.status}"`);
  lines.push(`version: ${memory.version}`);
  lines.push(`confidence: ${memory.confidence}`);
  lines.push(`confidence_tier: "${memory.confidenceTier}"`);
  lines.push(`created_at: "${memory.createdAt}"`);
  lines.push(`updated_at: "${memory.updatedAt}"`);
  lines.push(`last_verified_at: "${memory.lastVerifiedAt}"`);
  lines.push(`superseded_by_id: ${memory.supersededById ?? "null"}`);
  lines.push("provenance:");
  lines.push(`  first_seen_scan_id: ${memory.firstSeenScanId ?? "null"}`);
  lines.push(`  last_seen_scan_id: ${memory.lastSeenScanId ?? "null"}`);
  lines.push(`  evidence_count: ${evidence.length}`);
  lines.push(`  historical_versions_count: ${versions.length}`);
  lines.push("---");
  lines.push(PROJECTION_BANNER);
  lines.push("");

  // Document Title and Content
  lines.push(`# ${memory.title}`);
  lines.push("");
  lines.push(memory.content.trim());
  lines.push("");

  // Attached Evidence section if present
  if (evidence.length > 0) {
    lines.push("## Evidence Provenance");
    const sortedEv = [...evidence].sort((a, b) => a.id - b.id);
    for (const ev of sortedEv) {
      const lineRange =
        ev.lineStart !== null && ev.lineEnd !== null
          ? ` (L${ev.lineStart}-L${ev.lineEnd})`
          : ev.lineStart !== null
            ? ` (L${ev.lineStart})`
            : "";
      const hashStr = ev.sourceHash ? ` [${ev.sourceHash.slice(0, 8)}]` : "";
      lines.push(
        `- [${ev.evidenceType}] \`${ev.sourcePath}\`${lineRange}${hashStr}: ${ev.description}`,
      );
    }
    lines.push("");
  }

  // Historical Versions Summary if present
  if (versions.length > 0) {
    lines.push("## Version History");
    const sortedVers = [...versions].sort((a, b) => a.version - b.version);
    for (const v of sortedVers) {
      lines.push(
        `- **v${v.version}** (${v.status}): ${v.changeReason} [hash: ${v.newContentHash.slice(0, 8)}]`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export class MemoryProjector {
  private db: SqliteDatabase;
  private store: MemoryStore;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.store = new MemoryStore(db);
  }

  /**
   * Projects active and durable memories from SQLite to Markdown files.
   */
  public project(
    repositoryId: number,
    workspaceRoot: string,
    options: ProjectMemoriesOptions = {},
  ): ProjectionReport {
    const dryRun = options.dryRun ?? false;
    const outputDirRel = options.outputDir ?? path.join(".frontier", "memories");
    const canonicalOutputDir = validateWorkspaceContainment(workspaceRoot, outputDirRel);

    // Guard: formal ADR directories must NEVER be the target of memory projection
    const forbiddenPatterns = [
      path.join(workspaceRoot, "docs", "adr"),
      path.join(workspaceRoot, "adr"),
      path.join(workspaceRoot, "docs", "architecture-decisions"),
    ];

    for (const forbidden of forbiddenPatterns) {
      const rel = path.relative(path.resolve(forbidden), path.resolve(canonicalOutputDir));
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        throw new Error(
          `Security Error: Projection target '${outputDirRel}' overlaps with formal ADR directory '${forbidden}'. Memory projection cannot overwrite human ADR sources.`,
        );
      }
    }

    const report: ProjectionReport = {
      success: true,
      dryRun,
      outputDirectory: path.relative(workspaceRoot, canonicalOutputDir).replace(/\\/g, "/"),
      totalProjected: 0,
      files: [],
      errors: [],
    };

    let memories: EngineeringMemoryRecord[] = [];
    if (options.key) {
      const m = this.store.getMemoryByKey(repositoryId, options.key);
      if (m) memories.push(m);
      else {
        report.errors.push({
          key: options.key,
          error: `Memory with key '${options.key}' not found in repository ${repositoryId}`,
        });
        report.success = false;
        return report;
      }
    } else {
      memories = this.store.listMemories(repositoryId, {
        category: options.category,
      });
    }

    if (!dryRun && !fs.existsSync(canonicalOutputDir)) {
      fs.mkdirSync(canonicalOutputDir, { recursive: true });
    }

    // Write directory README documenting round-trip limits
    if (!dryRun) {
      const readmePath = path.join(canonicalOutputDir, "README.md");
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(
          readmePath,
          `# Frontier Engineer — Memory Projections\n\nThis directory contains deterministic Markdown projections of Frontier Engineer persistent engineering memories.\n\n## Round-Trip Limitations\n- The SQLite database (\`.frontier/intelligence/index.sqlite\`) is the authoritative source for relational graph topologies, graph edges, and evidence linkages.\n- These Markdown files serve as human-readable projections and exports.\n- Formal ADR source files live in \`docs/adr/\` and are ingested via \`frontier memory ingest-adr\`.\n`,
          "utf8",
        );
      }
    }

    for (const mem of memories) {
      try {
        const catDir = path.join(canonicalOutputDir, mem.category);
        if (!dryRun && !fs.existsSync(catDir)) {
          fs.mkdirSync(catDir, { recursive: true });
        }

        const targetFile = path.join(catDir, `${mem.memoryKey}.md`);
        const relativeTarget = path.relative(workspaceRoot, targetFile).replace(/\\/g, "/");

        const evidence = this.store.getMemoryEvidence(repositoryId, mem.id);
        const versions = this.store.getMemoryVersions(repositoryId, mem.id);

        const rendered = renderMemoryMarkdown(mem, evidence, versions);
        const contentHash = sha256(rendered);

        let status: "WRITTEN" | "UNCHANGED" | "PREVIEW" = dryRun ? "PREVIEW" : "WRITTEN";
        let isNew = true;

        if (fs.existsSync(targetFile)) {
          isNew = false;
          const existingContent = fs.readFileSync(targetFile, "utf8");

          // User-authored file protection guard: verify file has projection banner or generator frontmatter
          if (
            !existingContent.includes(PROJECTION_BANNER) &&
            !existingContent.includes("generator: frontier-engineer")
          ) {
            throw new Error(
              `User-Authored File Protection: Target file '${relativeTarget}' already exists and was not generated by Frontier Engineer. Refusing to overwrite.`,
            );
          }

          if (sha256(existingContent) === contentHash) {
            status = "UNCHANGED";
          }
        }

        if (!dryRun && status !== "UNCHANGED") {
          // Atomic write using temp file and rename
          const tempPath = `${targetFile}.tmp.${Date.now()}`;
          fs.writeFileSync(tempPath, rendered, "utf8");
          fs.renameSync(tempPath, targetFile);
        }

        report.files.push({
          memoryId: mem.id,
          memoryKey: mem.memoryKey,
          category: mem.category,
          filePath: relativeTarget,
          contentHash,
          isNew,
          status,
        });

        report.totalProjected++;
      } catch (err) {
        report.errors.push({
          key: mem.memoryKey,
          error: err instanceof Error ? err.message : String(err),
        });
        report.success = false;
      }
    }

    return report;
  }
}
