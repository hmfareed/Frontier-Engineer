/**
 * Output protocol emitter for Frontier Engineer hooks runtime.
 * Guarantees that stdout strictly contains valid JSON and stderr handles diagnostics.
 */

/** Emits a JSON payload strictly to stdout and terminates the stream. */
export function emitOutput(data: unknown): void {
  try {
    const jsonStr = JSON.stringify(data ?? {});
    process.stdout.write(jsonStr + "\n");
  } catch (error) {
    const fallback = JSON.stringify({
      error: "Failed to serialize output JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(fallback + "\n");
  }
}

/** Emits diagnostic or warning messages to stderr only. Never pollutes stdout. */
export function logDiagnostic(message: string, context?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    let line = `[FRONTIER_HOOK ${timestamp}] ${message}`;
    if (context !== undefined) {
      line += ` | ${JSON.stringify(context)}`;
    }
    process.stderr.write(line + "\n");
  } catch {
    // Fail silent on stderr write issues
  }
}
