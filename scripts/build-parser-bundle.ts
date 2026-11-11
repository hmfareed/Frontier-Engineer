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
  minify: true,
  allowOverwrite: true,
});

console.log("[build-parser-bundle] dist/parser.bundle.js created successfully.");
