/**
 * Phase 7.6 — Cached Runtime JSON Schema Validator
 * Compiles Frontier JSON schemas once per process and redacts/sanitizes all diagnostic output.
 */

import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { repoRoot } from "../lib/paths.ts";
import { redactString } from "../hooks/lib/secret-redactor.ts";
import { ContentSanitizer } from "./content-sanitizer.ts";

interface CompiledSchema {
  (value: unknown): boolean;
  errors: ErrorObject[] | null;
}

type AjvConstructor = new (options: { allErrors: boolean; strict: boolean }) => {
  compile(schema: Record<string, unknown>): CompiledSchema;
};

const AjvCtor = Ajv as unknown as AjvConstructor;
const validatorCache = new Map<string, CompiledSchema>();

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function loadRawSchema(root: string, schemaRelPath: string): Record<string, unknown> {
  const fullPath = path.join(root, schemaRelPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing local schema: ${schemaRelPath}`);
  }
  const text = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

function getCompiledValidator(
  root: string,
  schemaRelPath: string,
  definitionRef?: string,
): CompiledSchema {
  const cacheKey = `${path.resolve(root)}::${schemaRelPath}::${definitionRef ?? "*"}`;
  const existing = validatorCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const rawSchema = loadRawSchema(root, schemaRelPath);
  let targetSchema = rawSchema;
  if (definitionRef) {
    const cloned: Record<string, unknown> = { ...rawSchema, $ref: definitionRef };
    delete cloned.oneOf;
    delete cloned.$id;
    targetSchema = cloned;
  }

  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const compiled = ajv.compile(targetSchema);
  validatorCache.set(cacheKey, compiled);
  return compiled;
}

function sanitizeSchemaDiagnostic(raw: string): string {
  const withoutSecrets = redactString(raw);
  const sanitized = ContentSanitizer.sanitizeMetadataText(withoutSecrets).text;
  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}

function formatAjvError(error: ErrorObject): string {
  const location =
    error.instancePath === "" ? "(root)" : sanitizeSchemaDiagnostic(error.instancePath);
  let paramSuffix = "";
  if (error.params && Object.keys(error.params).length > 0) {
    const safeParams = { ...error.params } as Record<string, unknown>;
    if ("allowedValues" in safeParams && Array.isArray(safeParams.allowedValues)) {
      const vals = safeParams.allowedValues.slice(0, 12).map((v) => String(v));
      safeParams.allowedValues = safeParams.allowedValues.length > 12 ? [...vals, "..."] : vals;
    }
    paramSuffix = ` ${sanitizeSchemaDiagnostic(JSON.stringify(safeParams))}`;
  }
  const msg = sanitizeSchemaDiagnostic(error.message ?? "schema violation");
  return `${location}: ${msg}${paramSuffix}`;
}

export function validateAgainstCachedSchema(
  value: unknown,
  schemaRelPath: string,
  options?: { root?: string; definitionRef?: string },
): SchemaValidationResult {
  const root = options?.root ?? repoRoot();
  const validate = getCompiledValidator(root, schemaRelPath, options?.definitionRef);
  if (validate(value)) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).slice(0, 12).map(formatAjvError);
  if ((validate.errors?.length ?? 0) > 12) {
    errors.push(`...and ${(validate.errors?.length ?? 0) - 12} additional schema error(s).`);
  }
  return { valid: false, errors };
}

export function validateWorkspaceConfigValue(
  value: unknown,
  root?: string,
): SchemaValidationResult {
  return validateAgainstCachedSchema(value, "schemas/retrieval-config.schema.json", { root });
}

export function validateRetrievalResponse(
  response: unknown,
  root?: string,
): SchemaValidationResult {
  return validateAgainstCachedSchema(response, "schemas/retrieval-context.schema.json", { root });
}

export function validateHandoffPayload(payload: unknown, root?: string): SchemaValidationResult {
  return validateAgainstCachedSchema(payload, "schemas/handoff.schema.json", { root });
}

export function validateHandoffAttachment(
  attachment: unknown,
  root?: string,
): SchemaValidationResult {
  return validateAgainstCachedSchema(attachment, "schemas/handoff.schema.json", {
    root,
    definitionRef: "#/definitions/retrievalContextAttachment",
  });
}

export function clearSchemaValidatorCache(): void {
  validatorCache.clear();
}
