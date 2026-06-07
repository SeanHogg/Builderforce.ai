/**
 * Pure helper for steering a running execution.
 *
 * When a user sends a follow-up direction to an in-flight execution from the
 * portal, the API relays an `execution.message` frame to this agent host. We
 * inject it into the live agent session as the next turn by issuing a
 * `chat.send` against the same `main` session the task dispatch runs in.
 *
 * Kept pure (no gateway/socket deps) so the wire-shape is unit-testable.
 */

export interface SteeringInjection {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
}

/**
 * Build the `chat.send` params for a steering message, or null when there is no
 * usable text (so the caller can skip the dispatch). `nowMs` makes the
 * idempotency key unique per send and keeps the function deterministic to test.
 */
export function buildSteeringInjection(
  executionId: number | undefined,
  text: unknown,
  nowMs: number,
): SteeringInjection | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;
  return {
    sessionKey: "main",
    message: trimmed,
    idempotencyKey: `steer-${executionId ?? "na"}-${nowMs}`,
  };
}
