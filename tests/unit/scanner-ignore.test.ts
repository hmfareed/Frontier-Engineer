import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IgnoreStack } from "../../scripts/scanner/ignore-evaluator.ts";

describe("IgnoreStack (Git Ignore Semantics & Oracle Comparison)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-scanner-ignore-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. handles root-anchored patterns (/build vs build)", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["/build", "out/"]);

    // Root-anchored /build matches root build, not src/build
    expect(stack.isIgnored("build", true)).toBe(true);
    expect(stack.isIgnored("src/build", true)).toBe(false);

    // out/ has no leading slash but has trailing slash: matches root or nested directory
    expect(stack.isIgnored("out", true)).toBe(true);
    expect(stack.isIgnored("src/out", true)).toBe(true);
  });

  it("2. handles patterns relative to nested .gitignore files", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["*.log"]);
    stack.pushScope("packages/core", ["dist/", "temp.ts"]);

    expect(stack.isIgnored("packages/core/dist", true)).toBe(true);
    expect(stack.isIgnored("packages/core/temp.ts", false)).toBe(true);
    expect(stack.isIgnored("packages/other/temp.ts", false)).toBe(false);

    stack.popScope();
    expect(stack.isIgnored("packages/core/dist", true)).toBe(false);
  });

  it("3. handles directory-only patterns on directories only", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["temp/"]);

    expect(stack.isIgnored("temp", true)).toBe(true);
    expect(stack.isIgnored("temp", false)).toBe(false);
  });

  it("4. handles *, ?, and character classes [0-9]", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["file-[0-9].txt", "test-?.ts"]);

    expect(stack.isIgnored("file-1.txt", false)).toBe(true);
    expect(stack.isIgnored("file-9.txt", false)).toBe(true);
    expect(stack.isIgnored("file-a.txt", false)).toBe(false);

    expect(stack.isIgnored("test-a.ts", false)).toBe(true);
    expect(stack.isIgnored("test-1.ts", false)).toBe(true);
    expect(stack.isIgnored("test-abc.ts", false)).toBe(false);
  });

  it("5. handles ** patterns (leading, middle, trailing)", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["**/cache", "logs/**", "a/**/b"]);

    // **/cache matches cache anywhere
    expect(stack.isIgnored("cache", true)).toBe(true);
    expect(stack.isIgnored("src/cache", true)).toBe(true);
    expect(stack.isIgnored("src/deep/cache", true)).toBe(true);

    // logs/** matches anything under logs
    expect(stack.isIgnored("logs/debug.log", false)).toBe(true);

    // a/**/b matches a/b and a/x/b
    expect(stack.isIgnored("a/b", false)).toBe(true);
    expect(stack.isIgnored("a/x/b", false)).toBe(true);
    expect(stack.isIgnored("a/x/y/b", false)).toBe(true);
    expect(stack.isIgnored("c/x/b", false)).toBe(false);
  });

  it("6. handles escaped special characters (\\#, \\!)", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["\\#file.txt", "\\!important.txt"]);

    expect(stack.isIgnored("#file.txt", false)).toBe(true);
    expect(stack.isIgnored("!important.txt", false)).toBe(true);
  });

  it("7. handles negation patterns that re-include matching files", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["*.log", "!important.log"]);

    expect(stack.isIgnored("error.log", false)).toBe(true);
    expect(stack.isIgnored("important.log", false)).toBe(false);
  });

  it("8. respects nested ignore-file precedence over parent rules", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["*.tmp"]);
    stack.pushScope("src", ["!special.tmp"]);

    expect(stack.isIgnored("other.tmp", false)).toBe(true);
    expect(stack.isIgnored("src/special.tmp", false)).toBe(false);
  });

  it("9. adheres to Git specification: parent exclusion prevents child re-inclusion", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["vendor/", "!vendor/lib/util.ts"]);

    expect(stack.isIgnored("vendor", true)).toBe(true);
    expect(stack.isIgnored("vendor/lib/util.ts", false)).toBe(true);
  });

  it("10. enforces hard Frontier exclusions (.frontier, .git, .agents)", () => {
    const stack = new IgnoreStack();
    stack.pushScope("", ["!*.frontier*", "!*.git*"]);

    expect(stack.isHardExcluded(".frontier")).toBe(true);
    expect(stack.isHardExcluded(".frontier/intelligence/frontier.db")).toBe(true);
    expect(stack.isHardExcluded(".git")).toBe(true);
    expect(stack.isHardExcluded(".git/HEAD")).toBe(true);
    expect(stack.isHardExcluded(".agents")).toBe(true);
  });

  it("11. development comparison oracle: matches git check-ignore on fixture repo", () => {
    // Initialize temporary git repo
    try {
      cp.execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    } catch {
      // If git is not available in environment, skip oracle check
      return;
    }

    // Set up nested gitignores and test files
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "node_modules/\n*.log\n!important.log\nbuild/\n",
    );
    fs.mkdirSync(path.join(tmpDir, "src", "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", ".gitignore"), "generated/\n*.tmp\n");

    const testCases: Array<{ path: string; isDir: boolean }> = [
      { path: "app.log", isDir: false },
      { path: "important.log", isDir: false },
      { path: "src/sub/test.ts", isDir: false },
      { path: "src/generated/types.ts", isDir: false },
      { path: "src/sub/temp.tmp", isDir: false },
    ];

    // Evaluate with IgnoreStack
    const stack = new IgnoreStack();
    stack.pushScope("", ["node_modules/", "*.log", "!important.log", "build/"]);
    stack.pushScope("src", ["generated/", "*.tmp"]);

    for (const tc of testCases) {
      let gitIgnored = false;
      try {
        cp.execSync(`git check-ignore "${tc.path}"`, { cwd: tmpDir, stdio: "pipe" });
        gitIgnored = true;
      } catch {
        gitIgnored = false;
      }

      const stackIgnored = stack.isIgnored(tc.path, tc.isDir);
      expect(
        stackIgnored,
        `Mismatch for ${tc.path} (git: ${gitIgnored}, stack: ${stackIgnored})`,
      ).toBe(gitIgnored);
    }
  });
});
