/**
 * Safe stdin reader and parser for Antigravity hook payloads.
 * Protects against buffer overflows, unclosed streams, and malformed JSON.
 */

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB limit

export interface InputResult<T = Record<string, unknown>> {
  success: boolean;
  payload?: T;
  rawText?: string;
  error?: string;
}

/** Reads the full content of stdin up to MAX_PAYLOAD_BYTES. */
export async function readStdin(timeoutMs = 5000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        // If data was received, resolve what we got; otherwise reject
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks).toString("utf8"));
        } else {
          reject(new Error(`Timeout waiting for stdin after ${timeoutMs}ms`));
        }
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    }

    function onData(chunk: Buffer) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_PAYLOAD_BYTES) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`Payload size exceeded limit of ${MAX_PAYLOAD_BYTES} bytes`));
        }
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    }

    function onError(err: Error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);

    // If stdin is already finished / paused in certain environments
    if (process.stdin.readableEnded) {
      onEnd();
    }
  });
}

/** Reads and parses JSON payload from stdin safely. */
export async function parseStdinPayload<T = Record<string, unknown>>(
  timeoutMs = 5000,
): Promise<InputResult<T>> {
  try {
    const raw = await readStdin(timeoutMs);
    const trimmed = raw.trim();

    if (!trimmed) {
      return { success: false, rawText: "", error: "Empty stdin received" };
    }

    const payload = JSON.parse(trimmed) as T;
    return { success: true, payload, rawText: trimmed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
