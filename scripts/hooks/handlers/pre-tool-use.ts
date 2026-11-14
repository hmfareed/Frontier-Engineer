import { classifyToolCall } from "../lib/command-classifier.ts";
import type { ClassificationResult } from "../lib/command-classifier.ts";
import type { PreToolUsePayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { scanBufferForSecrets } from "../../scanner/sensitive-filter.ts";
import {
  HANDOFF_BLOCK_END,
  HANDOFF_BLOCK_START,
  parseAndValidateHandoffBundle,
  prepareDelegationHandoff,
} from "../../retrieval/orchestrator.ts";
import type { AgentId } from "../../retrieval/types.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PreToolUseOutput {
  decision: "allow" | "deny" | "force_ask" | "ask";
  reason?: string;
  permissionOverrides?: string[];
  overwrite?: Record<string, unknown>;
}

const SPAWN_DELEGATION_TOOLS = new Set(["invoke_subagent", "delegate_agent", "spawn_subagent"]);
const MESSAGE_DELEGATION_TOOLS = new Set(["send_message"]);
const FRONTIER_AGENT_SET = new Set<AgentId>([
  "frontier-engineer",
  "architect",
  "implementation-engineer",
  "security-auditor",
  "qa-engineer",
  "design-engineer",
]);
const BUILTIN_ANTIGRAVITY_SUBAGENTS = new Set(["browser", "research", "self", "image-generator"]);
const RAW_SECRET_TOKEN_REGEX =
  /\b(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{36,}|sntrys_[A-Za-z0-9]{32,})\b/;

function containsUnredactedSecret(text: string): boolean {
  return (
    scanBufferForSecrets(Buffer.from(text, "utf8")).detected || RAW_SECRET_TOKEN_REGEX.test(text)
  );
}

function normalizeTargetAgentName(rawTarget: unknown): string | null {
  if (typeof rawTarget !== "string" || rawTarget.trim().length === 0) return null;
  return rawTarget.trim().replace(/^frontier-engineer:/, "");
}

function resolveEnvFlags() {
  return {
    allowPartialSnapshot: process.env.FRONTIER_ALLOW_PARTIAL_HANDOFF === "1",
    allowStaleSnapshot: process.env.FRONTIER_ALLOW_STALE_HANDOFF === "1",
    allowUnindexedDegraded: process.env.FRONTIER_ALLOW_UNINDEXED_HANDOFF !== "0",
  };
}

function collectMarkerStrings(args: Record<string, unknown>): string[] {
  const matches: string[] = [];
  for (const val of Object.values(args)) {
    if (
      typeof val === "string" &&
      (val.includes(HANDOFF_BLOCK_START) || val.includes(HANDOFF_BLOCK_END))
    ) {
      matches.push(val);
    }
  }
  return matches;
}

function recordAuditAndBuildOutput(
  payload: PreToolUsePayload,
  toolName: string,
  classification: ClassificationResult,
  workspaceRoot: string | undefined,
  overwrite?: Record<string, unknown>,
): PreToolUseOutput {
  writeAuditLog(
    {
      event: "PreToolUse",
      hookId: "frontier-pre-tool-safety",
      conversationId: extractCorrelationId(payload),
      timestamp: new Date().toISOString(),
      stepIdx: payload.stepIdx,
      toolName,
      status:
        classification.decision === "deny"
          ? "denied"
          : classification.decision === "force_ask" || classification.decision === "ask"
            ? "escalated"
            : "info",
      metadata: {
        decision: classification.decision,
        semanticClass: classification.semanticClass,
        category: classification.category,
        reason: classification.reason,
        overwriteApplied: overwrite ? Object.keys(overwrite) : undefined,
      },
    },
    workspaceRoot,
  );

  if (classification.decision === "allow") {
    return overwrite
      ? { decision: "allow", reason: classification.reason, overwrite }
      : { decision: "allow" };
  }

  return {
    decision: classification.decision,
    reason: classification.reason,
    ...(overwrite ? { overwrite } : {}),
  };
}

