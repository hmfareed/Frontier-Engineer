import crypto from "node:crypto";
import fs from "node:fs";
import type { HashState } from "./types.ts";

export interface StableReadResult {
  ok: boolean;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string | null;
  hashState: HashState;
  exclusionReason: string | null;
  buffer?: Buffer;
}

export interface StableReadOptions {
  maxFileSizeBytes?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  collectBufferForSecretScan?: boolean;
  maxSecretScanBytes?: number;
}

const DEFAULT_OPTIONS: Required<Omit<StableReadOptions, "signal">> = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxRetries: 3,
  collectBufferForSecretScan: true,
  maxSecretScanBytes: 512 * 1024, // 512 KB scan window for text secrets
};

const CHUNK_SIZE = 64 * 1024; // 64 KB streaming chunk

/**
 * Stable-read protocol: opens file descriptor, verifies fstat before and after
 * streaming chunks into SHA-256 to detect concurrent writes, and avoids whole-file memory spikes.
 */
export function stableReadFileAndHash(
  absPath: string,
  optionsOrMaxBytes: StableReadOptions | number = {},
  deprecatedRetries = 3,
): StableReadResult {
  const options: StableReadOptions =
    typeof optionsOrMaxBytes === "number"
      ? { maxFileSizeBytes: optionsOrMaxBytes, maxRetries: deprecatedRetries }
      : optionsOrMaxBytes;

  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_OPTIONS.maxFileSizeBytes;
  const maxRetries = options.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
  const collectBuffer =
    options.collectBufferForSecretScan ?? DEFAULT_OPTIONS.collectBufferForSecretScan;
  const maxSecretScanBytes = options.maxSecretScanBytes ?? DEFAULT_OPTIONS.maxSecretScanBytes;
  const signal = options.signal;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) {
      return {
        ok: false,
        sizeBytes: 0,
        mtimeMs: 0,
        contentHash: null,
        hashState: "ERROR",
        exclusionReason: "READ_CANCELLED_BY_SIGNAL",
      };
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(absPath, "r");
      const preStat = fs.fstatSync(fd);

      if (!preStat.isFile()) {
        fs.closeSync(fd);
        fd = null;
        return {
          ok: false,
          sizeBytes: preStat.size,
          mtimeMs: preStat.mtimeMs,
          contentHash: null,
          hashState: "ERROR",
          exclusionReason: "NOT_A_REGULAR_FILE",
        };
      }

      if (preStat.size > maxFileSizeBytes) {
        fs.closeSync(fd);
        fd = null;
        return {
          ok: false,
          sizeBytes: preStat.size,
          mtimeMs: preStat.mtimeMs,
          contentHash: null,
          hashState: "SKIPPED_LIMIT",
          exclusionReason: "FILE_SIZE_LIMIT_EXCEEDED",
        };
      }

      const hash = crypto.createHash("sha256");
      const chunk = Buffer.alloc(CHUNK_SIZE);
      const secretChunks: Buffer[] = [];
      let totalBytesRead = 0;

      while (totalBytesRead < preStat.size) {
        if (signal?.aborted) {
          fs.closeSync(fd);
          fd = null;
          return {
            ok: false,
            sizeBytes: preStat.size,
            mtimeMs: preStat.mtimeMs,
            contentHash: null,
            hashState: "ERROR",
            exclusionReason: "READ_CANCELLED_BY_SIGNAL",
          };
        }

        const bytesToRead = Math.min(CHUNK_SIZE, preStat.size - totalBytesRead);
        const bytesRead = fs.readSync(fd, chunk, 0, bytesToRead, totalBytesRead);
        if (bytesRead === 0) break;

        hash.update(chunk.subarray(0, bytesRead));

        if (collectBuffer && totalBytesRead < maxSecretScanBytes) {
          const sliceBytes = Math.min(bytesRead, maxSecretScanBytes - totalBytesRead);
          secretChunks.push(Buffer.from(chunk.subarray(0, sliceBytes)));
        }

        totalBytesRead += bytesRead;
      }

      const postStat = fs.fstatSync(fd);
      fs.closeSync(fd);
      fd = null;

      // Verify stability across streaming read: mtime, size, inode, device
      const isStable =
        preStat.mtimeMs === postStat.mtimeMs &&
        preStat.size === postStat.size &&
        preStat.ino === postStat.ino &&
        preStat.dev === postStat.dev &&
        totalBytesRead === preStat.size;

      if (isStable) {
        return {
          ok: true,
          sizeBytes: preStat.size,
          mtimeMs: preStat.mtimeMs,
          contentHash: hash.digest("hex"),
          hashState: "COMPUTED",
          exclusionReason: null,
          buffer: collectBuffer ? Buffer.concat(secretChunks) : undefined,
        };
      }

      // If stats differed, file was modified during read; sleep briefly before retry
      if (attempt < maxRetries - 1) {
        sleepMs(50 * (attempt + 1));
      }
    } catch (err) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      if (attempt === maxRetries - 1) {
        const error = err as NodeJS.ErrnoException;
        const reason =
          error.code === "ENOENT"
            ? "FILE_DISAPPEARED_DURING_READ"
            : error.code === "EACCES" || error.code === "EPERM"
              ? "READ_PERMISSION_DENIED"
              : `READ_ERROR: ${error.message}`;

        return {
          ok: false,
          sizeBytes: 0,
          mtimeMs: 0,
          contentHash: null,
          hashState: "ERROR",
          exclusionReason: reason,
        };
      }
      sleepMs(50 * (attempt + 1));
    }
  }

  return {
    ok: false,
    sizeBytes: 0,
    mtimeMs: 0,
    contentHash: null,
    hashState: "ERROR",
    exclusionReason: "UNSTABLE_CONCURRENT_MODIFICATION",
  };
}

function sleepMs(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // synchronous spin wait for short retry interval
  }
}
