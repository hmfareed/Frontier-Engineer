import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../scripts/lib/paths.ts";

describe("extractor-isolated-runtime (AC-7201 Isolated Environment Execution)", () => {
  it("executes parser successfully in a directory without node_modules and empty NODE_PATH", async () => {
    const root = repoRoot();
    const loaderPath = path.join(root, "scripts", "extractor", "parser-loader.ts");
    const loaderUrl = pathToFileURL(loaderPath).href;

    // Create an isolated temp directory that definitely has no node_modules
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-isolated-parser-"));

    try {
      const runnerScript = `
        import { loadParser } from "${loaderUrl}";

        async function main() {
          const parser = await loadParser();
          const sf = parser.createSourceFile("isolated.ts", "const x: number = 42;", parser.ScriptTarget.Latest, true);
          if (!sf || sf.statements.length !== 1) {
            process.exit(1);
          }
          process.stdout.write("PARSED_OK");
        }

        main().catch((err) => {
          console.error(err);
          process.exit(2);
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
        timeout: 10000,
      });

      expect(result.status, `Subprocess failed with stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("PARSED_OK");
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
