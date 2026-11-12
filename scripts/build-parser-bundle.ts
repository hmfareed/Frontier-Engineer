import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

console.log("[build-parser-bundle] Building self-contained parser bundle with esbuild...");

await esbuild.build({
  entryPoints: [path.join(root, "scripts", "extractor", "parser-entry.ts")],
  outfile: path.join(root, "dist", "parser.bundle.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);`,
  },
  minify: true,
  allowOverwrite: true,
});

await esbuild.build({
  entryPoints: [path.join(root, "scripts", "extractor", "parser-entry.ts")],
  outfile: path.join(root, "dist", "parser.bundle.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  allowOverwrite: true,
});

console.log(
  "[build-parser-bundle] dist/parser.bundle.js and dist/parser.bundle.cjs created successfully.",
);
