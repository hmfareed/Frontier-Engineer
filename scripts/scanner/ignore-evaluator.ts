/**
 * Nested .gitignore evaluator following the official Git ignore specification.
 */

interface CompiledRule {
  raw: string;
  isNegated: boolean;
  directoryOnly: boolean;
  regex: RegExp;
  scope: string; // workspace-relative path where this rule was defined (e.g. "" or "packages/core")
}

interface IgnoreScope {
  scopePath: string; // "" or "src"
  rules: CompiledRule[];
}

export class IgnoreStack {
  private scopes: IgnoreScope[] = [];
  private static HARD_EXCLUSIONS = [".frontier", ".git", ".agents"];

  /** Checks if a path matches hard Frontier exclusions (.frontier, .git, .agents) */
  public isHardExcluded(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    for (const hard of IgnoreStack.HARD_EXCLUSIONS) {
      if (normalized === hard || normalized.startsWith(hard + "/")) {
        return true;
      }
    }
    return false;
  }

  /** Push a new directory scope with lines from that directory's .gitignore */
  public pushScope(scopePath: string, lines: string[]): void {
    const normalizedScope = scopePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const compiled: CompiledRule[] = [];

    for (const rawLine of lines) {
      // Check for comments (# unless escaped \#)
      let line = rawLine;
      if (line.startsWith("#") && !line.startsWith("\\#")) {
        continue;
      }

      // Trailing spaces are ignored unless escaped with backslash
      if (!line.endsWith("\\ ")) {
        line = line.trimEnd();
      }

      if (!line.trim()) continue;

      let isNegated = false;
      if (line.startsWith("!") && !line.startsWith("\\!")) {
        isNegated = true;
        line = line.slice(1);
      } else if (line.startsWith("\\!")) {
        line = line.slice(1);
      } else if (line.startsWith("\\#")) {
        line = line.slice(1);
      }

      let directoryOnly = false;
      if (line.endsWith("/")) {
        directoryOnly = true;
        line = line.slice(0, -1);
      }

      const regex = this.compilePatternToRegex(line);
      compiled.push({
        raw: rawLine,
        isNegated,
        directoryOnly,
        regex,
        scope: normalizedScope,
      });
    }

    this.scopes.push({
      scopePath: normalizedScope,
      rules: compiled,
    });
  }

  /** Pop the topmost scope when leaving a directory */
  public popScope(): void {
    this.scopes.pop();
  }

  /**
   * Evaluates whether a path is ignored.
   * relPath: workspace-relative path (e.g. "src/index.ts" or "vendor/pkg")
   * isDirectory: whether the target path is a directory
   */
  public isIgnored(relPath: string, isDirectory: boolean): boolean {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

    if (this.isHardExcluded(normalized)) {
      return true;
    }

    // Git rule: check if any parent directory segment of normalized is ignored.
    // If a parent directory is ignored, the child cannot be re-included.
    const segments = normalized.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parentDir = segments.slice(0, i).join("/");
      if (this.evaluatePathRules(parentDir, true)) {
        return true;
      }
    }

    return this.evaluatePathRules(normalized, isDirectory);
  }

  private evaluatePathRules(pathToCheck: string, isDirectory: boolean): boolean {
    let ignored = false;

    // Evaluate scopes from root to deepest
    for (const scope of this.scopes) {
      // Rule only applies if path is within this scope
      if (
        scope.scopePath &&
        !pathToCheck.startsWith(scope.scopePath + "/") &&
        pathToCheck !== scope.scopePath
      ) {
        continue;
      }

      // Relative path within this scope
      const relToScope = scope.scopePath
        ? pathToCheck === scope.scopePath
          ? ""
          : pathToCheck.slice(scope.scopePath.length + 1)
        : pathToCheck;

      for (const rule of scope.rules) {
        if (rule.directoryOnly && !isDirectory) {
          continue;
        }

        if (rule.regex.test(relToScope)) {
          ignored = !rule.isNegated;
        }
      }
    }

    return ignored;
  }

  private compilePatternToRegex(pattern: string): RegExp {
    const hasLeadingSlash = pattern.startsWith("/");
    const cleanPattern = pattern.replace(/^\/+/, "");
    const hasInternalSlash = cleanPattern.includes("/");
    const isAnchored = hasLeadingSlash || hasInternalSlash;

    let regexStr = "";
    let i = 0;

    while (i < cleanPattern.length) {
      const char = cleanPattern[i];

      // Handle escaped characters
      if (char === "\\") {
        const next = cleanPattern[i + 1];
        if (next !== undefined) {
          regexStr += "\\" + next;
          i += 2;
          continue;
        } else {
          regexStr += "\\\\";
          i++;
          continue;
        }
      }

      // Handle double-star: /**/ or /** or **/
      if (char === "/" && cleanPattern.slice(i, i + 4) === "/**/") {
        regexStr += "(?:/.+)?/";
        i += 4;
        continue;
      }
      if (char === "/" && cleanPattern.slice(i, i + 3) === "/**") {
        regexStr += "/.*";
        i += 3;
        continue;
      }
      if (char === "*" && cleanPattern[i + 1] === "*") {
        if (cleanPattern.slice(i, i + 3) === "**/") {
          regexStr += "(?:.+/)?";
          i += 3;
          continue;
        } else {
          regexStr += ".*";
          i += 2;
          continue;
        }
      }

      // Handle single star *
      if (char === "*") {
        regexStr += "[^/]*";
        i++;
        continue;
      }

      // Handle single character ?
      if (char === "?") {
        regexStr += "[^/]";
        i++;
        continue;
      }

      // Handle character classes [abc] or [0-9] or [!abc]
      if (char === "[") {
        const closingIdx = cleanPattern.indexOf("]", i + 1);
        if (closingIdx !== -1) {
          let classContent = cleanPattern.slice(i + 1, closingIdx);
          if (classContent.startsWith("!")) {
            classContent = "^" + classContent.slice(1);
          }
          regexStr += "[" + classContent + "]";
          i = closingIdx + 1;
          continue;
        }
      }

      // Escape special regex characters
      if (["\\", ".", "+", "^", "$", "{", "}", "(", ")", "|"].includes(char)) {
        regexStr += "\\" + char;
        i++;
      } else {
        regexStr += char;
        i++;
      }
    }

    if (isAnchored) {
      return new RegExp(`^${regexStr}(?:/.*)?$`);
    } else {
      return new RegExp(`(?:^|/)${regexStr}(?:/.*)?$`);
    }
  }
}
