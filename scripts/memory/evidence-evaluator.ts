/**
 * Phase 7.5 Stage 4 — Deterministic Memory Evidence Evaluator
 * Evaluates all 9 MemoryEvidenceType categories against a target snapshot and comparison.
 */

import type { SqliteDatabase } from "../storage/database.ts";
import type { MemoryEvidenceRecord } from "../storage/types.ts";
import type { ComparisonLimitation, SnapshotComparison } from "../evolution/types.ts";
import type { ArchitectureComponent } from "../architecture/types.ts";
import { ComponentDetector } from "../architecture/component-detector.ts";
import { TestAssociationEngine } from "../architecture/test-association.ts";
import { AdrDiffEngine } from "../evolution/adr-diff.ts";
import { SnapshotComparisonError } from "../evolution/snapshot-comparator.ts";
import type { EvidenceEvaluationItem, EvidenceVerificationStatus } from "./types.ts";

export interface EvidenceContextOptions {
  allowPartial?: boolean;
  workspaceRoot?: string;
}

export interface TargetSnapshotContext {
  repositoryId: number;
  targetScanId: number;
  targetScanExists: boolean;
  isPartialSnapshot: boolean;
  hasComparison: boolean;
  limitations: ComparisonLimitation[];
  filesByPath: Map<string, { id: number; contentHash: string | null }>;
  symbolsByIdentity: Map<
    string,
    { id: number; fingerprint: string; filePath: string; name: string }
  >;
  relocatedSymbols: Map<
    string,
    {
      isAmbiguous: boolean;
      targetIdentity: string;
      targetFingerprint?: string;
      targetPath?: string;
    }
  >;
  importsBySource: Map<
    string,
    {
      specifier: string;
      resolvedPath: string | null;
      resolutionStatus: string;
      startLine: number;
    }[]
  >;
  componentsByIdentity: Map<string, ArchitectureComponent>;
  modifiedComponentCategories: Map<string, { from: string; to: string }>;
  getComponentCategoryInScan: (scanId: number, compIdentity: string) => string | undefined;
  adrsById: Map<string, { status?: string; filePath: string; isFallback: boolean }>;
  adrsByPath: Map<string, { status?: string; adrId: string; isFallback: boolean }>;
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
    options: EvidenceContextOptions = {},
  ): TargetSnapshotContext {
    const scanRow = db
      .prepare("SELECT id, repository_id AS repositoryId, status FROM scan_runs WHERE id = ?")
      .get(targetScanId) as { id: number; repositoryId: number; status: string } | undefined;

    if (!scanRow) {
      throw new SnapshotComparisonError(
        `Target scan ${targetScanId} does not exist.`,
        "ERR_SCAN_NOT_FOUND",
      );
    }

    if (scanRow.repositoryId !== repositoryId) {
      throw new SnapshotComparisonError(
        `Target scan ${targetScanId} belongs to repository ${scanRow.repositoryId}, expected ${repositoryId}.`,
        "ERR_REPOSITORY_MISMATCH",
      );
    }

    if (scanRow.status === "RUNNING" || scanRow.status === "VALIDATING") {
      throw new SnapshotComparisonError(
        `Target scan ${targetScanId} is still ${scanRow.status} and cannot evaluate memory lifecycle.`,
        "ERR_SCAN_INCOMPLETE",
      );
    }

    if (scanRow.status === "FAILED" || scanRow.status === "CANCELLED") {
      throw new SnapshotComparisonError(
        `Target scan ${targetScanId} ended with status ${scanRow.status} and cannot evaluate memory lifecycle.`,
        "ERR_SCAN_FAILED",
      );
    }

    const isPartialSnapshot = scanRow.status === "PARTIAL";
    if (isPartialSnapshot && !options.allowPartial) {
      throw new SnapshotComparisonError(
        `Target scan ${targetScanId} has status PARTIAL; pass allowPartial: true to evaluate with incomplete coverage warnings.`,
        "ERR_PARTIAL_SCAN_NOT_ALLOWED",
      );
    }

    const limitations: ComparisonLimitation[] = [];
    if (isPartialSnapshot) {
      limitations.push({
        code: "LIM_PARTIAL_SNAPSHOT_EVALUATION",
        description: `Target scan ${targetScanId} is PARTIAL; missing artifacts will be marked UNVERIFIED rather than downgrading memories to STALE.`,
        domain: "snapshot",
      });
    }

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
      { id: number; fingerprint: string; filePath: string; name: string }
    >();
    const symbolRows = db
      .prepare(
        `SELECT s.id, s.symbol_identity AS symbolIdentity, s.fingerprint, s.name, f.normalized_path AS filePath
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.repository_id = ? AND s.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      id: number;
      symbolIdentity: string;
      fingerprint: string;
      name: string;
      filePath: string;
    }[];
    for (const s of symbolRows) {
      symbolsByIdentity.set(s.symbolIdentity, {
        id: s.id,
        fingerprint: s.fingerprint,
        filePath: s.filePath,
        name: s.name,
      });
    }

    const relocatedSymbols = new Map<
      string,
      {
        isAmbiguous: boolean;
        targetIdentity: string;
        targetFingerprint?: string;
        targetPath?: string;
      }
    >();
    if (comparison) {
      for (const sc of comparison.symbols.changes) {
        if (sc.changeType === "RELOCATED") {
          const info = {
            isAmbiguous: Boolean(sc.isAmbiguous),
            targetIdentity: sc.symbolIdentity,
            targetFingerprint: sc.targetFingerprint,
            targetPath: sc.targetPath,
          };
          relocatedSymbols.set(sc.symbolIdentity, info);
          // Also index by probable base identity (replacing targetPath with basePath) so memories
          // anchored on the old symbolIdentity can resolve cleanly (or flag ambiguity).
          if (sc.basePath && sc.targetPath && sc.symbolIdentity.includes(sc.targetPath)) {
            const probableBaseId = sc.symbolIdentity.replace(sc.targetPath, sc.basePath);
            relocatedSymbols.set(probableBaseId, info);
          }
        }
      }
    }

    const importsBySource = new Map<
      string,
      {
        specifier: string;
        resolvedPath: string | null;
        resolutionStatus: string;
        startLine: number;
      }[]
    >();
    const importRows = db
      .prepare(
        `SELECT f.normalized_path AS sourcePath, i.imported_specifier AS specifier,
                tf.normalized_path AS resolvedPath, i.resolution_status AS resolutionStatus,
                i.start_line AS startLine
         FROM imports i
         JOIN files f ON f.id = i.source_file_id
         LEFT JOIN files tf ON tf.id = i.resolved_file_id
         WHERE i.repository_id = ? AND i.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      sourcePath: string;
      specifier: string;
      resolvedPath: string | null;
      resolutionStatus: string;
      startLine: number;
    }[];
    for (const imp of importRows) {
      if (!importsBySource.has(imp.sourcePath)) {
        importsBySource.set(imp.sourcePath, []);
      }
      importsBySource.get(imp.sourcePath)!.push({
        specifier: imp.specifier,
        resolvedPath: imp.resolvedPath,
        resolutionStatus: imp.resolutionStatus,
        startLine: imp.startLine,
      });
    }

    const components = ComponentDetector.detect(db, repositoryId, targetScanId);
    const componentsByIdentity = new Map<string, ArchitectureComponent>();
    for (const c of components) {
      componentsByIdentity.set(c.componentIdentity, c);
    }

    const scanCategoryCache = new Map<number, Map<string, string>>();
    const getComponentCategoryInScan = (
      scanId: number,
      compIdentity: string,
    ): string | undefined => {
      if (!scanCategoryCache.has(scanId)) {
        const comps = ComponentDetector.detect(db, repositoryId, scanId);
        scanCategoryCache.set(scanId, new Map(comps.map((c) => [c.componentIdentity, c.category])));
      }
      return scanCategoryCache.get(scanId)!.get(compIdentity);
    };

    const modifiedComponentCategories = new Map<string, { from: string; to: string }>();
    if (comparison) {
      const baseScanId = comparison.baseSnapshot.scanId;
      for (const c of components) {
        const baseCat = getComponentCategoryInScan(baseScanId, c.componentIdentity);
        if (baseCat && baseCat !== c.category) {
          modifiedComponentCategories.set(c.componentIdentity, { from: baseCat, to: c.category });
        }
      }
    }

    // DEFECT-EV-06: Resolve ADRs purely from hash-verified historical snapshot state
    const adrsById = new Map<string, { status?: string; filePath: string; isFallback: boolean }>();
    const adrsByPath = new Map<string, { status?: string; adrId: string; isFallback: boolean }>();
    const effectiveRoot = options.workspaceRoot ?? workspaceRoot;
    const historicalAdrs = AdrDiffEngine.resolveHistoricalAdrs(
      db,
      repositoryId,
      targetScanId,
      effectiveRoot,
    );
    limitations.push(...historicalAdrs.limitations);

    for (const adr of historicalAdrs.adrs) {
      adrsById.set(adr.adrId, {
        status: adr.status,
        filePath: adr.filePath,
        isFallback: adr.isFallback,
      });
      adrsByPath.set(adr.filePath, {
        status: adr.status,
        adrId: adr.adrId,
        isFallback: adr.isFallback,
      });
    }
    if (comparison) {
      for (const adr of comparison.adrs.changes) {
        if (adr.changeType !== "REMOVED" && adr.targetPath && !adrsById.has(adr.adrId)) {
          adrsById.set(adr.adrId, {
            status: adr.targetStatus,
            filePath: adr.targetPath,
            isFallback: Boolean(adr.isFallback),
          });
          if (!adrsByPath.has(adr.targetPath)) {
            adrsByPath.set(adr.targetPath, {
              status: adr.targetStatus,
              adrId: adr.adrId,
              isFallback: Boolean(adr.isFallback),
            });
          }
        }
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
         WHERE me.repository_id = ? AND ge.repository_id = ? AND me.graph_edge_id IS NOT NULL`,
      )
      .all(repositoryId, repositoryId) as unknown as { id: number; edgeIdentity: string }[];
    for (const e of allEvidenceEdges) {
      sourceEdgeIdentitiesById.set(e.id, e.edgeIdentity);
    }

    const associations = TestAssociationEngine.associate(db, repositoryId, targetScanId);
    const testFilesWithAssociations = new Set<string>(associations.map((a) => a.testFilePath));

    return {
      repositoryId,
      targetScanId,
      targetScanExists: true,
      isPartialSnapshot,
      hasComparison: Boolean(comparison),
      limitations,
      filesByPath,
      symbolsByIdentity,
      relocatedSymbols,
      importsBySource,
      componentsByIdentity,
      modifiedComponentCategories,
      getComponentCategoryInScan,
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
        const fileEntry = ctx.filesByPath.get(evidence.sourcePath);
        if (!fileEntry) {
          status = "MISSING";
          reason = `Source file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        } else if (evidence.sourceHash && fileEntry.contentHash === null) {
          status = "UNVERIFIED";
          reason = `Source file '${evidence.sourcePath}' exists in scan ${ctx.targetScanId} but lacks stored content_hash to verify expected hash '${evidence.sourceHash}'`;
        } else if (evidence.sourceHash && fileEntry.contentHash !== evidence.sourceHash) {
          status = "MISSING";
          reason = `Source file '${evidence.sourcePath}' content hash changed (${evidence.sourceHash} -> ${fileEntry.contentHash}) in scan ${ctx.targetScanId}; memory needs re-verification`;
        } else {
          status = "VERIFIED";
          reason = `Source file '${evidence.sourcePath}' verified in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "symbol": {
        const symId = evidence.symbolIdentity;
        const targetSym = symId ? ctx.symbolsByIdentity.get(symId) : undefined;
        const reloc = symId ? ctx.relocatedSymbols.get(symId) : undefined;

        if (!symId) {
          status = ctx.filesByPath.has(evidence.sourcePath) ? "UNVERIFIED" : "MISSING";
          reason =
            status === "UNVERIFIED"
              ? `Symbol evidence on '${evidence.sourcePath}' lacks symbolIdentity and cannot be verified`
              : `Symbol file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        } else if (reloc?.isAmbiguous) {
          status = "UNVERIFIED";
          reason = `Symbol '${symId}' had an ambiguous relocation in scan ${ctx.targetScanId}; cannot verify automatically`;
        } else if (targetSym) {
          if (evidence.sourceHash && evidence.sourceHash !== targetSym.fingerprint) {
            status = "MISSING";
            reason = `Symbol '${symId}' fingerprint changed (${evidence.sourceHash} -> ${targetSym.fingerprint}); memory needs re-verification`;
          } else {
            status = "VERIFIED";
            reason = `Symbol '${symId}' verified in scan ${ctx.targetScanId}`;
          }
        } else if (reloc && !reloc.isAmbiguous) {
          if (
            evidence.sourceHash &&
            reloc.targetFingerprint &&
            evidence.sourceHash !== reloc.targetFingerprint
          ) {
            status = "MISSING";
            reason = `Relocated symbol '${symId}' fingerprint changed (${evidence.sourceHash} -> ${reloc.targetFingerprint}); memory needs re-verification`;
          } else {
            status = "VERIFIED";
            reason = `Symbol '${symId}' verified via unique relocation (${reloc.targetIdentity}) in scan ${ctx.targetScanId}`;
          }
        } else {
          status = "MISSING";
          reason = `Symbol '${symId}' missing in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "import": {
        const imports = ctx.importsBySource.get(evidence.sourcePath) ?? [];
        const specMatch = evidence.description.match(/import:([^\s]+)/i);
        const targetSpec = evidence.symbolIdentity ?? specMatch?.[1];
        let matching = targetSpec
          ? imports.filter((i) => i.specifier === targetSpec || i.resolvedPath === targetSpec)
          : imports;
        if (evidence.lineStart !== null && matching.length > 0) {
          const lineMatched = matching.filter(
            (i) => Math.abs(i.startLine - evidence.lineStart!) <= 2,
          );
          if (lineMatched.length > 0) {
            matching = lineMatched;
          }
        }
        if (matching.length === 0) {
          status = "MISSING";
          reason = `Import evidence in '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
        } else if (matching.every((i) => i.resolutionStatus === "UNRESOLVED")) {
          status = "UNVERIFIED";
          reason = `Import in '${evidence.sourcePath}' has resolutionStatus UNRESOLVED in scan ${ctx.targetScanId}; target cannot be verified`;
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
        const catShift = ctx.modifiedComponentCategories.get(compIdentity);
        const originCategory =
          evidence.scanId !== ctx.targetScanId
            ? ctx.getComponentCategoryInScan(evidence.scanId, compIdentity)
            : undefined;
        const expectedCatMatch = evidence.description.match(/category:([a-z0-9_-]+)/i);
        const categoryShifted =
          catShift !== undefined ||
          (comp !== undefined &&
            originCategory !== undefined &&
            originCategory !== comp.category) ||
          (comp !== undefined &&
            expectedCatMatch !== null &&
            expectedCatMatch[1].toLowerCase() !== comp.category.toLowerCase());
        if (!comp) {
          status = "MISSING";
          reason = `Component '${compIdentity}' missing in scan ${ctx.targetScanId}`;
        } else if (categoryShifted) {
          status = "MISSING";
          reason = `Component '${compIdentity}' reclassified to '${comp.category}' in scan ${ctx.targetScanId}; memory needs re-verification`;
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
            status = "UNVERIFIED";
            reason = `ADR file '${evidence.sourcePath}' exists in scan ${ctx.targetScanId} without verified ADR status metadata`;
          } else {
            status = "MISSING";
            reason = `ADR '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
          }
        } else if (adrInfo.isFallback || !adrInfo.status) {
          status = "UNVERIFIED";
          reason = `ADR '${evidence.sourcePath}' historical status could not be hash-verified in scan ${ctx.targetScanId}`;
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
          status = "UNVERIFIED";
          reason = `Graph edge identity could not be resolved for scan ${ctx.targetScanId}`;
        } else {
          const edge = ctx.graphEdgesByIdentity.get(resolvedIdentity);
          if (!edge) {
            status = "MISSING";
            reason = `Graph edge '${resolvedIdentity}' missing in scan ${ctx.targetScanId}`;
          } else if (edge.relationshipStatus === "UNRESOLVED") {
            status = "UNVERIFIED";
            reason = `Graph edge '${resolvedIdentity}' is UNRESOLVED in scan ${ctx.targetScanId}; target cannot be verified`;
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
          reason = `Test file '${evidence.sourcePath}' associated with source modules in scan ${ctx.targetScanId}`;
        } else {
          status = "MISSING";
          reason = `Test file '${evidence.sourcePath}' has no associated source modules in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "diff": {
        if (evidence.sourcePath && evidence.sourcePath !== "diff") {
          if (ctx.filesByPath.has(evidence.sourcePath)) {
            status = "VERIFIED";
            reason = `Snapshot diff artifact '${evidence.sourcePath}' verified in scan ${ctx.targetScanId}`;
          } else {
            status = "MISSING";
            reason = `Snapshot diff artifact '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
          }
        } else if (ctx.hasComparison) {
          status = "VERIFIED";
          reason = `Snapshot diff evidence evaluated against comparison ending at scan ${ctx.targetScanId}`;
        } else {
          status = "UNVERIFIED";
          reason = `Diff evidence lacks concrete sourcePath and comparison context in scan ${ctx.targetScanId}`;
        }
        break;
      }

      case "manual": {
        if (!evidence.sourcePath || evidence.sourcePath === "manual") {
          status = "UNVERIFIED";
          reason = `Unanchored manual evidence cannot be automatically verified against scan ${ctx.targetScanId}`;
        } else {
          const fileEntry = ctx.filesByPath.get(evidence.sourcePath);
          if (!fileEntry) {
            status = "MISSING";
            reason = `Manual evidence file '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
          } else if (evidence.sourceHash && fileEntry.contentHash === null) {
            status = "UNVERIFIED";
            reason = `Manual evidence file '${evidence.sourcePath}' lacks stored content_hash in scan ${ctx.targetScanId}`;
          } else if (evidence.sourceHash && fileEntry.contentHash !== evidence.sourceHash) {
            status = "MISSING";
            reason = `Manual evidence file '${evidence.sourcePath}' hash changed in scan ${ctx.targetScanId}; needs review`;
          } else {
            status = "VERIFIED";
            reason = `Manual evidence file '${evidence.sourcePath}' verified in scan ${ctx.targetScanId}`;
          }
        }
        break;
      }
    }

    // DEFECT-EV-05: In PARTIAL snapshots, missing artifacts cannot prove staleness
    if (ctx.isPartialSnapshot && status === "MISSING") {
      status = "UNVERIFIED";
      reason = `${reason} (downgraded from MISSING because scan ${ctx.targetScanId} is PARTIAL)`;
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
        return evidence.sourcePath &&
          evidence.sourcePath !== "manual" &&
          evidence.sourcePath !== "diff"
          ? ctx.filesByPath.has(evidence.sourcePath)
          : false;
      case "symbol":
        return evidence.symbolIdentity
          ? ctx.symbolsByIdentity.has(evidence.symbolIdentity)
          : ctx.filesByPath.has(evidence.sourcePath);
      case "component": {
        const descMatch = evidence.description.match(/comp:([^\s,)]+)/);
        const compId = descMatch?.[1]
          ? `comp:${descMatch[1]}`
          : evidence.sourcePath.startsWith("comp:")
            ? evidence.sourcePath
            : `comp:${evidence.sourcePath}`;
        return ctx.componentsByIdentity.has(compId);
      }
      case "graph_edge": {
        const edgeId =
          (evidence.graphEdgeId !== null
            ? ctx.sourceEdgeIdentitiesById.get(evidence.graphEdgeId)
            : undefined) ?? evidence.description.match(/(edge:[^\s]+)/)?.[1];
        return edgeId ? ctx.graphEdgesByIdentity.has(edgeId) : false;
      }
      case "import": {
        const imports = ctx.importsBySource.get(evidence.sourcePath) ?? [];
        const specMatch = evidence.description.match(/import:([^\s]+)/i);
        const targetSpec = evidence.symbolIdentity ?? specMatch?.[1];
        if (!targetSpec) {
          return imports.length > 0;
        }
        return imports.some((i) => i.specifier === targetSpec || i.resolvedPath === targetSpec);
      }
      case "adr": {
        const adrMatch = evidence.description.match(/\b(ADR-\d+)\b/i);
        const adrInfo =
          ctx.adrsByPath.get(evidence.sourcePath) ??
          (adrMatch ? ctx.adrsById.get(adrMatch[1].toUpperCase()) : undefined);
        if (adrInfo && adrInfo.status && DEPRECATED_ADR_STATUS_RE.test(adrInfo.status)) {
          return false;
        }
        return ctx.filesByPath.has(evidence.sourcePath);
      }
      case "source_file":
      case "test":
        return ctx.filesByPath.has(evidence.sourcePath);
    }
  }
}
