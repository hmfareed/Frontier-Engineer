/**
 * Phase 7.6 — Agent Retrieval Policies & Configuration Resolution
 * Enforces per-agent domain priorities, budgets, depth bounds, and safety ceilings.
 */

import fs from "node:fs";
import path from "node:path";
import { validateWorkspaceConfigValue } from "./schema-validator.ts";
import { ContentSanitizer } from "./content-sanitizer.ts";
import type {
  AgentId,
  AgentRetrievalPolicy,
  RetrievalDomain,
  RetrievalLimits,
  RetrievalRequest,
  RetrievalWarning,
} from "./types.ts";

export const HARD_SAFETY_CEILINGS: RetrievalLimits = {
  maxItems: 100,
  maxTotalChars: 128_000,
  maxTokens: 32_000,
  maxDepth: 10,
  maxSnippetLines: 80,
};

const ALL_DOMAINS: RetrievalDomain[] = [
  "overview",
  "components",
  "files",
  "symbols",
  "dependencies",
  "tests",
  "decisions",
  "memories",
  "evolution",
  "snippets",
];

function makeWeights(ordered: RetrievalDomain[]): Record<RetrievalDomain, number> {
  const weights = {} as Record<RetrievalDomain, number>;
  for (const d of ALL_DOMAINS) {
    weights[d] = 1;
  }
  const len = ordered.length;
  for (let i = 0; i < len; i++) {
    weights[ordered[i]] = len - i + 2;
  }
  return weights;
}

