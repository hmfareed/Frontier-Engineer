import fs from "node:fs";
import path from "node:path";
import { classifyFile } from "./file-classifier.ts";
import { IgnoreStack } from "./ignore-evaluator.ts";
import {
  evaluateSensitivePath,
  extractConfigKeysOnly,
  scanBufferForSecrets,
} from "./sensitive-filter.ts";
import { stableReadFileAndHash } from "./stable-hasher.ts";
import type {
  FileInventoryResult,
  InventorySummary,
  ScanLimits,
  ScanOptions,
  ScanStatus,
  ScannedFileRecord,
} from "./types.ts";

const DEFAULT_LIMITS: Required<ScanLimits> = {
  maxFiles: 50000,
  maxTotalBytes: 500 * 1024 * 1024, // 500 MB
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB per file
};

/**
 * Frontier Canonical Path Comparator.
 *
 * Collation Policy: Deterministic UTF-16 code-unit lexicographical ordering.
 *
 * Exact Semantics:
 * 1. Strings are compared element-by-element using standard JavaScript relational operators (`<`, `>`).
 * 2. Each element comparison operates on sequential 16-bit UTF-16 code units (0x0000..0xFFFF).
 * 3. For Basic Multilingual Plane (BMP) characters (U+0000..U+FFFF), UTF-16 code-unit numerical
 *    order directly matches Unicode code-point numerical order.
 * 4. For supplementary Unicode characters (U+10000..U+10FFFF), characters are encoded as UTF-16
 *    surrogate pairs: a high surrogate (0xD800..0xDBFF) followed by a low surrogate (0xDC00..0xDFFF).
 *    Under UTF-16 code-unit collation, surrogate code units (0xD800..0xDFFF) sort before BMP
 *    characters in the range U+E000..U+FFFF (such as Private Use Area and CJK Compatibility ideographs).
 * 5. Equality: Returns 0 if and only if string `a` is identical in length and code units to string `b`.
 * 6. Mathematical guarantees: Establishes a strict weak ordering satisfying irreflexivity (a < a is false),
 *    antisymmetry (sign(cmp(a, b)) === -sign(cmp(b, a))), and transitivity (a < b && b < c => a < c).
 * 7. Platform independence: The comparator is pure, deterministic, and locale-independent across
 *    Windows, Linux, and macOS runtimes, avoiding the locale-dependent instability of `localeCompare()`.
 *
 * Contract Boundary:
 * Frontier Engineer defines its own canonical inventory path ordering contract.
 * This collation is NOT equivalent to Git tree ordering (which appends an implicit trailing '/' to directory
 * entries during tree comparison) or SQLite's default binary collation across supplementary Unicode characters.
 * No Git runtime dependency or external collator is required.
 */
export function compareCanonicalPaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Traverses a repository root directory, applies nested ignores, excludes sensitive files,
 * hashes content stably, classifies files, and produces a deterministic FileInventoryResult.
 */
