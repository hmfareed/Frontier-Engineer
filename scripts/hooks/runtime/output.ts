/**
 * Output protocol emitter for Frontier Engineer hooks runtime.
 * Guarantees that stdout strictly contains valid JSON and stderr handles diagnostics.
 */

import { redactString, redactValue } from "../lib/secret-redactor.ts";

/** Emits a JSON payload strictly to stdout and terminates the stream. */
export function emitOutput(data: unknown, event?: string): void {
  try {
    const jsonStr = JSON.stringify(data ?? {});
    process.stdout.write(jsonStr + "\n");
  } catch (error) {
    const rawErrText = error instanceof Error ? error.message : String(error);
    const errText = redactString(rawErrText);
    const isPreTool =
      event === "PreToolUse" || (typeof data === "object" && data !== null && "decision" in data);
    const fallback = isPreTool
      ? JSON.stringify({
          decision: "deny",
          reason: `Execution blocked by safeguard: Failed to serialize output JSON (${errText}).`,
        })
      : JSON.stringify({
          error: "Failed to serialize output JSON",
          details: errText,
        });
    process.stdout.write(fallback + "\n");
  }
}

/** Emits diagnostic or warning messages to stderr only. Never pollutes stdout. */
export function logDiagnostic(message: string, context?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    let line = `[FRONTIER_HOOK ${timestamp}] ${redactString(message)}`;
    if (context !== undefined) {
      line += ` | ${redactString(JSON.stringify(redactValue(context)))}`;
    }
    process.stderr.write(line + "\n");
  } catch {
    // Fail silent on stderr write issues
  }
}
