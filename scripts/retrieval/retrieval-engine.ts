/**
 * Phase 7.6 — Agent Retrieval Engine
 * Deterministic, read-only, evidence-backed orchestrator across Phases 7.1–7.5 intelligence subsystems.
 */

import { createHash } from "node:crypto";
import type { ConnectionManager } from "../storage/connection-manager.ts";
import { ArchitectureQueryEngine } from "../query/query-engine.ts";
import { FreshnessEvaluator } from "../query/freshness-evaluator.ts";
import { ArchitectureAnalyzer } from "../architecture/architecture-analyzer.ts";
import { EvolutionAnalyzer } from "../evolution/evolution-analyzer.ts";
import { SnapshotComparisonError } from "../evolution/snapshot-comparator.ts";
import { TaskClassifier } from "./task-classifier.ts";
import { resolveEffectivePolicy } from "./agent-policies.ts";
import { RetrievalPlanner } from "./retrieval-planner.ts";
import { ContentSanitizer } from "./content-sanitizer.ts";
import { EvidenceUnifier } from "./evidence-unifier.ts";
import { RelevanceRanker } from "./relevance-ranker.ts";
import { ContextBudgeter } from "./context-budgeter.ts";
import { validateRetrievalResponse } from "./schema-validator.ts";
import type {
  AnyRankedItem,
  BudgetReport,
  ConfidenceSummary,
  HandoffContextHighlight,
  HandoffEvidenceVerificationStatus,
  HandoffRetrievalContext,
  RankedAdrItem,
  RankedComponentItem,
  RankedDependencyItem,
  RankedFileItem,
  RankedMemoryItem,
  RankedSymbolItem,
  RankedTestAssociationItem,
  RetrievalDomain,
  RetrievalEvolutionSummary,
  RetrievalOverviewSummary,
  RetrievalPlan,
  RetrievalRequest,
  RetrievalResponse,
  RetrievalWarning,
  RetrievalWarningCode,
  SafeCodeSnippet,
} from "./types.ts";
import type { ConfidenceTier } from "../query/types.ts";
import type { ScanRecord } from "../storage/types.ts";

const VALID_AGENT_IDS = new Set<string>([
  "frontier-engineer",
  "architect",
  "implementation-engineer",
  "security-auditor",
  "qa-engineer",
  "design-engineer",
]);

const VALID_TASK_TYPES = new Set<string>([
  "architecture_design",
  "feature_implementation",
  "bug_fix",
  "refactoring",
  "database_change",
  "security_audit",
  "test_generation",
  "ui_ux_work",
  "documentation",
  "evolution_review",
  "general_inspection",
]);

const ALLOWED_REQUEST_KEYS = new Set<string>([
  "agentId",
  "taskSummary",
  "objective",
  "taskType",
  "targetFiles",
  "targetSymbols",
  "targetComponents",
  "targetAdrs",
  "scanId",
  "baseScanId",
  "targetScanId",
  "expectedRepositoryIdentity",
  "verifyContentHashes",
  "includeSnippets",
  "includeHistoricalMemories",
  "allowPartialSnapshot",
  "limits",
  "signal",
]);

const ALLOWED_LIMITS_KEYS = new Set<string>([
  "maxItems",
  "maxTotalChars",
  "maxTokens",
  "maxDepth",
  "maxSnippetLines",
]);

export class RetrievalEngine {
  private readonly connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  private validateRequest(request: RetrievalRequest): void {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("ERR_RETRIEVAL_REQUEST_INVALID: Retrieval request must be a plain object.");
    }

    for (const key of Object.keys(request)) {
      if (!ALLOWED_REQUEST_KEYS.has(key)) {
        throw new Error(`ERR_RETRIEVAL_REQUEST_INVALID: Unknown request field '${key}'.`);
      }
    }

    if (
      !request.taskSummary ||
      typeof request.taskSummary !== "string" ||
      !request.taskSummary.trim()
    ) {
      throw new Error("ERR_RETRIEVAL_REQUEST_INVALID: Retrieval taskSummary cannot be empty.");
    }

    if (typeof request.agentId !== "string" || !VALID_AGENT_IDS.has(request.agentId)) {
      throw new Error(
        `ERR_RETRIEVAL_REQUEST_INVALID: Unsupported agentId '${String(request.agentId)}'.`,
      );
    }

    if (
      request.taskType !== undefined &&
      (typeof request.taskType !== "string" || !VALID_TASK_TYPES.has(request.taskType))
    ) {
      throw new Error(
        `ERR_RETRIEVAL_REQUEST_INVALID: Unsupported taskType '${String(request.taskType)}'.`,
      );
    }

    if (request.objective !== undefined && typeof request.objective !== "string") {
      throw new Error("ERR_RETRIEVAL_REQUEST_INVALID: objective must be a string.");
    }

    if (
      request.expectedRepositoryIdentity !== undefined &&
      typeof request.expectedRepositoryIdentity !== "string"
    ) {
      throw new Error(
        "ERR_RETRIEVAL_REQUEST_INVALID: expectedRepositoryIdentity must be a string.",
      );
    }