export async function scanRepository(
  workspaceRoot: string,
  options: ScanOptions = {},
): Promise<FileInventoryResult> {
  const startTime = Date.now();
  const normalizedRoot = path.resolve(workspaceRoot);
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const signal = options.signal;

  const records: ScannedFileRecord[] = [];
  let totalBytesDiscovered = 0;
  let totalBytesInspected = 0;
  let totalFilesDiscovered = 0;
  let unreadableCount = 0;

  let limitExceeded = false;
  let limitReason: string | undefined;
  let scanStatus: ScanStatus = "COMPLETE";
  let statusReason: string | undefined;

  const ignoreStack = new IgnoreStack();
  const visitedRealDirs = new Set<string>();
  const activeAncestors = new Set<string>();
  const visitedRealFiles = new Set<string>();

  try {
    const rootReal = fs.realpathSync(normalizedRoot);
    visitedRealDirs.add(rootReal.toLowerCase());
    activeAncestors.add(rootReal.toLowerCase());
  } catch {
    visitedRealDirs.add(normalizedRoot.toLowerCase());
    activeAncestors.add(normalizedRoot.toLowerCase());
  }

  function walk(currentDir: string): void {
    if (limitExceeded) return;

    if (signal?.aborted) {
      limitExceeded = true;
      limitReason = "SCAN_CANCELLED_BY_SIGNAL";
      scanStatus = "CANCELLED";
      statusReason = "Scan was cancelled by AbortSignal";
      return;
    }

    const relDir = path.relative(normalizedRoot, currentDir).replace(/\\/g, "/");

    // Check if current directory itself is hard excluded or ignored
    if (
      relDir !== "" &&
      (ignoreStack.isHardExcluded(relDir) || ignoreStack.isIgnored(relDir, true))
    ) {
      return;
    }

    // Check if this directory contains a .gitignore
    const gitignorePath = path.join(currentDir, ".gitignore");
    let pushedScope = false;
    if (fs.existsSync(gitignorePath)) {
      try {
        const lines = fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/);
        ignoreStack.pushScope(relDir, lines);
        pushedScope = true;
      } catch {
        // ignore read failure
      }
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      if (pushedScope) ignoreStack.popScope();
      unreadableCount++;
      if (scanStatus === "COMPLETE") {
        scanStatus = "PARTIAL_WITH_ERRORS";
        statusReason = `Directory unreadable: ${relDir} (${(err as Error).message})`;
      }
      return;
    }

    // Sort directory entries deterministically using locale-independent binary comparison
    entries.sort((a, b) => compareCanonicalPaths(a.name, b.name));

    for (const entry of entries) {
      if (limitExceeded) break;
      if (signal?.aborted) {
        limitExceeded = true;
        limitReason = "SCAN_CANCELLED_BY_SIGNAL";
        scanStatus = "CANCELLED";
        statusReason = "Scan was cancelled by AbortSignal";
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(normalizedRoot, fullPath).replace(/\\/g, "/");

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      let symlinkTargetRel: string | undefined;

      // Verify symlink containment and cycle detection
      if (entry.isSymbolicLink()) {
        let realTarget: string;
        try {
          realTarget = fs.realpathSync(fullPath);
        } catch {
          // Broken symlink
          totalFilesDiscovered++;
          unreadableCount++;
          records.push({
            canonicalPath: relPath,
            fileExtension: path.extname(entry.name).toLowerCase(),
            classification: "unknown",
            sizeBytes: 0,
            mtimeMs: 0,
            contentHash: null,
            hashState: "ERROR",
            inspectionStatus: "UNREADABLE",
            exclusionStatus: "EXCLUDED_PATH",
            exclusionReason: "BROKEN_SYMLINK",
          });
          continue;
        }

        const realLower = realTarget.toLowerCase();
        const rootLower = normalizedRoot.toLowerCase();

        // Check if symlink target points outside workspace root
        if (
          !realLower.startsWith(rootLower) ||
          (realLower.length > rootLower.length &&
            realTarget[rootLower.length] !== "\\" &&
            realTarget[rootLower.length] !== "/")
        ) {
          totalFilesDiscovered++;
          records.push({
            canonicalPath: relPath,
            fileExtension: path.extname(entry.name).toLowerCase(),
            classification: "unknown",
            sizeBytes: 0,
            mtimeMs: 0,
            contentHash: null,
            hashState: "ERROR",
            inspectionStatus: "EXTERNAL_SYMLINK_EXCLUDED",
            exclusionStatus: "EXTERNAL_SYMLINK_EXCLUDED",
            exclusionReason: "TARGET_OUTSIDE_WORKSPACE_ROOT",
          });
          continue;
        }

        symlinkTargetRel = path.relative(normalizedRoot, realTarget).replace(/\\/g, "/");

        // Symlink points inside workspace: determine if target is file or directory
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          isDirectory = true;
          // Cycle detection for directory symlinks
          if (activeAncestors.has(realLower)) {
            totalFilesDiscovered++;
            records.push({
              canonicalPath: relPath,
              fileExtension: "",
              classification: "unknown",
              sizeBytes: 0,
              mtimeMs: stat.mtimeMs,
              contentHash: null,
              hashState: "ERROR",
              inspectionStatus: "UNREADABLE",
              exclusionStatus: "EXTERNAL_SYMLINK_EXCLUDED",
              exclusionReason: "SYMLINK_LOOP_DETECTED",
              symlinkTarget: symlinkTargetRel,
            });
            continue;
          }

          // If target directory was already visited elsewhere in repo: avoid duplicate traversal
          if (visitedRealDirs.has(realLower)) {
            totalFilesDiscovered++;
            records.push({
              canonicalPath: relPath,
              fileExtension: "",
              classification: "unknown",
              sizeBytes: 0,
              mtimeMs: stat.mtimeMs,
              contentHash: null,
              hashState: "SKIPPED_BINARY",
              inspectionStatus: "UNREADABLE",
              exclusionStatus: "EXTERNAL_SYMLINK_EXCLUDED",
              exclusionReason: "DUPLICATE_DIRECTORY_ALIAS",
              symlinkTarget: symlinkTargetRel,
            });
            continue;
          }

          visitedRealDirs.add(realLower);
          activeAncestors.add(realLower);
          walk(fullPath);
          activeAncestors.delete(realLower);
          continue;
        } else if (stat.isFile()) {
          isFile = true;
        }
      }

      if (isDirectory) {
        // Prune ignored directories
        if (ignoreStack.isHardExcluded(relPath) || ignoreStack.isIgnored(relPath, true)) {
          continue;
        }

        let realDir = fullPath;
        try {
          realDir = fs.realpathSync(fullPath);
        } catch {
          // ignore
        }
        const dirKey = realDir.toLowerCase();
        if (activeAncestors.has(dirKey)) {
          continue; // Prevent recursive loops
        }

        visitedRealDirs.add(dirKey);
        activeAncestors.add(dirKey);
        walk(fullPath);
        activeAncestors.delete(dirKey);
      } else if (isFile) {
        totalFilesDiscovered++;

        // Check limits before reading file
        if (records.length >= limits.maxFiles) {
          limitExceeded = true;
          limitReason = "MAX_FILE_COUNT_EXCEEDED";
          scanStatus = "LIMIT_REACHED";
          statusReason = `Maximum file limit reached (${limits.maxFiles} files)`;
          break;
        }
        if (totalBytesDiscovered >= limits.maxTotalBytes) {
          limitExceeded = true;
          limitReason = "MAX_TOTAL_BYTES_EXCEEDED";
          scanStatus = "LIMIT_REACHED";
          statusReason = `Maximum cumulative size limit reached (${limits.maxTotalBytes} bytes)`;
          break;
        }

        // Check if file is ignored by .gitignore
        if (ignoreStack.isIgnored(relPath, false)) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        const classification = classifyFile(relPath);
        const sensitiveCheck = evaluateSensitivePath(relPath);

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          // File disappeared between directory entry and stat (TOCTOU)
          unreadableCount++;
          records.push({
            canonicalPath: relPath,
            fileExtension: ext,
            classification,
            sizeBytes: 0,
            mtimeMs: 0,
            contentHash: null,
            hashState: "ERROR",
            inspectionStatus: "UNREADABLE",
            exclusionStatus: "UNREADABLE",
            exclusionReason: "FILE_DISAPPEARED_DURING_SCAN",
            symlinkTarget: symlinkTargetRel,
          });
          continue;
        }

        totalBytesDiscovered += stat.size;

        // Path-based sensitive exclusion
        if (sensitiveCheck.isSensitive) {
          records.push({
            canonicalPath: relPath,
            fileExtension: ext,
            classification: "sensitive",
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            contentHash: null,
            hashState: "SKIPPED_SENSITIVE",
            inspectionStatus: "EXCLUDED_PATH",
            exclusionStatus: "EXCLUDED_PATH",
            exclusionReason: sensitiveCheck.reason ?? "SENSITIVE_FILE",
            symlinkTarget: symlinkTargetRel,
          });
          continue;
        }

        // Allowed environment example / template: extract keys only
        const fileName = path.basename(relPath);
        let extractedConfigKeys: string[] | undefined;
        if (/^\.env\.(example|sample|template)$/i.test(fileName)) {
          try {
            const rawContent = fs.readFileSync(fullPath, "utf8");
            extractedConfigKeys = extractConfigKeysOnly(rawContent);
          } catch {
            // ignore
          }
        }

        // Binary files: skip hashing to conserve CPU/memory
        if (classification === "binary") {
          records.push({
            canonicalPath: relPath,
            fileExtension: ext,
            classification: "binary",
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            contentHash: null,
            hashState: "SKIPPED_BINARY",
            inspectionStatus: "INSPECTED",
            exclusionStatus: "INCLUDED",
            exclusionReason: null,
            symlinkTarget: symlinkTargetRel,
          });
          continue;
        }

        // Source, documentation, configuration, asset: stable read and hash
        const stableResult = stableReadFileAndHash(fullPath, {
          maxFileSizeBytes: limits.maxFileSizeBytes,
          signal,
          collectBufferForSecretScan: true,
        });

        if (!stableResult.ok) {
          const isUnstable = stableResult.exclusionReason === "UNSTABLE_CONCURRENT_MODIFICATION";
          const isLimit = stableResult.exclusionReason === "FILE_SIZE_LIMIT_EXCEEDED";
          const isCancelled = stableResult.exclusionReason === "READ_CANCELLED_BY_SIGNAL";

          if (isCancelled) {
            limitExceeded = true;
            limitReason = "SCAN_CANCELLED_BY_SIGNAL";
            scanStatus = "CANCELLED";
            statusReason = "Scan was cancelled during file read";
            break;
          }

          if (isUnstable) unreadableCount++;

          records.push({
            canonicalPath: relPath,
            fileExtension: ext,
            classification,
            sizeBytes: stableResult.sizeBytes,
            mtimeMs: stableResult.mtimeMs,
            contentHash: null,
            hashState: stableResult.hashState,
            inspectionStatus: isUnstable ? "UNSTABLE" : isLimit ? "EXCLUDED_LIMIT" : "UNREADABLE",
            exclusionStatus: isLimit ? "EXCLUDED_LIMIT" : "UNREADABLE",
            exclusionReason: stableResult.exclusionReason,
            symlinkTarget: symlinkTargetRel,
          });
          continue;
        }

        // Content-based secret detection on read buffer
        if (stableResult.buffer) {
          const secretCheck = scanBufferForSecrets(stableResult.buffer);
          if (secretCheck.detected) {
            records.push({
              canonicalPath: relPath,
              fileExtension: ext,
              classification: "sensitive",
              sizeBytes: stableResult.sizeBytes,
              mtimeMs: stableResult.mtimeMs,
              contentHash: null,
              hashState: "SKIPPED_SENSITIVE",
              inspectionStatus: "EXCLUDED_CONTENT",
              exclusionStatus: "EXCLUDED_CONTENT",
              exclusionReason: "DETECTED_SECRET",
              symlinkTarget: symlinkTargetRel,
            });
            continue;
          }
        }

        // Clean file successfully hashed
        totalBytesInspected += stableResult.sizeBytes;
        records.push({
          canonicalPath: relPath,
          fileExtension: ext,
          classification,
          sizeBytes: stableResult.sizeBytes,
          mtimeMs: stableResult.mtimeMs,
          contentHash: stableResult.contentHash,
          hashState: stableResult.hashState,
          inspectionStatus: "INSPECTED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
          extractedConfigKeys,
          symlinkTarget: symlinkTargetRel,
        });

        if (options.onProgress) {
          options.onProgress(records.length, relPath);
        }
      }
    }

    if (pushedScope) {
      ignoreStack.popScope();
    }
  }

  walk(normalizedRoot);

  // Sort records deterministically using locale-independent binary comparison
  records.sort((a, b) => compareCanonicalPaths(a.canonicalPath, b.canonicalPath));

  const inspectedCount = records.filter((r) => r.inspectionStatus === "INSPECTED").length;
  const excludedCount = records.filter((r) => r.inspectionStatus !== "INSPECTED").length;

  const summary: InventorySummary = {
    totalFilesDiscovered,
    totalFilesInspected: inspectedCount,
    totalFilesExcluded: excludedCount,
    totalFilesUnreadable: unreadableCount,
    totalBytesDiscovered,
    totalBytesInspected,
  };

  if (!limitExceeded && unreadableCount > 0 && scanStatus === "COMPLETE") {
    scanStatus = "PARTIAL_WITH_ERRORS";
    statusReason = `${unreadableCount} files or directories could not be read`;
  }

  return {
    workspaceRoot: normalizedRoot,
    scannedAt: new Date().toISOString(),
    scanStatus,
    statusReason,
    files: records,
    summary,
    totalFilesScanned: records.length,
    totalBytesScanned: totalBytesInspected,
    limitExceeded,
    limitReason,
    scanDurationMs: Date.now() - startTime,
  };
}
