/**
 * Phase 8.6C: Evaluation Workspace Isolation
 * Safely provisions, bounds, and cleans up isolated temporary workspaces
 * outside the active repository for executable behavioral evaluation scenarios.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "../lib/paths.ts";
import type { IsolatedWorkspace } from "./types.ts";

/** Verifies that a candidate path is strictly contained within a root directory. */
function isContainedPath(targetPath: string, parentDir: string): boolean {
  const normParent = path.resolve(parentDir).toLowerCase();
  const normTarget = path.resolve(targetPath).toLowerCase();
  if (normTarget === normParent) return true;
  return (
    normTarget.startsWith(normParent + path.sep) ||
    normTarget.startsWith(normParent.replace(/\\/g, "/") + "/")
  );
}

export class SafeIsolatedWorkspace implements IsolatedWorkspace {
  readonly path: string;
  private isCleanedUp = false;

  constructor(workspacePath: string) {
    this.path = path.resolve(workspacePath);
  }

  /** Resolves a relative path within the isolated workspace, preventing directory traversal. */
  resolve(relPath: string): string {
    if (this.isCleanedUp) {
      throw new Error(`Cannot access cleaned up isolated workspace: ${this.path}`);
    }
    if (path.isAbsolute(relPath)) {
      throw new Error(`Absolute paths are prohibited in isolated workspace: ${relPath}`);
    }
    const resolved = path.resolve(this.path, relPath);
    if (!isContainedPath(resolved, this.path)) {
      throw new Error(
        `Path traversal detected: '${relPath}' escapes isolated workspace '${this.path}'`,
      );
    }
    return resolved;
  }

  /** Reads a file within the isolated workspace. */
  readFile(relPath: string): string {
    const target = this.resolve(relPath);
    return fs.readFileSync(target, "utf8");
  }

  /** Writes a file within the isolated workspace, creating parent directories as needed. */
  writeFile(relPath: string, content: string): void {
    const target = this.resolve(relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }

  /** Checks if a file or directory exists within the isolated workspace. */
  exists(relPath: string): boolean {
    try {
      const target = this.resolve(relPath);
      return fs.existsSync(target);
    } catch {
      return false;
    }
  }

  /** Cleans up the temporary directory. Idempotent. */
  cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;
    try {
      if (fs.existsSync(this.path)) {
        fs.rmSync(this.path, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Creates an isolated temporary workspace for an evaluation scenario.
 * Ensures strict isolation from the primary project repository.
 */
export function createIsolatedWorkspace(
  scenarioId: string,
  fixtures?: Record<string, string>,
): IsolatedWorkspace {
  const root = repoRoot();
  const safeId = scenarioId.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const randomSuffix = crypto.randomBytes(6).toString("hex");
  const tempBase = path.join(os.tmpdir(), "frontier-eval");

  if (!fs.existsSync(tempBase)) {
    fs.mkdirSync(tempBase, { recursive: true });
  }

  const workspacePath = fs.mkdtempSync(path.join(tempBase, `${safeId}-${randomSuffix}-`));

  // Strict invariant: verify workspacePath is NOT within the project repository
  if (isContainedPath(workspacePath, root)) {
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw new Error(
      `CRITICAL SAFETY VIOLATION: Isolated workspace '${workspacePath}' was created inside repo root '${root}'`,
    );
  }

  const workspace = new SafeIsolatedWorkspace(workspacePath);

  // Initialize standard workspace directory structure
  workspace.writeFile(".frontier/.keep", "");
  workspace.writeFile(".frontier/audit/.keep", "");

  // Write declared fixtures
  if (fixtures) {
    for (const [relPath, content] of Object.entries(fixtures)) {
      workspace.writeFile(relPath, content);
    }
  }

  return workspace;
}
