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

export interface WorkspaceContainmentResult {
  allowed: boolean;
  canonicalRoot?: string;
  canonicalTarget?: string;
  relativePath?: string;
  reason?: string;
}

function extractWindowsDrive(p: string): { drive: string; isDriveRelative: boolean } | null {
  const m = /^([a-zA-Z]):(.*)$/.exec(p);
  if (!m) return null;
  const rest = m[2];
  return {
    drive: m[1].toUpperCase(),
    isDriveRelative: !rest.startsWith("/") && !rest.startsWith("\\"),
  };
}

function isDevicePath(p: string): boolean {
  return /^[/\\]{2}[.?](?:[/\\]|$)/.test(p);
}

function isUncLikePath(p: string): boolean {
  const fwd = p.replace(/\\/g, "/");
  return fwd.startsWith("//");
}

function parseUncShare(p: string): { server: string; share: string; rest: string[] } | null {
  const fwd = p.replace(/\\/g, "/");
  const m = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(fwd);
  if (!m) return null;
  const rest = m[3] ? m[3].split("/").filter((s) => s.length > 0) : [];
  return {
    server: m[1].toLowerCase(),
    share: m[2].toLowerCase(),
    rest,
  };
}

function isRelativeOutside(rel: string): boolean {
  if (rel === "") return false;
  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    rel.startsWith("../") ||
    rel.startsWith("..\\")
  ) {
    return true;
  }
  return path.isAbsolute(rel);
}

function walkCanonicalTarget(initialCursor: string, segments: string[]): string | null {
  let cursor = initialCursor;
  let missingBoundary = false;

  for (const seg of segments) {
    if (!seg || seg === ".") {
      continue;
    }

    if (seg === "..") {
      if (!missingBoundary) {
        try {
          cursor = fs.realpathSync(cursor);
        } catch {
          return null;
        }
      }
      const parent = path.dirname(cursor);
      cursor = parent;
      if (missingBoundary) {
        try {
          fs.lstatSync(cursor);
          // Stepped back up onto an existing directory (or symlink)
          cursor = fs.realpathSync(cursor);
          missingBoundary = false;
        } catch (err: any) {
          if (!err || err.code !== "ENOENT") {
            return null;
          }
        }
      }
      continue;
    }

    cursor = path.join(cursor, seg);
    if (!missingBoundary) {
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(cursor);
      } catch (err: any) {
        if (err && err.code === "ENOENT") {
          missingBoundary = true;
          continue;
        }
        // Fail closed on ENOTDIR, EACCES, EPERM, ELOOP, etc.
        return null;
      }

      // Existing file, directory, or symlink must resolve via realpathSync.
      // Broken or looping symlinks fail here and must be rejected.
      try {
        cursor = fs.realpathSync(cursor);
      } catch {
        return null;
      }

      void lstat;
    }
  }

  return cursor;
}

/**
 * Resolves and verifies canonical containment of `filePath` inside `workspaceRoot`.
 * Fails safely (`allowed: false`) whenever canonical resolution cannot prove containment.
 */
