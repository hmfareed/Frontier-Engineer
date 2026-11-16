import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePreToolUse } from "../../scripts/hooks/handlers/pre-tool-use.ts";
import {
  classifyCommandLine,
  classifyFilePath,
  classifyToolCall,
} from "../../scripts/hooks/lib/command-classifier.ts";
import {
  isWithinWorkspace,
  resolveWorkspaceContainment,
} from "../../scripts/hooks/lib/workspace-validator.ts";

function canCreateFileSymlinks(): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-85a-probe-"));
  const target = path.join(tmp, "target.txt");
  fs.writeFileSync(target, "probe", "utf8");
  try {
    fs.symlinkSync(target, path.join(tmp, "link.txt"), "file");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("Phase 8.5A: Stateless Security & Boundary Hardening", () => {
  let workspaceRoot: string;
  let siblingPrefixDir: string;
  let outsideDir: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "fe-85a-"));
    workspaceRoot = path.join(base, "workspace");
    siblingPrefixDir = path.join(base, "workspace-other");
    outsideDir = path.join(base, "outside");

    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".frontier", "intelligence"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".github", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".husky"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "scripts", "hooks", "handlers"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "specs", "hooks"), { recursive: true });
    fs.mkdirSync(siblingPrefixDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(path.join(workspaceRoot, "src", "index.ts"), "export const ok = true;\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "..foo.ts"),
      "export const dotdotName = true;\n",
    );
    fs.writeFileSync(path.join(workspaceRoot, "hooks.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "mcp_config.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "plugin.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".frontier", "config.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".git", "config"), "[core]\n");
    fs.writeFileSync(path.join(workspaceRoot, ".github", "workflows", "ci.yml"), "name: CI\n");
    fs.writeFileSync(path.join(workspaceRoot, ".husky", "pre-commit"), "#!/bin/sh\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "scripts", "hooks", "handlers", "pre-tool-use.ts"),
      "export {};\n",
    );
    fs.writeFileSync(path.join(workspaceRoot, "specs", "hooks", "pre-tool-use.md"), "# Spec\n");
    fs.writeFileSync(path.join(siblingPrefixDir, "secret.txt"), "sibling\n");
    fs.writeFileSync(path.join(outsideDir, "external.txt"), "outside\n");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  });

  describe("1. Workspace containment & canonical path enforcement", () => {
    it("allows existing and not-yet-created paths strictly inside the canonical workspace", () => {
      const existing = resolveWorkspaceContainment("src/index.ts", workspaceRoot);
      expect(existing.allowed).toBe(true);
      expect(existing.relativePath).toBe("src/index.ts");

      const doubleDotFilename = resolveWorkspaceContainment("src/..foo.ts", workspaceRoot);
      expect(doubleDotFilename.allowed).toBe(true);
      expect(doubleDotFilename.relativePath).toBe("src/..foo.ts");

      const nonExistentSubdir = resolveWorkspaceContainment(
        "src/new-feature/nested/file.ts",
        workspaceRoot,
      );
      expect(nonExistentSubdir.allowed).toBe(true);
      expect(nonExistentSubdir.relativePath).toBe("src/new-feature/nested/file.ts");
    });

    it("rejects relative traversal outside workspace including non-existent intermediate segments", () => {
      expect(isWithinWorkspace("../outside/external.txt", workspaceRoot)).toBe(false);
      expect(isWithinWorkspace("src/../../outside/external.txt", workspaceRoot)).toBe(false);
      expect(isWithinWorkspace("nonexistent-dir/../../outside/evil.ts", workspaceRoot)).toBe(false);

      for (const tool of ["write_file", "edit_file", "read_file", "write_to_file", "view_file"]) {
        const res = classifyToolCall(tool, { path: "../../etc/passwd" }, { workspaceRoot });
        expect(res.decision, `${tool} relative traversal`).toBe("deny");
        expect(res.category).toBe("destructive_filesystem");
      }
    });

    it("rejects sibling directories sharing the workspace path prefix (no unsafe startsWith bug)", () => {
      const siblingFile = path.join(siblingPrefixDir, "secret.txt");
      const containment = resolveWorkspaceContainment(siblingFile, workspaceRoot);
      expect(containment.allowed).toBe(false);

      const writeRes = classifyFilePath(siblingFile, "write", workspaceRoot);
      expect(writeRes.decision).toBe("deny");
      expect(writeRes.category).toBe("destructive_filesystem");

      const readRes = classifyFilePath(siblingFile, "read", workspaceRoot);
      expect(readRes.decision).toBe("deny");
      expect(readRes.category).toBe("destructive_filesystem");
    });

    it("rejects external absolute paths for read, write, and edit operations", () => {
      const externalFile = path.join(outsideDir, "external.txt");
      for (const op of ["read", "write", "edit"] as const) {
        const res = classifyFilePath(externalFile, op, workspaceRoot);
        expect(res.decision).toBe("deny");
        expect(res.category).toBe("destructive_filesystem");
      }
    });

    it("rejects Windows drive-letter changes and drive-relative paths", () => {
      const currentDrive = /^([a-zA-Z]):/.exec(workspaceRoot)?.[1]?.toUpperCase() ?? "C";
      const alternateDrive = currentDrive === "Z" ? "D" : "Z";

      const crossDrive = `${alternateDrive}:\\temp\\escape.ts`;
      const driveRelativeDifferent = `${alternateDrive}:escape.ts`;
      const driveRelativeSame = `${currentDrive}:escape.ts`;

      expect(resolveWorkspaceContainment(crossDrive, workspaceRoot).allowed).toBe(false);
      expect(resolveWorkspaceContainment(driveRelativeDifferent, workspaceRoot).allowed).toBe(
        false,
      );
      expect(resolveWorkspaceContainment(driveRelativeSame, workspaceRoot).allowed).toBe(false);

      expect(classifyFilePath(crossDrive, "write", workspaceRoot).decision).toBe("deny");
      expect(classifyFilePath(driveRelativeSame, "read", workspaceRoot).decision).toBe("deny");
    });

    it("rejects UNC network paths and Windows device paths", () => {
      const uncPaths = [
        "\\\\attacker-server\\share\\payload.ts",
        "//attacker-server/share/payload.ts",
        "\\\\?\\C:\\Windows\\System32\\drivers\\etc\\hosts",
        "\\\\.\\PhysicalDrive0",
      ];

      for (const unc of uncPaths) {
        expect(resolveWorkspaceContainment(unc, workspaceRoot).allowed, unc).toBe(false);
        expect(classifyFilePath(unc, "read", workspaceRoot).decision, `${unc} read`).toBe("deny");
        expect(classifyFilePath(unc, "write", workspaceRoot).decision, `${unc} write`).toBe("deny");
        expect(classifyFilePath(unc, "write").decision, `${unc} without root`).toBe("deny");
      }
    });

    it("fails safely when canonical workspace resolution cannot establish containment", () => {
      const missingRoot = path.join(path.dirname(workspaceRoot), "does-not-exist-workspace");
      const containment = resolveWorkspaceContainment("src/index.ts", missingRoot);
      expect(containment.allowed).toBe(false);

      const res = classifyFilePath("src/index.ts", "write", missingRoot);
      expect(res.decision).toBe("deny");
      expect(res.category).toBe("destructive_filesystem");

      const emptyRes = classifyFilePath("", "read", workspaceRoot);
      expect(emptyRes.decision).toBe("deny");
      expect(emptyRes.category).toBe("destructive_filesystem");
    });

    it("rejects directory symlink and junction escapes outside workspace", () => {
      const junctionPath = path.join(workspaceRoot, "src", "linked-outside");
      fs.symlinkSync(outsideDir, junctionPath, process.platform === "win32" ? "junction" : "dir");

      // Direct read/write into directory symlink targeting outsideDir
      const escapedTarget = path.join("src", "linked-outside", "external.txt");
      expect(resolveWorkspaceContainment(escapedTarget, workspaceRoot).allowed).toBe(false);
      expect(classifyFilePath(escapedTarget, "read", workspaceRoot).decision).toBe("deny");
      expect(classifyFilePath(escapedTarget, "write", workspaceRoot).decision).toBe("deny");

      // New child inside escaping directory symlink
      const escapedNewFile = path.join("src", "linked-outside", "new-payload.ts");
      expect(classifyFilePath(escapedNewFile, "write", workspaceRoot).decision).toBe("deny");

      // Traversal through escaping directory symlink
      const escapedNested = path.join("src", "linked-outside", "nested", "payload.ts");
      expect(resolveWorkspaceContainment(escapedNested, workspaceRoot).allowed).toBe(false);
    });

    it("rejects escaping, broken, and control-plane-aliased file symlinks (POSIX / privileged Windows)", () => {
      if (!canCreateFileSymlinks()) {
        if (process.platform !== "win32") {
          throw new Error("Expected file symlinks to be creatable on non-Windows host.");
        }
        console.log("[SKIPPED: Windows EPERM on file symlinks without Developer Mode]");
        return;
      }

      // Escaping file symlink
      const escapingFileLink = path.join(workspaceRoot, "src", "escape-link.txt");
      fs.symlinkSync(path.join(outsideDir, "external.txt"), escapingFileLink, "file");
      expect(resolveWorkspaceContainment("src/escape-link.txt", workspaceRoot).allowed).toBe(false);
      expect(classifyFilePath("src/escape-link.txt", "read", workspaceRoot).decision).toBe("deny");

      // Broken file symlink must fail closed rather than assuming lexical containment
      const brokenLink = path.join(workspaceRoot, "src", "broken-link.txt");
      fs.symlinkSync(path.join(outsideDir, "nonexistent-target.txt"), brokenLink, "file");
      expect(resolveWorkspaceContainment("src/broken-link.txt", workspaceRoot).allowed).toBe(false);
      expect(classifyFilePath("src/broken-link.txt", "write", workspaceRoot).decision).toBe("deny");

      // Internal file symlink pointing at protected control-plane file must still be blocked on write
      const aliasToHooks = path.join(workspaceRoot, "src", "harmless-name.json");
      fs.symlinkSync(path.join(workspaceRoot, "hooks.json"), aliasToHooks, "file");
      expect(resolveWorkspaceContainment("src/harmless-name.json", workspaceRoot).allowed).toBe(
        true,
      );
      expect(classifyFilePath("src/harmless-name.json", "write", workspaceRoot).decision).toBe(
        "deny",
      );
      expect(classifyFilePath("src/harmless-name.json", "read", workspaceRoot).decision).toBe(
        "allow",
      );
    });
  });

  describe("2. Control-plane protection (write/edit denied, reads preserved)", () => {
    const protectedTargets = [
      "hooks.json",
      "mcp_config.json",
      "plugin.json",
      ".frontier/config.json",
      ".frontier/intelligence/index.sqlite",
      ".git/config",
      ".git/hooks/pre-commit",
      ".github/workflows/ci.yml",
      ".husky/pre-commit",
      "scripts/hooks/handlers/pre-tool-use.ts",
      "specs/hooks/pre-tool-use.md",
      "./hooks.json",
      "src/../hooks.json",
      "nested/subdir/plugin.json",
    ];

    it.each(protectedTargets)(
      "denies direct write_file and edit_file (plus Antigravity aliases) on %s",
      (relTarget) => {
        for (const writeTool of [
          "write_file",
          "edit_file",
          "write_to_file",
          "replace_file_content",
          "multi_replace_file_content",
        ]) {
          const res = classifyToolCall(writeTool, { TargetFile: relTarget }, { workspaceRoot });
          expect(res.decision, `${writeTool} on ${relTarget}`).toBe("deny");
          expect(res.category).toBe("destructive_filesystem");
          expect(res.reason).toContain("control-plane");
        }
      },
    );

    it.each([
      "hooks.json",
      "mcp_config.json",
      "plugin.json",
      ".frontier/config.json",
      ".git/config",
      ".github/workflows/ci.yml",
      ".husky/pre-commit",
      "scripts/hooks/handlers/pre-tool-use.ts",
      "specs/hooks/pre-tool-use.md",
    ])("allows legitimate read operations on %s", (relTarget) => {
      for (const readTool of ["read_file", "view_file"]) {
        const res = classifyToolCall(readTool, { path: relTarget }, { workspaceRoot });
        expect(res.decision, `${readTool} on ${relTarget}`).toBe("allow");
      }
    });

    it("denies writes to protected targets even when named with misleading safe tool aliases", () => {
      const res = classifyToolCall(
        "custom_helper_sync",
        { path: ".frontier/config.json" },
        { workspaceRoot },
      );
      expect(res.decision).toBe("deny");
      expect(res.category).toBe("destructive_filesystem");
      expect(res.reason).toContain("control-plane");
    });

    it("allows normal workspace source writes inside src/", () => {
      for (const tool of ["write_file", "edit_file", "write_to_file", "replace_file_content"]) {
        const res = classifyToolCall(tool, { path: "src/index.ts" }, { workspaceRoot });
        expect(res.decision).toBe("allow");
      }
    });
  });

  describe("3. High-risk command classification (force_ask vs allow vs deny)", () => {
    it.each([
      "git push --force",
      "git push --force origin feature/test",
      "git push origin feature/test --force",
      "git push -f origin main",
      "git push -uf origin main",
      "git push --force-with-lease",
      "git push --force-with-lease=origin/main origin main",
      "git push --force-if-includes origin main",
      "git push origin +main",
      "git -C subrepo push --force origin main",
      "git --git-dir=.git push -f",
    ])("escalates %s to force_ask", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("force_ask");
      expect(res.category).toBe("high_risk_git");
    });

    it.each([
      "git branch -D old-branch",
      "git branch old-branch -D",
      "git branch -d -f old-branch",
      "git branch --delete --force old-branch",
      "git branch -f --delete old-branch",
      "git -C subrepo branch -D feature/x",
    ])("escalates destructive branch deletion (%s) to force_ask", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("force_ask");
      expect(res.category).toBe("high_risk_git");
    });

    it.each([
      "npm install lodash",
      "npm install --save-dev vitest",
      "npm i axios",
      "npm i -D typescript",
      "npm add zod",
      "pnpm add zod",
      "yarn add express",
      "bun add elysia",
      "pip install requests",
      "pip3 install httpx",
      "python -m pip install pytest",
      "python3 -m pip install black",
      "uv add ruff",
      "poetry add pydantic",
      "cargo add serde",
      "cargo install ripgrep",
      "go get github.com/stretchr/testify",
      "go install golang.org/x/tools/gopls@latest",
      "composer require symfony/console",
      "gem install bundler",
      "dotnet add package Newtonsoft.Json",
    ])("escalates new package installation (%s) to force_ask", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("force_ask");
      expect(res.category).toBe("external_side_effect");
    });

    it.each([
      'bash -c "git push --force"',
      "sh -c 'npm install left-pad'",
      'pwsh -NoProfile -Command "git branch -D stale"',
      'powershell -Command "pip install evil-pkg"',
      "cmd /c npm add chalk",
      "FOO=bar env NODE_ENV=production git push --force-with-lease",
      "npm test && git push --force",
      "git status; npm install evil-pkg",
      "npx vitest run || cargo add rand",
    ])("escalates shell wrapper, env-prefix, and chained bypasses (%s) to force_ask", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("force_ask");
    });

    it("preserves deny dominance when a high-risk command is chained with a prohibited command", () => {
      const res = classifyCommandLine("npm install lodash && rm -rf /");
      expect(res.decision).toBe("deny");
    });

    it.each([
      "git status",
      "git diff --stat",
      "git branch -d merged-branch",
      "git push origin feature/safe",
      "git push -u origin feature/safe",
      "npm test",
      "npm run verify",
      "npm run validate",
      "npm ci",
      "npm install",
      "npm install --frozen-lockfile",
      "pnpm install --frozen-lockfile",
      "npx vitest run tests/unit/hook-security.test.ts",
      'echo "git push --force"',
      'echo "npm install malicious"',
    ])("preserves allow for ordinary safe workspace command (%s)", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("allow");
    });
  });

  describe("4. PreToolUse handler, dispatcher integration, and audit trail", () => {
    it("enforces workspace containment and control-plane protection through handlePreToolUse and writes audit logs", () => {
      const traversal = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "read_file",
          args: { path: "../outside/external.txt" },
        },
      });
      expect(traversal.decision).toBe("deny");

      const controlPlaneWrite = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "write_file",
          args: { path: "hooks.json", content: "{}" },
        },
      });
      expect(controlPlaneWrite.decision).toBe("deny");

      const controlPlaneRead = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "read_file",
          args: { path: "hooks.json" },
        },
      });
      expect(controlPlaneRead.decision).toBe("allow");

      const pkgInstall = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "run_command",
          args: { CommandLine: "npm install express" },
        },
      });
      expect(pkgInstall.decision).toBe("force_ask");

      const auditFile = path.join(workspaceRoot, ".frontier", "audit", "execution.jsonl");
      expect(fs.existsSync(auditFile)).toBe(true);
      const lines = fs
        .readFileSync(auditFile, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(lines.length).toBe(4);
      expect(lines.map((entry) => entry.status)).toEqual(["denied", "denied", "info", "escalated"]);
    });

    it("fails closed when workspacePaths is explicitly empty and no cwd is provided", () => {
      const output = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [],
        toolCall: {
          name: "read_file",
          args: { path: "src/index.ts" },
        },
      });
      expect(output.decision).toBe("deny");
    });

    it("executes end-to-end through the hook dispatcher subprocess", () => {
      const dispatcherPath = path.resolve(
        process.cwd(),
        "scripts",
        "hooks",
        "runtime",
        "dispatcher.ts",
      );

      const runDispatcher = (payload: Record<string, unknown>) =>
        spawnSync(process.execPath, [dispatcherPath], {
          cwd: workspaceRoot,
          input: JSON.stringify(payload),
          encoding: "utf8",
          timeout: 15000,
        });

      const writeRes = runDispatcher({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "edit_file",
          args: { TargetFile: "mcp_config.json" },
        },
      });
      expect(writeRes.status).toBe(0);
      expect(JSON.parse(writeRes.stdout).decision).toBe("deny");

      const pushRes = runDispatcher({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "run_command",
          args: { CommandLine: "git push --force-with-lease" },
        },
      });
      expect(pushRes.status).toBe(0);
      expect(JSON.parse(pushRes.stdout).decision).toBe("force_ask");
    });
  });
});
