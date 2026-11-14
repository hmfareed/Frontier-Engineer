import { classifyToolCall } from "../lib/command-classifier.ts";
import type { PreToolUsePayload } from "../lib/event-context.ts";
import { extractCorrelationId } from "../lib/event-context.ts";
import { scanBufferForSecrets } from "../../scanner/sensitive-filter.ts";
import {
  HANDOFF_BLOCK_START,
  parseAndValidateHandoffBundle,
} from "../../retrieval/orchestrator.ts";
import { writeAuditLog } from "../runtime/logger.ts";

export interface PreToolUseOutput {
  decision: "allow" | "deny" | "force_ask" | "ask";
  reason?: string;
  permissionOverrides?: string[];
}

export function handlePreToolUse(payload: PreToolUsePayload): PreToolUseOutput {
  const toolName = payload.toolCall?.name ?? "";
  const toolArgs = payload.toolCall?.args ?? {};
  const correlationId = extractCorrelationId(payload);
  const workspaceRoot = payload.workspacePaths?.[0];

  let classification = classifyToolCall(toolName, toolArgs);

  // Enforce secret & handoff-contract integrity on Antigravity subagent delegation prompts
  if (
    classification.decision !== "deny" &&
    toolName === "invoke_subagent" &&
    typeof toolArgs.Prompt === "string"
  ) {
    const prompt = toolArgs.Prompt;
    const rawTokenMatch =
      /\b(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{36,}|sntrys_[A-Za-z0-9]{32,})\b/.test(
        prompt,
      );
    if (scanBufferForSecrets(Buffer.from(prompt, "utf8")).detected || rawTokenMatch) {
      classification = {
        ...classification,
        decision: "deny",
        reason: "Subagent delegation Prompt contains unredacted secret patterns.",
      };
    } else if (
      prompt.includes(HANDOFF_BLOCK_START) ||
      prompt.includes("<<<END_FRONTIER_HANDOFF_JSON>>>")
    ) {
      const parsed = parseAndValidateHandoffBundle(prompt);
      if (!parsed.valid) {
        classification = {
          ...classification,
          decision: "deny",
          reason: `Malformed FRONTIER_HANDOFF_JSON delegation bundle: ${parsed.errors[0] ?? "schema error"}`,
        };
      }
    }
  }

  writeAuditLog(
    {
      event: "PreToolUse",
      hookId: "frontier-pre-tool-safety",
      conversationId: correlationId,
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
      },
    },
    workspaceRoot,
  );

  if (classification.decision === "allow") {
    return { decision: "allow" };
  }

  return {
    decision: classification.decision,
    reason: classification.reason,
  };
}
