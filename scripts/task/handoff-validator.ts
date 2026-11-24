/**
 * Phase 8.3 — Handoff and Response Contract Validator
 * Validates outgoing coordinator handoff bundles and incoming specialist responses
 * against the authoritative Draft-07 JSON schema (schemas/handoff.schema.json).
 */

import { validateAgainstCachedSchema } from "../retrieval/schema-validator.ts";
import type { ValidationStatus } from "./types.ts";

export interface HandoffValidationResult {
  valid: boolean;
  status: ValidationStatus;
  errors: string[];
}

export class HandoffValidator {
  /**
   * Validates an outgoing coordinator handoff bundle against #/definitions/handoff.
   */
  public static validateOutgoingHandoff(payload: unknown): HandoffValidationResult {
    if (!payload || typeof payload !== "object") {
      return {
        valid: false,
        status: "INVALID",
        errors: ["Payload must be a non-null JSON object"],
      };
    }

    const res = validateAgainstCachedSchema(payload, "schemas/handoff.schema.json", {
      definitionRef: "#/definitions/handoff",
    });

    return {
      valid: res.valid,
      status: res.valid ? "VALID" : "INVALID",
      errors: res.errors,
    };
  }

  /**
   * Validates an incoming specialist response bundle against #/definitions/response.
   */
  public static validateIncomingResponse(payload: unknown): HandoffValidationResult {
    if (!payload || typeof payload !== "object") {
      return {
        valid: false,
        status: "INVALID",
        errors: ["Payload must be a non-null JSON object"],
      };
    }

    const res = validateAgainstCachedSchema(payload, "schemas/handoff.schema.json", {
      definitionRef: "#/definitions/response",
    });

    return {
      valid: res.valid,
      status: res.valid ? "VALID" : "INVALID",
      errors: res.errors,
    };
  }
}
