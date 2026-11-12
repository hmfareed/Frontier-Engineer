import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";

describe("extractor-isolated-runtime (AC-7201 Isolated Environment Execution & Packaging)", () => {
  it("executes complete extraction pipeline in an isolated environment without node_modules and empty NODE_PATH", async () => {
    const root = repoRoot();
    const extractorIndexPath = path.join(root, "scripts", "extractor", "index.ts");
    const extractorUrl = pathToFileURL(extractorIndexPath).href;

    // Create an isolated temp directory that definitely has no node_modules
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-isolated-parser-"));

    try {
      // Create two fixture files in the isolated workspace
      const fixtureRoot = path.join(isolatedDir, "repo");
      fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });

      const modBContent = `export function helper(val: number): number { return val * 2; }`;
      fs.writeFileSync(path.join(fixtureRoot, "src", "helper.ts"), modBContent, "utf8");

      const modAContent = `
        import { helper } from "./helper.js";
        export function main(): number {
          return helper(21);
        }
      `;
      fs.writeFileSync(path.join(fixtureRoot, "src", "main.ts"), modAContent, "utf8");

      // Runner script imported in isolated environment
      const runnerScript = `
        import { extractFileSymbols, loadParser } from "${extractorUrl}";

        async function run() {
          const parser = await loadParser({ requireBundled: true });
          if (!parser.isBundledParser) {
            console.error("FAIL: dev TypeScript fallback was unexpectedly used");
            process.exit(10);
          }

          const content = ${JSON.stringify(modAContent)};
          const result = await extractFileSymbols("src/main.ts", content, {
            workspaceRoot: ${JSON.stringify(fixtureRoot)},
          });

          if (result.status !== "SUCCESS") {
            console.error("FAIL: status is not SUCCESS:", result.status);
            process.exit(11);
          }

          if (result.symbols.length !== 1 || result.symbols[0].name !== "main") {
            console.error("FAIL: symbols mismatch:", result.symbols);
            process.exit(12);
          }

          if (result.imports.length !== 1) {
            console.error("FAIL: imports mismatch:", result.imports);
            process.exit(13);
          }

          const imp = result.imports[0];
          if (!imp.sourceEvidence || imp.sourceEvidence.lineStart < 1) {
            console.error("FAIL: missing import source evidence");
            process.exit(14);
          }

          process.stdout.write("ISOLATED_EXTRACTION_SUCCESS");
        }

        run().catch((err) => {
          console.error(err);
          process.exit(1);
        });
      `;

      const testScriptPath = path.join(isolatedDir, "test-runner.mjs");
      fs.writeFileSync(testScriptPath, runnerScript, "utf8");

      // Spawn node in isolatedDir with wiped NODE_PATH
      const env = { ...process.env };
      delete env.NODE_PATH;

      const result = cp.spawnSync("node", [testScriptPath], {
        cwd: isolatedDir,
        env,
        encoding: "utf8",
        timeout: 15000,
      });

      expect(result.status, `Subprocess failed with stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("ISOLATED_EXTRACTION_SUCCESS");
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it("fails fast with an explicit error when a corrupt bundle file is encountered", async () => {
    const root = repoRoot();
    const loaderPath = path.join(root, "scripts", "extractor", "parser-loader.ts");
    const loaderUrl = pathToFileURL(loaderPath).href;

    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-corrupt-bundle-"));

    try {
      const corruptBundlePath = path.join(isolatedDir, "corrupt-bundle.js");
      fs.writeFileSync(corruptBundlePath, "INVALID SYNTAX {{{{ NOT_JS", "utf8");

      const runnerScript = `
        import { loadParser } from "${loaderUrl}";

        async function run() {
          try {
            await loadParser({ bundlePath: ${JSON.stringify(corruptBundlePath)} });
            process.exit(1); // Should have thrown
          } catch (err) {
            if (err.message && err.message.includes("Failed to initialize bundled parser at") && err.message.includes("npm run build:parser")) {
              process.stdout.write("CORRUPT_BUNDLE_ACTIONABLE_ERROR");
              process.exit(0);
            }
            console.error("Wrong error message:", err.message);
            process.exit(2);
          }
        }

        run();
      `;

      const testScriptPath = path.join(isolatedDir, "corrupt-test.mjs");
      fs.writeFileSync(testScriptPath, runnerScript, "utf8");

      const env = { ...process.env };
      delete env.NODE_PATH;

      const result = cp.spawnSync("node", [testScriptPath], {
        cwd: isolatedDir,
        env,
        encoding: "utf8",
        timeout: 10000,
      });

      expect(result.status, `Subprocess failed with stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("CORRUPT_BUNDLE_ACTIONABLE_ERROR");
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it("fails fast with an explicit error when requireBundled is true and bundle is missing", async () => {
    const root = repoRoot();
    const loaderPath = path.join(root, "scripts", "extractor", "parser-loader.ts");
    const loaderUrl = pathToFileURL(loaderPath).href;

    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-missing-bundle-"));

    try {
      const missingBundlePath = path.join(isolatedDir, "non-existent-bundle.js");

      const runnerScript = `
        import { loadParser } from "${loaderUrl}";

        async function run() {
          try {
            await loadParser({ requireBundled: true, bundlePath: ${JSON.stringify(missingBundlePath)} });
            process.exit(1); // Should have thrown
          } catch (err) {
            if (err.message && err.message.includes("Bundled parser required but") && err.message.includes("npm run build:parser")) {
              process.stdout.write("MISSING_BUNDLE_ACTIONABLE_ERROR");
              process.exit(0);
            }
            console.error("Wrong error message:", err.message);
            process.exit(2);
          }
        }

        run();
      `;

      const testScriptPath = path.join(isolatedDir, "missing-test.mjs");
      fs.writeFileSync(testScriptPath, runnerScript, "utf8");

      const env = { ...process.env };
      delete env.NODE_PATH;

      const result = cp.spawnSync("node", [testScriptPath], {
        cwd: isolatedDir,
        env,
        encoding: "utf8",
        timeout: 10000,
      });

      expect(result.status, `Subprocess failed with stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("MISSING_BUNDLE_ACTIONABLE_ERROR");
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
