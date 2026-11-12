/**
 * Phase 7.3 — Entrypoint Detector
 * Evidence-based identification of CLI, server, browser, and library entrypoints.
 */

import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { EntrypointFinding } from "./types.ts";

export class EntrypointDetector {
  public static detect(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
    rootPath: string,
  ): EntrypointFinding[] {
    const findings: EntrypointFinding[] = [];
    const seenPaths = new Set<string>();

    // 1. Inspect package.json if present
    const pkgJsonPath = path.join(rootPath, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgRaw = fs.readFileSync(pkgJsonPath, "utf8");
        const pkg = JSON.parse(pkgRaw);

        // A. main & module
        if (typeof pkg.main === "string") {
          const norm = this.normalizeRelative(pkg.main);
          if (!seenPaths.has(norm)) {
            seenPaths.add(norm);
            findings.push({
              entrypointId: `entry:${norm}`,
              filePath: norm,
              type: "library",
              status: "CONFIRMED",
              confidence: 1.0,
              evidence: "Declared as package.json 'main' entrypoint",
              exportCount: this.getExportCount(db, scanId, norm),
            });
          }
        }

        if (typeof pkg.module === "string") {
          const norm = this.normalizeRelative(pkg.module);
          if (!seenPaths.has(norm)) {
            seenPaths.add(norm);
            findings.push({
              entrypointId: `entry:${norm}`,
              filePath: norm,
              type: "library",
              status: "CONFIRMED",
              confidence: 1.0,
              evidence: "Declared as package.json 'module' ESM entrypoint",
              exportCount: this.getExportCount(db, scanId, norm),
            });
          }
        }

        // B. bin declarations
        if (typeof pkg.bin === "string") {
          const norm = this.normalizeRelative(pkg.bin);
          if (!seenPaths.has(norm)) {
            seenPaths.add(norm);
            findings.push({
              entrypointId: `entry:${norm}`,
              filePath: norm,
              type: "cli",
              status: "CONFIRMED",
              confidence: 1.0,
              evidence: "Declared as package.json 'bin' executable",
              exportCount: this.getExportCount(db, scanId, norm),
            });
          }
        } else if (pkg.bin && typeof pkg.bin === "object") {
          for (const [binName, binPath] of Object.entries(pkg.bin)) {
            if (typeof binPath === "string") {
              const norm = this.normalizeRelative(binPath);
              if (!seenPaths.has(norm)) {
                seenPaths.add(norm);
                findings.push({
                  entrypointId: `entry:${norm}`,
                  filePath: norm,
                  type: "cli",
                  status: "CONFIRMED",
                  confidence: 1.0,
                  evidence: `Declared as package.json bin '${binName}'`,
                  exportCount: this.getExportCount(db, scanId, norm),
                });
              }
            }
          }
        }

        // C. scripts start
        if (pkg.scripts && typeof pkg.scripts.start === "string") {
          const match = pkg.scripts.start.match(/(?:node|ts-node|tsx)\s+([^\s;&|]+)/);
          if (match && match[1]) {
            const norm = this.normalizeRelative(match[1]);
            if (!seenPaths.has(norm)) {
              seenPaths.add(norm);
              findings.push({
                entrypointId: `entry:${norm}`,
                filePath: norm,
                type: "server",
                status: "CONFIRMED",
                confidence: 0.95,
                evidence: "Targeted by npm start script",
                exportCount: this.getExportCount(db, scanId, norm),
              });
            }
          }
        }
      } catch {
        // Non-fatal if package.json unparseable
      }
    }

    // 2. Query indexed files in scan for known framework entry patterns
    const files = db
      .prepare("SELECT normalized_path FROM files WHERE scan_id = ? ORDER BY normalized_path ASC")
      .all(scanId) as { normalized_path: string }[];

    for (const f of files) {
      const p = f.normalized_path;
      if (seenPaths.has(p)) continue;

      // Next.js App Router / Pages Router
      if (
        p === "app/page.tsx" ||
        p === "app/page.jsx" ||
        p === "src/app/page.tsx" ||
        p === "pages/index.tsx" ||
        p === "pages/index.jsx" ||
        p === "pages/_app.tsx"
      ) {
        seenPaths.add(p);
        findings.push({
          entrypointId: `entry:${p}`,
          filePath: p,
          type: "browser",
          status: "CONFIRMED",
          confidence: 0.95,
          evidence: "Next.js routing entrypoint convention",
          exportCount: this.getExportCount(db, scanId, p),
        });
      }
      // Vite / SPA Main
      else if (
        p === "src/main.tsx" ||
        p === "src/main.ts" ||
        p === "src/main.jsx" ||
        p === "src/main.js"
      ) {
        seenPaths.add(p);
        findings.push({
          entrypointId: `entry:${p}`,
          filePath: p,
          type: "browser",
          status: "CONFIRMED",
          confidence: 0.9,
          evidence: "Standard client application main entrypoint",
          exportCount: this.getExportCount(db, scanId, p),
        });
      }
      // Python Server
      else if (p === "manage.py" || p === "wsgi.py" || p === "asgi.py") {
        seenPaths.add(p);
        findings.push({
          entrypointId: `entry:${p}`,
          filePath: p,
          type: "server",
          status: "CONFIRMED",
          confidence: 0.95,
          evidence: "Python WSGI/ASGI/Django application entrypoint",
          exportCount: 0,
        });
      }
      // Root or src Index library / module (convention-only: marked INFERRED, never CONFIRMED without manifest declaration)
      else if (
        p === "src/index.ts" ||
        p === "src/index.js" ||
        p === "index.ts" ||
        p === "index.js"
      ) {
        seenPaths.add(p);
        const exportCount = this.getExportCount(db, scanId, p);
        findings.push({
          entrypointId: `entry:${p}`,
          filePath: p,
          type: "library",
          status: "INFERRED",
          confidence: exportCount > 0 ? 0.75 : 0.5,
          evidence: `Standard module index convention with ${exportCount} exported symbols (undeclared in package.json)`,
          exportCount,
        });
      }
      // Standalone server.ts / app.ts in root or src
      else if (p === "server.ts" || p === "src/server.ts" || p === "server.js") {
        seenPaths.add(p);
        findings.push({
          entrypointId: `entry:${p}`,
          filePath: p,
          type: "server",
          status: "INFERRED",
          confidence: 0.8,
          evidence: "Standard server entrypoint filename",
          exportCount: this.getExportCount(db, scanId, p),
        });
      }
    }

    return findings;
  }

  private static getExportCount(
    db: SqliteDatabase,
    scanId: number,
    normalizedPath: string,
  ): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM exports e
         JOIN files f ON f.id = e.file_id
         WHERE f.scan_id = ? AND f.normalized_path = ?`,
      )
      .get(scanId, normalizedPath) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  private static normalizeRelative(target: string): string {
    return target.replace(/^\.\//, "").replace(/\\/g, "/");
  }
}
