import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareCanonicalPaths, scanRepository } from "../../scripts/scanner/repository-scanner.ts";

describe("scanner-contract (Deterministic Ordering & Collation)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-ordering-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. reconciles summary counts with file records exactly", async () => {
    fs.writeFileSync(path.join(tmpDir, "app.ts"), "console.log('app');");
    fs.writeFileSync(path.join(tmpDir, "utils.ts"), "export const x = 10;");
    fs.writeFileSync(path.join(tmpDir, ".env"), "API_KEY=secret");
    fs.writeFileSync(path.join(tmpDir, "data.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));

    const result = await scanRepository(tmpDir);

    expect(result.scanStatus).toBe("COMPLETE");
    expect(result.summary).toBeDefined();

    const inspectedRecords = result.files.filter((f) => f.inspectionStatus === "INSPECTED");
    const excludedRecords = result.files.filter((f) => f.inspectionStatus !== "INSPECTED");

    expect(result.summary.totalFilesInspected).toBe(inspectedRecords.length);
    expect(result.summary.totalFilesExcluded).toBe(excludedRecords.length);
    expect(result.summary.totalFilesDiscovered).toBe(result.files.length);

    const expectedBytesInspected = inspectedRecords
      .filter((r) => r.classification !== "binary")
      .reduce((sum, r) => sum + r.sizeBytes, 0);
    expect(result.summary.totalBytesInspected).toBe(expectedBytesInspected);
  });

  it("2. enforces binary code-point ordering across uppercase, lowercase, and numeric segments", () => {
    const list = ["b.ts", "A.ts", "10_numeric.ts", "a.ts", "2_numeric.ts", "B.ts", "1_numeric.ts"];
    list.sort(compareCanonicalPaths);

    // In ASCII/Unicode binary code points:
    // '1' (49) < '2' (50) < 'A' (65) < 'B' (66) < 'a' (97) < 'b' (98)
    expect(list).toEqual([
      "10_numeric.ts",
      "1_numeric.ts",
      "2_numeric.ts",
      "A.ts",
      "B.ts",
      "a.ts",
      "b.ts",
    ]);
  });

  it("3. handles unicode filenames deterministically", () => {
    const unicodeList = [
      "zebra.ts",
      "apple.ts",
      "über.ts",
      "étoile.md",
      "résumé.md",
      "ファイル.ts",
    ];
    unicodeList.sort(compareCanonicalPaths);

    const copy = [...unicodeList].sort(compareCanonicalPaths);
    expect(unicodeList).toEqual(copy);

    // ASCII characters: 'a' (97), 'r' (114), 'z' (122)
    // Non-ASCII Latin-1 supplement: 'é' (233), 'ü' (252)
    // CJK: 'フ' (12501)
    expect(unicodeList).toEqual([
      "apple.ts",
      "résumé.md",
      "zebra.ts",
      "étoile.md",
      "über.ts",
      "ファイル.ts",
    ]);
  });

  it("4. handles nested paths with exact ordinal slash collation", () => {
    const paths = ["a/b/c.ts", "a-b.ts", "a/b.ts", "a/z.ts", "a.ts"];
    paths.sort(compareCanonicalPaths);

    // '/' is 47, '-' is 45, '.' is 46
    // '-' (45) < '.' (46) < '/' (47)
    expect(paths).toEqual(["a-b.ts", "a.ts", "a/b.ts", "a/b/c.ts", "a/z.ts"]);
  });

  it("5. produces identical ordering across multiple consecutive scans", async () => {
    // Use distinct casing characters to ensure compatibility across case-insensitive (NTFS/APFS) and case-sensitive (ext4) filesystems
    const files = ["Z.ts", "b.ts", "A.ts", "1.ts", "nested/c.ts", "nested/B.ts"];
    fs.mkdirSync(path.join(tmpDir, "nested"));
    for (const f of files) {
      fs.writeFileSync(path.join(tmpDir, f), `// ${f}`);
    }

    const run1 = await scanRepository(tmpDir);
    const run2 = await scanRepository(tmpDir);
    const run3 = await scanRepository(tmpDir);

    const paths1 = run1.files.map((f) => f.canonicalPath);
    const paths2 = run2.files.map((f) => f.canonicalPath);
    const paths3 = run3.files.map((f) => f.canonicalPath);

    expect(paths1).toEqual(paths2);
    expect(paths2).toEqual(paths3);
    expect(paths1).toEqual(["1.ts", "A.ts", "Z.ts", "b.ts", "nested/B.ts", "nested/c.ts"]);
  });
});
