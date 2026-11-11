import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluateSensitivePath,
  extractConfigKeysOnly,
  scanBufferForSecrets,
} from "../../scripts/scanner/sensitive-filter.ts";
import { scanRepository } from "../../scripts/scanner/repository-scanner.ts";

describe("sensitive-filter & Secret-Bearing Content Verification", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-sec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Path exclusions", () => {
    it("excludes .env and environment variants", () => {
      expect(evaluateSensitivePath(".env").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".env.local").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".env.production").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".env.production.local").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".env.development.local").isSensitive).toBe(true);
      expect(evaluateSensitivePath("config/.env.test").isSensitive).toBe(true);
    });

    it("excludes private keys and credential stores", () => {
      expect(evaluateSensitivePath("id_rsa").isSensitive).toBe(true);
      expect(evaluateSensitivePath("id_ed25519").isSensitive).toBe(true);
      expect(evaluateSensitivePath("server.pem").isSensitive).toBe(true);
      expect(evaluateSensitivePath("auth.key").isSensitive).toBe(true);
      expect(evaluateSensitivePath("cert.p12").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".ssh/config").isSensitive).toBe(true);
      expect(evaluateSensitivePath(".aws/credentials").isSensitive).toBe(true);
    });

    it("explicitly allows ordinary source files containing 'key' or 'token'", () => {
      expect(evaluateSensitivePath("src/keyboard.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/tokenizer.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/token.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/token-bucket.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/key-value-store.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/hotkeys.ts").isSensitive).toBe(false);
      expect(evaluateSensitivePath("src/authorization.ts").isSensitive).toBe(false);
    });

    it("explicitly allows .env.example, .env.sample, and .env.template", () => {
      expect(evaluateSensitivePath(".env.example").isSensitive).toBe(false);
      expect(evaluateSensitivePath(".env.sample").isSensitive).toBe(false);
      expect(evaluateSensitivePath(".env.template").isSensitive).toBe(false);
      expect(evaluateSensitivePath("config/.env.example").isSensitive).toBe(false);
    });
  });

  describe("End-to-End Secret Ingestion & Inventory Security", () => {
    it("1. excludes source file containing realistic GitHub-style synthetic credential", async () => {
      const filePath = path.join(tmpDir, "github-client.ts");
      const secret = "ghp_" + "A".repeat(36);
      fs.writeFileSync(filePath, `export const token = "${secret}";`, "utf8");

      const result = await scanRepository(tmpDir);
      const record = result.files.find((f) => f.canonicalPath === "github-client.ts");

      expect(record).toBeDefined();
      expect(record?.inspectionStatus).toBe("EXCLUDED_CONTENT");
      expect(record?.exclusionReason).toBe("DETECTED_SECRET");
      expect(record?.classification).toBe("sensitive");
      expect(record?.contentHash).toBeNull();
      expect(record?.hashState).toBe("SKIPPED_SENSITIVE");
    });

    it("2. excludes source file containing realistic AWS credential pattern", async () => {
      const filePath = path.join(tmpDir, "s3-uploader.ts");
      const secret = "AKIA" + "0123456789ABCDEF";
      fs.writeFileSync(filePath, `const awsKey = "${secret}";`, "utf8");

      const result = await scanRepository(tmpDir);
      const record = result.files.find((f) => f.canonicalPath === "s3-uploader.ts");

      expect(record).toBeDefined();
      expect(record?.inspectionStatus).toBe("EXCLUDED_CONTENT");
      expect(record?.exclusionReason).toBe("DETECTED_SECRET");
      expect(record?.contentHash).toBeNull();
      expect(record?.hashState).toBe("SKIPPED_SENSITIVE");
    });

    it("3. excludes source file containing embedded private-key block", async () => {
      const filePath = path.join(tmpDir, "crypto-keys.ts");
      const header = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
      const footer = ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
      fs.writeFileSync(filePath, `const key = \`${header}\\nMIIE...\\n${footer}\`;`, "utf8");

      const result = await scanRepository(tmpDir);
      const record = result.files.find((f) => f.canonicalPath === "crypto-keys.ts");

      expect(record).toBeDefined();
      expect(record?.inspectionStatus).toBe("EXCLUDED_CONTENT");
      expect(record?.exclusionReason).toBe("DETECTED_SECRET");
      expect(record?.contentHash).toBeNull();
    });

    it("4. inspects normal source file containing harmless token-related identifiers", async () => {
      const filePath = path.join(tmpDir, "tokenizer.ts");
      const content = `
export class Tokenizer {
  private token: string = "";
  public authToken(): string { return this.token; }
  public handleKeyboardEvent(): void {}
}
`;
      fs.writeFileSync(filePath, content, "utf8");

      const result = await scanRepository(tmpDir);
      const record = result.files.find((f) => f.canonicalPath === "tokenizer.ts");

      expect(record).toBeDefined();
      expect(record?.inspectionStatus).toBe("INSPECTED");
      expect(record?.classification).toBe("source");
      expect(record?.contentHash).not.toBeNull();
      expect(record?.hashState).toBe("COMPUTED");
      expect(record?.exclusionReason).toBeNull();
    });

    it("5. extracts keys only from .env.example, never placeholder values", async () => {
      const filePath = path.join(tmpDir, ".env.example");
      fs.writeFileSync(
        filePath,
        `
DATABASE_URL=postgres://user:pass@localhost:5432/db
PORT=8080
API_SECRET=placeholder_secret_value
`,
        "utf8",
      );

      const result = await scanRepository(tmpDir);
      const record = result.files.find((f) => f.canonicalPath === ".env.example");

      expect(record).toBeDefined();
      expect(record?.inspectionStatus).toBe("INSPECTED");
      expect(record?.extractedConfigKeys).toEqual(["DATABASE_URL", "PORT", "API_SECRET"]);
      expect(record?.extractedConfigKeys).not.toContain("postgres://user:pass@localhost:5432/db");
      expect(record?.extractedConfigKeys).not.toContain("placeholder_secret_value");
    });

    it("6. confirms sensitive files have no persisted original-content hash", async () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "REAL_SECRET=12345");
      fs.writeFileSync(path.join(tmpDir, "id_rsa"), "dummy-key-content");

      const result = await scanRepository(tmpDir);

      for (const rec of result.files) {
        if (rec.inspectionStatus !== "INSPECTED") {
          expect(rec.contentHash).toBeNull();
          expect(rec.hashState).not.toBe("COMPUTED");
        }
      }
    });

    it("7. confirms secret values do not appear in serialized inventory results", async () => {
      const rawSecret = "ghp_" + "X".repeat(36);
      fs.writeFileSync(path.join(tmpDir, "leaked.ts"), `const s = "${rawSecret}";`);
      fs.writeFileSync(path.join(tmpDir, ".env"), `SECRET_VAL=${rawSecret}`);

      const result = await scanRepository(tmpDir);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(rawSecret);
    });
  });
});
