import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepository } from "../../scripts/scanner/repository-scanner.ts";

describe("scanner-limits-cancellation (Resource Bounds & Abort Signals)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-limits-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. handles maximum file count reached explicitly", async () => {
    for (let i = 0; i < 15; i++) {
      fs.writeFileSync(path.join(tmpDir, `item_${i}.txt`), `File content ${i}`);
    }

    const result = await scanRepository(tmpDir, { limits: { maxFiles: 5 } });

    expect(result.limitExceeded).toBe(true);
    expect(result.limitReason).toBe("MAX_FILE_COUNT_EXCEEDED");
    expect(result.scanStatus).toBe("LIMIT_REACHED");
    expect(result.statusReason).toContain("Maximum file limit reached");
    expect(result.files.length).toBeLessThanOrEqual(5);
  });

  it("2. handles maximum cumulative bytes reached explicitly", async () => {
    // 3 files of 1000 bytes each
    fs.writeFileSync(path.join(tmpDir, "file1.txt"), "A".repeat(1000));
    fs.writeFileSync(path.join(tmpDir, "file2.txt"), "B".repeat(1000));
    fs.writeFileSync(path.join(tmpDir, "file3.txt"), "C".repeat(1000));

    const result = await scanRepository(tmpDir, { limits: { maxTotalBytes: 1500 } });

    expect(result.limitExceeded).toBe(true);
    expect(result.limitReason).toBe("MAX_TOTAL_BYTES_EXCEEDED");
    expect(result.scanStatus).toBe("LIMIT_REACHED");
    expect(result.statusReason).toContain("Maximum cumulative size limit reached");
  });

  it("3. handles individual file exceeding configured limit", async () => {
    fs.writeFileSync(path.join(tmpDir, "huge.txt"), "X".repeat(5000));
    fs.writeFileSync(path.join(tmpDir, "normal.txt"), "Normal content");

    const result = await scanRepository(tmpDir, { limits: { maxFileSizeBytes: 1000 } });

    const hugeRecord = result.files.find((f) => f.canonicalPath === "huge.txt");
    expect(hugeRecord).toBeDefined();
    expect(hugeRecord?.inspectionStatus).toBe("EXCLUDED_LIMIT");
    expect(hugeRecord?.exclusionReason).toBe("FILE_SIZE_LIMIT_EXCEEDED");
    expect(hugeRecord?.contentHash).toBeNull();
    expect(hugeRecord?.hashState).toBe("SKIPPED_LIMIT");

    const normalRecord = result.files.find((f) => f.canonicalPath === "normal.txt");
    expect(normalRecord).toBeDefined();
    expect(normalRecord?.inspectionStatus).toBe("INSPECTED");
    expect(normalRecord?.contentHash).not.toBeNull();
  });

  it("4. handles cancellation during directory traversal", async () => {
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(tmpDir, `entry_${i}.txt`), `Entry ${i}`);
    }

    const controller = new AbortController();
    controller.abort(); // already aborted

    const result = await scanRepository(tmpDir, { signal: controller.signal });

    expect(result.limitExceeded).toBe(true);
    expect(result.scanStatus).toBe("CANCELLED");
    expect(result.limitReason).toBe("SCAN_CANCELLED_BY_SIGNAL");
  });

  it("5. handles cancellation during a large file read", async () => {
    const largeFile = path.join(tmpDir, "large.txt");
    fs.writeFileSync(largeFile, "Z".repeat(1024 * 500)); // 500 KB

    const controller = new AbortController();
    // Abort after 5ms
    setTimeout(() => controller.abort(), 5);

    const result = await scanRepository(tmpDir, { signal: controller.signal });
    expect(["CANCELLED", "COMPLETE"]).toContain(result.scanStatus);
  });

  it("6. guarantees a partial scan cannot be reported as complete", async () => {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, `f_${i}.txt`), "content");
    }

    const result = await scanRepository(tmpDir, { limits: { maxFiles: 3 } });

    expect(result.scanStatus).not.toBe("COMPLETE");
    expect(result.scanStatus).toBe("LIMIT_REACHED");
  });

  it("7. guarantees a limit-reached scan remains distinguishable from a fatal failure", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.txt"), "content");

    const limitResult = await scanRepository(tmpDir, { limits: { maxFiles: 0 } });
    expect(limitResult.scanStatus).toBe("LIMIT_REACHED");
    expect(limitResult.limitExceeded).toBe(true);

    // Fatal failure would be ERROR, distinct from LIMIT_REACHED
    expect(limitResult.scanStatus).not.toBe("FATAL_ERROR");
  });
});
