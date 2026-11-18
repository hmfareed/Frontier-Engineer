/**
 * Phase 8.6B-1: Core Telemetry Reader & Legacy Normalizer
 * Bounded-memory, streaming JSONL audit reader supporting active and rotated logs.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { resolveSafeAuditDir } from "../hooks/runtime/logger.ts";
import { parseTelemetryLine } from "./telemetry-parser.ts";
import type {
  AuditFileMetadata,
  InternalTelemetryStreamOptions,
  NormalizedTelemetryRecord,
  ParseDiagnostic,
  TelemetryReaderOptions,
  TelemetryReadResult,
} from "./types.ts";

export type TelemetryStreamItem =
  | { type: "record"; record: NormalizedTelemetryRecord }
  | { type: "diagnostic"; diagnostic: ParseDiagnostic };

const MAX_ROTATION_BACKUPS = 3;

/**
 * Discovers available audit log files in strict chronological order:
 * .3 -> .2 -> .1 -> execution.jsonl.
 */
export function discoverAuditFiles(
  auditDir: string,
  includeRotated: boolean = false,
): { files: AuditFileMetadata[]; diagnostics: ParseDiagnostic[] } {
  const diagnostics: ParseDiagnostic[] = [];
  const files: AuditFileMetadata[] = [];

  try {
    if (!fs.existsSync(auditDir)) {
      return { files, diagnostics };
    }
    const stat = fs.statSync(auditDir);
    if (!stat.isDirectory()) {
      diagnostics.push({
        severity: "error",
        code: "IO_ERROR",
        message: `Specified audit path '${auditDir}' is not a directory.`,
        filePath: auditDir,
        lineNumber: 0,
      });
      return { files, diagnostics };
    }
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "IO_ERROR",
      message: `Failed to inspect audit directory: ${err instanceof Error ? err.message : String(err)}`,
      filePath: auditDir,
      lineNumber: 0,
    });
    return { files, diagnostics };
  }

  const realAuditDir = fs.realpathSync(auditDir);

  // Candidate file paths in chronological order: oldest rotated backup to active log
  const candidateSpecs: Array<{ fileName: string; isRotated: boolean; rotationIndex?: number }> =
    [];

  if (includeRotated) {
    for (let i = MAX_ROTATION_BACKUPS; i >= 1; i--) {
      candidateSpecs.push({
        fileName: `execution.jsonl.${i}`,
        isRotated: true,
        rotationIndex: i,
      });
    }
  }

  // Active log file
  candidateSpecs.push({
    fileName: "execution.jsonl",
    isRotated: false,
  });

  for (const spec of candidateSpecs) {
    const candidatePath = path.join(auditDir, spec.fileName);
    if (fs.existsSync(candidatePath)) {
      try {
        const candidateReal = fs.realpathSync(candidatePath);
        // Path containment check: ensure real path does not escape the real audit directory
        const relative = path.relative(realAuditDir, candidateReal);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          diagnostics.push({
            severity: "error",
            code: "IO_ERROR",
            message: `Disallowed symlink or path traversal outside audit directory: '${candidatePath}'.`,
            filePath: candidatePath,
            lineNumber: 0,
          });
          continue;
        }

        const fileStat = fs.statSync(candidateReal);
        if (fileStat.isFile()) {
          files.push({
            filePath: candidateReal,
            fileName: spec.fileName,
            isRotated: spec.isRotated,
            rotationIndex: spec.rotationIndex,
            sizeBytes: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
            isoModified: fileStat.mtime.toISOString(),
          });
        }
      } catch (err) {
        diagnostics.push({
          severity: "warning",
          code: "IO_ERROR",
          message: `Could not stat candidate audit log '${candidatePath}': ${err instanceof Error ? err.message : String(err)}`,
          filePath: candidatePath,
          lineNumber: 0,
        });
      }
    }
  }

  return { files, diagnostics };
}

/**
 * Resolves the target audit directory based on caller options.
 */
export function resolveTargetAuditDir(options?: TelemetryReaderOptions): string | null {
  if (
    options?.auditDir &&
    typeof options.auditDir === "string" &&
    options.auditDir.trim().length > 0
  ) {
    return path.resolve(options.auditDir.trim());
  }
  return resolveSafeAuditDir(options?.workspaceRoot ?? process.cwd());
}

/**
 * Streaming generator that yields parsed NormalizedTelemetryRecords and ParseDiagnostics
 * one-by-one from audit logs with bounded memory consumption.
 */