export function resolveWorkspaceContainment(
  filePath: string,
  workspaceRoot: string,
): WorkspaceContainmentResult {
  if (
    typeof filePath !== "string" ||
    filePath.trim().length === 0 ||
    typeof workspaceRoot !== "string" ||
    workspaceRoot.trim().length === 0
  ) {
    return {
      allowed: false,
      reason: "Path or workspace root is empty; canonical containment cannot be verified.",
    };
  }

  if (filePath.includes("\0") || workspaceRoot.includes("\0")) {
    return {
      allowed: false,
      reason: "Path contains null bytes and is prohibited.",
    };
  }

  if (isDevicePath(filePath) || isDevicePath(workspaceRoot)) {
    return {
      allowed: false,
      reason: "Device paths are outside approved workspace boundaries.",
    };
  }

  // Explicitly validate UNC paths and drive letters across Windows and POSIX hosts
  const targetIsUnc = isUncLikePath(filePath);
  const rootIsUnc = isUncLikePath(workspaceRoot);
  if (targetIsUnc) {
    const targetShare = parseUncShare(filePath);
    const rootShare = rootIsUnc ? parseUncShare(workspaceRoot) : null;
    if (!targetShare) {
      return {
        allowed: false,
        reason: "Malformed UNC path cannot be verified within workspace boundaries.",
      };
    }
    if (
      !rootShare ||
      targetShare.server !== rootShare.server ||
      targetShare.share !== rootShare.share
    ) {
      return {
        allowed: false,
        reason: `UNC path '//${targetShare.server}/${targetShare.share}' is outside the approved workspace.`,
      };
    }
    if (process.platform !== "win32") {
      return {
        allowed: false,
        reason: "UNC path canonical containment cannot be verified on non-Windows hosts.",
      };
    }
  }

  const targetDrive = extractWindowsDrive(filePath);
  const rootDrive = extractWindowsDrive(workspaceRoot);
  if (targetDrive) {
    if (targetDrive.isDriveRelative) {
      return {
        allowed: false,
        reason: `Drive-relative path '${filePath}' is ambiguous and outside verified workspace boundaries.`,
      };
    }
    if (!rootDrive || targetDrive.drive !== rootDrive.drive) {
      return {
        allowed: false,
        reason: `Drive '${targetDrive.drive}:' is outside the approved workspace drive.`,
      };
    }
    if (process.platform !== "win32") {
      return {
        allowed: false,
        reason: "Windows drive-letter paths cannot be canonically verified on non-Windows hosts.",
      };
    }
  }

  // Canonicalize workspace root; fail safely if it does not exist or is not a directory
  let canonicalRoot: string;
  try {
    const resolvedRoot = path.resolve(workspaceRoot);
    canonicalRoot = fs.realpathSync(resolvedRoot);
    if (!fs.statSync(canonicalRoot).isDirectory()) {
      return {
        allowed: false,
        reason: "Approved workspace root is not an existing directory.",
      };
    }
  } catch {
    return {
      allowed: false,
      reason: "Approved workspace root could not be canonically resolved.",
    };
  }

  // Split target into initial anchor + segments so symlinks are resolved before '..' traversal
  let initialCursor: string;
  let segments: string[];

  const normalizedSlashes = filePath.replace(/\//g, path.sep);
  if (targetDrive && process.platform === "win32") {
    const driveRoot = `${targetDrive.drive}:${path.sep}`;
    initialCursor = driveRoot;
    segments = normalizedSlashes.slice(2).split(/[\\/]+/);
  } else if (targetIsUnc && process.platform === "win32") {
    const unc = parseUncShare(filePath)!;
    initialCursor = `\\\\${unc.server}\\${unc.share}\\`;
    segments = unc.rest;
  } else if (filePath.startsWith("/") || filePath.startsWith("\\")) {
    if (process.platform === "win32") {
      const parsedRoot = path.parse(canonicalRoot).root;
      initialCursor = parsedRoot;
    } else {
      initialCursor = "/";
    }
    segments = normalizedSlashes.split(/[\\/]+/);
  } else {
    initialCursor = canonicalRoot;
    segments = normalizedSlashes.split(/[\\/]+/);
  }

  const canonicalTarget = walkCanonicalTarget(initialCursor, segments);
  if (!canonicalTarget) {
    return {
      allowed: false,
      canonicalRoot,
      reason: `Canonical path containment could not be verified for '${filePath}'.`,
    };
  }

  const rel = path.relative(canonicalRoot, canonicalTarget);
  if (isRelativeOutside(rel)) {
    return {
      allowed: false,
      canonicalRoot,
      canonicalTarget,
      reason: `Path '${filePath}' resolves outside the approved workspace boundary.`,
    };
  }

  return {
    allowed: true,
    canonicalRoot,
    canonicalTarget,
    relativePath: rel.replace(/\\/g, "/"),
  };
}

/** Checks whether a file path resolves strictly within the approved workspace. */
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  return resolveWorkspaceContainment(filePath, workspaceRoot).allowed;
}
