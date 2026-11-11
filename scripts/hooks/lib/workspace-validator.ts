import fs from "node:fs";
import path from "node:path";

export interface WorkspaceContext {
  available: boolean;
  projectRoot: string;
  isRecognizedProject: boolean;
  hasGit: boolean;
  hasPackageJson: boolean;
  hasPluginJson: boolean;
}

/** Validates and resolves the primary workspace directory. */
export function validateWorkspace(workspacePaths: string[] | undefined): WorkspaceContext {
  if (!workspacePaths || !Array.isArray(workspacePaths) || workspacePaths.length === 0) {
    const cwd = process.cwd();
    return inspectDirectory(cwd);
  }

  const primaryPath = workspacePaths[0];
  if (!primaryPath || typeof primaryPath !== "string") {
    return inspectDirectory(process.cwd());
  }

  const resolved = path.resolve(primaryPath);
  return inspectDirectory(resolved);
}

function inspectDirectory(targetDir: string): WorkspaceContext {
  try {
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return {
        available: false,
        projectRoot: targetDir,
        isRecognizedProject: false,
        hasGit: false,
        hasPackageJson: false,
        hasPluginJson: false,
      };
    }

    const hasGit = fs.existsSync(path.join(targetDir, ".git"));
    const hasPackageJson = fs.existsSync(path.join(targetDir, "package.json"));
    const hasPluginJson = fs.existsSync(path.join(targetDir, "plugin.json"));

    return {
      available: true,
      projectRoot: targetDir,
      isRecognizedProject: hasGit || hasPackageJson || hasPluginJson,
      hasGit,
      hasPackageJson,
      hasPluginJson,
    };
  } catch {
    return {
      available: false,
      projectRoot: targetDir,
      isRecognizedProject: false,
      hasGit: false,
      hasPackageJson: false,
      hasPluginJson: false,
    };
  }
}

/** Checks whether a file path resolves strictly within the approved workspace. */
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    const relative = path.relative(resolvedRoot, resolvedPath);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