export const AGENT_RETRIEVAL_POLICIES: Record<AgentId, AgentRetrievalPolicy> = {
  "frontier-engineer": {
    agentId: "frontier-engineer",
    policyVersion: 1,
    description:
      "Coordinator role: broad architectural overview, component boundaries, ADRs, high-value memories, impacted files, and optional evolution highlights for safe task planning and delegation.",
    priorityDomains: [
      "overview",
      "components",
      "decisions",
      "memories",
      "files",
      "dependencies",
      "evolution",
      "tests",
      "symbols",
      "snippets",
    ],
    domainWeights: makeWeights([
      "overview",
      "components",
      "decisions",
      "memories",
      "files",
      "dependencies",
      "evolution",
      "tests",
      "symbols",
      "snippets",
    ]),
    domainQuotas: {
      components: 8,
      decisions: 6,
      memories: 8,
      files: 8,
      dependencies: 6,
      tests: 4,
      symbols: 4,
      snippets: 0,
    },
    preferredMemoryCategories: [
      "architectural_knowledge",
      "architectural_decision",
      "project_context",
      "engineering_convention",
      "technical_debt",
      "evolution_record",
    ],
    defaultLimits: {
      maxItems: 35,
      maxTotalChars: 32_000,
      maxTokens: 8_000,
      maxDepth: 2,
      maxSnippetLines: 25,
    },
    defaultIncludeSnippets: false,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },

  architect: {
    agentId: "architect",
    policyVersion: 1,
    description:
      "Architecture specialist: components, module boundaries, circular dependencies, ADRs, architectural memories, and structural evolution.",
    priorityDomains: [
      "components",
      "decisions",
      "dependencies",
      "memories",
      "evolution",
      "overview",
      "files",
      "symbols",
      "tests",
      "snippets",
    ],
    domainWeights: makeWeights([
      "components",
      "decisions",
      "dependencies",
      "memories",
      "evolution",
      "overview",
      "files",
      "symbols",
      "tests",
      "snippets",
    ]),
    domainQuotas: {
      components: 10,
      decisions: 8,
      dependencies: 10,
      memories: 8,
      files: 6,
      symbols: 4,
      tests: 3,
      snippets: 0,
    },
    preferredMemoryCategories: [
      "architectural_decision",
      "architectural_knowledge",
      "technical_debt",
      "evolution_record",
    ],
    defaultLimits: {
      maxItems: 40,
      maxTotalChars: 40_000,
      maxTokens: 10_000,
      maxDepth: 3,
      maxSnippetLines: 30,
    },
    defaultIncludeSnippets: false,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },

  "implementation-engineer": {
    agentId: "implementation-engineer",
    policyVersion: 1,
    description:
      "Implementation specialist: target files, symbols, direct callers/dependencies, associated tests, engineering conventions, and bounded code snippets.",
    priorityDomains: [
      "files",
      "symbols",
      "dependencies",
      "tests",
      "snippets",
      "memories",
      "decisions",
      "components",
      "evolution",
      "overview",
    ],
    domainWeights: makeWeights([
      "files",
      "symbols",
      "dependencies",
      "tests",
      "snippets",
      "memories",
      "decisions",
      "components",
      "evolution",
      "overview",
    ]),
    domainQuotas: {
      files: 10,
      symbols: 10,
      dependencies: 8,
      tests: 6,
      snippets: 5,
      memories: 6,
      decisions: 4,
      components: 4,
    },
    preferredMemoryCategories: [
      "engineering_convention",
      "architectural_knowledge",
      "technical_debt",
      "architectural_decision",
    ],
    defaultLimits: {
      maxItems: 35,
      maxTotalChars: 48_000,
      maxTokens: 12_000,
      maxDepth: 2,
      maxSnippetLines: 40,
    },
    defaultIncludeSnippets: true,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },

  "security-auditor": {
    agentId: "security-auditor",
    policyVersion: 1,
    description:
      "Security specialist: entrypoints, trust boundaries (auth/api/database), dependency chains, security ADRs, disputed/stale governance warnings, and SAFE code snippets with strict secret suppression.",
    priorityDomains: [
      "components",
      "dependencies",
      "files",
      "decisions",
      "memories",
      "snippets",
      "symbols",
      "tests",
      "evolution",
      "overview",
    ],
    domainWeights: makeWeights([
      "components",
      "dependencies",
      "files",
      "decisions",
      "memories",
      "snippets",
      "symbols",
      "tests",
      "evolution",
      "overview",
    ]),
    domainQuotas: {
      components: 8,
      dependencies: 10,
      files: 10,
      decisions: 6,
      memories: 8,
      snippets: 5,
      symbols: 6,
      tests: 4,
    },
    preferredMemoryCategories: [
      "architectural_decision",
      "architectural_knowledge",
      "engineering_convention",
      "technical_debt",
    ],
    defaultLimits: {
      maxItems: 40,
      maxTotalChars: 48_000,
      maxTokens: 12_000,
      maxDepth: 3,
      maxSnippetLines: 40,
    },
    defaultIncludeSnippets: true,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },

  "qa-engineer": {
    agentId: "qa-engineer",
    policyVersion: 1,
    description:
      "QA & Verification specialist: test associations, untested module gaps, target files/symbols, technical debt memories, and recent change impact.",
    priorityDomains: [
      "tests",
      "files",
      "components",
      "symbols",
      "memories",
      "dependencies",
      "evolution",
      "snippets",
      "decisions",
      "overview",
    ],
    domainWeights: makeWeights([
      "tests",
      "files",
      "components",
      "symbols",
      "memories",
      "dependencies",
      "evolution",
      "snippets",
      "decisions",
      "overview",
    ]),
    domainQuotas: {
      tests: 12,
      files: 8,
      components: 6,
      symbols: 6,
      memories: 6,
      dependencies: 4,
      snippets: 4,
      decisions: 3,
    },
    preferredMemoryCategories: [
      "technical_debt",
      "engineering_convention",
      "architectural_knowledge",
      "evolution_record",
    ],
    defaultLimits: {
      maxItems: 35,
      maxTotalChars: 40_000,
      maxTokens: 10_000,
      maxDepth: 2,
      maxSnippetLines: 35,
    },
    defaultIncludeSnippets: true,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },

  "design-engineer": {
    agentId: "design-engineer",
    policyVersion: 1,
    description:
      "Design & UI specialist: frontend components, UI entrypoints, CSS/token files, exported UI symbols, frontend conventions/ADRs, and SAFE component snippets.",
    priorityDomains: [
      "components",
      "files",
      "symbols",
      "snippets",
      "decisions",
      "memories",
      "tests",
      "dependencies",
      "overview",
      "evolution",
    ],
    domainWeights: makeWeights([
      "components",
      "files",
      "symbols",
      "snippets",
      "decisions",
      "memories",
      "tests",
      "dependencies",
      "overview",
      "evolution",
    ]),
    domainQuotas: {
      components: 8,
      files: 10,
      symbols: 8,
      snippets: 5,
      decisions: 4,
      memories: 5,
      tests: 4,
      dependencies: 3,
    },
    preferredMemoryCategories: [
      "engineering_convention",
      "architectural_decision",
      "project_context",
      "architectural_knowledge",
    ],
    defaultLimits: {
      maxItems: 30,
      maxTotalChars: 36_000,
      maxTokens: 9_000,
      maxDepth: 2,
      maxSnippetLines: 35,
    },
    defaultIncludeSnippets: true,
    defaultIncludeHistoricalMemories: false,
    surfaceDisputedAndStaleWarnings: true,
    excludeSensitiveContent: true,
    requireUntrustedFence: true,
  },
};

