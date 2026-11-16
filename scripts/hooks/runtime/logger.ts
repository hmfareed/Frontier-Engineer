import fs from "node:fs";
import path from "node:path";
import { containsUnredactedSecrets } from "../../scanner/sensitive-filter.ts";
import { redactString, redactValue } from "../lib/secret-redactor.ts";
import { logDiagnostic } from "./output.ts";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BACKUP_FILES = 3;

export interface AuditRecord {
  event: string;
  hookId: string;
  conversationId?: string;
  timestamp: string;
  stepIdx?: number;
  toolName?: string;
  status: "success" | "denied" | "error" | "escalated" | "info";
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Resolves an explicit audit log directory, returning null if workspace context is missing or invalid. */
export function resolveSafeAuditDir(workspaceRoot?: string): string | null {
  if (process.env.PLUGIN_DATA && fs.existsSync(process.env.PLUGIN_DATA)) {
    return path.join(process.env.PLUGIN_DATA, "audit");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    return null;
  }
  try {
    const resolved = path.resolve(workspaceRoot);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return null;
    }
    return path.join(resolved, ".frontier", "audit");
  } catch {
    return null;
  }
}

/** Resolves the audit log directory (never falling back to an arbitrary process.cwd()). */
export function resolveAuditDir(workspaceRoot?: string): string {
  return resolveSafeAuditDir(workspaceRoot) ?? "";
}

/** Rotates audit log file if it exceeds MAX_LOG_SIZE_BYTES. */
function rotateLogsIfNeeded(logFilePath: string): void {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const stats = fs.statSync(logFilePath);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Shift backups: .2 -> .3, .1 -> .2, log -> .1
    for (let i = MAX_BACKUP_FILES - 1; i >= 1; i--) {
      const src = `${logFilePath}.${i}`;
      const dest = `${logFilePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dest);
        } catch {
          // Ignore rotation rename collisions
        }
      }
    }

    const firstBackup = `${logFilePath}.1`;
    try {
      fs.renameSync(logFilePath, firstBackup);
    } catch {
      // If rename fails, truncate existing file
      fs.writeFileSync(logFilePath, "", "utf8");
    }
  } catch {
    // Rotation is best effort
  }
}

const AUDIT_JSON_REPLACER = (_key: string, val: unknown): unknown => {
  if (typeof val === "bigint") {
    return val.toString();
  }
  if (typeof val === "string") {
    return redactString(val);
  }
  return val;
};

function serializeAuditLine(record: AuditRecord): string {
  try {
    const sanitized = redactValue(record) as AuditRecord;
    const serialized = JSON.stringify(sanitized, AUDIT_JSON_REPLACER);
    if (typeof serialized !== "string") {
      throw new Error("Audit record serialization produced undefined output.");
    }
    if (containsUnredactedSecrets(serialized)) {
      throw new Error("Post-serialization secret check detected unredacted content.");
    }
    return serialized;
  } catch (serializeErr) {
    const errMsg = serializeErr instanceof Error ? serializeErr.message : String(serializeErr);
    const safeErrMsg = redactString(errMsg);
    logDiagnostic("Audit record serialization degraded; writing redacted fallback entry", {
      error: safeErrMsg,
    });

    const fallbackRecord: AuditRecord = {
      event: redactString(String(record.event ?? "UnknownEvent")),
      hookId: redactString(String(record.hookId ?? "unknown-hook")),
      conversationId:
        record.conversationId !== undefined
          ? redactString(String(record.conversationId))
          : undefined,
      timestamp: redactString(String(record.timestamp ?? new Date().toISOString())),
      stepIdx: typeof record.stepIdx === "number" ? record.stepIdx : undefined,
      toolName: record.toolName !== undefined ? redactString(String(record.toolName)) : undefined,
      status: record.status,
      error: record.error !== undefined ? redactString(String(record.error)) : undefined,
      metadata: { serializationError: safeErrMsg },
    };
    const fallbackLine = JSON.stringify(fallbackRecord, AUDIT_JSON_REPLACER);
    if (!containsUnredactedSecrets(fallbackLine)) {
      return fallbackLine;
    }
    return JSON.stringify({
      event: "UnknownEvent",
      hookId: "unknown-hook",
      timestamp: new Date().toISOString(),
      status: "error",
      metadata: { serializationError: "Redacted fallback serialization guard triggered." },
    });
  }
}

/** Writes a sanitized audit record to local JSONL log when explicit audit target exists. */
export function writeAuditLog(record: AuditRecord, workspaceRoot?: string): void {
  try {
    const auditDir = resolveSafeAuditDir(workspaceRoot);
    if (!auditDir) {
      logDiagnostic("Skipping audit log write: missing or invalid workspace context", {
        event: record.event,
        hookId: record.hookId,
      });
      return;
    }
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }

    const logFilePath = path.join(auditDir, "execution.jsonl");
    rotateLogsIfNeeded(logFilePath);

    const line = serializeAuditLine(record) + "\n";
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch (error) {
    logDiagnostic("Failed to write audit log entry (failing open)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
