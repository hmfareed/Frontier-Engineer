import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepository } from "../../scripts/scanner/repository-scanner.ts";

describe("repository-scanner (Traversal & Inventory)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces deterministic, canonically sorted file inventory", async () => {
    // Create nested tree
    fs.mkdirSync(path.join(tmpDir, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "src", "auth", "token.ts"), "export const token = 'jwt';");
    fs.writeFileSync(path.join(tmpDir, "src", "keyboard.ts"), "export const key = 'esc';");
    fs.writeFileSync(path.join(tmpDir, "docs", "README.md"), "# Documentation");
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");

    const result1 = await scanRepository(tmpDir);
    const result2 = await scanRepository(tmpDir);

    expect(result1.files.length).toBe(5);
    expect(result1.totalFilesScanned).toBe(5);

    // Verify canonical path sorting
    const paths1 = result1.files.map((f) => f.canonicalPath);
    const paths2 = result2.files.map((f) => f.canonicalPath);
    expect(paths1).toEqual(paths2);
    expect(paths1).toEqual([
      "docs/README.md",
      "package.json",
      "src/auth/token.ts",
      "src/index.ts",
      "src/keyboard.ts",
    ]);

    // Verify token.ts and keyboard.ts are INCLUDED as source
    const tokenRecord = result1.files.find((f) => f.canonicalPath === "src/auth/token.ts");
    expect(tokenRecord?.exclusionStatus).toBe("INCLUDED");
    expect(tokenRecord?.classification).toBe("source");
  });

  it("handles nested .gitignore and respects parent ignore pruning", async () => {
    fs.mkdirSync(path.join(tmpDir, "build"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "temp"), { recursive: true });

    // Root .gitignore
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "build/\n*.log\n");
    // Nested .gitignore
    fs.writeFileSync(path.join(tmpDir, "src", ".gitignore"), "temp/\n");

    fs.writeFileSync(path.join(tmpDir, "build", "output.js"), "console.log(1);");
    fs.writeFileSync(path.join(tmpDir, "src", "temp", "scratch.ts"), "const x = 1;");
    fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "console.log('app');");
    fs.writeFileSync(path.join(tmpDir, "error.log"), "error");

    const result = await scanRepository(tmpDir);
    const paths = result.files.map((f) => f.canonicalPath);

    expect(paths).toContain("src/app.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain("src/.gitignore");
    expect(paths).not.toContain("build/output.js");
    expect(paths).not.toContain("src/temp/scratch.ts");
    expect(paths).not.toContain("error.log");
  });

  it("correctly records sensitive file metadata without persisting secret content hashes", async () => {
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET_API_KEY=super_secret_value_12345");
    const pemHeader = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
    fs.writeFileSync(path.join(tmpDir, "id_rsa"), `${pemHeader}...`);
    fs.writeFileSync(path.join(tmpDir, ".env.example"), "DATABASE_URL=postgres://...\nPORT=3000\n");

    const result = await scanRepository(tmpDir);

    const envRecord = result.files.find((f) => f.canonicalPath === ".env");
    expect(envRecord).toBeDefined();
    expect(envRecord?.exclusionStatus).toBe("EXCLUDED_PATH");
    expect(envRecord?.exclusionReason).toBe("SENSITIVE_ENV_FILE");
    expect(envRecord?.contentHash).toBeNull();
    expect(envRecord?.hashState).toBe("SKIPPED_SENSITIVE");
    expect(envRecord?.sizeBytes).toBeGreaterThan(0); // Real size recorded

    const exampleRecord = result.files.find((f) => f.canonicalPath === ".env.example");
    expect(exampleRecord).toBeDefined();
    expect(exampleRecord?.exclusionStatus).toBe("INCLUDED");
    expect(exampleRecord?.extractedConfigKeys).toEqual(["DATABASE_URL", "PORT"]);
  });

  it("enforces max file limits gracefully", async () => {
    for (let i = 0; i < 15; i++) {
      fs.writeFileSync(path.join(tmpDir, `file_${i}.txt`), `Content ${i}`);
    }

    const result = await scanRepository(tmpDir, { limits: { maxFiles: 10 } });
    expect(result.limitExceeded).toBe(true);
    expect(result.limitReason).toBe("MAX_FILE_COUNT_EXCEEDED");
    expect(result.files.length).toBeLessThanOrEqual(10);
  });

  it("respects AbortSignal cancellation", async () => {
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(tmpDir, `doc_${i}.md`), `# Doc ${i}`);
    }

    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const result = await scanRepository(tmpDir, { signal: controller.signal });
    expect(result.limitExceeded).toBe(true);
    expect(result.limitReason).toBe("SCAN_CANCELLED_BY_SIGNAL");
  });

  it("verifies zero SQLite dependencies in scanner module", async () => {
    // Read the scanner source and verify node:sqlite is not imported
    const scannerSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "scanner", "repository-scanner.ts"),
      "utf8",
    );
    expect(scannerSource).not.toContain("node:sqlite");
    expect(scannerSource).not.toContain("DatabaseSync");
    expect(scannerSource).not.toContain("better-sqlite3");
  });
});
