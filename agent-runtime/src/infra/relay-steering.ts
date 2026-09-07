/**
 * Mid-run steering channel for an in-flight V2 (Claude Agent SDK) execution.
 *
 * When a user sends a follow-up direction to a running execution from the
 * portal, the API relays an `execution.message` frame to this agent host. The
 * SDK only accepts additional user turns in STREAMING-INPUT mode (`query({
 * prompt: AsyncIterable<SDKUserMessage> })`), so a run opens one of these
 * channels, hands it to `query()` as the prompt iterable, and the relay pushes
 * steers into it while the run is live. The first message the channel yields is
 * the task prompt; every later one is a steer, applied as the next turn.
 *
 * Kept pure (no gateway/socket deps) so the wire-shape and the queue semantics
 * are unit-testable. Dedupe of a re-sent steer happens cloud-side
 * (`execution_messages.consumed_at`), so there is no idempotency key here.
 */

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** Normalise steering text from the wire: trimmed string or null when unusable. */
export function normalizeSteeringText(text: unknown): string | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed ? trimmed : null;
}

/** The SDK user turn a steer becomes. Pure so the exact shape is testable. */
export function buildSteeringMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

export interface SteeringChannel {
  /** Queue a steer for the live run. Returns false once the channel is closed. */
  push(text: unknown): boolean;
  /** Steers queued but not yet handed to the SDK. */
  pending(): number;
  /** True after {@link close}; pushes are refused from then on. */
  closed(): boolean;
  /** End the input stream so the SDK run can finish. Idempotent. */
  close(): void;
  /**
   * The prompt iterable for `query()`: yields `initial` first, then every steer
   * in push order, and completes when {@link close} is called and the queue is
   * drained. `onApplied` fires as each steer is actually handed to the SDK.
   */
  messages(initial: string, onApplied?: (text: string) => void): AsyncIterable<SDKUserMessage>;
}

/** Create a steering channel. One per run; closed by the run's terminal handling. */
export function createSteeringChannel(): SteeringChannel {
  const queue: string[] = [];
  let isClosed = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  return {
    push(text) {
      const normalized = normalizeSteeringText(text);
      if (!normalized || isClosed) return false;
      queue.push(normalized);
      notify();
      return true;
    },
    pending: () => queue.length,
    closed: () => isClosed,
    close() {
      if (isClosed) return;
      isClosed = true;
      notify();
    },
    async *messages(initial, onApplied) {
      yield buildSteeringMessage(initial);
      for (;;) {
        if (queue.length) {
          const text = queue.shift()!;
          onApplied?.(text);
          yield buildSteeringMessage(text);
          continue;
        }
        if (isClosed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
