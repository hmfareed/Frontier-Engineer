import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareCanonicalPaths, scanRepository } from "../../scripts/scanner/repository-scanner.ts";

describe("scanner-contract (Deterministic UTF-16 Code-Unit Ordering & Inventory Contract)", () => {
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

  it("2. orders uppercase and lowercase filenames strictly by UTF-16 code unit", () => {
    const list = ["b.ts", "A.ts", "z.ts", "B.ts", "a.ts", "Z.ts"];
    list.sort(compareCanonicalPaths);

    // In UTF-16 code units:
    // 'A' (65) < 'B' (66) < 'Z' (90) < 'a' (97) < 'b' (98) < 'z' (122)
    expect(list).toEqual(["A.ts", "B.ts", "Z.ts", "a.ts", "b.ts", "z.ts"]);
  });

  it("3. orders numeric filename segments lexicographically by code unit", () => {
    const list = ["20.ts", "1.ts", "100.ts", "0.ts", "10.ts", "2.ts"];
    list.sort(compareCanonicalPaths);

    // Lexicographical ordering: '0' (48), '1' (49), '2' (50)
    // '.' is 46, so '1.ts' has '.' at index 1 (46) < '0' (48) in '10.ts'
    // '10.ts' has '.' at index 2 (46) < '0' (48) in '100.ts'
    expect(list).toEqual(["0.ts", "1.ts", "10.ts", "100.ts", "2.ts", "20.ts"]);
  });

  it("4. orders accented Latin characters after ASCII in code-unit sequence", () => {
    const list = ["élan.ts", "apple.ts", "über.ts", "zebra.ts", "café.ts"];
    list.sort(compareCanonicalPaths);

    // 'a' (97) < 'c' (99) < 'z' (122) < 'é' (233) < 'ü' (252)
    expect(list).toEqual(["apple.ts", "café.ts", "zebra.ts", "élan.ts", "über.ts"]);
  });

  it("5. orders supplementary Unicode characters via UTF-16 surrogate pairs", () => {
    // Supplementary characters (U+10000..U+10FFFF) use surrogate pairs (0xD800..0xDFFF).
    // In UTF-16 code-unit order:
    // - ASCII 'z' = 122
    // - U+1D400 (𝐀) = \uD835\uDC00 (high surrogate 55349)
    // - U+1F600 (😀) = \uD83D\uDE00 (high surrogate 55357, low surrogate 56832)
    // - U+1F680 (🚀) = \uD83D\uDE80 (high surrogate 55357, low surrogate 56960)
    // - BMP Private Use Area \uE000 = 57344 (surrogates 0xD800..0xDFFF sort BEFORE U+E000)
    const list = ["\uE000.ts", "🚀.ts", "z.ts", "😀.ts", "𝐀.ts"];
    list.sort(compareCanonicalPaths);

    expect(list).toEqual(["z.ts", "𝐀.ts", "😀.ts", "🚀.ts", "\uE000.ts"]);

    // Compare two supplementary characters sharing identical high surrogate (0xD83D)
    expect(compareCanonicalPaths("😀.ts", "🚀.ts")).toBe(-1); // low surrogate 0xDE00 < 0xDE80
    expect(compareCanonicalPaths("🚀.ts", "😀.ts")).toBe(1);
  });

  it("6. orders Japanese and diverse non-Latin scripts deterministically", () => {
    const list = ["日本語.ts", "file.ts", "あ.ts", "ملف.ts", "ファイル.ts", "файл.ts"];
    list.sort(compareCanonicalPaths);

    // In UTF-16 code units:
    // 'file.ts' (ASCII 'f' = 102)
    // 'файл.ts' (Cyrillic 'ф' = 1092)
    // 'ملف.ts' (Arabic 'م' = 1605)
    // 'あ.ts' (Hiragana 'あ' = 12354)
    // 'ファイル.ts' (Katakana 'フ' = 12501)
    // '日本語.ts' (Kanji '日' = 26085)
    expect(list).toEqual(["file.ts", "файл.ts", "ملف.ts", "あ.ts", "ファイル.ts", "日本語.ts"]);
  });

  it("7. handles nested paths and directory separators with exact ordinal slash collation", () => {
    const paths = ["a/b/c.ts", "a-b.ts", "a/b.ts", "a/z.ts", "a.ts", "src-old/a.ts", "src/a.ts"];
    paths.sort(compareCanonicalPaths);

    // In ASCII/UTF-16: '-' (45) < '.' (46) < '/' (47)
    // Therefore 'a-b.ts' < 'a.ts' < 'a/b.ts'
    // And 'src-old/a.ts' ('-' at index 3 is 45) < 'src/a.ts' ('/' at index 3 is 47)
    expect(paths).toEqual([
      "a-b.ts",
      "a.ts",
      "a/b.ts",
      "a/b/c.ts",
      "a/z.ts",
      "src-old/a.ts",
      "src/a.ts",
    ]);
  });

  it("8. returns zero for identical paths", () => {
    expect(compareCanonicalPaths("", "")).toBe(0);
    expect(compareCanonicalPaths("src/app.ts", "src/app.ts")).toBe(0);
    expect(compareCanonicalPaths("nested/deep/file.ts", "nested/deep/file.ts")).toBe(0);
    expect(compareCanonicalPaths("😀.ts", "😀.ts")).toBe(0);
    expect(compareCanonicalPaths("日本語/ファイル.ts", "日本語/ファイル.ts")).toBe(0);
  });

  it("9. satisfies antisymmetry across varied path pairs", () => {
    const samplePaths = [
      "0.ts",
      "A.ts",
      "Z.ts",
      "a.ts",
      "a-b.ts",
      "a/b.ts",
      "café.ts",
      "élan.ts",
      "😀.ts",
      "\uE000.ts",
      "ファイル.ts",
    ];

    for (const a of samplePaths) {
      for (const b of samplePaths) {
        const cmpAB = compareCanonicalPaths(a, b);
        const cmpBA = compareCanonicalPaths(b, a);

        if (a === b) {
          expect(cmpAB).toBe(0);
          expect(cmpBA).toBe(0);
        } else {
          expect(Math.sign(cmpAB)).toBe(-Math.sign(cmpBA));
        }
      }
    }
  });

  it("10. satisfies transitivity across representative path triples", () => {
    const sample = [
      "0.ts",
      "A.ts",
      "Z.ts",
      "a.ts",
      "a-b.ts",
      "a/b.ts",
      "café.ts",
      "élan.ts",
      "😀.ts",
      "\uE000.ts",
      "ファイル.ts",
    ];

    // Mathematical transitivity: if cmp(a, b) < 0 and cmp(b, c) < 0, then cmp(a, c) must be < 0
    for (const a of sample) {
      for (const b of sample) {
        for (const c of sample) {
          if (compareCanonicalPaths(a, b) < 0 && compareCanonicalPaths(b, c) < 0) {
            expect(compareCanonicalPaths(a, c)).toBe(-1);
          }
        }
      }
    }
  });

  it("11. produces identical ordering across multiple consecutive scans", async () => {
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
