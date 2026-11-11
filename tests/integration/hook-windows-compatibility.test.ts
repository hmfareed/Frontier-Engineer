import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFilePath } from "../../scripts/hooks/lib/command-classifier.ts";
import {
  isWithinWorkspace,
  validateWorkspace,
} from "../../scripts/hooks/lib/workspace-validator.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";

const root = repoRoot();

describe("Windows compatibility and path handling", () => {
  it("normalizes Windows backslashes and case when classifying paths", () => {
    const winPath = "C:\\Projects\\Frontier-Engineer\\.env";
    const result = classifyFilePath(winPath, "read");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain(".env");

    const winSafe = "C:\\Projects\\Frontier-Engineer\\src\\index.ts";
    const safeResult = classifyFilePath(winSafe, "read");
    expect(safeResult.decision).toBe("allow");
  });

  it("accurately detects workspace boundary confinement on Windows paths", () => {
    const inside = path.join(root, "scripts", "validate.ts");
    expect(isWithinWorkspace(inside, root)).toBe(true);

    const outside = path.resolve(root, "..", "OtherProject", "secret.txt");
    expect(isWithinWorkspace(outside, root)).toBe(false);
  });

  it("inspects workspace root accurately across Windows drive notations", () => {
    const context = validateWorkspace([root]);
    expect(context.available).toBe(true);
    expect(context.isRecognizedProject).toBe(true);
    expect(context.hasPackageJson).toBe(true);
  });

  if (process.platform === "win32") {
    it("runs hook dispatcher successfully via cmd.exe /c", () => {
      const dispatcherPath = path.join(root, "scripts", "hooks", "runtime", "dispatcher.ts");
      const cmd = `echo {"toolCall":{"name":"run_command","args":{"CommandLine":"git status"}}} | node "${dispatcherPath}" --hook frontier-pre-tool-safety --event PreToolUse`;
      const output = execSync(cmd, { shell: "cmd.exe", cwd: root }).toString("utf8");
      const parsed = JSON.parse(output.trim());
      expect(parsed.decision).toBe("allow");
    });
  }
});
