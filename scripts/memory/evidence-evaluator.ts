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
import { SnapshotValidator } from "../evolution/snapshot-validator.ts";
import type { EvidenceEvaluationItem, EvidenceVerificationStatus } from "./types.ts";

export interface EvidenceContextOptions {
  allowPartial?: boolean;
  workspaceRoot?: string;
}

export interface RelocatedSymbolInfo {
  isAmbiguous: boolean;
  targetIdentity: string;
  targetFingerprint?: string;
  targetPath?: string;
  baseFingerprint?: string;
  name?: string;
  kind?: string;
}

export interface TargetGraphEdgeInfo {
  id: number;
  edgeIdentity: string;
  relationshipType: string;
  relationshipStatus: string;
  sourceNodeIdentity: string | null;
  targetNodeIdentity: string | null;
  hasValidOwnedEndpoints: boolean;
}

export interface GraphEdgeByIdRecord {
  id: number;
  repositoryId: number;
  scanId: number;
  edgeIdentity: string;
  relationshipType: string;
  relationshipStatus: string;
  sourceNodeIdentity: string | null;
  sourceNodeRepoId: number | null;
  sourceNodeScanId: number | null;
  targetNodeIdentity: string | null;
  targetNodeRepoId: number | null;
  targetNodeScanId: number | null;
}

export interface TargetSnapshotContext {
  repositoryId: number;
  targetScanId: number;
  targetScanExists: boolean;
  isPartialSnapshot: boolean;
  hasComparison: boolean;
  limitations: ComparisonLimitation[];
  isScanOwnedByRepository: (scanId: number) => boolean;
  filesByPath: Map<string, { id: number; contentHash: string | null }>;
  symbolsByIdentity: Map<
    string,
    {
      id: number;
      fingerprint: string;
      filePath: string;
      name: string;
      kind: string;
      scope: string | null;
    }
  >;
  relocatedSymbols: Map<string, RelocatedSymbolInfo>;
  resolveRelocationFromScan: (
    originScanId: number,
    symbolIdentity: string,
  ) => RelocatedSymbolInfo | undefined;
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
  graphEdgesByIdentity: Map<string, TargetGraphEdgeInfo>;
  getGraphEdgeById: (edgeId: number) => GraphEdgeByIdRecord | undefined;
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
    // DEFECT-LC-03: Validate target scan existence, ownership, completion status, and comparison validity upfront.
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

    if (comparison) {
      if (comparison.repositoryId !== repositoryId) {
        throw new SnapshotComparisonError(
          `Snapshot comparison belongs to repository ${comparison.repositoryId}, expected ${repositoryId}.`,
          "ERR_REPOSITORY_MISMATCH",
        );
      }
      if (comparison.targetSnapshot.scanId !== targetScanId) {
        throw new SnapshotComparisonError(
          `Snapshot comparison targets scan ${comparison.targetSnapshot.scanId}, expected ${targetScanId}.`,
          "ERR_SCAN_MISMATCH",
        );
      }
      const validation = SnapshotValidator.validate(
        db,
        comparison.baseSnapshot.scanId,
        targetScanId,
        {
          allowPartial: options.allowPartial,
          expectedRepositoryId: repositoryId,
        },
      );
      if (!validation.isValid) {
        throw new SnapshotComparisonError(
          validation.errorMessage ?? "Invalid snapshot comparison for lifecycle evaluation.",
          validation.errorCode ?? "ERR_SNAPSHOT_VALIDATION_FAILED",
          validation,
        );
      }
    }

