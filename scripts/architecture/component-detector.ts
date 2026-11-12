/**
 * Phase 7.3 — Component Detector
 * Multi-evidence deterministic detection of architectural components and boundaries.
 */

import path from "node:path";
import type { SqliteDatabase } from "../storage/database.ts";
import type { ArchitectureComponent } from "./types.ts";
import type { ComponentCategory, ComponentStatus } from "../storage/types.ts";

export class ComponentDetector {
  public static detect(
    db: SqliteDatabase,
    repositoryId: number,
    scanId: number,
  ): ArchitectureComponent[] {
    const components: ArchitectureComponent[] = [];

    // 1. Query all files and their classifications and extensions
    const fileRows = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, classification, extension, language
         FROM files WHERE scan_id = ? ORDER BY normalized_path ASC`,
      )
      .all(scanId) as {
      id: number;
      normalizedPath: string;
      classification: string;
      extension: string;
      language: string;
    }[];

    // Group files by top-level or second-level directory
    const dirMap = new Map<string, typeof fileRows>();
    for (const f of fileRows) {
      const parts = f.normalizedPath.split("/");
      let groupKey = "";
      if (parts.length > 1) {
        if (parts[0] === "packages" && parts.length > 2) {
          groupKey = `packages/${parts[1]}`;
        } else if (parts[0] === "src" && parts.length > 2) {
          groupKey = `src/${parts[1]}`;
        } else {
          groupKey = parts[0];
        }
      } else {
        groupKey = ".";
      }

      if (!dirMap.has(groupKey)) {
        dirMap.set(groupKey, []);
      }
      dirMap.get(groupKey)!.push(f);
    }

    // 2. Query imports for technology/library evidence
    const importRows = db
      .prepare(
        `SELECT source_file_id AS sourceFileId, imported_specifier AS specifier
         FROM imports WHERE scan_id = ?`,
      )
      .all(scanId) as { sourceFileId: number; specifier: string }[];

    const fileToImports = new Map<number, Set<string>>();
    for (const imp of importRows) {
      if (!fileToImports.has(imp.sourceFileId)) {
        fileToImports.set(imp.sourceFileId, new Set());
      }
      fileToImports.get(imp.sourceFileId)!.add(imp.specifier.toLowerCase());
    }

    // 3. Classify components with evidence
    for (const [dir, files] of dirMap.entries()) {
      if (dir === ".") continue; // Skip root top-level loose files

      const filePaths = files.map((f) => f.normalizedPath);
      const extSet = new Set(files.map((f) => f.extension.toLowerCase()));
      const collectedImports = new Set<string>();
      for (const f of files) {
        const imps = fileToImports.get(f.id);
        if (imps) {
          for (const s of imps) collectedImports.add(s);
        }
      }

      const baseName = path.posix.basename(dir).toLowerCase();

      // Test Subsystem
      if (
        dir.startsWith("tests") ||
        dir.startsWith("test") ||
        dir.includes("__tests__") ||
        files.every(
          (f) => f.normalizedPath.includes(".test.") || f.normalizedPath.includes(".spec."),
        )
      ) {
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "test",
          rootPath: dir,
          status: "CONFIRMED",
          confidence: 1.0,
          detectionMethod: "test_directory_and_suite_conventions",
          evidenceDescription: `Directory contains ${files.length} test files`,
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Documentation Subsystem
      if (dir === "docs" || dir.startsWith("documentation")) {
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "docs",
          rootPath: dir,
          status: "CONFIRMED",
          confidence: 1.0,
          detectionMethod: "docs_directory_convention",
          evidenceDescription: `Documentation tree containing ${files.length} markdown/docs files`,
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Database Subsystem
      const hasSqlFiles = extSet.has(".sql") || extSet.has(".prisma");
      const hasDbImports =
        collectedImports.has("node:sqlite") ||
        collectedImports.has("sqlite3") ||
        collectedImports.has("better-sqlite3") ||
        collectedImports.has("pg") ||
        collectedImports.has("prisma") ||
        collectedImports.has("@prisma/client") ||
        collectedImports.has("typeorm") ||
        collectedImports.has("drizzle-orm");

      if (
        baseName === "db" ||
        baseName === "database" ||
        baseName === "schema" ||
        baseName === "migrations" ||
        hasSqlFiles ||
        hasDbImports
      ) {
        const isConfirmed = hasSqlFiles || hasDbImports;
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "database",
          rootPath: dir,
          status: isConfirmed ? "CONFIRMED" : "INFERRED",
          confidence: isConfirmed ? 0.95 : 0.7,
          detectionMethod: isConfirmed
            ? "database_driver_and_schema_evidence"
            : "naming_convention",
          evidenceDescription: isConfirmed
            ? `Contains database schemas, migrations, or driver imports (${
                Array.from(collectedImports)
                  .filter((i) => i.includes("sql") || i.includes("prisma"))
                  .join(", ") || "SQL files"
              })`
            : "Directory name indicates database layer without verified driver imports",
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Frontend / UI Subsystem
      const hasJsx = extSet.has(".tsx") || extSet.has(".jsx");
      const hasUiImports =
        collectedImports.has("react") ||
        collectedImports.has("react-dom") ||
        collectedImports.has("vue") ||
        collectedImports.has("svelte") ||
        collectedImports.has("next");

      if (
        baseName === "components" ||
        baseName === "ui" ||
        baseName === "pages" ||
        baseName === "views" ||
        baseName === "frontend" ||
        hasJsx ||
        hasUiImports
      ) {
        const isConfirmed = hasJsx || hasUiImports;
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "frontend",
          rootPath: dir,
          status: isConfirmed ? "CONFIRMED" : "INFERRED",
          confidence: isConfirmed ? 0.95 : 0.7,
          detectionMethod: isConfirmed ? "ui_ast_and_framework_imports" : "naming_convention",
          evidenceDescription: isConfirmed
            ? `Contains JSX/TSX components or frontend framework imports (files: ${files.length})`
            : "Directory name suggests UI components without direct JSX evidence",
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Guard: If all files in the directory are documentation, do not classify as backend or api
      const isPureDocs = files.every(
        (f) =>
          f.classification === "documentation" || f.extension === ".md" || f.extension === ".txt",
      );
      const hasSourceFiles = files.some((f) => f.classification === "source");

      // Backend / API Subsystem
      const hasServerImports =
        collectedImports.has("express") ||
        collectedImports.has("fastify") ||
        collectedImports.has("koa") ||
        collectedImports.has("node:http") ||
        collectedImports.has("http");

      if (
        !isPureDocs &&
        hasSourceFiles &&
        (baseName === "api" ||
          baseName === "server" ||
          baseName === "controllers" ||
          baseName === "routes" ||
          baseName === "backend" ||
          hasServerImports)
      ) {
        const isConfirmed = hasServerImports;
        const status: ComponentStatus = isConfirmed
          ? "CONFIRMED"
          : baseName === "api"
            ? "CANDIDATE"
            : "INFERRED";
        const confidence = isConfirmed ? 0.95 : baseName === "api" ? 0.45 : 0.65;
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "backend",
          rootPath: dir,
          status,
          confidence,
          detectionMethod: isConfirmed ? "server_framework_imports" : "naming_convention",
          evidenceDescription: isConfirmed
            ? `Contains server route handlers or HTTP framework imports (${Array.from(
                collectedImports,
              )
                .filter((i) => i.includes("express") || i.includes("http") || i.includes("fastify"))
                .join(", ")})`
            : "Directory name suggests API/backend layer without confirmed server framework imports",
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Auth Subsystem
      const hasAuthImports =
        collectedImports.has("jsonwebtoken") ||
        collectedImports.has("bcrypt") ||
        collectedImports.has("passport") ||
        collectedImports.has("next-auth");

      if (baseName === "auth" || hasAuthImports) {
        const isConfirmed = hasAuthImports;
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "auth",
          rootPath: dir,
          status: isConfirmed ? "CONFIRMED" : "INFERRED",
          confidence: isConfirmed ? 0.95 : 0.7,
          detectionMethod: isConfirmed ? "security_credential_libraries" : "naming_convention",
          evidenceDescription: isConfirmed
            ? "Contains security/token verification dependencies"
            : "Directory named auth without verified crypto/auth imports",
          filesCount: files.length,
          filePaths,
        });
        continue;
      }

      // Shared Library / Core Package
      if (
        dir.startsWith("packages/") ||
        baseName === "shared" ||
        baseName === "lib" ||
        baseName === "common"
      ) {
        components.push({
          componentIdentity: `comp:${dir}`,
          name: dir,
          category: "shared_lib",
          rootPath: dir,
          status: dir.startsWith("packages/") ? "CONFIRMED" : "INFERRED",
          confidence: dir.startsWith("packages/") ? 0.9 : 0.75,
          detectionMethod: dir.startsWith("packages/")
            ? "monorepo_package_boundary"
            : "shared_library_convention",
          evidenceDescription: `Modular component containing ${files.length} source files`,
          filesCount: files.length,
          filePaths,
        });
        continue;
      }
    }

    return components;
  }
}