export interface WorkspaceConfigLoadResult {
  loaded: boolean;
  defaults?: Partial<RetrievalLimits>;
  agentOverride?: {
    includeSnippets?: boolean;
    includeHistoricalMemories?: boolean;
    limits?: Partial<RetrievalLimits>;
    priorityDomains?: RetrievalDomain[];
  };
  warnings: RetrievalWarning[];
}

export function getAgentRetrievalPolicy(agentId: AgentId): AgentRetrievalPolicy {
  const policy = AGENT_RETRIEVAL_POLICIES[agentId];
  if (!policy) {
    throw new Error(`Unsupported agent ID for retrieval policy: '${String(agentId)}'`);
  }
  return policy;
}

export function clampRetrievalLimits(
  base: RetrievalLimits,
  override?: Partial<RetrievalLimits>,
): RetrievalLimits {
  const clamp = (val: number | undefined, fallback: number, min: number, max: number): number => {
    const chosen = typeof val === "number" && Number.isFinite(val) ? Math.floor(val) : fallback;
    return Math.min(Math.max(chosen, min), max);
  };

  return {
    maxItems: clamp(override?.maxItems, base.maxItems, 1, HARD_SAFETY_CEILINGS.maxItems),
    maxTotalChars: clamp(
      override?.maxTotalChars,
      base.maxTotalChars,
      1024,
      HARD_SAFETY_CEILINGS.maxTotalChars,
    ),
    maxTokens: clamp(override?.maxTokens, base.maxTokens, 256, HARD_SAFETY_CEILINGS.maxTokens),
    maxDepth: clamp(override?.maxDepth, base.maxDepth, 1, HARD_SAFETY_CEILINGS.maxDepth),
    maxSnippetLines: clamp(
      override?.maxSnippetLines,
      base.maxSnippetLines,
      5,
      HARD_SAFETY_CEILINGS.maxSnippetLines,
    ),
  };
}

