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
  hasNtfsStreamSyntax,
  resolveWorkspaceContainment,
  stripTrailingDotsAndSpacesFromPath,
} from "../../scripts/hooks/lib/workspace-validator.ts";
import { resolveAuditDir, writeAuditLog } from "../../scripts/hooks/runtime/logger.ts";

describe("Phase 8.5A-R1: Security Boundary Remediation & Adversarial Closure", () => {
  let workspaceRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "fe-85a-r1-"));
    workspaceRoot = path.join(base, "ws");
    outsideDir = path.join(base, "outside");

    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".gemini"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".agent", "workflows"), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(path.join(workspaceRoot, "hooks.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".env"), "SECRET=abc\n");
    fs.writeFileSync(path.join(workspaceRoot, "package.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "package-lock.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "scripts", "validate.ts"), "export {};\n");
    fs.writeFileSync(path.join(workspaceRoot, ".gemini", "settings.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".agent", "workflows", "ci.md"), "# ci\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "index.ts"), "export const ok = true;\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "..foo.ts"), "export const d = 1;\n");
    fs.writeFileSync(path.join(outsideDir, "x.ts"), "export {};\n");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  });

  describe("85A-AUD-01: Windows NTFS ADS and trailing dot/space alias hardening", () => {
    it("denies NTFS Alternate Data Stream writes and secret reads with or without workspaceRoot", () => {
      const adsInputs = [
        "hooks.json::$DATA",
        "hooks.json:hidden_stream",
        path.join(workspaceRoot, "hooks.json::$DATA"),
        "src/ok.ts:secret",
        ".env::$DATA",
        ".env:leak",
      ];

      for (const candidate of adsInputs) {
        expect(hasNtfsStreamSyntax(candidate)).toBe(true);
        expect(resolveWorkspaceContainment(candidate, workspaceRoot).allowed, candidate).toBe(
          false,
        );
        expect(classifyFilePath(candidate, "write", workspaceRoot).decision, candidate).toBe(
          "deny",
        );
        expect(classifyFilePath(candidate, "read", workspaceRoot).decision, candidate).toBe("deny");
        expect(classifyFilePath(candidate, "write").decision, `${candidate} static`).toBe("deny");
      }
    });

    it("denies Windows trailing-dot and trailing-space aliases of protected targets while preserving legitimate names", () => {
      expect(stripTrailingDotsAndSpacesFromPath("hooks.json.")).toBe("hooks.json");
      expect(stripTrailingDotsAndSpacesFromPath("hooks.json ")).toBe("hooks.json");
      expect(stripTrailingDotsAndSpacesFromPath("src/..foo.ts")).toBe("src/..foo.ts");

      expect(classifyFilePath("hooks.json.", "write", workspaceRoot).decision).toBe("deny");
      expect(classifyFilePath("hooks.json ", "edit", workspaceRoot).decision).toBe("deny");
      expect(classifyFilePath(".env.", "read", workspaceRoot).decision).toBe("deny");
      expect(classifyFilePath(".env ", "read", workspaceRoot).decision).toBe("deny");

      // Nearby legitimate filenames remain allowed
      expect(classifyFilePath("src/index.ts", "write", workspaceRoot).decision).toBe("allow");
      expect(classifyFilePath("src/..foo.ts", "write", workspaceRoot).decision).toBe("allow");
      expect(classifyFilePath(".gitignore", "write", workspaceRoot).decision).toBe("allow");
    });
  });

  describe("85A-AUD-02: Malformed, missing, array, and conflicting tool arguments fail closed", () => {
    it("never allows empty, missing, array, non-string, or conflicting run_command arguments", () => {
      expect(classifyToolCall("run_command", {}, { workspaceRoot }).decision).toBe("deny");
      expect(
        classifyToolCall("run_command", { CommandLine: "   " }, { workspaceRoot }).decision,
      ).toBe("deny");
      expect(
        classifyToolCall(
          "run_command",
          { CommandLine: ["rm", "-rf", "/"] as unknown as string },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");
      expect(
        classifyToolCall(
          "run_command",
          { CommandLine: 123 as unknown as string },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");
      expect(
        classifyToolCall(
          "run_command",
          { CommandLine: "echo safe", cmd: "rm -rf /" },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");
      expect(
        classifyToolCall(
          "run_command",
          { CommandLine: "echo safe", command: "git push --force" },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");

      // Nearby legitimate command passes
      expect(
        classifyToolCall("run_command", { CommandLine: "npm test" }, { workspaceRoot }).decision,
      ).toBe("allow");
    });

    it("detects conflicting file path keys and multi-file arrays across native file tools", () => {
      // Conflicting TargetFile (benign) vs path (outside workspace)
      expect(
        classifyToolCall(
          "write_file",
          { TargetFile: "src/index.ts", path: "../outside/x.ts" },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");

      // Conflicting benign paths in single-file tool still fail closed
      expect(
        classifyToolCall(
          "edit_file",
          { TargetFile: "src/index.ts", path: "src/other.ts" },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");

      // Multi-file array hiding protected path alongside safe TargetFile
      expect(
        classifyToolCall(
          "write_file",
          { TargetFile: "src/index.ts", paths: ["src/index.ts", "hooks.json"] },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");

      // Malformed array TargetFile or empty array paths
      expect(
        classifyToolCall(
          "write_file",
          { TargetFile: ["hooks.json"] as unknown as string },
          { workspaceRoot },
        ).decision,
      ).toBe("deny");
      expect(classifyToolCall("write_file", { paths: [] }, { workspaceRoot }).decision).toBe(
        "deny",
      );

      // Nearby legitimate multi-chunk edit with matching TargetFile remains allowed
      expect(
        classifyToolCall(
          "multi_replace_file_content",
          {
            TargetFile: "src/index.ts",
            ReplacementChunks: [
              { StartLine: 1, EndLine: 1, TargetContent: "ok", ReplacementContent: "ok2" },
            ],
          },
          { workspaceRoot },
        ).decision,
      ).toBe("allow");
    });
  });

  describe("85A-AUD-05: Missing or ambiguous workspace context fails closed and avoids CWD audit pollution", () => {
    it("denies file operations when both workspacePaths and cwd are omitted or ambiguous", () => {
      const missingCtxRead = handlePreToolUse({
        hookEventName: "PreToolUse",
        toolCall: { name: "read_file", args: { path: "src/index.ts" } },
      });
      expect(missingCtxRead.decision).toBe("deny");

      const ambiguousMultiRoot = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot, outsideDir],
        toolCall: { name: "write_file", args: { path: "src/index.ts" } },
      });
      expect(ambiguousMultiRoot.decision).toBe("deny");

      const emptyEntryRoot = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [""],
        toolCall: { name: "read_file", args: { path: "src/index.ts" } },
      });
      expect(emptyEntryRoot.decision).toBe("deny");

      // Explicit valid workspace still permits safe reads/writes and still runs safe commands
      const validCtx = handlePreToolUse({
        hookEventName: "PreToolUse",
        workspacePaths: [workspaceRoot],
        toolCall: { name: "read_file", args: { path: "src/index.ts" } },
      });
      expect(validCtx.decision).toBe("allow");
    });

    it("does not silently write audit logs into an unintended working directory when workspace context is missing", () => {
      const origCwd = process.cwd();
      const origPluginData = process.env.PLUGIN_DATA;
      const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "fe-unintended-cwd-"));

      try {
        delete process.env.PLUGIN_DATA;
        process.chdir(isolatedCwd);

        handlePreToolUse({
          hookEventName: "PreToolUse",
          toolCall: { name: "read_file", args: { path: "src/index.ts" } },
        });
        writeAuditLog({
          event: "PreToolUse",
          hookId: "test-no-cwd-leak",
          timestamp: new Date().toISOString(),
          status: "denied",
        });

        expect(resolveAuditDir(undefined)).toBe("");
        expect(fs.existsSync(path.join(isolatedCwd, ".frontier", "audit", "execution.jsonl"))).toBe(
          false,
        );
      } finally {
        process.chdir(origCwd);
        if (origPluginData !== undefined) process.env.PLUGIN_DATA = origPluginData;
        fs.rmSync(isolatedCwd, { recursive: true, force: true });
      }
    });
  });

  describe("85A-AUD-03 & 85A-AUD-04: Package manager value flags and git push +refspec", () => {
    it.each([
      "yarn --cwd packages/app add react",
      "pip --cache-dir /tmp install evilpkg",
      "pip --index-url https://pypi.example/simple install evilpkg",
      "pip3 --timeout 10 install httpx",
      "python3 -u -m pip install evilpkg",
      "pip install -r extra-requirements.txt",
      "pip install --requirement=dev-reqs.txt",
      "uv --project subdir add evilpkg",
      "uv --directory subdir pip install -r reqs.txt",
      "poetry --directory packages/a add evilpkg",
      "cargo --manifest-path a/Cargo.toml add serde",
      "cargo +nightly add serde",
      "go -C subdir get example.com/pkg",
      "composer -d subdir require symfony/console",
    ])("escalates package installation bypass (%s) to force_ask", (cmd) => {
      const res = classifyCommandLine(cmd);
      expect(res.decision, cmd).toBe("force_ask");
    });

    it.each([
      "yarn --cwd packages/app test",
      "yarn --cwd packages/app install",
      "pip list",
      "python3 -u -m pip list",
      "uv --project subdir run pytest",
      "cargo --manifest-path a/Cargo.toml test",
      "cargo +nightly test",
      "go -C subdir test ./...",
      "npm test",
      "npm ci",
      "npx vitest run",
    ])("preserves allow for nearby safe package manager command (%s)", (cmd) => {
      expect(classifyCommandLine(cmd).decision, cmd).toBe("allow");
    });

    it.each(["git push +main", "git push --repo=origin +main", "git push origin +HEAD:main"])(
      "escalates force-push refspec (%s) to force_ask",
      (cmd) => {
        expect(classifyCommandLine(cmd).decision, cmd).toBe("force_ask");
      },
    );

    it.each(["git push origin :feature-delete-remote", "git push origin main"])(
      "preserves allow for non-force ref push (%s)",
      (cmd) => {
        expect(classifyCommandLine(cmd).decision, cmd).toBe("allow");
      },
    );
  });

  describe("85A-AUD-06: Shell wrappers, background chains, substitutions, and encoded commands", () => {
    it.each([
      'bash -ec "git push --force"',
      'bash -ic "npm install evil-pkg"',
      'powershell -Command "& { git push --force }"',
      'powershell "& { git push --force }"',
      'pwsh -c "{ git branch -D old; }"',
      'bash -c "bash -c \\"bash -c \'git push --force\'\\""',
      "npm test & git push --force",
      "echo $(git push --force)",
      "echo `npm install evil-pkg`",
      "echo $(unclosed",
      'echo "git push --force" | bash',
      'printf "npm install evil" | sh',
      "g\\it push --force",
      'bash -c "g\\it push --force"',
      "env -u HOME git push --force",
      'env -S "git push --force"',
    ])("escalates adversarial shell construct (%s) to force_ask", (cmd) => {
      expect(classifyCommandLine(cmd).decision, cmd).toBe("force_ask");
    });

    it("denies POSIX backslash-escaped destructive commands while allowing normal Windows script paths", () => {
      expect(classifyCommandLine("r\\m -rf /").decision).toBe("deny");
      expect(classifyCommandLine("c\\at .env").decision).toBe("deny");
      expect(classifyCommandLine("node scripts\\validate.ts").decision).toBe("allow");
      expect(classifyCommandLine("git log | head -n 5").decision).toBe("allow");
      expect(
        classifyCommandLine("powershell -ExecutionPolicy Bypass -File scripts\\ci.ps1").decision,
      ).toBe("allow");
    });

    it("rejects malformed args even on trusted read-only tools and escalates stray project paths on run_command", () => {
      expect(classifyToolCall("get_state", [] as unknown as Record<string, unknown>).decision).toBe(
        "deny",
      );
      expect(
        classifyToolCall(
          "run_command",
          { CommandLine: "echo ok", TargetFile: "package.json" },
          { workspaceRoot },
        ).decision,
      ).toBe("force_ask");
    });

    it("decodes UTF-16LE PowerShell -EncodedCommand payloads and denies/escalates appropriately", () => {
      const encodedPush = Buffer.from("git push --force", "utf16le").toString("base64");
      expect(classifyCommandLine(`powershell -EncodedCommand ${encodedPush}`).decision).toBe(
        "force_ask",
      );

      const encodedRm = Buffer.from("rm -rf /", "utf16le").toString("base64");
      expect(classifyCommandLine(`powershell -enc ${encodedRm}`).decision).toBe("deny");

      // Invalid/unparseable obfuscated encoded payload fails conservatively to force_ask
      expect(classifyCommandLine("powershell -EncodedCommand !!!notbase64!!!").decision).toBe(
        "force_ask",
      );
    });

    it("enforces deny dominance inside substitutions and background chains", () => {
      expect(classifyCommandLine("echo $(rm -rf /)").decision).toBe("deny");
      expect(classifyCommandLine("npm test & cat .env").decision).toBe("deny");
    });

    it.each(["echo '$(git push --force)'", "echo '`npm install evil`'", 'echo "git push --force"'])(
      "does not falsely trigger on literal single-quoted or harmless echoed text (%s)",
      (cmd) => {
        expect(classifyCommandLine(cmd).decision, cmd).toBe("allow");
      },
    );
  });

  describe("85A-AUD-08: Additional control-plane and project manifest protection policy", () => {
    it.each([
      "scripts/validate.ts",
      ".gemini/settings.json",
      ".claude/settings.json",
      ".agent/workflows/ci.md",
    ])(
      "denies direct write/edit on security control resource %s while permitting read",
      (target) => {
        expect(classifyFilePath(target, "write", workspaceRoot).decision).toBe("deny");
        expect(classifyFilePath(target, "edit", workspaceRoot).decision).toBe("deny");
        expect(classifyFilePath(target, "read", workspaceRoot).decision).toBe("allow");
      },
    );

    it.each(["package.json", "package-lock.json", "tsconfig.json"])(
      "requires fresh confirmation (force_ask) on direct write/edit to %s while preserving reads",
      (target) => {
        expect(classifyFilePath(target, "write", workspaceRoot).decision).toBe("force_ask");
        expect(classifyFilePath(target, "edit", workspaceRoot).decision).toBe("force_ask");
        expect(classifyFilePath(target, "read", workspaceRoot).decision).toBe("allow");
      },
    );
  });

  describe("AUD-F1 through AUD-F4: Quote concatenation and env -S split-string hardening", () => {
    it.each(["'r'm -rf /", 'r"m" -rf /', '"c"at .env', "c'a't .env", "sudo 'r'm -rf /"])(
      "AUD-F1/F2: denies quote-concatenated destructive/secret command (%s)",
      (cmd) => {
        expect(classifyCommandLine(cmd).decision, cmd).toBe("deny");
      },
    );

    it("AUD-F1/F2: escalates quote-concatenated high-risk git command and denies pipe-to-shell destructive payload", () => {
      expect(classifyCommandLine("g'it' push --force").decision).toBe("force_ask");
      expect(classifyCommandLine("echo 'rm -rf /' | bash").decision).toBe("deny");
      expect(classifyCommandLine('echo "rm -rf /" | env -S bash').decision).toBe("deny");
    });

    it.each([
      "echo 'rm -rf /'",
      "echo 'cat .env'",
      "echo 'DROP TABLE users'",
      "git commit -m 'fix rm -rf / note'",
    ])("AUD-F1/F2 safe controls: does not misclassify literal inert text arguments (%s)", (cmd) => {
      expect(classifyCommandLine(cmd).decision, cmd).toBe("allow");
    });

    it.each([
      'echo "git push --force" | env -S bash',
      'env --split-string="git push --force"',
      'env -S"git push --force"',
      'env --split-string "git push --force"',
      'env -S bash -c "git push --force"',
      'env -S "bash -c" "git push --force"',
      'echo "npm install evil" | /usr/bin/env --split-string="sh -u"',
    ])("AUD-F3/F4: escalates env -S / --split-string wrappers and pipe targets (%s)", (cmd) => {
      expect(classifyCommandLine(cmd).decision, cmd).toBe("force_ask");
    });

    it("AUD-F4: preserves deny dominance inside env --split-string payloads and escalates malformed quotes", () => {
      expect(classifyCommandLine("env --split-string='rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine("env -S 'echo ok && rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine("'rm -rf /").decision).toBe("force_ask");
      expect(classifyCommandLine('echo "unclosed').decision).toBe("force_ask");
    });

    it.each([
      'env -S "node scripts/validate.ts"',
      "env -u HOME git status",
      'env -S "git log --oneline"',
    ])("AUD-F3/F4 safe controls: allows benign env / env -S command (%s)", (cmd) => {
      expect(classifyCommandLine(cmd).decision, cmd).toBe("allow");
    });
  });

  describe("Audit Findings 1–4: env -S options, privilege/modifier wrappers, -S=, and commit metadata", () => {
    it("Finding 1: resolves env -S injected options and environment assignments completely", () => {
      expect(classifyCommandLine('env -S "-u HOME rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('env -S "-i bash" -c "rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('echo "git push --force" | env -S "-u HOME bash"').decision).toBe(
        "force_ask",
      );
      expect(
        classifyCommandLine('env -S "-C /tmp --unset=FOO -a alt -- FOO=1 git push --force"')
          .decision,
      ).toBe("force_ask");
      expect(classifyCommandLine("env -S '-i env -S \"rm -rf /\"'").decision).toBe("deny");
      expect(classifyCommandLine('env -S "-u HOME node scripts/validate.ts"').decision).toBe(
        "allow",
      );
      expect(classifyCommandLine('env -S "-u"').decision).toBe("force_ask");
    });

    it("Finding 2: enforces unified doas/sudo privilege unwrapping and deny dominance", () => {
      expect(classifyCommandLine("doas sh -c 'rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine("doas git push --force").decision).toBe("force_ask");
      expect(classifyCommandLine("doas ls").decision).toBe("force_ask");
      expect(classifyCommandLine("doas -u wheel rm -rf /").decision).toBe("deny");
      expect(classifyCommandLine("sudo bash -c 'rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine('sudo sh -c "cat .env"').decision).toBe("deny");
      expect(classifyCommandLine("echo 'rm -rf /' | sudo bash").decision).toBe("deny");
      expect(classifyCommandLine("echo 'git push --force' | doas sh").decision).toBe("force_ask");
      expect(classifyCommandLine("sudo git push --force").decision).toBe("force_ask");
    });

    it("Finding 2: parses timeout, nice, and xargs options without hiding dangerous commands", () => {
      expect(classifyCommandLine("timeout 5 rm -rf /").decision).toBe("deny");
      expect(classifyCommandLine("timeout -k 10s -s KILL 5 bash -c 'cat .env'").decision).toBe(
        "deny",
      );
      expect(
        classifyCommandLine("timeout --signal=TERM 30 node scripts/validate.ts").decision,
      ).toBe("allow");
      expect(classifyCommandLine("timeout 5").decision).toBe("force_ask");

      expect(classifyCommandLine("nice -n 10 rm -rf /").decision).toBe("deny");
      expect(classifyCommandLine("nice --adjustment=-5 git push --force").decision).toBe(
        "force_ask",
      );
      expect(classifyCommandLine("nice -n 10 node scripts/validate.ts").decision).toBe("allow");
      expect(classifyCommandLine("nice -n bad echo hi").decision).toBe("force_ask");

      expect(classifyCommandLine("xargs rm -rf /").decision).toBe("deny");
      expect(classifyCommandLine("xargs -0 -P 4 -I {} sh -c 'rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine("find src -type f | xargs -0 prettier --check").decision).toBe(
        "allow",
      );
      expect(classifyCommandLine("xargs --unknown-flag echo ok").decision).toBe("force_ask");
    });

    it("Finding 2: bounds deeply nested wrapper chains conservatively", () => {
      let deepEnvChain = "echo ok";
      for (let i = 0; i < 18; i++) {
        const escaped = deepEnvChain.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        deepEnvChain = `env -S "${escaped}"`;
      }
      expect(classifyCommandLine(deepEnvChain).decision).toBe("force_ask");

      const deepModifiers = `${"nice -n 1 ".repeat(18)}echo ok`;
      expect(classifyCommandLine(deepModifiers).decision).toBe("force_ask");

      const deepPrivileged = `${"sudo nice -n 1 ".repeat(10)}echo ok`;
      expect(classifyCommandLine(deepPrivileged).decision).toBe("force_ask");
    });

    it("Finding 3: rejects or escalates malformed env -S= forms and validates all env -S variants", () => {
      expect(classifyCommandLine("env -S='rm -rf /'").decision).toBe("deny");
      expect(classifyCommandLine('env -S="git push --force"').decision).toBe("force_ask");
      expect(classifyCommandLine('env -S="echo ok"').decision).toBe("force_ask");
      expect(classifyCommandLine("env -S=").decision).toBe("force_ask");

      expect(classifyCommandLine('env -S "rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('env -S"rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('env --split-string="rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('env --split-string "rm -rf /"').decision).toBe("deny");
      expect(classifyCommandLine('env -S ""').decision).toBe("force_ask");
      expect(classifyCommandLine("env -S").decision).toBe("force_ask");
      expect(classifyCommandLine("env -S 'env -S \"rm -rf /\"'").decision).toBe("deny");
    });

    it("Finding 4: avoids false-positive escalation inside inert Git commit/tag metadata", () => {
      expect(classifyCommandLine("git commit -m 'sudo bash -c rm -rf /'").decision).toBe("allow");
      expect(
        classifyCommandLine(
          'git commit -m "chore: document sudo, takeown, Set-MpPreference" -m "and chmod 777 / git reset --hard"',
        ).decision,
      ).toBe("allow");
      expect(classifyCommandLine('git tag -a v1.0 -m "sudo cleanup note"').decision).toBe("allow");
      expect(classifyCommandLine("sudo git push --force").decision).toBe("force_ask");
      expect(classifyCommandLine("git push --force").decision).toBe("force_ask");
    });
  });
});
