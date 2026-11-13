/**
 * Phase 7.5 Stage 4 — Deterministic Memory Evidence Evaluator
 * Evaluates all 9 MemoryEvidenceType categories against a target snapshot and comparison.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { MemoryEvidenceRecord } from "../storage/types.ts";
import type { SnapshotComparison } from "../evolution/types.ts";
import type { ArchitectureComponent } from "../architecture/types.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import { TestAssociationEngine } from "../architecture/test-association.ts";
import { AdrDetector } from "../architecture/adr-detector.ts";
import type { EvidenceEvaluationItem, EvidenceVerificationStatus } from "./types.ts";

interface TargetSnapshotContext {
  repositoryId: number;
  targetScanId: number;
  targetScanExists: boolean;
  filesByPath: Map<string, { id: number; contentHash: string | null }>;
  symbolsByIdentity: Map<string, { id: number; fingerprint: string; filePath: string }>;
  relocatedSymbols: Set<string>;
  importsBySource: Map<string, { specifier: string; resolutionStatus: string }[]>;
  componentsByIdentity: Map<string, ArchitectureComponent>;
  modifiedComponentCategories: Set<string>;
  adrsById: Map<string, { status: string; filePath: string }>;
  adrsByPath: Map<string, { status: string; adrId: string }>;
  graphEdgesByIdentity: Map<string, { relationshipStatus: string }>;
  sourceEdgeIdentitiesById: Map<number, string>;
  testFilesWithAssociations: Set<string>;
}

const DEPRECATED_ADR_STATUS_RE = /\b(deprecated|rejected|superseded)\b/i;

export class EvidenceEvaluator {
  public static createContext(
    db: SqliteDatabase,
    repositoryId: number,
    targetScanId: number,
    comparison?: SnapshotComparison,
    workspaceRoot?: string,
  ): TargetSnapshotContext {
    const scanRow = db
      .prepare("SELECT id FROM scan_runs WHERE repository_id = ? AND id = ?")
      .get(repositoryId, targetScanId) as { id: number } | undefined;

    const filesByPath = new Map<string, { id: number; contentHash: string | null }>();
    const fileRows = db
      .prepare(
        `SELECT id, normalized_path AS normalizedPath, content_hash AS contentHash
         FROM files WHERE repository_id = ? AND scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      id: number;
      normalizedPath: string;
      contentHash: string | null;
    }[];
    for (const f of fileRows) {
      filesByPath.set(f.normalizedPath, { id: f.id, contentHash: f.contentHash });
    }

    const symbolsByIdentity = new Map<
      string,
      { id: number; fingerprint: string; filePath: string }
    >();
    const symbolRows = db
      .prepare(
        `SELECT s.id, s.symbol_identity AS symbolIdentity, s.fingerprint, f.normalized_path AS filePath
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.repository_id = ? AND s.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      id: number;
      symbolIdentity: string;
      fingerprint: string;
      filePath: string;
    }[];
    for (const s of symbolRows) {
      symbolsByIdentity.set(s.symbolIdentity, {
        id: s.id,
        fingerprint: s.fingerprint,
        filePath: s.filePath,
      });
    }

    const relocatedSymbols = new Set<string>();
    if (comparison) {
      for (const sc of comparison.symbols.changes) {
        if (sc.changeType === "RELOCATED") {
          relocatedSymbols.add(sc.symbolIdentity);
        }
      }
    }

    const importsBySource = new Map<string, { specifier: string; resolutionStatus: string }[]>();
    const importRows = db
      .prepare(
        `SELECT f.normalized_path AS sourcePath, i.imported_specifier AS specifier, i.resolution_status AS resolutionStatus
         FROM imports i
         JOIN files f ON f.id = i.source_file_id
         WHERE i.repository_id = ? AND i.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      sourcePath: string;
      specifier: string;
      resolutionStatus: string;
    }[];
    for (const imp of importRows) {
      if (!importsBySource.has(imp.sourcePath)) {
        importsBySource.set(imp.sourcePath, []);
      }
      importsBySource.get(imp.sourcePath)!.push({
        specifier: imp.specifier,
        resolutionStatus: imp.resolutionStatus,
      });
    }

    const components = ComponentDetector.detect(db, repositoryId, targetScanId);
    const componentsByIdentity = new Map<string, ArchitectureComponent>();
    for (const c of components) {
      componentsByIdentity.set(c.componentIdentity, c);
    }

    const modifiedComponentCategories = new Set<string>();
    if (comparison) {
      // Detect category shifts when base component identity exists in base scan
      const baseComponents = ComponentDetector.detect(
        db,
        repositoryId,
        comparison.baseSnapshot.scanId,
      );
      const baseCatMap = new Map(baseComponents.map((b) => [b.componentIdentity, b.category]));
      for (const c of components) {
        const baseCat = baseCatMap.get(c.componentIdentity);
        if (baseCat && baseCat !== c.category) {
          modifiedComponentCategories.add(c.componentIdentity);
        }
      }
    }

    const adrsById = new Map<string, { status: string; filePath: string }>();
    const adrsByPath = new Map<string, { status: string; adrId: string }>();
    if (comparison) {
      for (const adr of comparison.adrs.changes) {
        if (adr.changeType !== "REMOVED" && adr.targetPath) {
          const status = adr.targetStatus ?? "Proposed";
          adrsById.set(adr.adrId, { status, filePath: adr.targetPath });
          adrsByPath.set(adr.targetPath, { status, adrId: adr.adrId });
        }
      }
    }
    // Fill any unchanged/snapshot ADRs from DB / workspace
    const repoRow = db
      .prepare("SELECT root_path AS rootPath FROM repositories WHERE id = ?")
      .get(repositoryId) as { rootPath: string } | undefined;
    const effectiveRoot = workspaceRoot ?? repoRow?.rootPath;
    if (effectiveRoot) {
      const detectedAdrs = AdrDetector.detect(db, repositoryId, targetScanId, effectiveRoot);
      for (const adr of detectedAdrs) {
        if (!adrsById.has(adr.adrId)) {
          adrsById.set(adr.adrId, { status: adr.status, filePath: adr.filePath });
        }
        if (!adrsByPath.has(adr.filePath)) {
          adrsByPath.set(adr.filePath, { status: adr.status, adrId: adr.adrId });
        }
      }
    }
    // Also inspect snapshot source_evidence ADR_METADATA_JSON rows for offline/in-memory scans
    const adrMetaRows = db
      .prepare(
        `SELECT f.normalized_path AS filePath, se.evidence_description AS description
         FROM source_evidence se
         JOIN files f ON f.id = se.file_id
         WHERE se.repository_id = ? AND se.scan_id = ? AND se.evidence_type = 'ADR_METADATA_JSON'`,
      )
      .all(repositoryId, targetScanId) as unknown as { filePath: string; description: string }[];
    for (const row of adrMetaRows) {
      try {
        const meta = JSON.parse(row.description) as { adrId?: string; status?: string };
        if (meta.adrId && meta.status) {
          adrsById.set(meta.adrId, { status: meta.status, filePath: row.filePath });
          adrsByPath.set(row.filePath, { status: meta.status, adrId: meta.adrId });
        }
      } catch {
        // Ignore malformed metadata JSON
      }
    }

    const graphEdgesByIdentity = new Map<string, { relationshipStatus: string }>();
    const edgeRows = db
      .prepare(
        `SELECT edge_identity AS edgeIdentity, relationship_status AS relationshipStatus
         FROM graph_edges WHERE repository_id = ? AND scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      edgeIdentity: string;
      relationshipStatus: string;
    }[];
    for (const edge of edgeRows) {
      graphEdgesByIdentity.set(edge.edgeIdentity, {
        relationshipStatus: edge.relationshipStatus,
      });
    }

    const sourceEdgeIdentitiesById = new Map<number, string>();
    const allEvidenceEdges = db
      .prepare(
        `SELECT ge.id, ge.edge_identity AS edgeIdentity
         FROM memory_evidence me
         JOIN graph_edges ge ON ge.id = me.graph_edge_id
         WHERE me.repository_id = ? AND me.graph_edge_id IS NOT NULL`,
      )
      .all(repositoryId) as unknown as { id: number; edgeIdentity: string }[];
    for (const e of allEvidenceEdges) {
      sourceEdgeIdentitiesById.set(e.id, e.edgeIdentity);
    }

    const associations = TestAssociationEngine.associate(db, repositoryId, targetScanId);
    const testFilesWithAssociations = new Set<string>(associations.map((a) => a.testFilePath));

    return {
      repositoryId,
      targetScanId,
      targetScanExists: Boolean(scanRow),
      filesByPath,
      symbolsByIdentity,
      relocatedSymbols,
      importsBySource,
      componentsByIdentity,
      modifiedComponentCategories,
      adrsById,
      adrsByPath,
      graphEdgesByIdentity,
      sourceEdgeIdentitiesById,
      testFilesWithAssociations,
    };
  }

  public static evaluateEvidence(
    ctx: TargetSnapshotContext,
    evidence: MemoryEvidenceRecord,
  ): EvidenceEvaluationItem {
    let status: EvidenceVerificationStatus;
    let reason: string;

    if (evidence.isContradictory) {
      const active = this.isContradictoryArtifactPresent(ctx, evidence);
      if (active) {
        status = "CONTRADICTED";
        reason = `Contradictory ${evidence.evidenceType} evidence active in scan ${ctx.targetScanId}: ${evidence.description}`;
      } else {
        status = "MISSING";
        reason = `Contradictory ${evidence.evidenceType} artifact absent in scan ${ctx.targetScanId}`;
      }
      return {
        evidenceId: evidence.id,
        memoryId: evidence.memoryId,
        evidenceType: evidence.evidenceType,
        sourcePath: evidence.sourcePath,
        symbolIdentity: evidence.symbolIdentity,
        isContradictory: evidence.isContradictory,
        status,
        reason,
        targetScanId: ctx.targetScanId,
      };
    }

    switch (evidence.evidenceType) {
      case "source_file": {
        if (ctx.filesByPath.has(evidence.sourcePath)) {
          status = "VERIFIED";
          reason = `Source file '${evidence.sourcePath}' exists in scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Source file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "symbol": {
        const symId = evidence.symbolIdentity;
        const targetSym = symId ? ctx.symbolsByIdentity.get(symId) : undefined;
        if (targetSym) {
          if (evidence.sourceHash && evidence.sourceHash !== targetSym.fingerprint) {
            status = "CONTRADICTED";
            reason = `Symbol '${symId}' fingerprint changed (${evidence.sourceHash} -> ${targetSym.fingerprint})`;
          } else {
            status = "VERIFIED";
            reason = `Symbol '${symId}' verified in scan ${ctx.targetScanId}`;
          }
        } else if (symId && ctx.relocatedSymbols.has(symId)) {
          status = "VERIFIED";
          reason = `Symbol '${symId}' verified via relocation in scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Symbol '${symId ?? evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "import": {
        const imports = ctx.importsBySource.get(evidence.sourcePath) ?? [];
        const specMatch = evidence.description.match(/import:([^\s]+)/i);
        const targetSpec = specMatch?.[1];
        const matching = targetSpec ? imports.filter((i) => i.specifier === targetSpec) : imports;
        if (matching.length === 0) {
          status = "MISSING";
          reason = `Import evidence in '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        } else if (matching.some((i) => i.resolutionStatus === "UNRESOLVED")) {
          status = "CONTRADICTED";
          reason = `Import in '${evidence.sourcePath}' degraded to UNRESOLVED in scan ${ctx.targetScanId}`;
        } else {
          status = "VERIFIED";
          reason = `Import in '${evidence.sourcePath}' verified in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "component": {
        const descMatch = evidence.description.match(/comp:([^\s,)]+)/);
        const compIdentity = descMatch?.[1]
          ? `comp:${descMatch[1]}`
          : evidence.sourcePath.startsWith("comp:")
            ? evidence.sourcePath
            : `comp:${evidence.sourcePath}`;
        const comp = ctx.componentsByIdentity.get(compIdentity);
        if (!comp) {
          status = "MISSING";
          reason = `Component '${compIdentity}' missing in scan ${ctx.targetScanId}`;
        } else if (ctx.modifiedComponentCategories.has(compIdentity)) {
          status = "CONTRADICTED";
          reason = `Component '${compIdentity}' reclassified to '${comp.category}' in scan ${ctx.targetScanId}`;
        } else {
          status = "VERIFIED";
          reason = `Component '${compIdentity}' verified in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "adr": {
        const adrMatch = evidence.description.match(/\b(ADR-\d+)\b/i);
        const byPath = ctx.adrsByPath.get(evidence.sourcePath);
        const byId = adrMatch ? ctx.adrsById.get(adrMatch[1].toUpperCase()) : undefined;
        const adrInfo = byPath ?? byId;
        if (!adrInfo) {
          if (ctx.filesByPath.has(evidence.sourcePath)) {
            status = "VERIFIED";
            reason = `ADR file '${evidence.sourcePath}' exists in scan ${ctx.targetScanId}`;
          } else {
            status = "MISSING";
            reason = `ADR '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
          }
        } else if (DEPRECATED_ADR_STATUS_RE.test(adrInfo.status)) {
          status = "CONTRADICTED";
          reason = `ADR '${evidence.sourcePath}' status is '${adrInfo.status}' in scan ${ctx.targetScanId}`;
        } else {
          status = "VERIFIED";
          reason = `ADR '${evidence.sourcePath}' active (${adrInfo.status}) in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "graph_edge": {
        const resolvedIdentity =
          (evidence.graphEdgeId !== null
            ? ctx.sourceEdgeIdentitiesById.get(evidence.graphEdgeId)
            : undefined) ?? evidence.description.match(/(edge:[^\s]+)/)?.[1];
        if (!resolvedIdentity) {
          status = "MISSING";
          reason = `Graph edge identity could not be resolved for scan ${ctx.targetScanId}`;
        } else {
          const edge = ctx.graphEdgesByIdentity.get(resolvedIdentity);
          if (!edge) {
            status = "MISSING";
            reason = `Graph edge '${resolvedIdentity}' missing in scan ${ctx.targetScanId}`;
          } else if (edge.relationshipStatus === "UNRESOLVED") {
            status = "CONTRADICTED";
            reason = `Graph edge '${resolvedIdentity}' is UNRESOLVED in scan ${ctx.targetScanId}`;
          } else {
            status = "VERIFIED";
            reason = `Graph edge '${resolvedIdentity}' verified in scan ${ctx.targetScanId}`;
          }
        }
        break;
      }

      case "test": {
        if (!ctx.filesByPath.has(evidence.sourcePath)) {
          status = "MISSING";
          reason = `Test file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        } else if (ctx.testFilesWithAssociations.has(evidence.sourcePath)) {
          status = "VERIFIED";
          reason = `Test file '${evidence.sourcePath}' associated with source files in scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Test file '${evidence.sourcePath}' has no associated source modules in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "diff": {
        if (ctx.targetScanExists) {
          status = "VERIFIED";
          reason = `Snapshot diff evidence valid against scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Target scan ${ctx.targetScanId} missing`;
        }
        break;
      }

      case "manual": {
        if (!evidence.sourcePath || evidence.sourcePath === "manual") {
          status = "VERIFIED";
          reason = `Manual engineering evidence verified in scan ${ctx.targetScanId}`;
        } else if (ctx.filesByPath.has(evidence.sourcePath)) {
          status = "VERIFIED";
          reason = `Manual evidence file '${evidence.sourcePath}' exists in scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Manual evidence file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        }
        break;
      }
    }

    return {
      evidenceId: evidence.id,
      memoryId: evidence.memoryId,
      evidenceType: evidence.evidenceType,
      sourcePath: evidence.sourcePath,
      symbolIdentity: evidence.symbolIdentity,
      isContradictory: evidence.isContradictory,
      status,
      reason,
      targetScanId: ctx.targetScanId,
    };
  }

  private static isContradictoryArtifactPresent(
    ctx: TargetSnapshotContext,
    evidence: MemoryEvidenceRecord,
  ): boolean {
    switch (evidence.evidenceType) {
      case "manual":
      case "diff":
        return !evidence.sourcePath || evidence.sourcePath === "manual"
          ? true
          : ctx.filesByPath.has(evidence.sourcePath);
      case "symbol":
        return evidence.symbolIdentity
          ? ctx.symbolsByIdentity.has(evidence.symbolIdentity)
          : ctx.filesByPath.has(evidence.sourcePath);
      case "component": {
        const compId = evidence.sourcePath.startsWith("comp:")
          ? evidence.sourcePath
          : `comp:${evidence.sourcePath}`;
        return ctx.componentsByIdentity.has(compId) || ctx.filesByPath.has(evidence.sourcePath);
      }
      case "graph_edge": {
        const edgeId =
          evidence.graphEdgeId !== null
            ? ctx.sourceEdgeIdentitiesById.get(evidence.graphEdgeId)
            : undefined;
        return edgeId
          ? ctx.graphEdgesByIdentity.has(edgeId)
          : ctx.filesByPath.has(evidence.sourcePath);
      }
      case "source_file":
      case "import":
      case "adr":
      case "test":
        return ctx.filesByPath.has(evidence.sourcePath);
    }
  }
}