export function handlePreToolUse(payload: PreToolUsePayload): PreToolUseOutput {
  const toolName = payload.toolCall?.name ?? "";
  const toolArgs = payload.toolCall?.args ?? {};
  const workspaceRoot = payload.workspacePaths?.[0] ?? payload.cwd;
  const flags = resolveEnvFlags();

  let classification = classifyToolCall(toolName, toolArgs);

  // Validate handoff markers wherever they appear, without ever upgrading unknown tools to allow
  if (classification.decision !== "deny") {
    const markerTexts = collectMarkerStrings(toolArgs);
    const isDelegation =
      SPAWN_DELEGATION_TOOLS.has(toolName) || MESSAGE_DELEGATION_TOOLS.has(toolName);
    if (!isDelegation && markerTexts.length > 0) {
      for (const markerText of markerTexts) {
        if (containsUnredactedSecret(markerText)) {
          classification = {
            ...classification,
            decision: "deny",
            reason: `Tool '${toolName}' argument with handoff markers contains unredacted secrets.`,
          };
          break;
        }
        const parsed = parseAndValidateHandoffBundle(markerText, {
          workspaceRoot,
          allowPartialSnapshot: flags.allowPartialSnapshot,
          allowStaleSnapshot: flags.allowStaleSnapshot,
          allowUnindexedDegraded: flags.allowUnindexedDegraded,
        });
        if (!parsed.valid) {
          classification = {
            ...classification,
            decision: "deny",
            reason: `Malformed FRONTIER_HANDOFF_JSON bundle on '${toolName}': ${parsed.errors[0] ?? "validation error"}`,
          };
          break;
        }
      }
      // Deliberately preserve original classification (e.g., force_ask on unknown tools) when valid
      return recordAuditAndBuildOutput(payload, toolName, classification, workspaceRoot);
    }
  }

  if (classification.decision !== "deny" && SPAWN_DELEGATION_TOOLS.has(toolName)) {
    const rawTarget =
      toolArgs.TypeName ??
      toolArgs.typeName ??
      toolArgs.agent ??
      toolArgs.Agent ??
      toolArgs.targetAgent;
    const normalizedTarget = normalizeTargetAgentName(rawTarget);
    const promptCandidate = toolArgs.Prompt ?? toolArgs.prompt ?? toolArgs.task ?? toolArgs.Task;

    if (!normalizedTarget) {
      classification = {
        ...classification,
        decision: "deny",
        reason: `Subagent delegation via '${toolName}' requires a valid non-empty TypeName.`,
      };
    } else if (
      !FRONTIER_AGENT_SET.has(normalizedTarget as AgentId) &&
      !BUILTIN_ANTIGRAVITY_SUBAGENTS.has(normalizedTarget)
    ) {
      classification = {
        ...classification,
        decision: "deny",
        reason: `Unsupported or unknown delegation target agent '${String(rawTarget)}'.`,
      };
    } else if (typeof promptCandidate !== "string" || promptCandidate.trim().length === 0) {
      classification = {
        ...classification,
        decision: "deny",
        reason: `Subagent delegation via '${toolName}' requires a non-empty Prompt string.`,
      };
    } else if (containsUnredactedSecret(promptCandidate)) {
      classification = {
        ...classification,
        decision: "deny",
        reason: "Subagent delegation Prompt contains unredacted secret patterns.",
      };
    } else {
      const hasMarkers =
        promptCandidate.includes(HANDOFF_BLOCK_START) ||
        promptCandidate.includes(HANDOFF_BLOCK_END);
      const isFrontierSpecialist = FRONTIER_AGENT_SET.has(normalizedTarget as AgentId);
      const claimsRetrieval =
        toolArgs.requireHandoff === true ||
        /\b(?:FRONTIER_HANDOFF_JSON|retrieval-assisted|Grounded Snapshot:)\b/i.test(
          promptCandidate,
        );

      if (hasMarkers) {
        const parsed = parseAndValidateHandoffBundle(promptCandidate, {
          workspaceRoot,
          expectedTargetAgent: isFrontierSpecialist ? (normalizedTarget as AgentId) : undefined,
          allowPartialSnapshot: flags.allowPartialSnapshot,
          allowStaleSnapshot: flags.allowStaleSnapshot,
          allowUnindexedDegraded: flags.allowUnindexedDegraded,
        });
        if (!parsed.valid) {
          classification = {
            ...classification,
            decision: "deny",
            reason: `Invalid FRONTIER_HANDOFF_JSON delegation bundle: ${parsed.errors[0] ?? "validation error"}`,
          };
        } else {
          classification = {
            decision: "allow",
            semanticClass: "trusted_read_only",
            category: "safe",
            reason: `Validated FRONTIER_HANDOFF_JSON bundle (${parsed.mode ?? "INDEXED"}) for '${normalizedTarget}'.`,
          };
        }
      } else if (isFrontierSpecialist || claimsRetrieval) {
        classification = {
          ...classification,
          decision: "deny",
          reason: `Blocked plain-text delegation to '${normalizedTarget}': valid FRONTIER_HANDOFF_JSON bundle is required.`,
        };
      }
    }
  } else if (classification.decision !== "deny" && MESSAGE_DELEGATION_TOOLS.has(toolName)) {
    const rawRecipient = toolArgs.Recipient ?? toolArgs.recipient;
    const normalizedRecipient = normalizeTargetAgentName(rawRecipient);
    const messageCandidate = toolArgs.Message ?? toolArgs.message;

    if (typeof messageCandidate !== "string" || messageCandidate.trim().length === 0) {
      classification = {
        ...classification,
        decision: "deny",
        reason: "Agent send_message requires a non-empty Message string.",
      };
    } else if (containsUnredactedSecret(messageCandidate)) {
      classification = {
        ...classification,
        decision: "deny",
        reason: "Agent send_message payload contains unredacted secret patterns.",
      };
    } else {
      const hasMarkers =
        messageCandidate.includes(HANDOFF_BLOCK_START) ||
        messageCandidate.includes(HANDOFF_BLOCK_END);
      const claimsRetrieval =
        /\b(?:FRONTIER_HANDOFF_JSON|retrieval-assisted|Grounded Snapshot:)\b/i.test(
          messageCandidate,
        );
      if (hasMarkers) {
        const parsed = parseAndValidateHandoffBundle(messageCandidate, {
          workspaceRoot,
          allowPartialSnapshot: flags.allowPartialSnapshot,
          allowStaleSnapshot: flags.allowStaleSnapshot,
          allowUnindexedDegraded: flags.allowUnindexedDegraded,
        });
        if (!parsed.valid) {
          classification = {
            ...classification,
            decision: "deny",
            reason: `Invalid FRONTIER_HANDOFF_JSON bundle in send_message: ${parsed.errors[0] ?? "validation error"}`,
          };
        } else {
          classification = {
            decision: "allow",
            semanticClass: "trusted_read_only",
            category: "safe",
            reason: "Validated FRONTIER_HANDOFF_JSON bundle in send_message.",
          };
        }
      } else if (
        claimsRetrieval ||
        (normalizedRecipient !== null && FRONTIER_AGENT_SET.has(normalizedRecipient as AgentId))
      ) {
        classification = {
          ...classification,
          decision: "deny",
          reason:
            "Blocked ungrounded Frontier delegation/handoff claim in send_message without valid FRONTIER_HANDOFF_JSON bundle.",
        };
      }
    }
  }

  return recordAuditAndBuildOutput(payload, toolName, classification, workspaceRoot);
}

