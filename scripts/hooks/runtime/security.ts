import { logDiagnostic } from "./output.ts";

export interface SafeFallbackResponse {
  exitCode: number;
  output: unknown;
}

/** Determines the safe fallback response based on event failure mode. */
export function resolveSafeFallback(
  event: string,
  hookId: string,
  errorReason: string,
): SafeFallbackResponse {
  logDiagnostic(`Triggering safe fallback for ${hookId} (${event})`, { error: errorReason });

  switch (event) {
    case "PreToolUse":
      // Fail closed: PreToolUse MUST NEVER allow on failure
      return {
        exitCode: 0,
        output: {
          decision: "deny",
          reason: `Execution blocked by Frontier safeguard: Safety check encountered an error (${errorReason}).`,
        },
      };

    case "SessionStart":
      // Degrade gracefully: provide basic session banner without failing conversation start
      return {
        exitCode: 0,
        output: {
          injectSteps: [
            {
              systemMessage: {
                systemMessage:
                  "Frontier Engineer initialized in degraded mode. Safeguard policies active.",
              },
            },
          ],
        },
      };

    case "PostToolUse":
      // Fail open: return standard empty object
      return {
        exitCode: 0,
        output: {},
      };

    case "PreInvocation":
      // Fail open: proceed without reminder injection
      return {
        exitCode: 0,
        output: {
          injectSteps: [],
          terminationBehavior: "",
        },
      };

    case "PostInvocation":
      // Fail open: proceed without diagnostics
      return {
        exitCode: 0,
        output: {
          injectSteps: [],
          terminationBehavior: "",
        },
      };

    case "Stop":
      // Fail open: permit normal termination
      return {
        exitCode: 0,
        output: {},
      };

    default:
      return {
        exitCode: 0,
        output: {},
      };
  }
}
