import type { PreInvocationPayload } from "../lib/event-context.ts";

export interface PreInvocationOutput {
  injectSteps: Array<{
    systemMessage: {
      systemMessage: string;
      metadata?: Record<string, unknown>;
    };
  }>;
  terminationBehavior?: string;
}

export function handlePreInvocation(payload: PreInvocationPayload): PreInvocationOutput {
  const invocationNum = payload.invocationNum ?? 1;

  // Reminders must remain concise (under 25 words) and not duplicate full rules
  // Injected on initial turns or periodically to preserve token economy
  if (invocationNum === 1 || invocationNum % 5 === 0) {
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage:
              "Frontier Reminder: Inspect before editing; verify changes with tests before claiming completion; distinguish assumptions from verified facts.",
          },
        },
      ],
      terminationBehavior: "",
    };
  }

  return {
    injectSteps: [],
    terminationBehavior: "",
  };
}