export interface PrepareAndGateOptions {
  allowPartialSnapshot?: boolean;
  allowStaleSnapshot?: boolean;
  allowUnindexedFallback?: boolean;
  includeSnippets?: boolean;
}

/**
 * Genuine producer-side Antigravity PreToolUse integration: when delegating to a Frontier
 * specialist without an embedded bundle, runs read-only retrieval, validates the handoff,
 * attaches it via documented PreToolUse `overwrite.Prompt`, and fails closed if retrieval
 * or validation fails. Existing embedded bundles are strictly validated without overwriting.
 */
export async function prepareAndGateSubagentToolCall(
  payload: PreToolUsePayload,
  options: PrepareAndGateOptions = {},
): Promise<PreToolUseOutput> {
  const toolName = payload.toolCall?.name ?? "";
  const toolArgs = payload.toolCall?.args ?? {};
  const workspaceRoot = payload.workspacePaths?.[0] ?? payload.cwd;

  if (!SPAWN_DELEGATION_TOOLS.has(toolName)) {
    return handlePreToolUse(payload);
  }

  const rawTarget =
    toolArgs.TypeName ??
    toolArgs.typeName ??
    toolArgs.agent ??
    toolArgs.Agent ??
    toolArgs.targetAgent;
  const normalizedTarget = normalizeTargetAgentName(rawTarget);
  const promptCandidate = toolArgs.Prompt ?? toolArgs.prompt ?? toolArgs.task ?? toolArgs.Task;

  if (
    !normalizedTarget ||
    !FRONTIER_AGENT_SET.has(normalizedTarget as AgentId) ||
    typeof promptCandidate !== "string" ||
    promptCandidate.trim().length === 0 ||
    containsUnredactedSecret(promptCandidate) ||
    promptCandidate.includes(HANDOFF_BLOCK_START) ||
    promptCandidate.includes(HANDOFF_BLOCK_END) ||
    toolArgs.requireExistingHandoff === true
  ) {
    return handlePreToolUse(payload);
  }

  if (!workspaceRoot) {
    return recordAuditAndBuildOutput(
      payload,
      toolName,
      {
        decision: "deny",
        semanticClass: "unknown",
        category: "ambiguous",
        reason: `Blocked Frontier delegation to '${normalizedTarget}': workspaceRoot missing for automatic retrieval preparation.`,
      },
      undefined,
    );
  }

  try {
    const taskId = `FE-HOOK-${(payload.stepIdx ?? 0).toString()}`;
    const prepared = await prepareDelegationHandoff({
      workspaceRoot,
      targetAgent: normalizedTarget as AgentId,
      fromAgent: "frontier-engineer",
      taskId,
      taskSummary: promptCandidate,
      allowPartialSnapshot: options.allowPartialSnapshot ?? resolveEnvFlags().allowPartialSnapshot,
      allowStaleSnapshot: options.allowStaleSnapshot ?? resolveEnvFlags().allowStaleSnapshot,
      allowUnindexedFallback: options.allowUnindexedFallback ?? false,
      includeSnippets: options.includeSnippets,
    });

    const usable =
      (prepared.status === "READY" ||
        (prepared.status === "DEGRADED_UNINDEXED" && options.allowUnindexedFallback === true)) &&
      prepared.promptSection !== null &&
      prepared.handoff !== null;

    if (!usable) {
      const detail =
        prepared.schemaValidation.errors[0] ??
        prepared.limitations[0] ??
        prepared.eligibility.reason;
      return recordAuditAndBuildOutput(
        payload,
        toolName,
        {
          decision: "deny",
          semanticClass: "unknown",
          category: "ambiguous",
          reason: `Blocked Frontier delegation to '${normalizedTarget}': retrieval handoff preparation failed (${prepared.status}: ${detail}).`,
        },
        workspaceRoot,
      );
    }

    const consumerCheck = parseAndValidateHandoffBundle(prepared.promptSection!, {
      workspaceRoot,
      expectedTargetAgent: normalizedTarget as AgentId,
      allowPartialSnapshot: options.allowPartialSnapshot ?? resolveEnvFlags().allowPartialSnapshot,
      allowStaleSnapshot: options.allowStaleSnapshot ?? resolveEnvFlags().allowStaleSnapshot,
      allowUnindexedDegraded: options.allowUnindexedFallback ?? false,
    });

    if (!consumerCheck.valid) {
      return recordAuditAndBuildOutput(
        payload,
        toolName,
        {
          decision: "deny",
          semanticClass: "unknown",
          category: "ambiguous",
          reason: `Blocked Frontier delegation to '${normalizedTarget}': generated handoff failed consumer validation (${consumerCheck.errors[0] ?? "invalid bundle"}).`,
        },
        workspaceRoot,
      );
    }

    return recordAuditAndBuildOutput(
      payload,
      toolName,
      {
        decision: "allow",
        semanticClass: "trusted_read_only",
        category: "safe",
        reason: `Attached validated FRONTIER_HANDOFF_JSON bundle (${prepared.status}) via PreToolUse overwrite.`,
      },
      workspaceRoot,
      { Prompt: prepared.promptSection! },
    );
  } catch (err: any) {
    return recordAuditAndBuildOutput(
      payload,
      toolName,
      {
        decision: "deny",
        semanticClass: "unknown",
        category: "ambiguous",
        reason: `Blocked Frontier delegation due to handoff preparation error: ${err?.message ?? String(err)}`,
      },
      workspaceRoot,
    );
  }
}
