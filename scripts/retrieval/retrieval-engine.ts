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
import type {
  AnyRankedItem,
  ConfidenceSummary,
  HandoffContextHighlight,
  HandoffRetrievalContext,
  RankedAdrItem,
  RankedComponentItem,
  RankedDependencyItem,
  RankedFileItem,
  RankedMemoryItem,
  RankedSymbolItem,
  RankedTestAssociationItem,
  RetrievalEvolutionSummary,
  RetrievalOverviewSummary,
  RetrievalRequest,
  RetrievalResponse,
  RetrievalWarning,
  SafeCodeSnippet,
} from "./types.ts";
import type { ConfidenceTier } from "../query/types.ts";
import type { ScanRecord } from "../storage/types.ts";

export class RetrievalEngine {
  private readonly connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  public async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    if (
      !request.taskSummary ||
      typeof request.taskSummary !== "string" ||
      !request.taskSummary.trim()
    ) {
      throw new Error("Retrieval taskSummary cannot be empty.");
    }

    const db = this.connectionManager.getDatabase();
    const repo = this.connectionManager.getRepository();
    const boundedRequest: RetrievalRequest = {
      ...request,
      taskSummary: request.taskSummary.slice(0, 8192),
      objective: request.objective ? request.objective.slice(0, 4096) : undefined,
    };

    const resolvedScan = this.resolveTargetScan(repo.id, repo.activeScanId, boundedRequest.scanId);
    const freshness = FreshnessEvaluator.evaluate(db, repo.id, repo.rootPath, {
      explicitScanId: resolvedScan.id,
      verifyContentHashes: boundedRequest.verifyContentHashes ?? false,
    });

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

    // 1. Classify task & extract targets deterministically
    const classification = TaskClassifier.classify(boundedRequest);
    for (const unsafePath of classification.extractedTargets.ignoredUnsafeTargets) {
      warnings.push({
        code: "UNSAFE_TARGET_IGNORED",
        severity: "warning",
        message: `Ignored unsafe or outside-workspace target path '${unsafePath}'.`,
        entity: unsafePath,
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
    let overview: RetrievalOverviewSummary | null = null;
    if (plannedDomains.has("overview")) {
      try {
        const ovRes = await queryEngine.getOverview({ scanId });
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
      } catch {
        // Overview omitted if unavailable
      }
    }

    // 4b. Components
    const archComponents = await archAnalyzer.getComponents(repo.id, scanId);
    const compNameByFile = new Map<string, string>();
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
      if (plannedDomains.has("components")) {
        const item: RankedComponentItem = {
          id: comp.componentIdentity,
          domain: "components",
          title: `${comp.name} (${comp.category})`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: comp.status,
          untrustedRepositoryContent: false,
          componentIdentity: comp.componentIdentity,
          name: comp.name,
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
              description: comp.evidenceDescription,
            },
          ],
        };
        candidates.push(item);
      }
    }

