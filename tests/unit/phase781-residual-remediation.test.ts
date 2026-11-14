import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanRepository } from "../../scripts/scanner/repository-scanner.ts";
import {
  containsUnredactedSecrets,
  redactPemPrivateKeys,
  scanBufferForSecrets,
} from "../../scripts/scanner/sensitive-filter.ts";
import { extractFileSymbols } from "../../scripts/extractor/index.ts";
import { ContentSanitizer } from "../../scripts/retrieval/content-sanitizer.ts";
import { redactString, redactValue } from "../../scripts/hooks/lib/secret-redactor.ts";
import { resolveAuditDir, writeAuditLog } from "../../scripts/hooks/runtime/logger.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import { SnapshotWriter } from "../../scripts/storage/transactions/snapshot-writer.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "frontier-p781-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Phase 7.8.1 Residual Security Remediation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("RES-01: Unterminated single-line & complex PEM redaction", () => {
    const pemBegin = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
    const pemRsaBegin = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
    const pemRsaEnd = ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
    const payloadA = "MIIEvQIBADANBgkqhkiG9w0BAQEF";
    const payloadB = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=";

    it("redacts single-line unterminated PEM payload followed by inline safe prose across all entry points", () => {
      const exactReproduction = `${pemBegin}\n${payloadA}   const safeAfter = 1;\n`;

      const scannerRes = scanBufferForSecrets(Buffer.from(exactReproduction, "utf8"));
      expect(scannerRes.detected).toBe(true);
      expect(scannerRes.redactedText).not.toContain(payloadA);
      expect(scannerRes.redactedText).toContain("[REDACTED_SECRET:PRIVATE_KEY]");
      expect(scannerRes.redactedText).toContain("const safeAfter = 1;");

      // Idempotency
      const secondPass = scanBufferForSecrets(Buffer.from(scannerRes.redactedText, "utf8"));
      expect(secondPass.detected).toBe(false);
      expect(secondPass.redactedText).toBe(scannerRes.redactedText);

      // Fail-closed secret detector & sanitizer & hook string redactor
      expect(containsUnredactedSecrets(exactReproduction)).toBe(true);
      const san = ContentSanitizer.sanitizeUntrustedText(exactReproduction);
      expect(san.redacted).toBe(true);
      expect(san.text).not.toContain(payloadA);
      expect(san.text).toContain("const safeAfter = 1;");

      const hookRed = redactString(exactReproduction);
      expect(hookRed).not.toContain(payloadA);
      expect(hookRed).toContain("[REDACTED_PRIVATE_KEY]");
      expect(hookRed).toContain("const safeAfter = 1;");

      // preserveLineCount mode keeps line alignment while stripping payloadA
      const preserved = redactPemPrivateKeys(exactReproduction, "[REDACTED_SECRET:PRIVATE_KEY]", {
        preserveLineCount: true,
      });
      expect(preserved.detected).toBe(true);
      expect(preserved.redactedText).not.toContain(payloadA);
      expect(preserved.redactedText.split("\n")).toHaveLength(exactReproduction.split("\n").length);
    });

    it("handles padded single-line tails, template-literal delimiters, multiline, multiple blocks, and JSON-escaped PEMs without false positives", () => {
      const paddedSingleLine = `${pemBegin}\ndA==   const okAfterPad = true;`;
      const paddedRes = ContentSanitizer.sanitizeUntrustedText(paddedSingleLine);
      expect(paddedRes.redacted).toBe(true);
      expect(paddedRes.text).not.toContain("dA==");
      expect(paddedRes.text).toContain("const okAfterPad = true;");

      const templateDelim = `const k = \`${pemBegin}\n${payloadA}\`; const afterTpl = 2;`;
      const tplRes = scanBufferForSecrets(Buffer.from(templateDelim, "utf8"));
      expect(tplRes.detected).toBe(true);
      expect(tplRes.redactedText).not.toContain(payloadA);
      expect(tplRes.redactedText).toContain("const afterTpl = 2;");

      const multiBlock = [
        `${pemRsaBegin}\n${payloadA}\n${payloadB}\n${pemRsaEnd}`,
        "const betweenBlocks = true;",
        `${pemBegin}\n${payloadA}   const safeTail = 3;`,
      ].join("\n");
      const multiRes = scanBufferForSecrets(Buffer.from(multiBlock, "utf8"));
      expect(multiRes.detected).toBe(true);
      expect(multiRes.redactedText).not.toContain(payloadA);
      expect(multiRes.redactedText).not.toContain(payloadB);
      expect(multiRes.redactedText).toContain("const betweenBlocks = true;");
      expect(multiRes.redactedText).toContain("const safeTail = 3;");
      expect(ContentSanitizer.sanitizeUntrustedText(multiRes.redactedText).text).toBe(
        multiRes.redactedText,
      );

      const jsonEscapedComplete = JSON.stringify({
        k: `${pemRsaBegin}\n${payloadA}\n${pemRsaEnd}`,
      });
      const jsonEscapedUnterminated = JSON.stringify({
        k: `${pemBegin}\n${payloadA}`,
      });
      for (const candidate of [jsonEscapedComplete, jsonEscapedUnterminated]) {
        const res = scanBufferForSecrets(Buffer.from(candidate, "utf8"));
        expect(res.detected).toBe(true);
        expect(res.redactedText).not.toContain(payloadA);
        expect(() => JSON.parse(res.redactedText)).not.toThrow();
      }

      // Non-secret prose / ordinary assignments after an empty quoted PEM label must stay intact
      const nonSecretCode = [
        `const labelText = "${pemBegin}";`,
        "const configuration = 123;",
        "export const camelCaseConfigValue = true;",
      ].join("\n");
      const nonSecretRes = redactPemPrivateKeys(nonSecretCode, "[REDACTED_SECRET:PRIVATE_KEY]");
      expect(nonSecretRes.redactedText).toContain("const configuration = 123;");
      expect(nonSecretRes.redactedText).toContain("export const camelCaseConfigValue = true;");
    });

    it("prevents malformed unterminated PEM files from entering extracted symbols or safe snippets", async () => {
      const ws = makeTempDir("frontier-p781-pem-persist-");
      const srcDir = path.join(ws, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const leakySource = `${pemBegin}\n${payloadA}   export const shouldNotIndex = 1;\n`;
      fs.writeFileSync(path.join(srcDir, "secret.ts"), leakySource, "utf8");
      fs.writeFileSync(path.join(srcDir, "clean.ts"), "export const cleanSymbol = 42;\n", "utf8");

      const inv = await scanRepository(ws);
      const secretRec = inv.files.find((f) => f.canonicalPath === "src/secret.ts");
      expect(secretRec).toBeDefined();
      expect(secretRec!.classification).toBe("sensitive");
      expect(secretRec!.exclusionStatus).toBe("EXCLUDED_CONTENT");
      expect(secretRec!.hashState).toBe("SKIPPED_SENSITIVE");

      const cleanRec = inv.files.find((f) => f.canonicalPath === "src/clean.ts");
      expect(cleanRec?.exclusionStatus).toBe("INCLUDED");

      const extractions = new Map([
        [
          "src/clean.ts",
          await extractFileSymbols("src/clean.ts", "export const cleanSymbol = 42;\n"),
        ],
        ["src/secret.ts", await extractFileSymbols("src/secret.ts", leakySource)],
      ]);

      const cm = new ConnectionManager({ workspaceRoot: ws });
      const sm = new StorageManager(cm);
      await sm.initialize();
      try {
        const db = cm.getDatabase();
        const repoId = cm.getRepository().id;
        const snap = await SnapshotWriter.persist(db, repoId, {
          repositoryIdentity: cm.getRepository().identity,
          rootPath: ws,
          displayName: "pem-test",
          inventory: inv,
          extractions,
          scannerVersion: "0.6.3",
          extractorVersion: "0.6.3",
        });
        expect(snap.status).toBe("COMPLETE");

        const symRows = db
          .prepare("SELECT name FROM symbols WHERE repository_id = ? AND scan_id = ?")
          .all(repoId, snap.scanId) as Array<{ name: string }>;
        expect(symRows.map((s) => s.name)).toEqual(["cleanSymbol"]);

        const fileRows = db
          .prepare(
            "SELECT normalized_path AS canonicalPath, sensitivity_status AS sensitivityStatus FROM files WHERE repository_id = ? AND scan_id = ?",
          )
          .all(repoId, snap.scanId) as Array<{ canonicalPath: string; sensitivityStatus: string }>;
        const storedSecret = fileRows.find((f) => f.canonicalPath === "src/secret.ts");
        expect(storedSecret?.sensitivityStatus).toBe("SENSITIVE");

        // Even if snippet reader were called directly on the file content (assuming pre-scan SAFE status),
        // readSafeSnippet scrubs the payload line before returning any lines.
        const snippetAttempt = ContentSanitizer.readSafeSnippet({
          workspaceRoot: ws,
          filePath: "src/secret.ts",
          sensitivityStatus: "SAFE",
          maxLines: 10,
        });
        expect(snippetAttempt.allowed).toBe(true);
        expect(snippetAttempt.content).not.toContain(payloadA);
        expect(snippetAttempt.content).toContain("[REDACTED_SECRET:PRIVATE_KEY]");
      } finally {
        cm.close();
      }
    });
  });

  describe("RES-03: Audit logging & serialization redaction safety", () => {
    const slackTok = ["xoxb", "123456", "7890123456", "AbCdEfGh1234"].join("-");
    const openaiTok = ["sk-proj-", "AbCdEfGh1234567890_xyz"].join("");
    const githubTok = ["gho_", "Xy90".repeat(6)].join("");
    const awsTok = ["AKIA", "Z9X8C7V6B5N4M3L2"].join("");
    const sentryTok = ["sntrys_", "eyJpYXQi_1234-5678=="].join("");
    const bearerTok = `Bearer ${"eyJhbGciOiJIUzI1NiJ9.payload12345"}`;
    const basicTok = `Authorization: Basic ${"dXNlcjpwYXNzMTIz"}`;
    const dbUri = ["postgres://appuser:", "p%40ss%2Fslash/1", "@db.local:5432/prod"].join("");

    it("never executes attacker-controlled toJSON() and never leaks secrets through writeAuditLog()", () => {
      const ws = makeTempDir("frontier-p781-audit-tojson-");
      const toJsonCalls = { dataProp: 0, getterProp: 0 };

      const hostileDataToJson = {
        safeInfo: "kept",
        toJSON() {
          toJsonCalls.dataProp++;
          return { leaked: githubTok, nested: { aws: awsTok } };
        },
      };

      const hostileGetterToJson: Record<string, unknown> = { ok: true };
      Object.defineProperty(hostileGetterToJson, "toJSON", {
        enumerable: true,
        get() {
          toJsonCalls.getterProp++;
          return () => ({ nestedSecret: { slack: slackTok } });
        },
      });

      const throwingToJson = {
        safeField: "preserved",
        toJSON() {
          throw new Error(`toJSON boom ${openaiTok}`);
        },
      };

      // Direct redactValue should also refuse to preserve/invoke toJSON
      const directRedacted = redactValue({ a: hostileDataToJson, b: hostileGetterToJson });
      expect(() => JSON.stringify(directRedacted)).not.toThrow();
      expect(toJsonCalls.dataProp).toBe(0);
      expect(toJsonCalls.getterProp).toBe(0);

      writeAuditLog(
        {
          event: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          timestamp: new Date().toISOString(),
          status: "denied",
          metadata: {
            hostileDataToJson,
            hostileGetterToJson,
            throwingToJson,
          },
        },
        ws,
      );

      expect(toJsonCalls.dataProp).toBe(0);
      expect(toJsonCalls.getterProp).toBe(0);

      const logPath = path.join(resolveAuditDir(ws), "execution.jsonl");
      const content = fs.readFileSync(logPath, "utf8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.metadata.hostileDataToJson.safeInfo).toBe("kept");
      expect(parsed.metadata.throwingToJson.safeField).toBe("preserved");
      for (const secret of [githubTok, awsTok, slackTok, openaiTok]) {
        expect(content).not.toContain(secret);
      }
    });

    it("handles throwing getters, circular references, DAG reuse, BigInt, deep nesting, Errors, and all credential families in writeAuditLog()", () => {
      const ws = makeTempDir("frontier-p781-audit-all-");
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const objWithThrowingGetter: Record<string, unknown> = { safeSibling: "still-here" };
      Object.defineProperty(objWithThrowingGetter, "explosive", {
        enumerable: true,
        get() {
          throw new Error(`getter exploded ${githubTok}`);
        },
      });
      Object.defineProperty(objWithThrowingGetter, "apiKey", {
        enumerable: true,
        get() {
          throw new Error(`secret getter ${awsTok}`);
        },
      });

      const mutA: Record<string, unknown> = { name: "A", s: slackTok };
      const mutB: Record<string, unknown> = { name: "B", a: mutA };
      mutA.b = mutB;

      const sharedDag = { msg: `shared ${sentryTok}`, token: "raw-secret" };

      let deep: Record<string, unknown> = { leaf: openaiTok };
      for (let i = 0; i < 3000; i++) {
        deep = { next: deep };
      }

      const customErr = new Error(`Err message ${bearerTok}`, {
        cause: { db: dbUri, auth: basicTok },
      }) as Error & { secretCode?: string };
      customErr.secretCode = slackTok;

      writeAuditLog(
        {
          event: "PostToolUse",
          hookId: "frontier-post-tool-audit",
          timestamp: new Date().toISOString(),
          status: "error",
          error: `All creds: ${slackTok} ${openaiTok} ${githubTok} ${awsTok} ${sentryTok} ${bearerTok} ${basicTok} ${dbUri}`,
          metadata: {
            throwing: objWithThrowingGetter,
            cycle: mutA,
            dagLeft: sharedDag,
            dagRight: sharedDag,
            bigCount: BigInt("9007199254740993"),
            deep,
            customErr,
          },
        },
        ws,
      );

      expect(stderrSpy).not.toHaveBeenCalled();

      const logPath = path.join(resolveAuditDir(ws), "execution.jsonl");
      const rawLine = fs.readFileSync(logPath, "utf8").trim();
      const entry = JSON.parse(rawLine);

      expect(entry.metadata.throwing.safeSibling).toBe("still-here");
      expect(entry.metadata.throwing.explosive).toContain("PropertyAccessError");
      expect(entry.metadata.throwing.apiKey).toBe("[REDACTED]");
      expect(entry.metadata.cycle.b.a).toBe("[Circular]");
      expect(entry.metadata.dagLeft.msg).toBe("shared sntrys_[REDACTED]");
      expect(entry.metadata.dagRight.msg).toBe("shared sntrys_[REDACTED]");
      expect(entry.metadata.dagLeft.token).toBe("[REDACTED]");
      expect(entry.metadata.bigCount).toBe("9007199254740993");
      expect(entry.metadata.customErr.cause.db).toContain("[REDACTED]@db.local:5432/prod");

      for (const secret of [
        slackTok,
        openaiTok,
        githubTok,
        awsTok,
        sentryTok,
        "eyJhbGciOiJIUzI1NiJ9.payload12345",
        "dXNlcjpwYXNzMTIz",
        "p%40ss%2Fslash/1",
      ]) {
        expect(rawLine).not.toContain(secret);
      }
    });

    it("handles hostile Proxy enumeration errors and degrades safely in writeAuditLog() without losing records", () => {
      const ws = makeTempDir("frontier-p781-audit-proxy-");
      const hostileProxy = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error(`Proxy ownKeys leak ${githubTok}`);
          },
        },
      );

      const redactedProxy = redactValue({ hostileProxy }) as {
        hostileProxy: { __enumerationError?: string };
      };
      expect(redactedProxy.hostileProxy.__enumerationError).toContain("PropertyEnumerationError");
      expect(redactedProxy.hostileProxy.__enumerationError).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(redactedProxy.hostileProxy.__enumerationError).not.toContain(githubTok);

      // Even if a primitive symbol/unserializable root forces degraded fallback in serializeAuditLine,
      // writeAuditLog must still write a redacted JSONL audit entry instead of dropping it.
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const rootProxy = new Proxy(
        {
          event: "PreToolUse",
          hookId: "frontier-pre-tool-safety",
          timestamp: new Date().toISOString(),
          status: "denied" as const,
          error: `Blocked ${slackTok}`,
          metadata: undefined as unknown as Record<string, unknown>,
        },
        {
          get(target, prop, receiver) {
            if (prop === "metadata") {
              throw new Error(`metadata getter boom ${openaiTok}`);
            }
            return Reflect.get(target, prop, receiver);
          },
        },
      );

      writeAuditLog(rootProxy, ws);
      const logPath = path.join(resolveAuditDir(ws), "execution.jsonl");
      const content = fs.readFileSync(logPath, "utf8").trim();
      const entry = JSON.parse(content);
      expect(entry.event).toBe("PreToolUse");
      expect(entry.error).toContain("[REDACTED_SLACK_TOKEN]");
      expect(entry.metadata).toContain("PropertyAccessError");
      expect(entry.metadata).toContain("[REDACTED_API_KEY]");
      expect(content).not.toContain(slackTok);
      expect(content).not.toContain(openaiTok);
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe("RES-02 & RES-04: Dispositions and retained boundaries", () => {
    it("RES-02: redacts extended-length (>128-char) hyphenated Slack tokens while retaining underscore non-match boundary", () => {
      const longSlack = `xoxb-123456-${"a".repeat(130)}-TAIL99`;
      expect(containsUnredactedSecrets(longSlack)).toBe(true);
      expect(scanBufferForSecrets(Buffer.from(longSlack, "utf8")).redactedText).toBe(
        "[REDACTED_SECRET:SLACK_TOKEN]",
      );
      expect(redactString(longSlack)).toBe("[REDACTED_SLACK_TOKEN]");
      expect(ContentSanitizer.sanitizeUntrustedText(longSlack).text).toBe(
        "[REDACTED_SECRET:SLACK_TOKEN]",
      );

      // Accepted boundary: Slack tokens do not use underscores; snake-like fake prefixes do not match
      const underscoreInput = "xoxb-123456_not_a_real_slack_token";
      expect(containsUnredactedSecrets(underscoreInput)).toBe(false);
    });

    it("RES-04: documents and verifies RFC-3986 percent-encoded vs unencoded @ URI password boundary", () => {
      // RFC-3986 encoded @ (%40) and / (%2F / raw /) redact completely
      const rfcUri = "postgres://svc:p%40ss%2F1/2@db.internal:5432/app";
      expect(redactString(rfcUri)).toBe("postgres://svc:[REDACTED]@db.internal:5432/app");
      expect(ContentSanitizer.sanitizeUntrustedText(rfcUri).text).toBe(
        "postgres://svc:[REDACTED_SECRET:DB_PASSWORD]@db.internal:5432/app",
      );

      // Accepted boundary: malformed non-RFC URI with unencoded '@' splits at first '@',
      // preventing multi-host/email cross-token over-redaction across adjacent URIs.
      const multiHostText = "postgres://user:pass@db1.local:5432/app and contact admin@example.com";
      const res = redactString(multiHostText);
      expect(res).toBe(
        "postgres://user:[REDACTED]@db1.local:5432/app and contact admin@example.com",
      );
      expect(res).toContain("admin@example.com");
    });
  });
});
