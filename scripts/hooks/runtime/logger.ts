import fs from "node:fs";
import path from "node:path";
import { redactValue } from "../lib/secret-redactor.ts";
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

/** Resolves the audit log directory. */
export function resolveAuditDir(workspaceRoot?: string): string {
  if (process.env.PLUGIN_DATA && fs.existsSync(process.env.PLUGIN_DATA)) {
    return path.join(process.env.PLUGIN_DATA, "audit");
  }
  const baseDir = workspaceRoot || process.cwd();
  return path.join(baseDir, ".frontier", "audit");
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

/** Writes a sanitized audit record to local JSONL log. */
export function writeAuditLog(record: AuditRecord, workspaceRoot?: string): void {
  try {
    const auditDir = resolveAuditDir(workspaceRoot);
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }

    const logFilePath = path.join(auditDir, "execution.jsonl");
    rotateLogsIfNeeded(logFilePath);

    const sanitized = redactValue(record) as AuditRecord;
    const line = JSON.stringify(sanitized) + "\n";
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch (error) {
    logDiagnostic("Failed to write audit log entry (failing open)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