    // 4c. Files (targeted + keyword SQL lookup; avoids N+1 over large repositories)
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
      scanId,
      classification.extractedTargets.files,
      classification.extractedTargets.keywords,
      Array.from(seedFiles),
      Math.max(plan.effectiveLimits.maxItems, 25),
    );

    const indexedPathsFound = new Set<string>();
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

      if (plannedDomains.has("files")) {
        const counts = this.getFileCounts(scanId, fRow.id);
        const item: RankedFileItem = {
          id: `file:${fRow.normalizedPath}`,
          domain: "files",
          title: fRow.normalizedPath,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: "CONFIRMED",
          untrustedRepositoryContent: false,
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
    const matchedSymbolLocations: Array<{ filePath: string; startLine: number; endLine: number }> =
      [];
    if (plannedDomains.has("symbols") || plan.includeSnippets) {
      const symbolRows = this.selectCandidateSymbols(
        scanId,
        classification.extractedTargets.symbols,
        classification.extractedTargets.files,
        classification.extractedTargets.keywords,
        35,
      );
      for (const sym of symbolRows) {
        seedFiles.add(sym.filePath);
        matchedSymbolLocations.push({
          filePath: sym.filePath,
          startLine: sym.startLine,
          endLine: sym.endLine,
        });
        if (plannedDomains.has("symbols")) {
          const item: RankedSymbolItem = {
            id: `symbol:${sym.symbolIdentity}`,
            domain: "symbols",
            title: `${sym.name} (${sym.kind}) in ${sym.filePath}:${sym.startLine}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: sym.confidence >= 0.9 ? "CONFIRMED" : "INFERRED",
            untrustedRepositoryContent: false,
            symbolIdentity: sym.symbolIdentity,
            name: sym.name,
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
                description: `Declaration of ${sym.kind} '${sym.name}' (lines ${sym.startLine}-${sym.endLine})`,
              },
            ],
          };
          candidates.push(item);
        }
      }
    }

    // 4e. Dependencies & Dependents (cycle-safe bounded GraphTraversal via QueryEngine)
    if (plannedDomains.has("dependencies")) {
      const traversalSeeds = Array.from(seedFiles).slice(0, 4);
      if (traversalSeeds.length === 0 && archComponents.length > 0) {
        traversalSeeds.push(archComponents[0].componentIdentity);
      }

      const seenDepKeys = new Set<string>();
      for (const seed of traversalSeeds) {
        for (const dir of ["dependencies", "dependents"] as const) {
          try {
            const res =
              dir === "dependencies"
                ? await queryEngine.getDependencies(seed, {
                    scanId,
                    depth: plan.effectiveLimits.maxDepth,
                    limit: 12,
                  })
                : await queryEngine.getDependents(seed, {
                    scanId,
                    depth: plan.effectiveLimits.maxDepth,
                    limit: 12,
                  });

            const nodes = [...res.data.direct, ...res.data.transitive].slice(0, 12);
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
          } catch {
            // Seed target might have no graph node (e.g. non-source asset or unindexed target)
          }
        }
      }

      // Include structural cycles when relevant
      try {
        const cycleRes = await queryEngine.getCycles({ scanId, limit: 5 });
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
      } catch {
        // Ignore if cycle analyzer finds nothing or throws
      }
    }

    // 4f. Tests
    if (plannedDomains.has("tests")) {
      try {
        const testRes = await queryEngine.getTests(undefined, { scanId, limit: 40 });
        for (const assoc of testRes.data.associations) {
          const item: RankedTestAssociationItem = {
            id: `test:${assoc.testFilePath}=>${assoc.sourceFilePath}`,
            domain: "tests",
            title: `${assoc.testFilePath} tests ${assoc.sourceFilePath}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: assoc.associationStatus,
            untrustedRepositoryContent: false,
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
                description: assoc.evidenceDescription,
              },
            ],
          };
          candidates.push(item);
        }
      } catch {
        // Ignore if tests unavailable
      }
    }

    // 4g. Decisions (ADRs)
    if (plannedDomains.has("decisions")) {
      try {
        const adrRes = await queryEngine.getDecisions({ scanId, limit: 30 });
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
              message: `Prompt-injection-like text detected inside ADR '${adr.filePath}'; preserved strictly as untrusted data.`,
              entity: adr.adrId,
            });
          }

          const adrConfidenceTier = adr.confidence >= 0.9 ? "CONFIRMED" : "INFERRED";
          const item: RankedAdrItem = {
            id: `adr:${adr.adrId}`,
            domain: "decisions",
            title: `${adr.adrId}: ${sanitizedTitle.text}`,
            rankScore: 0,
            rankingReasons: [],
            confidenceTier: adrConfidenceTier,
            untrustedRepositoryContent: true,
            adrId: adr.adrId,
            adrNumber: adr.number,
            adrStatus: adr.status,
            filePath: adr.filePath,
            governedComponents: adr.governedComponents,
            summaryText: sanitizedSummary.text,
            evidence: [
              {
                sourceType: "adr_document",
                filePath: adr.filePath,
                confidence: adr.confidence,
                confidenceTier: adrConfidenceTier,
                verificationStatus: "STATIC_INDEX",
                description: sanitizedSummary.text,
              },
            ],
          };
          candidates.push(item);
        }
      } catch {
        // Ignore if ADRs unavailable
      }
    }

    // 4h. Engineering Memories (read-only verification)
    if (plannedDomains.has("memories")) {
      const memResult = EvidenceUnifier.loadAndVerifyMemories({
        db,
        repositoryId: repo.id,
        scanId,
        workspaceRoot: repo.rootPath,
        includeHistorical: plan.includeHistoricalMemories,
        surfaceWarnings: resolvedPolicy.policy.surfaceDisputedAndStaleWarnings,
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
          title: `${mem.record.memoryKey}: ${sanitizedTitle.text} [${mem.liveStatus}]`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: EvidenceUnifier.normalizeConfidenceTier(mem.record.confidenceTier),
          untrustedRepositoryContent: true,
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
    if (plan.includeSnippets && plannedDomains.has("snippets")) {
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

      for (const [filePath, range] of Array.from(snippetTargets.entries()).slice(0, 8)) {
        const meta = fileMetaByPath.get(filePath) ?? this.getSingleFileMeta(scanId, filePath);
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

        const snippetItem: SafeCodeSnippet = {
          id: `snippet:${filePath}:${snip.lineRange?.[0] ?? 1}-${snip.lineRange?.[1] ?? 1}`,
          domain: "snippets",
          title: `Snippet ${filePath}:${snip.lineRange?.[0] ?? 1}-${snip.lineRange?.[1] ?? 1}`,
          rankScore: 0,
          rankingReasons: [],
          confidenceTier: "CONFIRMED",
          untrustedRepositoryContent: true,
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
      resolvedPair = this.findLatestCompletedScanPair(repo.id);
    }

    if (resolvedPair) {
      try {
        const evo = new EvolutionAnalyzer(db).analyze(
          resolvedPair.baseScanId,
          resolvedPair.targetScanId,
          {
            persistEvents: false,
            applyLifecycle: false,
            allowPartial: boundedRequest.allowPartialSnapshot ?? true,
            maxRecordsPerDomain: 50,
            expectedRepositoryId: repo.id,
          },
        );

        const highlights: RetrievalEvolutionSummary["highlights"] = [];
        for (const d of evo.drift.findings.slice(0, 5)) {
          highlights.push({
            kind: "drift",
            severity: d.severity,
            title: d.title,
            confidenceTier: d.confidenceTier,
            relevantPaths: d.relevantPaths.slice(0, 5),
          });
        }
        for (const c of evo.decisions.correlations.slice(0, 5)) {
          highlights.push({
            kind: "decision_correlation",
            severity: c.severity,
            title: c.title,
            confidenceTier: c.confidenceTier,
            relevantPaths: c.relevantPaths.slice(0, 5),
          });
        }
        for (const debt of evo.debt.items.slice(0, 5)) {
          highlights.push({
            kind: "debt",
            severity: debt.severity,
            title: debt.title,
            confidenceTier: debt.confidenceTier,
            relevantPaths: debt.relevantPaths.slice(0, 5),
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
          message: `Evolution comparison skipped: ${err?.message ?? String(err)}`,
        });
      }
    }

    // 5. Rank deterministically across all domains & enforce budget
    const ranked = RelevanceRanker.rank(candidates, {
      classification,
      policy: resolvedPolicy.policy,
      seedFiles,
    });

    const baseChars =
      (overview ? JSON.stringify(overview).length : 0) +
      (evolution ? JSON.stringify(evolution).length : 0);

    const allocation = ContextBudgeter.allocate(
      ranked,
      plan.effectiveLimits,
      resolvedPolicy.policy,
      baseChars,
    );

    if (allocation.budget.truncatedCount > 0) {
      warnings.push({
        code: "BUDGET_TRUNCATED",
        severity: "info",
        message: `Truncated ${allocation.budget.truncatedCount} lower-priority item(s) across [${allocation.budget.truncatedDomains.join(", ")}] to honor retrieval budget (${plan.effectiveLimits.maxItems} items / ${plan.effectiveLimits.maxTotalChars} chars / ${plan.effectiveLimits.maxTokens} tokens).`,
      });
    }

    // 6. Partition selected items cleanly by domain
    const components: RankedComponentItem[] = [];
    const files: RankedFileItem[] = [];
    const symbols: RankedSymbolItem[] = [];
    const dependencies: RankedDependencyItem[] = [];
    const tests: RankedTestAssociationItem[] = [];
    const decisions: RankedAdrItem[] = [];
    const memories: RankedMemoryItem[] = [];
    const snippets: SafeCodeSnippet[] = [];

    for (const item of allocation.selected) {
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

    const confidenceSummary = this.computeConfidenceSummary(allocation.selected);
    const dedupedWarnings = this.dedupeWarnings(warnings);
    const dedupedLimitations = Array.from(new Set(limitations)).sort((a, b) => a.localeCompare(b));

    const retrievalId = this.computeDeterministicId({
      repositoryIdentity: repo.identity,
      scanId,
      agentId: boundedRequest.agentId,
      taskSummary: boundedRequest.taskSummary,
      taskType: classification.primaryTaskType,
      selectedIds: allocation.selected.map((s) => `${s.id}@${s.rankScore}`),
      freshnessStatus: freshness.status,
      baseScanId: evolution?.baseScanId,
      targetScanId: evolution?.targetScanId,
    });

    return {
      contract: "frontier-engineer/retrieval",
      version: 1,
      retrievalId,
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
        components,
        files,
        symbols,
        dependencies,
        tests,
        decisions,
        memories,
        evolution,
        snippets,
      },
      confidenceSummary,
      warnings: dedupedWarnings,
      budget: allocation.budget,
      limitations: dedupedLimitations,
    };
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

    const highlights: HandoffContextHighlight[] = allSelected.slice(0, 12).map((item) => ({
      domain: item.domain,
      idOrPath: item.id,
      summary: item.title,
      confidenceTier: item.confidenceTier,
      evidenceFile: item.evidence[0]?.filePath,
    }));

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
      warnings: response.warnings.slice(0, 8).map((w) => `[${w.code}] ${w.message}`),
      budget: {
        includedCount: response.budget.includedCount,
        truncatedCount: response.budget.truncatedCount,
        estimatedTokens: response.budget.estimatedTokens,
      },
    };
  }

  private resolveTargetScan(
    repositoryId: number,
    activeScanId: number | null,
    explicitScanId?: number,
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

    if (row.status === "FAILED" || row.status === "CANCELLED" || row.status === "RUNNING") {
      throw new Error(
        `Repository index snapshot ${scanId} has status '${row.status}' and is unavailable for retrieval.`,
      );
    }

    return row;
  }

  private getSingleFileMeta(scanId: number, normalizedPath: string) {
    const db = this.connectionManager.getDatabase();
    return db
      .prepare(
        `SELECT
          id, normalized_path AS normalizedPath, language, classification,
          sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
         FROM files WHERE scan_id = ? AND normalized_path = ?`,
      )
      .get(scanId, normalizedPath) as
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

  private getFileCounts(
    scanId: number,
    fileId: number,
  ): { exportsCount: number; importsCount: number } {
    const db = this.connectionManager.getDatabase();
    const exp = db
      .prepare("SELECT COUNT(*) AS count FROM exports WHERE scan_id = ? AND file_id = ?")
      .get(scanId, fileId) as { count: number };
    const imp = db
      .prepare("SELECT COUNT(*) AS count FROM imports WHERE scan_id = ? AND source_file_id = ?")
      .get(scanId, fileId) as { count: number };
    return { exportsCount: exp.count, importsCount: imp.count };
  }

  private selectCandidateFiles(
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
           WHERE scan_id = ? AND normalized_path IN (${placeholders})
           ORDER BY normalized_path ASC`,
        )
        .all(scanId, ...allSeeds) as any[];
      for (const r of rows) byPath.set(r.normalizedPath, r);
    }

    for (const kw of keywords.slice(0, 6)) {
      if (byPath.size >= maxCandidates) break;
      const rows = db
        .prepare(
          `SELECT id, normalized_path AS normalizedPath, language, classification,
                  sensitivity_status AS sensitivityStatus, size_bytes AS sizeBytes
           FROM files
           WHERE scan_id = ? AND LOWER(normalized_path) LIKE ?
           ORDER BY normalized_path ASC
           LIMIT ?`,
        )
        .all(scanId, `%${kw.toLowerCase()}%`, 15) as any[];
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
           WHERE scan_id = ? AND classification IN ('source', 'configuration', 'documentation')
           ORDER BY normalized_path ASC
           LIMIT ?`,
        )
        .all(scanId, maxCandidates) as any[];
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
           WHERE s.scan_id = ? AND f.sensitivity_status = 'SAFE'
             AND (s.name = ? OR s.symbol_identity = ? OR LOWER(s.name) LIKE ?)
           ORDER BY s.is_exported DESC, s.symbol_identity ASC
           LIMIT 15`,
        )
        .all(scanId, clean, clean, `%${clean.toLowerCase()}%`) as any[];
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
           WHERE s.scan_id = ? AND f.sensitivity_status = 'SAFE'
             AND f.normalized_path IN (${placeholders})
           ORDER BY s.is_exported DESC, s.start_line ASC
           LIMIT ?`,
        )
        .all(scanId, ...targetFiles, maxCandidates) as any[];
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
             WHERE s.scan_id = ? AND f.sensitivity_status = 'SAFE'
               AND s.is_exported = 1 AND LOWER(s.name) LIKE ?
             ORDER BY s.symbol_identity ASC
             LIMIT 10`,
          )
          .all(scanId, `%${kw.toLowerCase()}%`) as any[];
        for (const r of rows) {
          if (!byIdentity.has(r.symbolIdentity)) byIdentity.set(r.symbolIdentity, r);
        }
      }
    }

    return Array.from(byIdentity.values()).slice(0, maxCandidates);
  }

  private findLatestCompletedScanPair(
    repositoryId: number,
  ): { baseScanId: number; targetScanId: number } | null {
    const db = this.connectionManager.getDatabase();
    const rows = db
      .prepare(
        `SELECT id FROM scan_runs
         WHERE repository_id = ? AND status IN ('COMPLETE', 'PARTIAL')
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
      const key = `${w.code}:${w.entity ?? ""}:${w.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(w);
      }
    }
    result.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
    return result;
  }

  private computeDeterministicId(seed: Record<string, unknown>): string {
    const payload = JSON.stringify(seed);
    return `ret-${createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)}`;
  }
}