    const scanOwnershipCache = new Map<number, boolean>([[targetScanId, true]]);
    const scanOwnershipStmt = db.prepare(
      "SELECT 1 AS owned FROM scan_runs WHERE id = ? AND repository_id = ?",
    );
    const isScanOwnedByRepository = (scanId: number): boolean => {
      if (!scanOwnershipCache.has(scanId)) {
        const ownedRow = scanOwnershipStmt.get(scanId, repositoryId) as
          { owned: number } | undefined;
        scanOwnershipCache.set(scanId, Boolean(ownedRow));
      }
      return scanOwnershipCache.get(scanId)!;
    };

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
      {
        id: number;
        fingerprint: string;
        filePath: string;
        name: string;
        kind: string;
        scope: string | null;
      }
    >();
    const symbolRows = db
      .prepare(
        `SELECT s.id, s.symbol_identity AS symbolIdentity, s.fingerprint, s.name, s.kind, s.scope, f.normalized_path AS filePath
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.repository_id = ? AND s.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      id: number;
      symbolIdentity: string;
      fingerprint: string;
      name: string;
      kind: string;
      scope: string | null;
      filePath: string;
    }[];
    for (const s of symbolRows) {
      symbolsByIdentity.set(s.symbolIdentity, {
        id: s.id,
        fingerprint: s.fingerprint,
        filePath: s.filePath,
        name: s.name,
        kind: s.kind,
        scope: s.scope,
      });
    }

    // DEFECT-EV-03: Deterministic relocation resolution using SymbolDiffEngine's exact
    // semantic key (name::kind::scope::fingerprint) without brittle path string replacement.
    const originRelocationCache = new Map<number, Map<string, RelocatedSymbolInfo>>();
    const originSymbolsStmt = db.prepare(
      `SELECT s.symbol_identity AS symbolIdentity, s.fingerprint, s.name, s.kind, s.scope, f.normalized_path AS filePath
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.repository_id = ? AND s.scan_id = ?
       ORDER BY s.symbol_identity ASC, s.id ASC`,
    );

    const buildScanRelocationMap = (originScanId: number): Map<string, RelocatedSymbolInfo> => {
      if (originRelocationCache.has(originScanId)) {
        return originRelocationCache.get(originScanId)!;
      }
      const map = new Map<string, RelocatedSymbolInfo>();
      if (!isScanOwnedByRepository(originScanId) || originScanId === targetScanId) {
        originRelocationCache.set(originScanId, map);
        return map;
      }

      const originRows = originSymbolsStmt.all(repositoryId, originScanId) as unknown as {
        symbolIdentity: string;
        fingerprint: string;
        name: string;
        kind: string;
        scope: string | null;
        filePath: string;
      }[];

      const originById = new Map<string, (typeof originRows)[number]>();
      for (const b of originRows) {
        originById.set(b.symbolIdentity, b);
      }

      const unmatchedOrigin = originRows.filter((b) => !symbolsByIdentity.has(b.symbolIdentity));
      const unmatchedTarget: {
        symbolIdentity: string;
        fingerprint: string;
        filePath: string;
        name: string;
        kind: string;
        scope: string | null;
      }[] = [];
      for (const [tId, t] of symbolsByIdentity.entries()) {
        if (!originById.has(tId)) {
          unmatchedTarget.push({ symbolIdentity: tId, ...t });
        }
      }

      if (unmatchedOrigin.length > 0 && unmatchedTarget.length > 0) {
        const makeKey = (s: {
          name: string;
          kind: string;
          scope: string | null;
          fingerprint: string;
        }) => `${s.name}::${s.kind}::${s.scope ?? ""}::${s.fingerprint}`;

        const originByKey = new Map<string, typeof unmatchedOrigin>();
        for (const b of unmatchedOrigin) {
          const k = makeKey(b);
          if (!originByKey.has(k)) originByKey.set(k, []);
          originByKey.get(k)!.push(b);
        }

        const targetByKey = new Map<string, typeof unmatchedTarget>();
        for (const t of unmatchedTarget) {
          const k = makeKey(t);
          if (!targetByKey.has(k)) targetByKey.set(k, []);
          targetByKey.get(k)!.push(t);
        }

        for (const [k, tList] of targetByKey.entries()) {
          const bList = originByKey.get(k);
          if (!bList) continue;

          if (bList.length === 1 && tList.length === 1) {
            const b = bList[0];
            const t = tList[0];
            const info: RelocatedSymbolInfo = {
              isAmbiguous: false,
              targetIdentity: t.symbolIdentity,
              targetFingerprint: t.fingerprint,
              targetPath: t.filePath,
              baseFingerprint: b.fingerprint,
              name: t.name,
              kind: t.kind,
            };
            map.set(b.symbolIdentity, info);
            map.set(t.symbolIdentity, info);
          } else {
            for (const b of bList) {
              map.set(b.symbolIdentity, {
                isAmbiguous: true,
                targetIdentity: b.symbolIdentity,
                baseFingerprint: b.fingerprint,
                name: b.name,
                kind: b.kind,
              });
            }
            for (const t of tList) {
              map.set(t.symbolIdentity, {
                isAmbiguous: true,
                targetIdentity: t.symbolIdentity,
                targetFingerprint: t.fingerprint,
                targetPath: t.filePath,
                name: t.name,
                kind: t.kind,
              });
            }
          }
        }
      }

      originRelocationCache.set(originScanId, map);
      return map;
    };

    const resolveRelocationFromScan = (
      originScanId: number,
      symbolIdentity: string,
    ): RelocatedSymbolInfo | undefined => {
      return buildScanRelocationMap(originScanId).get(symbolIdentity);
    };

    const relocatedSymbols = new Map<string, RelocatedSymbolInfo>();
    if (comparison) {
      const baseRelocMap = buildScanRelocationMap(comparison.baseSnapshot.scanId);
      for (const [symId, info] of baseRelocMap.entries()) {
        relocatedSymbols.set(symId, info);
      }

      for (const sc of comparison.symbols.changes) {
        if (sc.isAmbiguous) {
          relocatedSymbols.set(sc.symbolIdentity, {
            isAmbiguous: true,
            targetIdentity: sc.symbolIdentity,
            targetFingerprint: sc.targetFingerprint,
            targetPath: sc.targetPath,
            baseFingerprint: sc.baseFingerprint,
            name: sc.name,
            kind: sc.kind,
          });
        } else if (sc.changeType === "RELOCATED" && !relocatedSymbols.has(sc.symbolIdentity)) {
          relocatedSymbols.set(sc.symbolIdentity, {
            isAmbiguous: false,
            targetIdentity: sc.symbolIdentity,
            targetFingerprint: sc.targetFingerprint,
            targetPath: sc.targetPath,
            baseFingerprint: sc.baseFingerprint,
            name: sc.name,
            kind: sc.kind,
          });
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
      if (!isScanOwnedByRepository(scanId)) {
        return undefined;
      }
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

    // ISSUE-EV-09: Load target graph edges joined with endpoint nodes to enforce continuity and ownership
    const graphEdgesByIdentity = new Map<string, TargetGraphEdgeInfo>();
    const edgeRows = db
      .prepare(
        `SELECT
          ge.id,
          ge.edge_identity AS edgeIdentity,
          ge.relationship_type AS relationshipType,
          ge.relationship_status AS relationshipStatus,
          src.node_identity AS sourceNodeIdentity,
          src.repository_id AS sourceNodeRepoId,
          src.scan_id AS sourceNodeScanId,
          dst.node_identity AS targetNodeIdentity,
          dst.repository_id AS targetNodeRepoId,
          dst.scan_id AS targetNodeScanId
         FROM graph_edges ge
         LEFT JOIN graph_nodes src ON src.id = ge.source_node_id
         LEFT JOIN graph_nodes dst ON dst.id = ge.target_node_id
         WHERE ge.repository_id = ? AND ge.scan_id = ?`,
      )
      .all(repositoryId, targetScanId) as unknown as {
      id: number;
      edgeIdentity: string;
      relationshipType: string;
      relationshipStatus: string;
      sourceNodeIdentity: string | null;
      sourceNodeRepoId: number | null;
      sourceNodeScanId: number | null;
      targetNodeIdentity: string | null;
      targetNodeRepoId: number | null;
      targetNodeScanId: number | null;
    }[];
    for (const edge of edgeRows) {
      const hasValidOwnedEndpoints = Boolean(
        edge.sourceNodeIdentity &&
        edge.targetNodeIdentity &&
        edge.sourceNodeRepoId === repositoryId &&
        edge.sourceNodeScanId === targetScanId &&
        edge.targetNodeRepoId === repositoryId &&
        edge.targetNodeScanId === targetScanId,
      );
      graphEdgesByIdentity.set(edge.edgeIdentity, {
        id: edge.id,
        edgeIdentity: edge.edgeIdentity,
        relationshipType: edge.relationshipType,
        relationshipStatus: edge.relationshipStatus,
        sourceNodeIdentity: edge.sourceNodeIdentity,
        targetNodeIdentity: edge.targetNodeIdentity,
        hasValidOwnedEndpoints,
      });
    }

    const edgeByIdCache = new Map<number, GraphEdgeByIdRecord | null>();
    const edgeByIdStmt = db.prepare(
      `SELECT
        ge.id,
        ge.repository_id AS repositoryId,
        ge.scan_id AS scanId,
        ge.edge_identity AS edgeIdentity,
        ge.relationship_type AS relationshipType,
        ge.relationship_status AS relationshipStatus,
        src.node_identity AS sourceNodeIdentity,
        src.repository_id AS sourceNodeRepoId,
        src.scan_id AS sourceNodeScanId,
        dst.node_identity AS targetNodeIdentity,
        dst.repository_id AS targetNodeRepoId,
        dst.scan_id AS targetNodeScanId
       FROM graph_edges ge
       LEFT JOIN graph_nodes src ON src.id = ge.source_node_id
       LEFT JOIN graph_nodes dst ON dst.id = ge.target_node_id
       WHERE ge.id = ?`,
    );
    const getGraphEdgeById = (edgeId: number): GraphEdgeByIdRecord | undefined => {
      if (!edgeByIdCache.has(edgeId)) {
        const row = edgeByIdStmt.get(edgeId) as GraphEdgeByIdRecord | undefined;
        edgeByIdCache.set(edgeId, row ?? null);
      }
      return edgeByIdCache.get(edgeId) ?? undefined;
    };

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
      isScanOwnedByRepository,
      filesByPath,
      symbolsByIdentity,
      relocatedSymbols,
      resolveRelocationFromScan,
      importsBySource,
      componentsByIdentity,
      modifiedComponentCategories,
      getComponentCategoryInScan,
      adrsById,
      adrsByPath,
      graphEdgesByIdentity,
      getGraphEdgeById,
      sourceEdgeIdentitiesById,
      testFilesWithAssociations,
    };
  }

  public static evaluateEvidence(
    ctx: TargetSnapshotContext,
    evidence: MemoryEvidenceRecord,
  ): EvidenceEvaluationItem {
    // Reject cross-repository or non-owned evidence scans conservatively as UNVERIFIED
    if (
      evidence.repositoryId !== ctx.repositoryId ||
      !ctx.isScanOwnedByRepository(evidence.scanId)
    ) {
      return {
        evidenceId: evidence.id,
        memoryId: evidence.memoryId,
        evidenceType: evidence.evidenceType,
        sourcePath: evidence.sourcePath,
        symbolIdentity: evidence.symbolIdentity,
        isContradictory: evidence.isContradictory,
        status: "UNVERIFIED",
        reason: `Evidence ${evidence.id} belongs to repository ${evidence.repositoryId} / scan ${evidence.scanId}, outside active repository ${ctx.repositoryId}`,
        targetScanId: ctx.targetScanId,
      };
    }

    if (evidence.isContradictory) {
      const outcome = this.evaluateContradictoryEvidence(ctx, evidence);
      return {
        evidenceId: evidence.id,
        memoryId: evidence.memoryId,
        evidenceType: evidence.evidenceType,
        sourcePath: evidence.sourcePath,
        symbolIdentity: evidence.symbolIdentity,
        isContradictory: evidence.isContradictory,
        status: outcome.status,
        reason: outcome.reason,
        targetScanId: ctx.targetScanId,
      };
    }

    let status: EvidenceVerificationStatus;
    let reason: string;

    switch (evidence.evidenceType) {
      case "source_file": {
        // DEFECT-EV-01: Verify both file path presence and contentHash against evidence.sourceHash
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
        // DEFECT-EV-02 & DEFECT-EV-03: Fingerprint drift is MISSING (STALE); unique relocation resolves target identity & fingerprint
        const symId = evidence.symbolIdentity;
        const targetSym = symId ? ctx.symbolsByIdentity.get(symId) : undefined;
        const reloc = symId
          ? (ctx.relocatedSymbols.get(symId) ??
            (evidence.scanId !== ctx.targetScanId
              ? ctx.resolveRelocationFromScan(evidence.scanId, symId)
              : undefined))
          : undefined;

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
          const relocatedTargetSym = ctx.symbolsByIdentity.get(reloc.targetIdentity);
          if (!relocatedTargetSym) {
            status = "UNVERIFIED";
            reason = `Relocated symbol target '${reloc.targetIdentity}' could not be confirmed in scan ${ctx.targetScanId}`;
          } else if (
            evidence.sourceHash &&
            evidence.sourceHash !== relocatedTargetSym.fingerprint
          ) {
            status = "MISSING";
            reason = `Relocated symbol '${symId}' fingerprint changed (${evidence.sourceHash} -> ${relocatedTargetSym.fingerprint}); memory needs re-verification`;
          } else if (
            reloc.baseFingerprint &&
            reloc.baseFingerprint !== relocatedTargetSym.fingerprint
          ) {
            status = "MISSING";
            reason = `Relocated symbol '${symId}' fingerprint drifted across move (${reloc.baseFingerprint} -> ${relocatedTargetSym.fingerprint}); memory needs re-verification`;
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
        // ISSUE-EV-07: Validate specifier, line window, and UNRESOLVED import semantics
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
        // ISSUE-EV-08: Detect component category shifts across comparison or origin scan
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
        // DEFECT-EV-06: Historical ADR status resolved purely from hash-verified snapshot state
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
        // ISSUE-EV-09: Resolve graph-edge evidence via graphEdgeId even when symbolIdentity is null,
        // verifying endpoint ownership, scan provenance, and endpoint/relationship continuity.
        if (evidence.graphEdgeId !== null) {
          const srcEdge = ctx.getGraphEdgeById(evidence.graphEdgeId);
          if (!srcEdge) {
            status = "UNVERIFIED";
            reason = `Graph edge ID ${evidence.graphEdgeId} could not be resolved for scan ${ctx.targetScanId}`;
          } else if (
            srcEdge.repositoryId !== ctx.repositoryId ||
            srcEdge.sourceNodeRepoId !== ctx.repositoryId ||
            srcEdge.targetNodeRepoId !== ctx.repositoryId
          ) {
            status = "UNVERIFIED";
            reason = `Graph edge ${evidence.graphEdgeId} or its endpoint nodes belong to another repository`;
          } else if (
            srcEdge.scanId !== evidence.scanId ||
            srcEdge.sourceNodeScanId !== srcEdge.scanId ||
            srcEdge.targetNodeScanId !== srcEdge.scanId
          ) {
            status = "UNVERIFIED";
            reason = `Graph edge ${evidence.graphEdgeId} (scan ${srcEdge.scanId}) does not match evidence scan ${evidence.scanId}`;
          } else if (!srcEdge.sourceNodeIdentity || !srcEdge.targetNodeIdentity) {
            status = "UNVERIFIED";
            reason = `Graph edge ${evidence.graphEdgeId} lacks resolved endpoint node identities`;
          } else if (
            evidence.symbolIdentity !== null &&
            evidence.symbolIdentity !== srcEdge.edgeIdentity
          ) {
            status = "UNVERIFIED";
            reason = `Graph edge ${evidence.graphEdgeId} identity '${srcEdge.edgeIdentity}' conflicts with symbolIdentity '${evidence.symbolIdentity}'`;
          } else {
            const targetEdge = ctx.graphEdgesByIdentity.get(srcEdge.edgeIdentity);
            if (!targetEdge) {
              status = "MISSING";
              reason = `Graph edge '${srcEdge.edgeIdentity}' missing in scan ${ctx.targetScanId}`;
            } else if (!targetEdge.hasValidOwnedEndpoints) {
              status = "UNVERIFIED";
              reason = `Graph edge '${srcEdge.edgeIdentity}' in scan ${ctx.targetScanId} has invalid or cross-repository endpoints`;
            } else if (
              targetEdge.sourceNodeIdentity !== srcEdge.sourceNodeIdentity ||
              targetEdge.targetNodeIdentity !== srcEdge.targetNodeIdentity ||
              targetEdge.relationshipType !== srcEdge.relationshipType
            ) {
              status = "MISSING";
              reason = `Graph edge '${srcEdge.edgeIdentity}' changed endpoints or relationship type (${srcEdge.relationshipType} -> ${targetEdge.relationshipType}) in scan ${ctx.targetScanId}`;
            } else if (targetEdge.relationshipStatus === "UNRESOLVED") {
              status = "UNVERIFIED";
              reason = `Graph edge '${srcEdge.edgeIdentity}' is UNRESOLVED in scan ${ctx.targetScanId}; target cannot be verified`;
            } else {
              status = "VERIFIED";
              reason = `Graph edge '${srcEdge.edgeIdentity}' verified via graphEdgeId=${evidence.graphEdgeId} in scan ${ctx.targetScanId}`;
            }
          }
        } else {
          const fallbackIdentity =
            evidence.symbolIdentity ??
            evidence.description.match(
              /(?:edge:[^\s]+|[a-z_]+:[^\s]+->[A-Z_]+->[a-z_]+:[^\s]+)/,
            )?.[0];
          if (!fallbackIdentity) {
            status = "UNVERIFIED";
            reason = `Graph edge identity could not be resolved for scan ${ctx.targetScanId}`;
          } else {
            const targetEdge = ctx.graphEdgesByIdentity.get(fallbackIdentity);
            if (!targetEdge) {
              status = "MISSING";
              reason = `Graph edge '${fallbackIdentity}' missing in scan ${ctx.targetScanId}`;
            } else if (
              !targetEdge.hasValidOwnedEndpoints ||
              targetEdge.relationshipStatus === "UNRESOLVED"
            ) {
              status = "UNVERIFIED";
              reason = `Graph edge '${fallbackIdentity}' in scan ${ctx.targetScanId} cannot be positively verified (${targetEdge.relationshipStatus})`;
            } else {
              status = "VERIFIED";
              reason = `Graph edge '${fallbackIdentity}' verified in scan ${ctx.targetScanId}`;
            }
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
        // DEFECT-EV-05: Diff evidence MUST anchor to a concrete target artifact and verify its hash/symbol;
        // a comparison object alone never certifies unanchored diff evidence.
        if (!evidence.sourcePath || evidence.sourcePath === "diff") {
          status = "UNVERIFIED";
          reason = `Unanchored diff evidence cannot be automatically verified against scan ${ctx.targetScanId}`;
        } else {
          const fileEntry = ctx.filesByPath.get(evidence.sourcePath);
          if (!fileEntry) {
            status = "MISSING";
            reason = `Snapshot diff artifact '${evidence.sourcePath}' missing in scan ${ctx.targetScanId}`;
          } else if (evidence.symbolIdentity) {
            const sym = ctx.symbolsByIdentity.get(evidence.symbolIdentity);
            if (!sym) {
              status = "MISSING";
              reason = `Snapshot diff symbol '${evidence.symbolIdentity}' missing in scan ${ctx.targetScanId}`;
            } else if (evidence.sourceHash && sym.fingerprint !== evidence.sourceHash) {
              status = "MISSING";
              reason = `Snapshot diff symbol '${evidence.symbolIdentity}' fingerprint changed in scan ${ctx.targetScanId}`;
            } else {
              status = "VERIFIED";
              reason = `Snapshot diff artifact '${evidence.sourcePath}' (${evidence.symbolIdentity}) verified in scan ${ctx.targetScanId}`;
            }
          } else if (evidence.sourceHash) {
            if (fileEntry.contentHash === null) {
              status = "UNVERIFIED";
              reason = `Snapshot diff artifact '${evidence.sourcePath}' lacks stored content_hash in scan ${ctx.targetScanId}`;
            } else if (fileEntry.contentHash !== evidence.sourceHash) {
              status = "MISSING";
              reason = `Snapshot diff artifact '${evidence.sourcePath}' hash changed (${evidence.sourceHash} -> ${fileEntry.contentHash}) in scan ${ctx.targetScanId}`;
            } else {
              status = "VERIFIED";
              reason = `Snapshot diff artifact '${evidence.sourcePath}' hash-verified in scan ${ctx.targetScanId}`;
            }
          } else {
            status = "VERIFIED";
            reason = `Snapshot diff artifact '${evidence.sourcePath}' verified in scan ${ctx.targetScanId}`;
          }
        }
        break;
      }

      case "manual": {
        // DEFECT-EV-04: Unanchored manual evidence returns UNVERIFIED; file-anchored checks path & sourceHash
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

    // DEFECT-LC-03: In PARTIAL snapshots, missing artifacts cannot prove staleness
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

  private static evaluateContradictoryEvidence(
    ctx: TargetSnapshotContext,
    evidence: MemoryEvidenceRecord,
  ): { status: EvidenceVerificationStatus; reason: string } {
    switch (evidence.evidenceType) {
      case "manual":
      case "diff": {
        if (!evidence.sourcePath || evidence.sourcePath === evidence.evidenceType) {
          return {
            status: "UNVERIFIED",
            reason: `Unanchored contradictory ${evidence.evidenceType} evidence cannot establish contradiction in scan ${ctx.targetScanId}`,
          };
        }
        const fileEntry = ctx.filesByPath.get(evidence.sourcePath);
        if (!fileEntry) {
          return {
            status: "MISSING",
            reason: `Contradictory ${evidence.evidenceType} artifact '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
          };
        }
        if (evidence.evidenceType === "diff" && evidence.symbolIdentity) {
          const sym = ctx.symbolsByIdentity.get(evidence.symbolIdentity);
          if (!sym || (evidence.sourceHash && sym.fingerprint !== evidence.sourceHash)) {
            return {
              status: "MISSING",
              reason: `Contradictory diff symbol '${evidence.symbolIdentity}' absent or altered in scan ${ctx.targetScanId}`,
            };
          }
          return {
            status: "CONTRADICTED",
            reason: `Contradictory diff symbol '${evidence.symbolIdentity}' active in scan ${ctx.targetScanId}`,
          };
        }
        if (evidence.sourceHash) {
          if (fileEntry.contentHash === null) {
            return {
              status: "UNVERIFIED",
              reason: `Contradictory ${evidence.evidenceType} artifact '${evidence.sourcePath}' lacks stored content_hash in scan ${ctx.targetScanId}`,
            };
          }
          if (fileEntry.contentHash !== evidence.sourceHash) {
            return {
              status: "MISSING",
              reason: `Contradictory ${evidence.evidenceType} artifact '${evidence.sourcePath}' hash differs in scan ${ctx.targetScanId}`,
            };
          }
        }
        return {
          status: "CONTRADICTED",
          reason: `Contradictory ${evidence.evidenceType} evidence active in scan ${ctx.targetScanId}: ${evidence.description}`,
        };
      }

      case "source_file": {
        const fileEntry = ctx.filesByPath.get(evidence.sourcePath);
        if (!fileEntry) {
          return {
            status: "MISSING",
            reason: `Contradictory source_file '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
          };
        }
        if (evidence.sourceHash) {
          if (fileEntry.contentHash === null) {
            return {
              status: "UNVERIFIED",
              reason: `Contradictory source_file '${evidence.sourcePath}' lacks content_hash in scan ${ctx.targetScanId}`,
            };
          }
          if (fileEntry.contentHash !== evidence.sourceHash) {
            return {
              status: "MISSING",
              reason: `Contradictory source_file '${evidence.sourcePath}' hash differs in scan ${ctx.targetScanId}`,
            };
          }
        }
        return {
          status: "CONTRADICTED",
          reason: `Contradictory source_file evidence active in scan ${ctx.targetScanId}: ${evidence.description}`,
        };
      }

      case "symbol": {
        if (!evidence.symbolIdentity) {
          return ctx.filesByPath.has(evidence.sourcePath)
            ? {
                status: "UNVERIFIED",
                reason: `Contradictory symbol evidence on '${evidence.sourcePath}' lacks symbolIdentity`,
              }
            : {
                status: "MISSING",
                reason: `Contradictory symbol file '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
              };
        }
        const sym = ctx.symbolsByIdentity.get(evidence.symbolIdentity);
        if (!sym || (evidence.sourceHash && sym.fingerprint !== evidence.sourceHash)) {
          return {
            status: "MISSING",
            reason: `Contradictory symbol '${evidence.symbolIdentity}' absent or altered in scan ${ctx.targetScanId}`,
          };
        }
        return {
          status: "CONTRADICTED",
          reason: `Contradictory symbol evidence active in scan ${ctx.targetScanId}: ${evidence.description}`,
        };
      }

      case "component": {
        const descMatch = evidence.description.match(/comp:([^\s,)]+)/);
        const compId = descMatch?.[1]
          ? `comp:${descMatch[1]}`
          : evidence.sourcePath.startsWith("comp:")
            ? evidence.sourcePath
            : `comp:${evidence.sourcePath}`;
        return ctx.componentsByIdentity.has(compId)
          ? {
              status: "CONTRADICTED",
              reason: `Contradictory component '${compId}' active in scan ${ctx.targetScanId}`,
            }
          : {
              status: "MISSING",
              reason: `Contradictory component '${compId}' absent in scan ${ctx.targetScanId}`,
            };
      }

      case "graph_edge": {
        if (evidence.graphEdgeId !== null) {
          const srcEdge = ctx.getGraphEdgeById(evidence.graphEdgeId);
          if (
            !srcEdge ||
            srcEdge.repositoryId !== ctx.repositoryId ||
            srcEdge.scanId !== evidence.scanId ||
            srcEdge.sourceNodeRepoId !== ctx.repositoryId ||
            srcEdge.targetNodeRepoId !== ctx.repositoryId ||
            !srcEdge.sourceNodeIdentity ||
            !srcEdge.targetNodeIdentity
          ) {
            return {
              status: "UNVERIFIED",
              reason: `Contradictory graph_edge ${evidence.graphEdgeId} ownership/scan could not be verified`,
            };
          }
          const targetEdge = ctx.graphEdgesByIdentity.get(srcEdge.edgeIdentity);
          if (
            !targetEdge ||
            targetEdge.sourceNodeIdentity !== srcEdge.sourceNodeIdentity ||
            targetEdge.targetNodeIdentity !== srcEdge.targetNodeIdentity ||
            targetEdge.relationshipType !== srcEdge.relationshipType
          ) {
            return {
              status: "MISSING",
              reason: `Contradictory graph_edge '${srcEdge.edgeIdentity}' absent in scan ${ctx.targetScanId}`,
            };
          }
          if (
            !targetEdge.hasValidOwnedEndpoints ||
            targetEdge.relationshipStatus === "UNRESOLVED"
          ) {
            return {
              status: "UNVERIFIED",
              reason: `Contradictory graph_edge '${srcEdge.edgeIdentity}' unresolved in scan ${ctx.targetScanId}`,
            };
          }
          return {
            status: "CONTRADICTED",
            reason: `Contradictory graph_edge '${srcEdge.edgeIdentity}' active in scan ${ctx.targetScanId}`,
          };
        }
        const edgeId =
          evidence.symbolIdentity ??
          evidence.description.match(
            /(?:edge:[^\s]+|[a-z_]+:[^\s]+->[A-Z_]+->[a-z_]+:[^\s]+)/,
          )?.[0];
        if (!edgeId) {
          return {
            status: "UNVERIFIED",
            reason: `Contradictory graph_edge lacks edge identity in scan ${ctx.targetScanId}`,
          };
        }
        const targetEdge = ctx.graphEdgesByIdentity.get(edgeId);
        if (!targetEdge) {
          return {
            status: "MISSING",
            reason: `Contradictory graph_edge '${edgeId}' absent in scan ${ctx.targetScanId}`,
          };
        }
        if (!targetEdge.hasValidOwnedEndpoints || targetEdge.relationshipStatus === "UNRESOLVED") {
          return {
            status: "UNVERIFIED",
            reason: `Contradictory graph_edge '${edgeId}' unresolved in scan ${ctx.targetScanId}`,
          };
        }
        return {
          status: "CONTRADICTED",
          reason: `Contradictory graph_edge '${edgeId}' active in scan ${ctx.targetScanId}`,
        };
      }

      case "import": {
        const imports = ctx.importsBySource.get(evidence.sourcePath) ?? [];
        const specMatch = evidence.description.match(/import:([^\s]+)/i);
        const targetSpec = evidence.symbolIdentity ?? specMatch?.[1];
        const matching = targetSpec
          ? imports.filter((i) => i.specifier === targetSpec || i.resolvedPath === targetSpec)
          : imports;
        return matching.length > 0
          ? {
              status: "CONTRADICTED",
              reason: `Contradictory import in '${evidence.sourcePath}' active in scan ${ctx.targetScanId}`,
            }
          : {
              status: "MISSING",
              reason: `Contradictory import in '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
            };
      }

      case "adr": {
        const adrMatch = evidence.description.match(/\b(ADR-\d+)\b/i);
        const adrInfo =
          ctx.adrsByPath.get(evidence.sourcePath) ??
          (adrMatch ? ctx.adrsById.get(adrMatch[1].toUpperCase()) : undefined);
        if (!adrInfo) {
          return ctx.filesByPath.has(evidence.sourcePath)
            ? {
                status: "UNVERIFIED",
                reason: `Contradictory ADR '${evidence.sourcePath}' exists without verified metadata in scan ${ctx.targetScanId}`,
              }
            : {
                status: "MISSING",
                reason: `Contradictory ADR '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
              };
        }
        if (adrInfo.isFallback || !adrInfo.status) {
          return {
            status: "UNVERIFIED",
            reason: `Contradictory ADR '${evidence.sourcePath}' historical status unverified in scan ${ctx.targetScanId}`,
          };
        }
        if (DEPRECATED_ADR_STATUS_RE.test(adrInfo.status)) {
          return {
            status: "MISSING",
            reason: `Contradictory ADR '${evidence.sourcePath}' is ${adrInfo.status} in scan ${ctx.targetScanId}`,
          };
        }
        return {
          status: "CONTRADICTED",
          reason: `Contradictory ADR '${evidence.sourcePath}' (${adrInfo.status}) active in scan ${ctx.targetScanId}`,
        };
      }

      case "test":
        return ctx.filesByPath.has(evidence.sourcePath)
          ? {
              status: "CONTRADICTED",
              reason: `Contradictory test file '${evidence.sourcePath}' present in scan ${ctx.targetScanId}`,
            }
          : {
              status: "MISSING",
              reason: `Contradictory test file '${evidence.sourcePath}' absent in scan ${ctx.targetScanId}`,
            };
    }
  }
}
