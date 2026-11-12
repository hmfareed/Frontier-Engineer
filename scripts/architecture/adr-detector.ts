/**
 * Phase 7.4 — Architecture Decision Record (ADR) Detector
 * Discovers, parses, and associates documented architecture decisions with repository components.
 */

import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { AdrFinding } from "./types.ts";

export class AdrDetector {
  public static detect(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
    rootPath: string,
  ): AdrFinding[] {
    const findings: AdrFinding[] = [];

    // 1. Query indexed files matching ADR path conventions
    const adrFiles = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath
         FROM files
         WHERE scan_id = ?
           AND (
             normalized_path LIKE 'docs/adr/ADR-%.md'
             OR normalized_path LIKE 'docs/%/ADR-%.md'
             OR normalized_path LIKE 'adr/ADR-%.md'
             OR normalized_path LIKE 'ADR-%.md'
           )
         ORDER BY normalized_path ASC`,
      )
      .all(scanId) as { id: number; normalizedPath: string }[];

    // 2. Query components to associate ADRs with governed components
    const componentRows = db
      .prepare(
        `SELECT component_identity AS identity, name, root_path AS rootPath, category
         FROM architecture_components
         WHERE scan_id = ?`,
      )
      .all(scanId) as { identity: string; name: string; rootPath: string; category: string }[];

    const realWsRoot = fs.existsSync(rootPath) ? fs.realpathSync(rootPath) : path.resolve(rootPath);

    for (const file of adrFiles) {
      const fullPath = path.resolve(rootPath, file.normalizedPath);

      // Security check: verify path remains within workspace root
      try {
        if (!fs.existsSync(fullPath)) continue;
        const realFilePath = fs.realpathSync(fullPath);
        const rel = path.relative(realWsRoot, realFilePath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          // Path traversal attempt or symlink outside workspace
          continue;
        }

        const content = fs.readFileSync(realFilePath, "utf8");
        const parsed = this.parseAdrContent(file.normalizedPath, content, componentRows);
        if (parsed) {
          findings.push(parsed);
        }
      } catch {
        // Skip unreadable files cleanly without crashing
      }
    }

    // Sort deterministically by ADR number ASC, then ADR ID ASC
    findings.sort((a, b) => a.number - b.number || a.adrId.localeCompare(b.adrId));

    return findings;
  }

  private static parseAdrContent(
    filePath: string,
    content: string,
    components: { identity: string; name: string; rootPath: string; category: string }[],
  ): AdrFinding | null {
    if (content.trim().length === 0) return null;
    const lines = content.split(/\r?\n/);

    // 1. Extract Title and ID
    let adrId = "";
    let number = 0;
    let title = "";

    const titleMatch = content.match(/^#\s+(ADR-(\d+)[^:\n]*):\s*(.+)$/m);
    if (titleMatch) {
      adrId = titleMatch[1].trim();
      number = parseInt(titleMatch[2], 10);
      title = titleMatch[3].trim();
    } else {
      // Fallback matching
      const simpleMatch = content.match(/^#\s+(ADR-(\d+)[^\n]*)/m);
      if (simpleMatch) {
        adrId = simpleMatch[1].trim();
        number = parseInt(simpleMatch[2], 10);
        title = adrId;
      } else {
        const fileBase = path.posix.basename(filePath, ".md");
        const numMatch = fileBase.match(/ADR-(\d+)/i);
        if (numMatch) {
          number = parseInt(numMatch[1], 10);
          adrId = `ADR-${String(number).padStart(3, "0")}`;
          title = fileBase;
        } else {
          return null;
        }
      }
    }

    // 2. Extract Metadata (Status, Date, Phase, Related)
    let status = "Proposed";
    let date: string | undefined;
    let phase: string | undefined;
    const relatedDocuments: string[] = [];

    const statusMatch = content.match(/[-*]\s+\*\*Status:\*\*\s*([^\n\r]+)/i);
    if (statusMatch) {
      status = statusMatch[1].trim();
    }

    const dateMatch = content.match(/[-*]\s+\*\*Date:\*\*\s*([^\n\r]+)/i);
    if (dateMatch) {
      date = dateMatch[1].trim();
    }

    const phaseMatch = content.match(/[-*]\s+\*\*Phase:\*\*\s*([^\n\r]+)/i);
    if (phaseMatch) {
      phase = phaseMatch[1].trim();
    }

    // Extract links in Related line
    const relatedSectionMatch = content.match(/[-*]\s+\*\*Related:\*\*\s*([^\n\r]+)/i);
    if (relatedSectionMatch) {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(relatedSectionMatch[1])) !== null) {
        relatedDocuments.push(m[2]);
      }
    }

    // 3. Identify Governed Components
    const governedComponents: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const comp of components) {
      const compBase = path.posix.basename(comp.rootPath).toLowerCase();
      if (
        lowerContent.includes(comp.rootPath.toLowerCase()) ||
        lowerContent.includes(`comp:${comp.name.toLowerCase()}`) ||
        (compBase.length >= 4 && lowerContent.includes(compBase))
      ) {
        if (!governedComponents.includes(comp.identity)) {
          governedComponents.push(comp.identity);
        }
      }
    }

    return {
      adrId,
      number,
      title,
      status,
      date,
      phase,
      filePath,
      governedComponents,
      relatedDocuments,
      evidenceDescription: `Architecture Decision Record parsed from ${filePath} (Status: ${status}, Phase: ${phase ?? "N/A"})`,
      confidence: 1.0,
    };
  }
}
