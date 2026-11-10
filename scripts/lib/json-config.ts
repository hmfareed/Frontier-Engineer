import path from "node:path";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { finding } from "./report.ts";
import type { Finding, JsonParseOutcome } from "./types.ts";

const ALLOWED_LOGO_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);

// Ajv 8 is CommonJS. Node's ESM interop yields a constructable default at runtime,
// but its NodeNext type declaration describes a namespace. Bridge the two explicitly.
interface CompiledSchema {
  (value: unknown): boolean;
  errors: ErrorObject[] | null;
}
type AjvConstructor = new (options: { allErrors: boolean; strict: boolean }) => {
  compile(schema: Record<string, unknown>): CompiledSchema;
};
const AjvCtor = Ajv as unknown as AjvConstructor;

export function parseJsonText(text: string, relPath: string): JsonParseOutcome {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      value: undefined,
      finding: finding(
        "error",
        "invalid-json",
        relPath,
        `File is not valid JSON (${message}). Fix the syntax so the plugin loader can read it.`,
      ),
    };
  }
}

/** Parses every authored JSON file. Fixtures are excluded: they are deliberately invalid. */
export function checkJsonSyntax(root: string): Finding[] {
  const findings: Finding[] = [];
  const files = walkFiles(root, (rel) => rel.endsWith(".json") && !isExcluded(rel));
  for (const rel of files) {
    const text = readText(root, rel);
    if (text === null) {
      findings.push(finding("error", "unreadable-json", rel, "File could not be read."));
      continue;
    }
    const outcome = parseJsonText(text, rel);
    if (!outcome.ok && outcome.finding) findings.push(outcome.finding);
  }
  return findings;
}

function readSchema(root: string, relPath: string): Record<string, unknown> {
  const text = readText(root, relPath);
  if (text === null) throw new Error(`Missing local schema: ${relPath}`);
  const outcome = parseJsonText(text, relPath);
  if (!outcome.ok) throw new Error(`Invalid local schema: ${relPath}`);
  return outcome.value as Record<string, unknown>;
}

function describeAjvError(error: ErrorObject): string {
  const location = error.instancePath === "" ? "(root)" : error.instancePath;
  const params = Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : "";
  return `${location}: ${error.message ?? "schema violation"}${params}`;
}

/** Validates an in-memory value against a verified local schema transcription. */
export function validateValueAgainstSchema(
  root: string,
  value: unknown,
  relPath: string,
  schemaRelPath: string,
  rule: string,
): Finding[] {
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const validate = ajv.compile(readSchema(root, schemaRelPath));
  if (validate(value)) return [];

  const details = (validate.errors ?? []).map(describeAjvError).join("; ");
  return [
    finding(
      "error",
      rule,
      relPath,
      `Does not match the verified schema ${schemaRelPath}. ${details || "Unknown violation."}`,
    ),
  ];
}

/** Validates a JSON document against a verified local schema transcription. */
export function validateAgainstSchema(
  root: string,
  relPath: string,
  schemaRelPath: string,
  rule: string,
): Finding[] {
  const text = readText(root, relPath);
  if (text === null) return [];
  const outcome = parseJsonText(text, relPath);
  if (!outcome.ok && outcome.finding) return [outcome.finding];
  return validateValueAgainstSchema(root, outcome.value, relPath, schemaRelPath, rule);
}

export function checkPluginManifest(root: string): Finding[] {
  const findings = validateAgainstSchema(
    root,
    "plugin.json",
    "schemas/plugin.schema.json",
    "invalid-plugin-manifest",
  );

  const text = readText(root, "plugin.json");
  const parsed = text === null ? null : parseJsonText(text, "plugin.json");
  const manifest =
    parsed?.ok && typeof parsed.value === "object" && parsed.value !== null
      ? (parsed.value as Record<string, unknown>)
      : null;

  if (manifest) {
    const logo = manifest.logo;
    if (typeof logo === "string" && logo.length > 0) {
      const extension = path.extname(logo).toLowerCase();
      if (!ALLOWED_LOGO_EXTENSIONS.has(extension)) {
        findings.push(
          finding(
            "error",
            "invalid-logo-extension",
            "plugin.json",
            `logo must be .svg, .png, .jpg, .jpeg or .webp; got "${extension}".`,
          ),
        );
      }
      if (!exists(root, logo)) {
        findings.push(
          finding(
            "error",
            "missing-logo-asset",
            "plugin.json",
            `logo asset "${logo}" does not exist.`,
          ),
        );
      }
    }

    const recommended = ["displayName", "description", "version", "suggestedPrompts", "author"];
    for (const key of recommended) {
      if (!(key in manifest)) {
        findings.push(
          finding(
            "warning",
            "marketplace-field-missing",
            "plugin.json",
            `Add "${key}" before Marketplace submission (agy plugin validate --strict).`,
          ),
        );
      }
    }
  }

  return findings;
}

/** Optional component configs are validated only when present. */
export function checkOptionalConfigs(root: string): Finding[] {
  const findings: Finding[] = [];
  if (exists(root, "mcp_config.json")) {
    findings.push(
      ...validateAgainstSchema(
        root,
        "mcp_config.json",
        "schemas/mcp-config.schema.json",
        "invalid-mcp-config",
      ),
    );
  }
  if (exists(root, "hooks.json")) {
    findings.push(
      ...validateAgainstSchema(
        root,
        "hooks.json",
        "schemas/hooks.schema.json",
        "invalid-hooks-config",
      ),
    );
  }
  return findings;
}

/** Detects config placed where the verified plugin loader will not read it. */
export function checkConfigPlacement(root: string): Finding[] {
  const findings: Finding[] = [];
  const misplaced = [
    "hooks/hooks.json",
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".agents/plugin.json",
  ];
  for (const rel of misplaced) {
    if (exists(root, rel)) {
      findings.push(
        finding(
          "warning",
          "foreign-config-detected",
          rel,
          "This path belongs to another agent platform or a staged extension. Native Antigravity plugins read components at the plugin root.",
        ),
      );
    }
  }
  return findings;
}
