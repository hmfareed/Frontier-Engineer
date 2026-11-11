import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const BUNDLE_PATH = path.join(root, "dist", "parser.bundle.js");

export interface ParserApi {
  createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion?: any,
    setParentNodes?: boolean,
    scriptKind?: any,
  ): any;
  forEachChild<T>(node: any, cbNode: (node: any) => T | undefined): T | undefined;
  SyntaxKind: Record<string, any>;
  ScriptTarget: Record<string, any>;
  ScriptKind: Record<string, any>;
}

let cachedParserPromise: Promise<ParserApi> | null = null;

/**
 * Loads the self-contained TypeScript parser API.
 * Prioritizes the zero-dependency bundled runtime at dist/parser.bundle.js (AC-7201).
 * Falls back to dynamic import of "typescript" in development if the bundle is absent.
 */
export function loadParser(): Promise<ParserApi> {
  if (cachedParserPromise) {
    return cachedParserPromise;
  }

  cachedParserPromise = (async () => {
    // 1. Try bundled parser in dist/parser.bundle.js (zero external dependencies)
    if (fs.existsSync(BUNDLE_PATH)) {
      try {
        const bundleModule = await import(pathToFileURL(BUNDLE_PATH).href);
        const parser = bundleModule.default || bundleModule;
        if (
          typeof parser.createSourceFile === "function" &&
          typeof parser.forEachChild === "function"
        ) {
          return {
            createSourceFile: parser.createSourceFile,
            forEachChild: parser.forEachChild,
            SyntaxKind: parser.SyntaxKind,
            ScriptTarget: parser.ScriptTarget,
            ScriptKind: parser.ScriptKind,
          };
        }
      } catch (bundleErr) {
        // If bundle import fails, fall through to dev fallback
        console.warn("[parser-loader] Warning: Failed to load bundled parser:", bundleErr);
      }
    }

    // 2. Development fallback: try loading typescript directly
    try {
      // @ts-ignore dynamic import for dev environment
      const ts = await import("typescript");
      const parser = ts.default || ts;
      if (
        typeof parser.createSourceFile === "function" &&
        typeof parser.forEachChild === "function"
      ) {
        return {
          createSourceFile: parser.createSourceFile,
          forEachChild: parser.forEachChild,
          SyntaxKind: parser.SyntaxKind,
          ScriptTarget: parser.ScriptTarget,
          ScriptKind: parser.ScriptKind,
        };
      }
    } catch {
      // Ignore fallback error and throw consolidated error below
    }

    throw new Error(
      "Parser runtime bundle missing and typescript module unavailable. " +
        "Ensure dist/parser.bundle.js is built (run: node scripts/build-parser-bundle.ts) " +
        "or typescript is installed in the development environment.",
    );
  })();

  return cachedParserPromise;
}