    for (const field of [
      "targetFiles",
      "targetSymbols",
      "targetComponents",
      "targetAdrs",
    ] as const) {
      const value = request[field];
      if (value !== undefined) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          throw new Error(`ERR_RETRIEVAL_REQUEST_INVALID: ${field} must be an array of strings.`);
        }
      }
    }

    for (const field of [
      "verifyContentHashes",
      "includeSnippets",
      "includeHistoricalMemories",
      "allowPartialSnapshot",
    ] as const) {
      if (request[field] !== undefined && typeof request[field] !== "boolean") {
        throw new Error(`ERR_RETRIEVAL_REQUEST_INVALID: ${field} must be a boolean.`);
      }
    }

    for (const field of ["scanId", "baseScanId", "targetScanId"] as const) {
      const val = request[field];
      if (val !== undefined && (!Number.isSafeInteger(val) || val <= 0)) {
        throw new Error(`ERR_RETRIEVAL_REQUEST_INVALID: ${field} must be a positive safe integer.`);
      }
    }

    if ((request.baseScanId !== undefined) !== (request.targetScanId !== undefined)) {
      throw new Error(
        "ERR_RETRIEVAL_REQUEST_INVALID: Evolution retrieval requires both baseScanId and targetScanId.",
      );
    }
    if (
      request.baseScanId !== undefined &&
      request.targetScanId !== undefined &&
      request.baseScanId === request.targetScanId
    ) {
      throw new Error(
        "ERR_RETRIEVAL_REQUEST_INVALID: baseScanId and targetScanId must refer to distinct scans.",
      );
    }

    if (request.limits !== undefined) {
      if (!request.limits || typeof request.limits !== "object" || Array.isArray(request.limits)) {
        throw new Error("ERR_RETRIEVAL_REQUEST_INVALID: limits must be a plain object.");
      }
      for (const [k, v] of Object.entries(request.limits)) {
        if (!ALLOWED_LIMITS_KEYS.has(k)) {
          throw new Error(`ERR_RETRIEVAL_REQUEST_INVALID: Unknown limits field '${k}'.`);
        }
        if (v !== undefined && (!Number.isSafeInteger(v) || v <= 0)) {
          throw new Error(
            `ERR_RETRIEVAL_REQUEST_INVALID: limits.${k} must be a positive safe integer.`,
          );
        }
      }
    }
  }

  public async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    this.throwIfAborted(request?.signal);
    this.validateRequest(request);

    const db = this.connectionManager.getDatabase();
    const repo = this.connectionManager.getRepository();

    if (
      request.expectedRepositoryIdentity !== undefined &&
      request.expectedRepositoryIdentity.trim() !== repo.identity
    ) {
      throw new SnapshotComparisonError(
        `Expected repository identity '${request.expectedRepositoryIdentity}', but workspace repository is '${repo.identity}'.`,
        "ERR_REPOSITORY_MISMATCH",
      );
    }

    const allowPartial = request.allowPartialSnapshot === true;
    const boundedRequest: RetrievalRequest = {
      ...request,
      taskSummary: ContentSanitizer.truncateUnicodeSafe(request.taskSummary, 4000).text,
      objective: request.objective
        ? ContentSanitizer.truncateUnicodeSafe(request.objective, 4000).text
        : undefined,
      signal: undefined,
    };

    const resolvedScan = this.resolveTargetScan(
      repo.id,
      repo.activeScanId,
      boundedRequest.scanId,
      allowPartial,
    );
    const freshness = FreshnessEvaluator.evaluate(db, repo.id, repo.rootPath, {
      explicitScanId: resolvedScan.id,
      verifyContentHashes: boundedRequest.verifyContentHashes ?? false,
    });

    if (freshness.isPartial && allowPartial === false) {
      throw new Error(
        `Repository index snapshot ${resolvedScan.id} is a PARTIAL index and allowPartialSnapshot is false.`,
      );
    }

    const warnings: RetrievalWarning[] = [];
    const limitations: string[] = [
      ...(freshness.limitations ?? []),
      ...(freshness.disclosures ?? []),
    ];

    if (freshness.isStale) {
      warnings.push({
        code: "INDEX_STALE",
        severity: "warning",
        message: freshness.staleReason ?? "Indexed snapshot is stale compared to workspace files.",
      });
    }
    if (freshness.isPartial || resolvedScan.status === "PARTIAL") {
      warnings.push({
        code: "PARTIAL_SNAPSHOT",
        severity: "warning",
        message: `Snapshot ${resolvedScan.id} is a PARTIAL index; missing files or symbols may affect completeness.`,
      });
    }

    this.throwIfAborted(request.signal);

    // 1. Classify task & extract targets deterministically
    const classification = TaskClassifier.classify(boundedRequest);
    if (classification.isAmbiguous) {
      warnings.push({
        code: "AMBIGUOUS_CLASSIFICATION",
        severity: "info",
        message: `Task intent classification was low-confidence or ambiguous (primary: '${classification.primaryTaskType}', tier: ${classification.confidenceTier ?? "CANDIDATE"}); falling back cleanly.`,
      });
    }
    for (const unsafePath of classification.extractedTargets.ignoredUnsafeTargets) {
      const safeEntity = ContentSanitizer.sanitizeMetadataText(unsafePath).text;
      warnings.push({
        code: "UNSAFE_TARGET_IGNORED",
        severity: "warning",
        message: `Ignored unsafe or outside-workspace target path '${safeEntity}'.`,
        entity: safeEntity,
      });
    }

    // 2. Resolve role-aware agent policy & configuration
    const resolvedPolicy = resolveEffectivePolicy(repo.rootPath, boundedRequest);
    warnings.push(...resolvedPolicy.warnings);

    // 3. Build bounded deterministic plan
    const plan = RetrievalPlanner.buildPlan(boundedRequest, classification, resolvedPolicy);
    const plannedDomains = new Set(plan.steps.map((s) => s.domain));

    const queryEngine = new ArchitectureQueryEngine(this.connectionManager);
    const archAnalyzer = new ArchitectureAnalyzer(db);
    const scanId = resolvedScan.id;

    // 4. Retrieve candidates per domain (strictly scoped to repositoryId + scanId, read-only)
    const candidates: AnyRankedItem[] = [];
    const seedFiles = new Set<string>(classification.extractedTargets.files);

    // 4a. Overview
    this.throwIfAborted(request.signal);
    let overview: RetrievalOverviewSummary | null = null;
    if (plannedDomains.has("overview")) {
      try {
        const ovRes = await queryEngine.getOverview({ scanId, allowPartial });
        const ovData = ovRes.data;
        overview = {
          languages: ovData.languages.slice(0, 10),
          packageManagers: ovData.packageManagers,
          frameworks: ovData.frameworks,
          componentCount: ovData.componentsSummary.totalComponents,
          entrypointPaths: ovData.entrypoints.slice(0, 10).map((e) => e.path),
          cycleCount: ovData.dependencySummary.circularCyclesCount,
          decisionCount: ovData.counts.decisions,
        };
      } catch (err: any) {
        const errMsg = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
        warnings.push({
          code: "PARTIAL_DOMAIN_ERROR",
          severity: "warning",
          message: `Overview summary could not be retrieved for scan ${scanId}: ${errMsg}`,
          entity: "overview",
        });
        limitations.push(`overview domain error on scan ${scanId}: ${errMsg}`);
      }
    }

    // 4b. Components
    this.throwIfAborted(request.signal);
    const archComponents = await archAnalyzer.getComponents(repo.id, scanId);
    const compNameByFile = new Map<string, string>();
    const compStepLimit = this.getStepLimit(plan, "components", 15);
    let compCountAdded = 0;
    for (const comp of archComponents) {
      for (const fp of comp.filePaths) {
        compNameByFile.set(fp, comp.name);
      }
      if (
        classification.extractedTargets.components.some(
          (hint) =>
            comp.name.toLowerCase().includes(hint.toLowerCase()) ||
            comp.category.toLowerCase() === hint.toLowerCase(),
        )
      ) {
        for (const fp of comp.filePaths.slice(0, 8)) {
          seedFiles.add(fp);
        }
      }
      if (plannedDomains.has("components") && compCountAdded < Math.max(compStepLimit * 2, 12)) {
        const safeName = ContentSanitizer.sanitizeMetadataText(comp.name).text;
        const safeEvidence = ContentSanitizer.sanitizeMetadataText(comp.evidenceDescription).text;
        const item: RankedComponentItem = {
          id: comp.componentIdentity,
          domain: "components",
          title: `${safeName} (${comp.category})`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: comp.status,
          untrustedRepositoryContent: false,
          trustLevel: "deterministic_metadata",
          componentIdentity: comp.componentIdentity,
          name: safeName,
          category: comp.category,
          rootPath: comp.rootPath,
          filesCount: comp.filesCount,
          sampleFiles: comp.filePaths.slice(0, 8),
          evidence: [
            {
              sourceType: comp.detectionMethod,
              filePath: comp.rootPath,
              confidence: comp.confidence,
              confidenceTier: comp.status,
              verificationStatus: "STATIC_INDEX",
              description: safeEvidence,
            },
          ],
        };
        candidates.push(item);
        compCountAdded++;
      }
    }

    // 4c. Files (targeted + keyword SQL lookup with batched export/import counts; avoids N+1)
    this.throwIfAborted(request.signal);
    const fileStepLimit = this.getStepLimit(plan, "files", 25);
    const fileMetaByPath = new Map<
      string,
      {
        id: number;
        normalizedPath: string;
        language: string;
        classification: string;
        sensitivityStatus: string;
        sizeBytes: number;
      }
    >();
    const selectedFileCandidates = this.selectCandidateFiles(
      repo.id,
      scanId,
      classification.extractedTargets.files,
      classification.extractedTargets.keywords,
      Array.from(seedFiles),
      Math.max(fileStepLimit * 2, plan.effectiveLimits.maxItems, 25),
    );

    const safeFileIds = selectedFileCandidates
      .filter((f) => f.sensitivityStatus === "SAFE")
      .map((f) => f.id);
    const batchedFileCounts = plannedDomains.has("files")
      ? this.getBatchFileCounts(repo.id, scanId, safeFileIds)
      : new Map<number, { exportsCount: number; importsCount: number }>();

    const indexedPathsFound = new Set<string>();
    let fileCountAdded = 0;
    for (const fRow of selectedFileCandidates) {
      indexedPathsFound.add(fRow.normalizedPath);
      fileMetaByPath.set(fRow.normalizedPath, fRow);

      if (fRow.sensitivityStatus !== "SAFE") {
        warnings.push({
          code: "SENSITIVE_FILE_REDACTED",
          severity: "warning",
          message: `Sensitive file '${fRow.normalizedPath}' metadata included without exposing hashes, symbols, or content.`,
          entity: fRow.normalizedPath,
        });
      }

      if (plannedDomains.has("files") && fileCountAdded < Math.max(fileStepLimit * 2, 20)) {
        const counts = batchedFileCounts.get(fRow.id) ?? { exportsCount: 0, importsCount: 0 };
        const item: RankedFileItem = {
          id: `file:${fRow.normalizedPath}`,
          domain: "files",
          title: fRow.normalizedPath,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: "CONFIRMED",
          untrustedRepositoryContent: false,
          trustLevel: "deterministic_metadata",
          filePath: fRow.normalizedPath,
          language: fRow.language,
          classification: fRow.classification,
          sensitivityStatus: fRow.sensitivityStatus,
          componentAssociation: compNameByFile.get(fRow.normalizedPath),
          exportedSymbolsCount: fRow.sensitivityStatus === "SAFE" ? counts.exportsCount : 0,
          importsCount: fRow.sensitivityStatus === "SAFE" ? counts.importsCount : 0,
          evidence: [
            {
              sourceType: "indexed_file",
              filePath: fRow.normalizedPath,
              confidence: 1.0,
              confidenceTier: "CONFIRMED",
              verificationStatus: "STATIC_INDEX",
              description: `Indexed ${fRow.classification} (${fRow.language}, sensitivity: ${fRow.sensitivityStatus})`,
            },
          ],
        };
        candidates.push(item);
        fileCountAdded++;
      }
    }

    for (const requestedFile of classification.extractedTargets.files) {
      if (!indexedPathsFound.has(requestedFile)) {
        warnings.push({
          code: "TARGET_NOT_FOUND",
          severity: "info",
          message: `Requested target file '${requestedFile}' was not found in scan ${scanId}.`,
          entity: requestedFile,
        });
      }
    }

    // 4d. Symbols (targeted SQL lookup on SAFE files only)
    this.throwIfAborted(request.signal);
    const matchedSymbolLocations: Array<{ filePath: string; startLine: number; endLine: number }> =
      [];
    if (plannedDomains.has("symbols") || plan.includeSnippets) {
      const symStepLimit = this.getStepLimit(plan, "symbols", 35);
      const symbolRows = this.selectCandidateSymbols(
        repo.id,
        scanId,
        classification.extractedTargets.symbols,
        classification.extractedTargets.files,
        classification.extractedTargets.keywords,
        Math.max(symStepLimit * 2, 20),
      );
      for (const sym of symbolRows) {
        seedFiles.add(sym.filePath);
        matchedSymbolLocations.push({
          filePath: sym.filePath,
          startLine: sym.startLine,
          endLine: sym.endLine,
        });
        if (plannedDomains.has("symbols")) {
          const safeSymName = ContentSanitizer.sanitizeMetadataText(sym.name).text;
          const item: RankedSymbolItem = {
            id: `symbol:${sym.symbolIdentity}`,
            domain: "symbols",
            title: `${safeSymName} (${sym.kind}) in ${sym.filePath}:${sym.startLine}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: sym.confidence >= 0.9 ? "CONFIRMED" : "INFERRED",
            untrustedRepositoryContent: false,
            trustLevel: "deterministic_metadata",
            symbolIdentity: sym.symbolIdentity,
            name: safeSymName,
            kind: sym.kind,
            filePath: sym.filePath,
            startLine: sym.startLine,
            endLine: sym.endLine,
            isExported: Boolean(sym.isExported),
            evidence: [
              {
                sourceType: "symbol_declaration",
                filePath: sym.filePath,
                lineRange: [sym.startLine, sym.endLine],
                symbolIdentity: sym.symbolIdentity,
                confidence: sym.confidence,
                confidenceTier: sym.confidence >= 0.9 ? "CONFIRMED" : "INFERRED",
                verificationStatus: "STATIC_INDEX",
                description: `Declaration of ${sym.kind} '${safeSymName}' (lines ${sym.startLine}-${sym.endLine})`,
              },
            ],
          };
          candidates.push(item);
        }
      }
    }

    // 4e. Dependencies & Dependents (cycle-safe bounded GraphTraversal via QueryEngine)
    this.throwIfAborted(request.signal);
    if (plannedDomains.has("dependencies")) {
      const depStepLimit = this.getStepLimit(plan, "dependencies", 12);
      const traversalSeeds = Array.from(seedFiles).slice(0, 4);
      if (traversalSeeds.length === 0 && archComponents.length > 0) {
        traversalSeeds.push(archComponents[0].componentIdentity);
      }

      const seenDepKeys = new Set<string>();
      for (const seed of traversalSeeds) {
        this.throwIfAborted(request.signal);
        for (const dir of ["dependencies", "dependents"] as const) {
          try {
            const res =
              dir === "dependencies"
                ? await queryEngine.getDependencies(seed, {
                    scanId,
                    allowPartial,
                    depth: plan.effectiveLimits.maxDepth,
                    limit: depStepLimit,
                  })
                : await queryEngine.getDependents(seed, {
                    scanId,
                    allowPartial,
                    depth: plan.effectiveLimits.maxDepth,
                    limit: depStepLimit,
                  });

            const nodes = [...res.data.direct, ...res.data.transitive].slice(0, depStepLimit);
            for (const n of nodes) {
              const key = `${dir}:${seed}->${n.nodeIdentity}`;
              if (seenDepKeys.has(key)) continue;
              seenDepKeys.add(key);

              const depItem: RankedDependencyItem = {
                id: `dep:${key}`,
                domain: "dependencies",
                title: `${seed} ${dir === "dependencies" ? "->" : "<-"} ${n.pathOrName} (depth ${n.depth})`,
                rankScore: 0,
                rankingReasons: [],
                confidenceTier: EvidenceUnifier.normalizeConfidenceTier(n.status),
                untrustedRepositoryContent: false,
                trustLevel: "deterministic_metadata",
                direction: dir === "dependencies" ? "dependency" : "dependent",
                sourceTarget: seed,
                targetNodeIdentity: n.nodeIdentity,
                targetName: n.pathOrName,
                relationship: n.relationship,
                depth: n.depth,
                unresolvedSpecifiers:
                  dir === "dependencies" ? res.data.unresolvedImports.slice(0, 10) : [],
                evidence: [
                  {
                    sourceType: "graph_traversal",
                    filePath: n.pathOrName,
                    confidence: n.confidence,
                    confidenceTier: EvidenceUnifier.normalizeConfidenceTier(n.status),
                    verificationStatus: "STATIC_INDEX",
                    description: `${n.relationship} path (${n.path.join(" -> ")})`,
                  },
                ],
              };
              candidates.push(depItem);
            }
          } catch (err: any) {
            const errMsg = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
            if (!/not found/i.test(errMsg)) {
              warnings.push({
                code: "PARTIAL_DOMAIN_ERROR",
                severity: "warning",
                message: `Dependency traversal failed for '${seed}' (${dir}): ${errMsg}`,
                entity: seed,
              });
              limitations.push(`dependency traversal partial error on '${seed}': ${errMsg}`);
            }
          }
        }
      }

      // Include structural cycles when relevant
      try {
        const cycleRes = await queryEngine.getCycles({
          scanId,
          allowPartial,
          limit: Math.min(5, depStepLimit),
        });
        for (const c of cycleRes.data.cycles) {
          const cycleId = `cycle:${c.cycle.join("->")}`;
          const item: RankedDependencyItem = {
            id: cycleId,
            domain: "dependencies",
            title: `Circular dependency: ${c.cycle.join(" -> ")}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: "CONFIRMED",
            untrustedRepositoryContent: false,
            trustLevel: "deterministic_metadata",
            direction: "cycle",
            sourceTarget: c.cycle[0],
            targetNodeIdentity: `file:${c.cycle[0]}`,
            targetName: c.cycle.join(" -> "),
            relationship: "CIRCULAR_DEPENDENCY",
            depth: c.cycle.length,
            unresolvedSpecifiers: [],
            evidence: [
              {
                sourceType: "tarjan_scc_cycle",
                filePath: c.cycle[0],
                confidence: 1.0,
                confidenceTier: "CONFIRMED",
                verificationStatus: "STATIC_INDEX",
                description: `Circular dependency loop (${c.cycle.join(" -> ")})`,
              },
            ],
          };
          candidates.push(item);
        }
      } catch (err: any) {
        const errMsg = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
        warnings.push({
          code: "PARTIAL_DOMAIN_ERROR",
          severity: "warning",
          message: `Circular dependency inspection failed for scan ${scanId}: ${errMsg}`,
          entity: "cycles",
        });
        limitations.push(`cycle analysis error on scan ${scanId}: ${errMsg}`);
      }
    }

    // 4f. Tests
    this.throwIfAborted(request.signal);
    if (plannedDomains.has("tests")) {
      const testStepLimit = this.getStepLimit(plan, "tests", 40);
      try {
        const testRes = await queryEngine.getTests(undefined, {
          scanId,
          allowPartial,
          limit: Math.max(testStepLimit * 2, 16),
        });
        for (const assoc of testRes.data.associations) {
          const safeDesc = ContentSanitizer.sanitizeMetadataText(assoc.evidenceDescription).text;
          const item: RankedTestAssociationItem = {
            id: `test:${assoc.testFilePath}=>${assoc.sourceFilePath}`,
            domain: "tests",
            title: `${assoc.testFilePath} tests ${assoc.sourceFilePath}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: assoc.associationStatus,
            untrustedRepositoryContent: false,
            trustLevel: "deterministic_metadata",
            testFilePath: assoc.testFilePath,
            sourceFilePath: assoc.sourceFilePath,
            associationStatus: assoc.associationStatus,
            evidenceType: assoc.evidenceType,
            evidence: [
              {
                sourceType: assoc.evidenceType,
                filePath: assoc.testFilePath,
                confidence: assoc.confidence,
                confidenceTier: assoc.associationStatus,
                verificationStatus: "STATIC_INDEX",
                description: safeDesc,
              },
            ],
          };
          candidates.push(item);
        }
      } catch (err: any) {
        const errMsg = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
        warnings.push({
          code: "PARTIAL_DOMAIN_ERROR",
          severity: "warning",
          message: `Test association retrieval failed for scan ${scanId}: ${errMsg}`,
          entity: "tests",
        });
        limitations.push(`tests domain error on scan ${scanId}: ${errMsg}`);
      }
    }

    // 4g. Decisions (ADRs — snapshot-hash isolated, never live-disk contaminated)
    this.throwIfAborted(request.signal);
    if (plannedDomains.has("decisions")) {
      const adrStepLimit = this.getStepLimit(plan, "decisions", 30);
      try {
        const adrRes = await queryEngine.getDecisions({
          scanId,
          allowPartial,
          limit: Math.max(adrStepLimit * 2, 16),
          requireSha256: true,
        });
        for (const adr of adrRes.data.decisions) {
          const sanitizedTitle = ContentSanitizer.sanitizeUntrustedText(adr.title, adr.filePath);
          const sanitizedSummary = ContentSanitizer.sanitizeUntrustedText(
            adr.evidenceDescription,
            adr.filePath,
          );
          if (sanitizedTitle.promptInjectionDetected || sanitizedSummary.promptInjectionDetected) {
            warnings.push({
              code: "PROMPT_INJECTION_SIGNAL",
              severity: "warning",
              message: `Prompt-injection-like text detected inside ADR '${adr.filePath}'; fenced strictly as untrusted data.`,
              entity: adr.adrId,
            });
          }
          if (sanitizedTitle.redacted || sanitizedSummary.redacted) {
            warnings.push({
              code: "INLINE_SECRET_REDACTED",
              severity: "warning",
              message: `Inline secret pattern redacted inside ADR '${adr.filePath}'.`,
              entity: adr.adrId,
            });
          }

          const isUnverifiedSnapshot =
            adr.isFallback === true ||
            (adr.verificationStatus !== undefined &&
              adr.verificationStatus !== "CONFIRMED" &&
              adr.verificationStatus !== "SNAPSHOT_METADATA");
          if (isUnverifiedSnapshot) {
            warnings.push({
              code: "ADR_SNAPSHOT_UNVERIFIED",
              severity: "warning",
              message: `ADR '${adr.adrId}' (${adr.filePath}) could not be SHA-256 verified against snapshot ${scanId} (${adr.verificationStatus ?? "UNVERIFIED"}); using snapshot fallback metadata only.`,
              entity: adr.adrId,
            });
            limitations.push(
              `ADR ${adr.adrId} snapshot verification status: ${adr.verificationStatus ?? "UNVERIFIED"} (live disk edits excluded).`,
            );
          }

          const adrConfidenceTier = isUnverifiedSnapshot
            ? "INFERRED"
            : adr.confidence >= 0.9
              ? "CONFIRMED"
              : "INFERRED";
          const evStatus =
            adr.verificationStatus === "CONFIRMED"
              ? "VERIFIED_ON_DISK"
              : (adr.verificationStatus ?? "STATIC_INDEX");

          const item: RankedAdrItem = {
            id: `adr:${adr.adrId}`,
            domain: "decisions",
            title: `${adr.adrId}: ${sanitizedTitle.inlineFencedText}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: adrConfidenceTier,
            untrustedRepositoryContent: true,
            trustLevel: "fenced_untrusted_content",
            adrId: adr.adrId,
            adrNumber: adr.number,
            adrStatus: adr.status,
            filePath: adr.filePath,
            governedComponents: adr.governedComponents,
            summaryText: sanitizedSummary.fencedText,
            verificationStatus: adr.verificationStatus,
            isFallback: adr.isFallback,
            evidence: [
              {
                sourceType: adr.isFallback ? "adr_snapshot_fallback" : "adr_document",
                filePath: adr.filePath,
                confidence: adr.confidence,
                confidenceTier: adrConfidenceTier,
                verificationStatus: evStatus,
                description: sanitizedSummary.inlineFencedText,
              },
            ],
          };
          candidates.push(item);
        }
      } catch (err: any) {
        const errMsg = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
        warnings.push({
          code: "PARTIAL_DOMAIN_ERROR",
          severity: "warning",
          message: `ADR retrieval failed for scan ${scanId}: ${errMsg}`,
          entity: "decisions",
        });
        limitations.push(`decisions domain error on scan ${scanId}: ${errMsg}`);
      }
    }

    // 4h. Engineering Memories (read-only verification)
    this.throwIfAborted(request.signal);
    if (plannedDomains.has("memories")) {
      const memResult = EvidenceUnifier.loadAndVerifyMemories({
        db,
        repositoryId: repo.id,
        scanId,
        workspaceRoot: repo.rootPath,
        includeHistorical: plan.includeHistoricalMemories,
        surfaceWarnings: resolvedPolicy.policy.surfaceDisputedAndStaleWarnings,
        allowPartial,
      });
      warnings.push(...memResult.warnings);

      for (const mem of memResult.items) {
        const sanitizedTitle = ContentSanitizer.sanitizeUntrustedText(
          mem.record.title,
          `memory:${mem.record.memoryKey}`,
        );
        const boundedRawContent =
          mem.record.content.length > 2000
            ? `${mem.record.content.slice(0, 2000)} [...truncated]`
            : mem.record.content;
        const sanitizedContent = ContentSanitizer.sanitizeUntrustedText(
          boundedRawContent,
          `memory:${mem.record.memoryKey}`,
        );
        const injDetected =
          sanitizedTitle.promptInjectionDetected || sanitizedContent.promptInjectionDetected;
        if (injDetected) {
          warnings.push({
            code: "PROMPT_INJECTION_SIGNAL",
            severity: "warning",
            message: `Prompt-injection-like pattern detected inside engineering memory '${mem.record.memoryKey}'; fenced as untrusted data.`,
            entity: mem.record.memoryKey,
          });
        }
        if (sanitizedTitle.redacted || sanitizedContent.redacted) {
          warnings.push({
            code: "INLINE_SECRET_REDACTED",
            severity: "warning",
            message: `Inline secret pattern redacted from engineering memory '${mem.record.memoryKey}'.`,
            entity: mem.record.memoryKey,
          });
        }

        const item: RankedMemoryItem = {
          id: `memory:${mem.record.memoryKey}`,
          domain: "memories",
          title: `${mem.record.memoryKey}: ${sanitizedTitle.inlineFencedText} [${mem.liveStatus}]`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: EvidenceUnifier.normalizeConfidenceTier(mem.record.confidenceTier),
          untrustedRepositoryContent: true,
          trustLevel: "fenced_untrusted_content",
          memoryId: mem.record.id,
          memoryKey: mem.record.memoryKey,
          category: mem.record.category,
          lifecycleStatus: mem.record.status,
          liveVerificationStatus: mem.liveStatus,
          supersededById: mem.record.supersededById,
          version: mem.record.version,
          content: sanitizedContent.fencedText,
          promptInjectionDetected: injDetected,
          evidence: mem.evidenceRefs,
        };
        candidates.push(item);
      }
    }

    // 4i. Safe Bounded Snippets (only if enabled by policy/override, SAFE files only)
    this.throwIfAborted(request.signal);
    if (plan.includeSnippets && plannedDomains.has("snippets")) {
      const snippetStepLimit = Math.max(1, this.getStepLimit(plan, "snippets", 8));
      const snippetTargets = new Map<string, { startLine?: number; endLine?: number }>();
      for (const loc of matchedSymbolLocations) {
        if (!snippetTargets.has(loc.filePath)) {
          snippetTargets.set(loc.filePath, {
            startLine: Math.max(1, loc.startLine - 2),
            endLine: loc.endLine + 4,
          });
        }
      }
      for (const targetFile of classification.extractedTargets.files) {
        if (!snippetTargets.has(targetFile)) {
          snippetTargets.set(targetFile, { startLine: 1 });
        }
      }
      for (const f of selectedFileCandidates.slice(0, 6)) {
        if (!snippetTargets.has(f.normalizedPath) && f.classification === "source") {
          snippetTargets.set(f.normalizedPath, { startLine: 1 });
        }
      }

      for (const [filePath, range] of Array.from(snippetTargets.entries()).slice(
        0,
        Math.max(snippetStepLimit, 8),
      )) {
        this.throwIfAborted(request.signal);
        const meta =
          fileMetaByPath.get(filePath) ?? this.getSingleFileMeta(repo.id, scanId, filePath);
        if (!meta) continue;

        const snip = ContentSanitizer.readSafeSnippet({
          workspaceRoot: repo.rootPath,
          filePath,
          sensitivityStatus: meta.sensitivityStatus,
          startLine: range.startLine,
          endLine: range.endLine,
          maxLines: plan.effectiveLimits.maxSnippetLines,
        });

        if (!snip.allowed) {
          if (snip.reason === "FILE_MISSING") {
            warnings.push({
              code: "DISK_FILE_MISSING",
              severity: "warning",
              message: `Indexed file '${filePath}' is missing from disk during snippet retrieval.`,
              entity: filePath,
            });
          } else if (snip.redacted || snip.reason?.includes("SENSITIVE")) {
            warnings.push({
              code: "SENSITIVE_FILE_REDACTED",
              severity: "warning",
              message: `Skipped snippet extraction for sensitive path '${filePath}' (${snip.reason}).`,
              entity: filePath,
            });
          }
          continue;
        }

        if (snip.redacted) {
          warnings.push({
            code: "INLINE_SECRET_REDACTED",
            severity: "warning",
            message: `Redacted ${snip.redactionCount} inline secret pattern(s) inside snippet '${filePath}'.`,
            entity: filePath,
          });
        }
        if (snip.promptInjectionDetected) {
          warnings.push({
            code: "PROMPT_INJECTION_SIGNAL",
            severity: "warning",
            message: `Prompt-injection-like pattern detected inside '${filePath}' (${snip.injectionLabels.join(", ")}); fenced as untrusted data.`,
            entity: filePath,
          });
        }

        const safePath = ContentSanitizer.sanitizeMetadataText(filePath).text;
        const snippetItem: SafeCodeSnippet = {
          id: `snippet:${filePath}:${snip.lineRange?.[0] ?? 1}-${snip.lineRange?.[1] ?? 1}`,
          domain: "snippets",
          title: `Snippet ${safePath}:${snip.lineRange?.[0] ?? 1}-${snip.lineRange?.[1] ?? 1}`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: "CONFIRMED",
          untrustedRepositoryContent: true,
          trustLevel: "fenced_untrusted_content",
          filePath,
          lineRange: snip.lineRange ?? [1, 1],
          content: snip.content ?? "",
          redacted: snip.redacted,
          redactionCount: snip.redactionCount,
          promptInjectionDetected: snip.promptInjectionDetected,
          evidence: [
            {
              sourceType: "source_snippet",
              filePath,
              lineRange: snip.lineRange ?? [1, 1],
              confidence: 1.0,
              confidenceTier: "CONFIRMED",
              verificationStatus: freshness.isStale ? "UNVERIFIED" : "STATIC_INDEX",
              description: `Bounded code excerpt (${snip.lineRange?.[0] ?? 1}-${snip.lineRange?.[1] ?? 1})`,
            },
          ],
        };
        candidates.push(snippetItem);
      }
    }

    // 4j. Optional Evolution Analysis (read-only: persistEvents: false, applyLifecycle: false)
    this.throwIfAborted(request.signal);
    let evolution: RetrievalEvolutionSummary | null = null;
    const reqBaseScan = boundedRequest.baseScanId ?? classification.extractedTargets.baseScanId;
    const reqTargetScan =
      boundedRequest.targetScanId ?? classification.extractedTargets.targetScanId;
    if ((reqBaseScan !== undefined) !== (reqTargetScan !== undefined)) {
      throw new Error(
        "Evolution retrieval requires both baseScanId and targetScanId when either is specified.",
      );
    }
    let resolvedPair: { baseScanId: number; targetScanId: number } | null = null;

    if (reqBaseScan !== undefined && reqTargetScan !== undefined) {
      resolvedPair = { baseScanId: reqBaseScan, targetScanId: reqTargetScan };
    } else if (
      plannedDomains.has("evolution") &&
      classification.primaryTaskType === "evolution_review"
    ) {
      resolvedPair = this.findLatestCompletedScanPair(repo.id, allowPartial);
    }

    if (resolvedPair) {
      try {
        const evo = new EvolutionAnalyzer(db).analyze(
          resolvedPair.baseScanId,
          resolvedPair.targetScanId,
          {
            persistEvents: false,
            applyLifecycle: false,
            allowPartial,
            maxRecordsPerDomain: 50,
            expectedRepositoryId: repo.id,
          },
        );

        const sanitizeEvoHighlight = (
          rawTitle: string,
          kindLabel: "drift" | "decision_correlation" | "debt" | "file_change",
        ): string => {
          const san = ContentSanitizer.sanitizeUntrustedText(rawTitle, `evolution:${kindLabel}`);
          if (san.redacted) {
            warnings.push({
              code: "INLINE_SECRET_REDACTED",
              severity: "warning",
              message: `Inline secret pattern redacted inside evolution ${kindLabel} highlight.`,
              entity: kindLabel,
            });
          }
          if (san.promptInjectionDetected) {
            warnings.push({
              code: "PROMPT_INJECTION_SIGNAL",
              severity: "warning",
              message: `Prompt-injection-like pattern detected inside evolution ${kindLabel} highlight; fenced strictly as untrusted data.`,
              entity: kindLabel,
            });
          }
          return san.inlineFencedText;
        };

        const highlights: RetrievalEvolutionSummary["highlights"] = [];
        for (const d of evo.drift.findings.slice(0, 5)) {
          highlights.push({
            kind: "drift",
            severity: d.severity,
            title: sanitizeEvoHighlight(d.title, "drift"),
            confidenceTier: d.confidenceTier,
            relevantPaths: d.relevantPaths.slice(0, 5),
            untrustedRepositoryContent: true,
          });
        }
        for (const c of evo.decisions.correlations.slice(0, 5)) {
          highlights.push({
            kind: "decision_correlation",
            severity: c.severity,
            title: sanitizeEvoHighlight(c.title, "decision_correlation"),
            confidenceTier: c.confidenceTier,
            relevantPaths: c.relevantPaths.slice(0, 5),
            untrustedRepositoryContent: true,
          });
        }
        for (const debt of evo.debt.items.slice(0, 5)) {
          highlights.push({
            kind: "debt",
            severity: debt.severity,
            title: sanitizeEvoHighlight(debt.title, "debt"),
            confidenceTier: debt.confidenceTier,
            relevantPaths: debt.relevantPaths.slice(0, 5),
            untrustedRepositoryContent: true,
          });
        }

        evolution = {
          baseScanId: resolvedPair.baseScanId,
          targetScanId: resolvedPair.targetScanId,
          status: evo.status,
          filesAdded: evo.comparison.files.addedCount,
          filesModified: evo.comparison.files.modifiedCount,
          filesDeleted: evo.comparison.files.deletedCount,
          driftFindingsCount: evo.drift.totalFindings,
          adrCorrelationsCount: evo.decisions.totalCorrelations,
          debtItemsCount: evo.debt.items.length,
          highlights,
        };
      } catch (err: any) {
        if (
          err instanceof SnapshotComparisonError &&
          reqBaseScan !== undefined &&
          reqTargetScan !== undefined
        ) {
          throw err;
        }
        warnings.push({
          code: "EVOLUTION_UNAVAILABLE",
          severity: "info",
          message: `Evolution comparison skipped: ${ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text}`,
        });
      }
    }

    // 5. Rank deterministically across all domains & enforce true serialized envelope budget
    this.throwIfAborted(request.signal);
    const ranked = RelevanceRanker.rank(candidates, {
      classification,
      policy: resolvedPolicy.policy,
      seedFiles,
    });

    const preliminaryWarnings = this.dedupeWarnings(warnings);
    const preliminaryLimitations = Array.from(new Set(limitations)).sort((a, b) =>
      a.localeCompare(b),
    );
    const envelopePlaceholder: RetrievalResponse = {
      contract: "frontier-engineer/retrieval",
      version: 1,
      retrievalId: "ret-0000000000000000",
      repository: {
        repositoryId: repo.id,
        repositoryIdentity: repo.identity,
        rootPath: repo.rootPath,
        displayName: repo.displayName,
        schemaVersion: repo.schemaVersion,
      },
      snapshot: {
        scanId,
        status: resolvedScan.status,
        freshness,
        ...(evolution
          ? { baseScanId: evolution.baseScanId, targetScanId: evolution.targetScanId }
          : {}),
      },
      agentId: boundedRequest.agentId,
      policyVersion: resolvedPolicy.policy.policyVersion,
      classification,
      plan,
      context: {
        overview,
        components: [],
        files: [],
        symbols: [],
        dependencies: [],
        tests: [],
        decisions: [],
        memories: [],
        evolution,
        snippets: [],
      },
      confidenceSummary: {
        confirmedCount: 0,
        inferredCount: 0,
        candidateCount: 0,
        unresolvedCount: 0,
        isMixedConfidence: false,
      },
      warnings: preliminaryWarnings,
      budget: {
        limitsConfigured: plan.effectiveLimits,
        usedChars: 100000,
        serializedChars: 100000,
        estimatedTokens: 25000,
        totalCandidatesFound: ranked.length,
        includedCount: 0,
        truncatedCount: 0,
        truncatedDomains: [],
        omittedItemIds: [],
        budgetOverflowed: false,
      },
      limitations: preliminaryLimitations,
    };

    const envelopeOverheadChars = JSON.stringify(envelopePlaceholder).length + 220;

    const allocation = ContextBudgeter.allocate(
      ranked,
      plan.effectiveLimits,
      resolvedPolicy.policy,
      envelopeOverheadChars,
    );

    const selected = [...allocation.selected];
    const omitted = [...allocation.omitted];

    const assembleResponse = (
      sel: AnyRankedItem[],
      omit: AnyRankedItem[],
      budgetOverride?: Partial<BudgetReport>,
    ): RetrievalResponse => {
      const domainBuckets = this.partitionSelectedItems(sel);
      const localWarnings = [...warnings];
      if (omit.length > 0) {
        const omitDomains = Array.from(new Set(omit.map((i) => i.domain))).sort((a, b) =>
          a.localeCompare(b),
        );
        localWarnings.push({
          code: "BUDGET_TRUNCATED",
          severity: "info",
          message: `Truncated ${omit.length} lower-priority item(s) across [${omitDomains.join(", ")}] to honor retrieval budget (${plan.effectiveLimits.maxItems} items / ${plan.effectiveLimits.maxTotalChars} chars / ${plan.effectiveLimits.maxTokens} tokens).`,
        });
      }
      const dedupedWarnings = this.dedupeWarnings(localWarnings);
      const confSummary = this.computeConfidenceSummary(sel);
      const retrievalId = this.computeDeterministicId({
        repositoryIdentity: repo.identity,
        scanId,
        agentId: boundedRequest.agentId,
        taskSummary: boundedRequest.taskSummary,
        taskType: classification.primaryTaskType,
        selectedIds: sel.map((s) => `${s.id}@${s.rankScore}`),
        freshnessStatus: freshness.status,
        baseScanId: evolution?.baseScanId,
        targetScanId: evolution?.targetScanId,
      });

      const truncatedDomains = Array.from(new Set(omit.map((i) => i.domain))).sort((a, b) =>
        a.localeCompare(b),
      );
      const initialUsed = allocation.budget.usedChars;
      const budget: BudgetReport = {
        limitsConfigured: plan.effectiveLimits,
        usedChars: budgetOverride?.usedChars ?? initialUsed,
        serializedChars: budgetOverride?.serializedChars ?? initialUsed,
        estimatedTokens:
          budgetOverride?.estimatedTokens ?? ContextBudgeter.estimateTokens(initialUsed),
        totalCandidatesFound: allocation.budget.totalCandidatesFound,
        includedCount: sel.length,
        truncatedCount: omit.length,
        truncatedDomains,
        omittedItemIds: omit.slice(0, 50).map((i) => i.id),
        budgetOverflowed: budgetOverride?.budgetOverflowed ?? allocation.budget.budgetOverflowed,
      };

      return {
        contract: "frontier-engineer/retrieval",
        version: 1,
        retrievalId,
        repository: envelopePlaceholder.repository,
        snapshot: envelopePlaceholder.snapshot,
        agentId: boundedRequest.agentId,
        policyVersion: resolvedPolicy.policy.policyVersion,
        classification,
        plan,
        context: {
          overview,
          ...domainBuckets,
          evolution,
        },
        confidenceSummary: confSummary,
        warnings: dedupedWarnings,
        budget,
        limitations: preliminaryLimitations,
      };
    };

    // Trim lowest-ranked selected items if full JSON serialization exceeds maxTotalChars/maxTokens
    let response = assembleResponse(selected, omitted, {
      usedChars: 100000,
      serializedChars: 100000,
      estimatedTokens: 25000,
      budgetOverflowed: false,
    });
    let actualSerializedChars = JSON.stringify(response).length;
    while (
      selected.length > 0 &&
      (actualSerializedChars > plan.effectiveLimits.maxTotalChars ||
        ContextBudgeter.estimateTokens(actualSerializedChars) > plan.effectiveLimits.maxTokens)
    ) {
      const removed = selected.pop()!;
      omitted.push(removed);
      response = assembleResponse(selected, omitted, {
        usedChars: 100000,
        serializedChars: 100000,
        estimatedTokens: 25000,
        budgetOverflowed: false,
      });
      actualSerializedChars = JSON.stringify(response).length;
    }

    const preliminaryTokens = ContextBudgeter.estimateTokens(actualSerializedChars);
    response = assembleResponse(selected, omitted, {
      usedChars: actualSerializedChars,
      serializedChars: actualSerializedChars,
      estimatedTokens: preliminaryTokens,
      budgetOverflowed:
        actualSerializedChars > plan.effectiveLimits.maxTotalChars ||
        preliminaryTokens > plan.effectiveLimits.maxTokens,
    });

    // Final convergence passes ensure budget.serializedChars equals compact JSON.stringify(response).length
    // while trimming if digit-width variance pushed the final payload slightly over budget.
    for (let pass = 0; pass < 3; pass += 1) {
      const exactChars = JSON.stringify(response).length;
      const exactTokens = ContextBudgeter.estimateTokens(exactChars);
      if (
        selected.length > 0 &&
        (exactChars > plan.effectiveLimits.maxTotalChars ||
          exactTokens > plan.effectiveLimits.maxTokens)
      ) {
        const removed = selected.pop()!;
        omitted.push(removed);
        response = assembleResponse(selected, omitted, {
          usedChars: exactChars,
          serializedChars: exactChars,
          estimatedTokens: exactTokens,
          budgetOverflowed: true,
        });
        continue;
      }
      const exactOverflowed =
        exactChars > plan.effectiveLimits.maxTotalChars ||
        exactTokens > plan.effectiveLimits.maxTokens;
      if (
        exactChars === response.budget.serializedChars &&
        exactOverflowed === response.budget.budgetOverflowed
      ) {
        break;
      }
      response.budget.usedChars = exactChars;
      response.budget.serializedChars = exactChars;
      response.budget.estimatedTokens = exactTokens;
      response.budget.budgetOverflowed = exactOverflowed;
    }

    const validation = validateRetrievalResponse(response);
    if (!validation.valid) {
      throw new Error(`ERR_RETRIEVAL_RESPONSE_INVALID: ${validation.errors.join("; ")}`);
    }

    return response;
  }

  private static resolveHighlightVerificationStatus(
    item: AnyRankedItem,
    snapshotStatus: string,
  ): HandoffEvidenceVerificationStatus | undefined {
    if (item.domain === "memories") {
      switch (item.liveVerificationStatus) {
        case "VERIFIED":
          return "VERIFIED";
        case "DISPUTED":
          return "DISPUTED";
        case "STALE":
          return "STALE";
        case "MISSING":
          return "MISSING";
        default:
          return "UNVERIFIED";
      }
    }
    if (item.domain === "decisions") {
      switch (item.verificationStatus) {
        case "CONFIRMED":
          return "VERIFIED";
        case "SNAPSHOT_METADATA":
          return snapshotStatus === "PARTIAL" ? "UNVERIFIED" : "VERIFIED";
        case "DISK_HASH_MISMATCH":
          return "CONTRADICTED";
        case "DISK_FILE_MISSING":
          return "MISSING";
        default:
          return "UNVERIFIED";
      }
    }
    if (item.domain === "snippets") {
      const evStatus = item.evidence[0]?.verificationStatus;
      return evStatus === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
    }
    const evStatus = item.evidence[0]?.verificationStatus;
    if (evStatus === "VERIFIED") return "VERIFIED";
    if (evStatus === "CONTRADICTED") return "CONTRADICTED";
    if (evStatus === "MISSING") return "MISSING";
    if (evStatus === "UNVERIFIED") return "UNVERIFIED";
    if (snapshotStatus === "PARTIAL" || item.confidenceTier === "UNRESOLVED") {
      return "UNVERIFIED";
    }
    if (evStatus === "STATIC_INDEX") {
      return "VERIFIED";
    }
    return undefined;
  }

  public static buildHandoffAttachment(response: RetrievalResponse): HandoffRetrievalContext {
    const allSelected: AnyRankedItem[] = [
      ...response.context.components,
      ...response.context.files,
      ...response.context.symbols,
      ...response.context.dependencies,
      ...response.context.tests,
      ...response.context.decisions,
      ...response.context.memories,
      ...response.context.snippets,
    ].sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id));

    const attachmentWarnings: RetrievalWarning[] = [];
    const highlights: HandoffContextHighlight[] = [];

    for (const item of allSelected) {
      if (highlights.length >= 12) break;

      const cleanId = ContentSanitizer.sanitizeMetadataText(item.id).text.trim();
      if (!cleanId || cleanId.length > 512) {
        attachmentWarnings.push({
          code: "BUDGET_TRUNCATED",
          severity: "warning",
          message: `[HIGHLIGHT_ID_OMITTED] Omitted highlight in domain '${item.domain}' because its identifier is empty or exceeds 512 chars.`,
        });
        continue;
      }

      const rawSummary = item.untrustedRepositoryContent
        ? item.title
        : ContentSanitizer.sanitizeMetadataText(item.title).text;
      const candidateSummary =
        rawSummary.trim().length > 0 ? rawSummary : `${item.domain}:${cleanId}`;
      const boundedSummary = ContentSanitizer.boundFencedText(candidateSummary, 2000);
      if (boundedSummary.truncated) {
        attachmentWarnings.push({
          code: "BUDGET_TRUNCATED",
          severity: "info",
          message: `[HIGHLIGHT_SUMMARY_TRUNCATED] Truncated highlight summary for '${cleanId}' to 2000 chars.`,
        });
      }

      let evidenceFile: string | undefined;
      const rawEvFile = item.evidence[0]?.filePath;
      if (typeof rawEvFile === "string" && rawEvFile.length > 0) {
        const cleanEvFile = ContentSanitizer.sanitizeMetadataText(rawEvFile).text.trim();
        if (cleanEvFile.length > 0 && cleanEvFile.length <= 512) {
          evidenceFile = cleanEvFile;
        } else {
          attachmentWarnings.push({
            code: "BUDGET_TRUNCATED",
            severity: "warning",
            message: `[EVIDENCE_PATH_OMITTED] Omitted evidenceFile for '${cleanId}' because path is empty or exceeds 512 chars.`,
          });
        }
      }

      let symbolIdentity: string | undefined;
      const rawSymbolId =
        item.domain === "symbols" ? item.symbolIdentity : item.evidence[0]?.symbolIdentity;
      if (typeof rawSymbolId === "string" && rawSymbolId.length > 0) {
        const cleanSymId = ContentSanitizer.sanitizeMetadataText(rawSymbolId).text.trim();
        if (cleanSymId.length > 0 && cleanSymId.length <= 512) {
          symbolIdentity = cleanSymId;
        } else {
          attachmentWarnings.push({
            code: "BUDGET_TRUNCATED",
            severity: "warning",
            message: `[SYMBOL_ID_OMITTED] Omitted symbolIdentity for '${cleanId}' because identifier is empty or exceeds 512 chars.`,
          });
        }
      }

      let lineRange: [number, number] | undefined;
      const rawRange =
        item.domain === "snippets"
          ? item.lineRange
          : item.domain === "symbols" && item.startLine >= 1 && item.endLine >= item.startLine
            ? ([item.startLine, item.endLine] as [number, number])
            : item.evidence[0]?.lineRange;
      if (
        Array.isArray(rawRange) &&
        rawRange.length === 2 &&
        Number.isInteger(rawRange[0]) &&
        Number.isInteger(rawRange[1]) &&
        rawRange[0] >= 1 &&
        rawRange[1] >= rawRange[0]
      ) {
        lineRange = [rawRange[0], rawRange[1]];
      }

      const evidenceVerificationStatus = this.resolveHighlightVerificationStatus(
        item,
        String(response.snapshot.status),
      );
      const effectiveConfidence: ConfidenceTier =
        (evidenceVerificationStatus === "CONTRADICTED" ||
          evidenceVerificationStatus === "MISSING") &&
        item.confidenceTier === "CONFIRMED"
          ? "UNRESOLVED"
          : item.confidenceTier;

      const highlightLimitations: string[] = [];
      if (String(response.snapshot.status) === "PARTIAL") {
        highlightLimitations.push("Derived from a PARTIAL snapshot; coverage may be incomplete.");
      }
      if (evidenceVerificationStatus && evidenceVerificationStatus !== "VERIFIED") {
        highlightLimitations.push(`Evidence verification status is ${evidenceVerificationStatus}.`);
      }

      highlights.push({
        domain: item.domain,
        idOrPath: cleanId,
        summary: boundedSummary.text,
        confidenceTier: effectiveConfidence,
        ...(evidenceFile ? { evidenceFile } : {}),
        untrustedRepositoryContent: item.untrustedRepositoryContent,
        ...(evidenceVerificationStatus ? { evidenceVerificationStatus } : {}),
        ...(lineRange ? { lineRange } : {}),
        ...(symbolIdentity ? { symbolIdentity } : {}),
        confidence: effectiveConfidence,
        ...(highlightLimitations.length > 0
          ? {
              limitations: highlightLimitations
                .slice(0, 16)
                .map((l) => ContentSanitizer.truncateUnicodeSafe(l, 512).text),
            }
          : {}),
      });
    }

    // Preserve all critical security/integrity/freshness/disputed warnings; never drop them behind info notices
    const combinedWarnings = [...response.warnings, ...attachmentWarnings];
    const critical: RetrievalWarning[] = [];
    const nonCritical: RetrievalWarning[] = [];
    for (const w of combinedWarnings) {
      if (this.getWarningPriority(w) <= 2 || w.severity === "error") {
        critical.push(w);
      } else {
        nonCritical.push(w);
      }
    }

    const chosenWarnings: RetrievalWarning[] = [...critical.slice(0, 31)];
    const remainingSlots = Math.max(0, 10 - chosenWarnings.length);
    chosenWarnings.push(...nonCritical.slice(0, remainingSlots));

    const omittedCount = combinedWarnings.length - chosenWarnings.length;
    const formattedWarnings = chosenWarnings.map(
      (w) =>
        ContentSanitizer.truncateUnicodeSafe(
          `[${w.code}] ${ContentSanitizer.sanitizeMetadataText(w.message).text}`,
          1024,
        ).text,
    );
    if (omittedCount > 0 && formattedWarnings.length < 32) {
      formattedWarnings.push(
        ContentSanitizer.truncateUnicodeSafe(
          `[WARNINGS_OVERFLOW] ${omittedCount} additional warning(s) omitted from compact handoff; inspect full RetrievalResponse.`,
          1024,
        ).text,
      );
    }

    const boundedLimitations = response.limitations
      .slice(0, 32)
      .map(
        (l) =>
          ContentSanitizer.truncateUnicodeSafe(ContentSanitizer.sanitizeMetadataText(l).text, 512)
            .text,
      )
      .filter((l) => l.length > 0);

    return {
      contract: "frontier-engineer/retrieval-attachment",
      version: 1,
      retrievalId: response.retrievalId,
      repositoryIdentity: response.repository.repositoryIdentity,
      scanId: response.snapshot.scanId,
      snapshotStatus: String(response.snapshot.status),
      freshnessStatus: response.snapshot.freshness.status,
      isStale: response.snapshot.freshness.isStale,
      taskType: response.classification.primaryTaskType,
      confidenceSummary: response.confidenceSummary,
      highlights,
      warnings: formattedWarnings.slice(0, 32),
      ...(boundedLimitations.length > 0 ? { limitations: boundedLimitations } : {}),
      budget: {
        includedCount: response.budget.includedCount,
        truncatedCount: response.budget.truncatedCount,
        estimatedTokens: response.budget.estimatedTokens,
      },
    };
  }

  private static getWarningPriority(w: RetrievalWarning): number {
    if (w.severity === "error") return 0;
    const code: RetrievalWarningCode = w.code;
    if (
      code === "SENSITIVE_FILE_REDACTED" ||
      code === "INLINE_SECRET_REDACTED" ||
      code === "PROMPT_INJECTION_SIGNAL" ||
      code === "UNSAFE_TARGET_IGNORED" ||
      code === "REPOSITORY_IDENTITY_MISMATCH"
    ) {
      return 1;
    }
    if (
      code === "MEMORY_DISPUTED" ||
      code === "PARTIAL_SNAPSHOT" ||
      code === "INDEX_STALE" ||
      code === "ADR_SNAPSHOT_UNVERIFIED"
    ) {
      return 2;
    }
    if (
      code === "MEMORY_STALE" ||
      code === "MEMORY_EVIDENCE_UNVERIFIED" ||
      code === "SNAPSHOT_VALIDATING" ||
      code === "PARTIAL_DOMAIN_ERROR" ||
      code === "DISK_FILE_MISSING" ||
      code === "INVALID_WORKSPACE_CONFIG"
    ) {
      return 3;
    }
    if (w.severity === "warning") return 4;
    return 5;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new Error("Retrieval cancelled via AbortSignal.");
      err.name = "AbortError";
      throw err;
    }
  }

  private getStepLimit(plan: RetrievalPlan, domain: RetrievalDomain, fallback: number): number {
    const step = plan.steps.find((s) => s.domain === domain);
    return step ? step.maxItems : fallback;
  }

  private partitionSelectedItems(selected: AnyRankedItem[]): {
    components: RankedComponentItem[];
    files: RankedFileItem[];
    symbols: RankedSymbolItem[];
    dependencies: RankedDependencyItem[];
    tests: RankedTestAssociationItem[];
    decisions: RankedAdrItem[];
    memories: RankedMemoryItem[];
    snippets: SafeCodeSnippet[];
  } {
    const components: RankedComponentItem[] = [];
    const files: RankedFileItem[] = [];
    const symbols: RankedSymbolItem[] = [];
    const dependencies: RankedDependencyItem[] = [];
    const tests: RankedTestAssociationItem[] = [];
    const decisions: RankedAdrItem[] = [];
    const memories: RankedMemoryItem[] = [];
    const snippets: SafeCodeSnippet[] = [];

    for (const item of selected) {
      switch (item.domain) {
        case "components":
          components.push(item);
          break;
        case "files":
          files.push(item);
          break;
        case "symbols":
          symbols.push(item);
          break;
        case "dependencies":
          dependencies.push(item);
          break;
        case "tests":
          tests.push(item);
          break;
        case "decisions":
          decisions.push(item);
          break;
        case "memories":
          memories.push(item);
          break;
        case "snippets":
          snippets.push(item);
          break;
      }
    }

    return { components, files, symbols, dependencies, tests, decisions, memories, snippets };
  }

  private resolveTargetScan(
    repositoryId: number,
    activeScanId: number | null,
    explicitScanId?: number,
    allowPartialSnapshot = false,
  ): ScanRecord {
    const db = this.connectionManager.getDatabase();
    const scanId = explicitScanId ?? activeScanId;

    if (!scanId) {
      throw new Error(
        `Repository index is unavailable: no active scan exists for repository ${repositoryId}. Run repository scan to generate an index.`,
      );
    }

    const row = db
      .prepare(
        `SELECT
          id, repository_id AS repositoryId, started_at AS startedAt,
          completed_at AS completedAt, status, files_discovered AS filesDiscovered,
          files_indexed AS filesIndexed, files_skipped AS filesSkipped,
          files_failed AS filesFailed, diagnostic_count AS diagnosticCount,
          scanner_version AS scannerVersion, extractor_version AS extractorVersion,
          is_active AS isActive, failure_reason AS failureReason
        FROM scan_runs WHERE id = ?`,
      )
      .get(scanId) as ScanRecord | undefined;

    if (!row) {
      throw new SnapshotComparisonError(
        `Scan ${scanId} was not found in repository index.`,
        "ERR_SCAN_NOT_FOUND",
      );
    }

    if (row.repositoryId !== repositoryId) {
      throw new SnapshotComparisonError(
        `Scan ${scanId} belongs to repository ${row.repositoryId}, expected active repository ${repositoryId}.`,
        "ERR_REPOSITORY_MISMATCH",
      );
    }

    if (
      row.status === "FAILED" ||
      row.status === "CANCELLED" ||
      row.status === "RUNNING" ||
      row.status === "VALIDATING"
    ) {
      throw new Error(
        `Repository index snapshot ${scanId} has status '${row.status}' and is unavailable for retrieval.`,
      );
    }

    if (row.status === "PARTIAL" && allowPartialSnapshot === false) {
      throw new Error(
        `ERR_PARTIAL_SCAN_NOT_ALLOWED: Repository index snapshot ${scanId} has status 'PARTIAL' and allowPartialSnapshot is false.`,
      );
    }

    if (row.status !== "COMPLETE" && row.status !== "PARTIAL") {
      throw new Error(
        `ERR_SCAN_INVALID_STATUS: Repository index snapshot ${scanId} has unsupported status '${row.status}'.`,
      );
    }

    return row;
  }

  private getSingleFileMeta(repositoryId: number, scanId: number, normalizedPath: string) {
    const db = this.connectionManager.getDatabase();
    return db
      .prepare(
        `SELECT
          id, normalized_path AS normalizedPath, language, classification,
          sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
         FROM files WHERE repository_id = ? AND scan_id = ? AND normalized_path = ?`,
      )
      .get(repositoryId, scanId, normalizedPath) as
      | {
          id: number;
          normalizedPath: string;
          language: string;
          classification: string;
          sensitivityStatus: string;
          sizeBytes: number;
        }
      | undefined;
  }

  private getBatchFileCounts(
    repositoryId: number,
    scanId: number,
    fileIds: number[],
  ): Map<number, { exportsCount: number; importsCount: number }> {
    const result = new Map<number, { exportsCount: number; importsCount: number }>();
    if (fileIds.length === 0) return result;

    const db = this.connectionManager.getDatabase();
    const chunkSize = 400;
    for (let offset = 0; offset < fileIds.length; offset += chunkSize) {
      const chunk = fileIds.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");

      const expRows = db
        .prepare(
          `SELECT file_id AS fileId, COUNT(*) AS count
           FROM exports
           WHERE repository_id = ? AND scan_id = ? AND file_id IN (${placeholders})
           GROUP BY file_id`,
        )
        .all(repositoryId, scanId, ...chunk) as Array<{ fileId: number; count: number }>;

      const impRows = db
        .prepare(
          `SELECT source_file_id AS fileId, COUNT(*) AS count
           FROM imports
           WHERE repository_id = ? AND scan_id = ? AND source_file_id IN (${placeholders})
           GROUP BY source_file_id`,
        )
        .all(repositoryId, scanId, ...chunk) as Array<{ fileId: number; count: number }>;

      for (const id of chunk) {
        result.set(id, { exportsCount: 0, importsCount: 0 });
      }
      for (const r of expRows) {
        const entry = result.get(r.fileId);
        if (entry) entry.exportsCount = r.count;
      }
      for (const r of impRows) {
        const entry = result.get(r.fileId);
        if (entry) entry.importsCount = r.count;
      }
    }

    return result;
  }

  private selectCandidateFiles(
    repositoryId: number,
    scanId: number,
    explicitFiles: string[],
    keywords: string[],
    seedFiles: string[],
    maxCandidates: number,
  ) {
    const db = this.connectionManager.getDatabase();
    const byPath = new Map<
      string,
      {
        id: number;
        normalizedPath: string;
        language: string;
        classification: string;
        sensitivityStatus: string;
        sizeBytes: number;
      }
    >();

    const allSeeds = Array.from(new Set([...explicitFiles, ...seedFiles]));
    if (allSeeds.length > 0) {
      const placeholders = allSeeds.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT id, normalized_path AS normalizedPath, language, classification,
                  sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
           FROM files
           WHERE repository_id = ? AND scan_id = ? AND normalized_path IN (${placeholders})
           ORDER BY normalized_path ASC`,
        )
        .all(repositoryId, scanId, ...allSeeds) as any[];
      for (const r of rows) byPath.set(r.normalizedPath, r);
    }

    for (const kw of keywords.slice(0, 6)) {
      if (byPath.size >= maxCandidates) break;
      const rows = db
        .prepare(
          `SELECT id, normalized_path AS normalizedPath, language, classification,
                  sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
           FROM files
           WHERE repository_id = ? AND scan_id = ? AND LOWER(normalized_path) LIKE ?
           ORDER BY normalized_path ASC
           LIMIT ?`,
        )
        .all(repositoryId, scanId, `%${kw.toLowerCase()}%`, 15) as any[];
      for (const r of rows) {
        if (!byPath.has(r.normalizedPath)) {
          byPath.set(r.normalizedPath, r);
        }
      }
    }

    if (byPath.size < Math.min(12, maxCandidates)) {
      const topRows = db
        .prepare(
          `SELECT id, normalized_path AS normalizedPath, language, classification,
                  sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
           FROM files
           WHERE repository_id = ? AND scan_id = ? AND classification IN ('source', 'configuration', 'documentation')
           ORDER BY normalized_path ASC
           LIMIT ?`,
        )
        .all(repositoryId, scanId, maxCandidates) as any[];
      for (const r of topRows) {
        if (byPath.size >= maxCandidates) break;
        if (!byPath.has(r.normalizedPath)) {
          byPath.set(r.normalizedPath, r);
        }
      }
    }

    return Array.from(byPath.values());
  }

  private selectCandidateSymbols(
    repositoryId: number,
    scanId: number,
    explicitSymbols: string[],
    targetFiles: string[],
    keywords: string[],
    maxCandidates: number,
  ) {
    const db = this.connectionManager.getDatabase();
    const byIdentity = new Map<
      string,
      {
        symbolIdentity: string;
        name: string;
        kind: string;
        isExported: number;
        startLine: number;
        endLine: number;
        confidence: number;
        filePath: string;
      }
    >();

    for (const sym of explicitSymbols.slice(0, 10)) {
      const clean = sym.trim();
      const rows = db
        .prepare(
          `SELECT s.symbol_identity AS symbolIdentity, s.name, s.kind, s.is_exported AS isExported,
                  s.start_line AS startLine, s.end_line AS endLine, s.confidence,
                  f.normalized_path AS filePath
           FROM symbols s
           JOIN files f ON f.id = s.file_id
           WHERE s.repository_id = ? AND f.repository_id = ? AND s.scan_id = ? AND f.sensitivity_status = 'SAFE'
             AND (s.name = ? OR s.symbol_identity = ? OR LOWER(s.name) LIKE ?)
           ORDER BY s.is_exported DESC, s.symbol_identity ASC
           LIMIT 15`,
        )
        .all(repositoryId, repositoryId, scanId, clean, clean, `%${clean.toLowerCase()}%`) as any[];
      for (const r of rows) byIdentity.set(r.symbolIdentity, r);
    }

    if (targetFiles.length > 0 && byIdentity.size < maxCandidates) {
      const placeholders = targetFiles.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT s.symbol_identity AS symbolIdentity, s.name, s.kind, s.is_exported AS isExported,
                  s.start_line AS startLine, s.end_line AS endLine, s.confidence,
                  f.normalized_path AS filePath
           FROM symbols s
           JOIN files f ON f.id = s.file_id
           WHERE s.repository_id = ? AND f.repository_id = ? AND s.scan_id = ? AND f.sensitivity_status = 'SAFE'
             AND f.normalized_path IN (${placeholders})
           ORDER BY s.is_exported DESC, s.start_line ASC
           LIMIT ?`,
        )
        .all(repositoryId, repositoryId, scanId, ...targetFiles, maxCandidates) as any[];
      for (const r of rows) {
        if (!byIdentity.has(r.symbolIdentity)) byIdentity.set(r.symbolIdentity, r);
      }
    }

    if (byIdentity.size < maxCandidates) {
      for (const kw of keywords.slice(0, 4)) {
        if (byIdentity.size >= maxCandidates) break;
        const rows = db
          .prepare(
            `SELECT s.symbol_identity AS symbolIdentity, s.name, s.kind, s.is_exported AS isExported,
                    s.start_line AS startLine, s.end_line AS endLine, s.confidence,
                    f.normalized_path AS filePath
             FROM symbols s
             JOIN files f ON f.id = s.file_id
             WHERE s.repository_id = ? AND f.repository_id = ? AND s.scan_id = ? AND f.sensitivity_status = 'SAFE'
               AND s.is_exported = 1 AND LOWER(s.name) LIKE ?
             ORDER BY s.symbol_identity ASC
             LIMIT 10`,
          )
          .all(repositoryId, repositoryId, scanId, `%${kw.toLowerCase()}%`) as any[];
        for (const r of rows) {
          if (!byIdentity.has(r.symbolIdentity)) byIdentity.set(r.symbolIdentity, r);
        }
      }
    }

    return Array.from(byIdentity.values()).slice(0, maxCandidates);
  }

  private findLatestCompletedScanPair(
    repositoryId: number,
    allowPartial = false,
  ): { baseScanId: number; targetScanId: number } | null {
    const db = this.connectionManager.getDatabase();
    const statusClause = allowPartial ? "status IN ('COMPLETE', 'PARTIAL')" : "status = 'COMPLETE'";
    const rows = db
      .prepare(
        `SELECT id FROM scan_runs
         WHERE repository_id = ? AND ${statusClause}
         ORDER BY id DESC LIMIT 2`,
      )
      .all(repositoryId) as { id: number }[];
    if (rows.length < 2) return null;
    return { baseScanId: rows[1].id, targetScanId: rows[0].id };
  }

  private computeConfidenceSummary(items: AnyRankedItem[]): ConfidenceSummary {
    let confirmedCount = 0;
    let inferredCount = 0;
    let candidateCount = 0;
    let unresolvedCount = 0;

    for (const item of items) {
      switch (item.confidenceTier) {
        case "CONFIRMED":
          confirmedCount++;
          break;
        case "INFERRED":
          inferredCount++;
          break;
        case "CANDIDATE":
          candidateCount++;
          break;
        case "UNRESOLVED":
          unresolvedCount++;
          break;
      }
    }

    const nonZeroTiers = [confirmedCount, inferredCount, candidateCount, unresolvedCount].filter(
      (n) => n > 0,
    ).length;

    return {
      confirmedCount,
      inferredCount,
      candidateCount,
      unresolvedCount,
      isMixedConfidence: nonZeroTiers > 1,
    };
  }

  private dedupeWarnings(warnings: RetrievalWarning[]): RetrievalWarning[] {
    const seen = new Set<string>();
    const result: RetrievalWarning[] = [];
    for (const w of warnings) {
      const sanitizedMsg = ContentSanitizer.sanitizeMetadataText(w.message).text;
      const sanitizedEntity = w.entity
        ? ContentSanitizer.sanitizeMetadataText(w.entity).text
        : undefined;
      const key = `${w.code}:${sanitizedEntity ?? ""}:${sanitizedMsg}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          ...w,
          message: sanitizedMsg,
          ...(sanitizedEntity !== undefined ? { entity: sanitizedEntity } : {}),
        });
      }
    }
    result.sort((a, b) => {
      const prioDiff =
        RetrievalEngine.getWarningPriority(a) - RetrievalEngine.getWarningPriority(b);
      if (prioDiff !== 0) return prioDiff;
      return a.code.localeCompare(b.code) || a.message.localeCompare(b.message);
    });
    const MAX_RESPONSE_WARNINGS = 32;
    if (result.length <= MAX_RESPONSE_WARNINGS) {
      return result;
    }
    const omittedCount = result.length - (MAX_RESPONSE_WARNINGS - 1);
    return [
      ...result.slice(0, MAX_RESPONSE_WARNINGS - 1),
      {
        code: "WARNINGS_OVERFLOW",
        severity: "info",
        message: `${omittedCount} additional lower-priority warning(s) omitted to honor bounded retrieval envelope.`,
      },
    ];
  }

  private computeDeterministicId(seed: Record<string, unknown>): string {
    const payload = JSON.stringify(seed);
    return `ret-${createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)}`;
  }
}