export async function* readTelemetryStream(
  options?: TelemetryReaderOptions | InternalTelemetryStreamOptions,
): AsyncGenerator<TelemetryStreamItem, void, undefined> {
  const auditDir = resolveTargetAuditDir(options);
  if (!auditDir) {
    yield {
      type: "diagnostic",
      diagnostic: {
        severity: "warning",
        code: "IO_ERROR",
        message: "No valid audit directory found for workspace context.",
        filePath: options?.workspaceRoot ?? process.cwd(),
        lineNumber: 0,
      },
    };
    return;
  }

  // Use pre-discovered metadata if provided (e.g. from readTelemetryLog), otherwise discover
  const discovery =
    (options as InternalTelemetryStreamOptions)?.discovered ??
    discoverAuditFiles(auditDir, options?.includeRotated ?? false);

  const { files, diagnostics: discoveryDiagnostics } = discovery;

  for (const diag of discoveryDiagnostics) {
    yield { type: "diagnostic", diagnostic: diag };
  }

  if (files.length === 0) {
    return;
  }

  const maxLines =
    typeof options?.maxLines === "number" && options.maxLines > 0 ? options.maxLines : Infinity;
  let linesRead = 0;

  for (const fileMeta of files) {
    if (options?.signal?.aborted) {
      break;
    }
    if (linesRead >= maxLines) {
      break;
    }

    let fileStream: fs.ReadStream | undefined;
    let rl: readline.Interface | undefined;

    try {
      fileStream = fs.createReadStream(fileMeta.filePath, {
        flags: "r",
        encoding: "utf8",
        autoClose: true,
      });

      rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let lineNumber = 0;

      for await (const rawLine of rl) {
        lineNumber++;
        linesRead++;
        options?.onPhysicalLine?.(fileMeta.filePath, lineNumber);

        if (options?.signal?.aborted) {
          break;
        }

        const parseResult = parseTelemetryLine(rawLine, {
          filePath: fileMeta.filePath,
          fileName: fileMeta.fileName,
          lineNumber,
        });

        for (const diag of parseResult.diagnostics) {
          yield { type: "diagnostic", diagnostic: diag };
        }

        if (parseResult.record) {
          yield { type: "record", record: parseResult.record };
        }

        if (linesRead >= maxLines) {
          break;
        }
      }
    } catch (readErr) {
      yield {
        type: "diagnostic",
        diagnostic: {
          severity: "error",
          code: "IO_ERROR",
          message: `Stream read error: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
          filePath: fileMeta.filePath,
          lineNumber: 0,
        },
      };
    } finally {
      if (rl) {
        rl.close();
      }
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    }
  }
}

/**
 * Reads all matching audit telemetry records and returns an aggregated result.
 */
export async function readTelemetryLog(
  options?: TelemetryReaderOptions,
): Promise<TelemetryReadResult> {
  const auditDir = resolveTargetAuditDir(options);
  const records: NormalizedTelemetryRecord[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let filesScanned: AuditFileMetadata[] = [];
  let totalLinesRead = 0;
  let malformedLineCount = 0;

  if (!auditDir) {
    diagnostics.push({
      severity: "warning",
      code: "IO_ERROR",
      message: "No valid audit directory found for workspace context.",
      filePath: options?.workspaceRoot ?? process.cwd(),
      lineNumber: 0,
    });
    return {
      records,
      diagnostics,
      filesScanned,
      totalLinesRead: 0,
      validRecordCount: 0,
      malformedLineCount: 0,
    };
  }

  // Single discovery call for the entire operation
  const discovery = discoverAuditFiles(auditDir, options?.includeRotated ?? false);
  filesScanned = discovery.files;

  // Stream using pre-discovered file snapshot, and count physical lines via onPhysicalLine
  const streamOptions: InternalTelemetryStreamOptions = {
    ...options,
    discovered: discovery,
    onPhysicalLine: (filePath, lineNumber) => {
      totalLinesRead++;
      options?.onPhysicalLine?.(filePath, lineNumber);
    },
  };

  for await (const item of readTelemetryStream(streamOptions)) {
    if (item.type === "record") {
      records.push(item.record);
    } else if (item.type === "diagnostic") {
      diagnostics.push(item.diagnostic);
      if (
        item.diagnostic.code === "INVALID_JSON" ||
        item.diagnostic.code === "UNSUPPORTED_VERSION"
      ) {
        malformedLineCount++;
      }
    }
  }

  return {
    records,
    diagnostics,
    filesScanned,
    totalLinesRead,
    validRecordCount: records.length,
    malformedLineCount,
  };
}