export function loadWorkspaceRetrievalConfig(
  workspaceRoot: string,
  agentId: AgentId,
): WorkspaceConfigLoadResult {
  const warnings: RetrievalWarning[] = [];
  const configPath = path.join(workspaceRoot, ".frontier", "retrieval.config.json");

  if (!fs.existsSync(configPath)) {
    return { loaded: false, warnings };
  }

  try {
    const realRoot = fs.realpathSync(workspaceRoot);
    const realConfig = fs.realpathSync(configPath);
    const rel = path.relative(realRoot, realConfig);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      warnings.push({
        code: "INVALID_WORKSPACE_CONFIG",
        severity: "warning",
        message:
          "Workspace .frontier/retrieval.config.json resolves outside workspace root and was ignored.",
        entity: ".frontier/retrieval.config.json",
      });
      return { loaded: false, warnings };
    }

    const stat = fs.statSync(realConfig);
    if (stat.size > 512 * 1024) {
      warnings.push({
        code: "INVALID_WORKSPACE_CONFIG",
        severity: "warning",
        message:
          "Workspace .frontier/retrieval.config.json exceeds 512KB size limit and was ignored.",
        entity: ".frontier/retrieval.config.json",
      });
      return { loaded: false, warnings };
    }

    const raw = fs.readFileSync(realConfig, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: number;
      defaults?: Partial<RetrievalLimits>;
      agents?: Record<string, WorkspaceConfigLoadResult["agentOverride"]>;
    };

    const validation = validateWorkspaceConfigValue(parsed);

    if (!validation.valid) {
      warnings.push({
        code: "INVALID_WORKSPACE_CONFIG",
        severity: "warning",
        message: `Workspace .frontier/retrieval.config.json failed schema validation and was ignored: ${validation.errors.join("; ")}`,
        entity: ".frontier/retrieval.config.json",
      });
      return { loaded: false, warnings };
    }

    return {
      loaded: true,
      defaults: parsed.defaults,
      agentOverride: parsed.agents?.[agentId],
      warnings,
    };
  } catch (err: any) {
    const safeErr = ContentSanitizer.sanitizeMetadataText(err?.message ?? String(err)).text;
    warnings.push({
      code: "INVALID_WORKSPACE_CONFIG",
      severity: "warning",
      message: `Unable to parse .frontier/retrieval.config.json; defaults applied (${safeErr}).`,
      entity: ".frontier/retrieval.config.json",
    });
    return { loaded: false, warnings };
  }
}

export interface ResolvedRetrievalPolicy {
  policy: AgentRetrievalPolicy;
  effectiveLimits: RetrievalLimits;
  includeSnippets: boolean;
  includeHistoricalMemories: boolean;
  priorityDomains: RetrievalDomain[];
  warnings: RetrievalWarning[];
}

export function resolveEffectivePolicy(
  workspaceRoot: string,
  request: RetrievalRequest,
): ResolvedRetrievalPolicy {
  const basePolicy = getAgentRetrievalPolicy(request.agentId);
  const wsConfig = loadWorkspaceRetrievalConfig(workspaceRoot, request.agentId);

  let limits = clampRetrievalLimits(basePolicy.defaultLimits, wsConfig.defaults);
  if (wsConfig.agentOverride?.limits) {
    limits = clampRetrievalLimits(limits, wsConfig.agentOverride.limits);
  }
  if (request.limits) {
    limits = clampRetrievalLimits(limits, request.limits);
  }

  const includeSnippets =
    request.includeSnippets ??
    wsConfig.agentOverride?.includeSnippets ??
    basePolicy.defaultIncludeSnippets;

  const includeHistoricalMemories =
    request.includeHistoricalMemories ??
    wsConfig.agentOverride?.includeHistoricalMemories ??
    basePolicy.defaultIncludeHistoricalMemories;

  const priorityDomains =
    wsConfig.agentOverride?.priorityDomains && wsConfig.agentOverride.priorityDomains.length > 0
      ? wsConfig.agentOverride.priorityDomains
      : basePolicy.priorityDomains;

  // Clone policy with effective snippet quota so explicit `includeSnippets: true`
  // grants an effective bounded quota even on roles whose default snippet quota is 0.
  const effectiveQuotas = { ...basePolicy.domainQuotas };
  if (includeSnippets) {
    if ((effectiveQuotas.snippets ?? 0) <= 0) {
      effectiveQuotas.snippets = Math.min(4, Math.max(1, Math.floor(limits.maxItems / 5)));
    }
  } else {
    effectiveQuotas.snippets = 0;
  }

  const effectivePolicy: AgentRetrievalPolicy = {
    ...basePolicy,
    domainQuotas: effectiveQuotas,
  };

  return {
    policy: effectivePolicy,
    effectiveLimits: limits,
    includeSnippets,
    includeHistoricalMemories,
    priorityDomains,
    warnings: wsConfig.warnings,
  };
}
