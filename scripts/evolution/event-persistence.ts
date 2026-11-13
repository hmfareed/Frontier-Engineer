/**
 * Phase 7.5 Stage 3 — Evolution Event Persistence Boundary
 * Transaction-safe, idempotent persistence of factual change events to evolution_events table.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { EvolutionEventRecord } from "../storage/types.ts";
import { SnapshotValidator } from "./snapshot-validator.ts";
import type { SnapshotComparison } from "./types.ts";

export class EventPersistenceBoundary {
  public static persist(
    db: SqliteDatabase,
    comparison: SnapshotComparison,
  ): EvolutionEventRecord[] {
    const repositoryId = comparison.repositoryId;
    const baseScanId = comparison.baseSnapshot.scanId;
    const targetScanId = comparison.targetSnapshot.scanId;
    const now = new Date().toISOString();

    const insertStmt = db.prepare(
      `INSERT INTO evolution_events (
        repository_id, base_scan_id, target_scan_id, event_type,
        category, title, description, severity, confidence,
        confidence_tier, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const deleteStmt = db.prepare(
      `DELETE FROM evolution_events
       WHERE repository_id = ? AND base_scan_id = ? AND target_scan_id = ?`,
    );

    const persistedEvents: EvolutionEventRecord[] = [];

    db.transaction(() => {
      // 0. Ownership & snapshot validity guard before destructive delete-and-reinsert
      const baseScan = db
        .prepare("SELECT id, repository_id AS repositoryId, status FROM scan_runs WHERE id = ?")
        .get(baseScanId) as { id: number; repositoryId: number; status: string } | undefined;
      const targetScan = db
        .prepare("SELECT id, repository_id AS repositoryId, status FROM scan_runs WHERE id = ?")
        .get(targetScanId) as { id: number; repositoryId: number; status: string } | undefined;

      if (!baseScan || !targetScan) {
        throw new Error(
          `Cannot persist evolution events: snapshot pair (${baseScanId}, ${targetScanId}) does not exist.`,
        );
      }

      if (baseScan.repositoryId !== repositoryId || targetScan.repositoryId !== repositoryId) {
        throw new Error(
          `Cannot persist evolution events: repository ownership mismatch for repository ${repositoryId}.`,
        );
      }

      const allowPartial =
        comparison.status === "PARTIAL" ||
        comparison.baseSnapshot.status === "PARTIAL" ||
        comparison.targetSnapshot.status === "PARTIAL";
      const validation = SnapshotValidator.validate(db, baseScanId, targetScanId, {
        allowPartial,
      });
      if (!validation.isValid || validation.repositoryId !== repositoryId) {
        throw new Error(
          validation.errorMessage ||
            `Snapshot validation failed during event persistence for (${baseScanId}, ${targetScanId}).`,
        );
      }

      // 1. Idempotency: remove prior factual events for this exact comparison pair
      deleteStmt.run(repositoryId, baseScanId, targetScanId);

      // 2. Persist File Events (factual changes only)
      for (const f of comparison.files.changes) {
        if (f.changeType === "UNCHANGED") continue;

        let eventType = `FILE_${f.changeType}`;
        let title = `File ${f.changeType.toLowerCase()}: ${f.path}`;
        let description = `File '${f.path}' was ${f.changeType.toLowerCase()} in snapshot ${targetScanId}`;
        let confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE" = "CONFIRMED";
        let confidence = 1.0;

        if (f.isInferredRename && f.renameSourcePath) {
          eventType = "FILE_RENAMED";
          title = `File renamed: ${f.renameSourcePath} -> ${f.path}`;
          description = `File was inferred as renamed from '${f.renameSourcePath}' to '${f.path}' with identical content hash`;
          confidenceTier = "INFERRED";
          confidence = f.renameConfidence ?? 0.95;
        }

        const detailsJson = JSON.stringify({
          path: f.path,
          baseHash: f.baseHash,
          targetHash: f.targetHash,
          renameSourcePath: f.renameSourcePath,
        });

        const res = insertStmt.run(
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          "file",
          title,
          description,
          "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          now,
        );

        persistedEvents.push({
          id: Number(res.lastInsertRowid),
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          category: "file",
          title,
          description,
          severity: "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          createdAt: now,
        });
      }

      // 3. Persist Symbol Events
      for (const s of comparison.symbols.changes) {
        if (s.changeType === "UNCHANGED") continue;

        const eventType = `SYMBOL_${s.changeType}`;
        const title = `Symbol ${s.changeType.toLowerCase()}: ${s.name} (${s.kind})`;
        const description = `Symbol '${s.name}' of kind '${s.kind}' was ${s.changeType.toLowerCase()}`;
        const confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE" =
          s.changeType === "RELOCATED" ? "INFERRED" : "CONFIRMED";
        const confidence =
          s.changeType === "RELOCATED" ? 0.9 : (s.targetConfidence ?? s.baseConfidence ?? 1.0);

        const detailsJson = JSON.stringify({
          symbolIdentity: s.symbolIdentity,
          name: s.name,
          kind: s.kind,
          basePath: s.basePath,
          targetPath: s.targetPath,
          baseFingerprint: s.baseFingerprint,
          targetFingerprint: s.targetFingerprint,
          baseLines: s.baseLines,
          targetLines: s.targetLines,
        });

        const res = insertStmt.run(
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          "symbol",
          title,
          description,
          "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          now,
        );

        persistedEvents.push({
          id: Number(res.lastInsertRowid),
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          category: "symbol",
          title,
          description,
          severity: "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          createdAt: now,
        });
      }

      // 4. Persist Dependency Events
      for (const d of comparison.dependencies.changes) {
        if (d.changeType === "UNCHANGED") continue;

        const eventType = `DEPENDENCY_${d.changeType}`;
        const title = `Dependency ${d.changeType.toLowerCase()}: ${d.sourcePath} -> ${d.specifier}`;
        const description = `Import of '${d.specifier}' in '${d.sourcePath}' was ${d.changeType.toLowerCase()}`;
        const confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE" =
          d.changeType === "UNRESOLVED" ? "CANDIDATE" : "CONFIRMED";

        const detailsJson = JSON.stringify({
          sourcePath: d.sourcePath,
          specifier: d.specifier,
          importKind: d.importKind,
          baseResolvedPath: d.baseResolvedPath,
          targetResolvedPath: d.targetResolvedPath,
          baseResolutionStatus: d.baseResolutionStatus,
          targetResolutionStatus: d.targetResolutionStatus,
        });

        const res = insertStmt.run(
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          "dependency",
          title,
          description,
          d.changeType === "UNRESOLVED" ? "LOW" : "INFO",
          d.confidence,
          confidenceTier,
          detailsJson,
          now,
        );

        persistedEvents.push({
          id: Number(res.lastInsertRowid),
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          category: "dependency",
          title,
          description,
          severity: d.changeType === "UNRESOLVED" ? "LOW" : "INFO",
          confidence: d.confidence,
          confidenceTier,
          detailsJson,
          createdAt: now,
        });
      }

      // 5. Persist Architecture Component Events
      for (const c of comparison.components.changes) {
        if (c.changeType === "UNCHANGED") continue;

        const eventType = `COMPONENT_${c.changeType}`;
        const title = `Component ${c.changeType.toLowerCase()}: ${c.name}`;
        const description = `Architectural component '${c.name}' (${c.category}) was ${c.changeType.toLowerCase()}`;
        const effectiveStatus = c.targetStatus ?? c.baseStatus;
        const confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE" =
          effectiveStatus === "CONFIRMED"
            ? "CONFIRMED"
            : effectiveStatus === "CANDIDATE"
              ? "CANDIDATE"
              : "INFERRED";
        const confidence = c.targetConfidence ?? c.baseConfidence ?? 0.9;

        const detailsJson = JSON.stringify({
          componentIdentity: c.componentIdentity,
          name: c.name,
          category: c.category,
          rootPath: c.rootPath,
          addedMemberFiles: c.addedMemberFiles,
          removedMemberFiles: c.removedMemberFiles,
        });

        const res = insertStmt.run(
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          "architecture",
          title,
          description,
          "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          now,
        );

        persistedEvents.push({
          id: Number(res.lastInsertRowid),
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          category: "architecture",
          title,
          description,
          severity: "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          createdAt: now,
        });
      }

      // 6. Persist ADR Decision Events
      for (const a of comparison.adrs.changes) {
        if (a.changeType === "UNCHANGED") continue;

        const eventType = `ADR_${a.changeType}`;
        const title = `Decision ${a.changeType.toLowerCase()}: ${a.adrId} (${a.title})`;
        const description = `Architecture Decision Record '${a.adrId}' was ${a.changeType.toLowerCase()}`;
        const confidenceTier: "CONFIRMED" | "INFERRED" | "CANDIDATE" = a.isFallback
          ? "INFERRED"
          : "CONFIRMED";
        const confidence = a.confidence ?? (a.isFallback ? 0.7 : 1.0);

        const detailsJson = JSON.stringify({
          adrId: a.adrId,
          number: a.number,
          title: a.title,
          baseStatus: a.baseStatus,
          targetStatus: a.targetStatus,
          baseContentHash: a.baseContentHash,
          targetContentHash: a.targetContentHash,
          isFallback: a.isFallback,
        });

        const res = insertStmt.run(
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          "decision",
          title,
          description,
          "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          now,
        );

        persistedEvents.push({
          id: Number(res.lastInsertRowid),
          repositoryId,
          baseScanId,
          targetScanId,
          eventType,
          category: "decision",
          title,
          description,
          severity: "INFO",
          confidence,
          confidenceTier,
          detailsJson,
          createdAt: now,
        });
      }
    });

    return persistedEvents;
  }
}
