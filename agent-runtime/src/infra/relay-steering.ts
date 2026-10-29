/**
 * Mid-run steering channel for an in-flight ticket run.
 *
 * When a user sends a follow-up direction to a running execution from the portal, the API
 * relays an `execution.message` frame to this agent host. The run opens one of these
 * channels; the relay pushes steers into it while the run is live, and the run drains it
 * (it is the agent's `SteeringSource` port, `onPremEvents.acknowledgedSteering`) before each
 * model call, so a steer reaches the next call.
 *
 * Once the run has settled the channel is closed and refuses pushes; what was queued but
 * never drained is handed back through {@link SteeringChannel.takeAll} so it can continue
 * as a follow-up run (`relay-late-steers.ts`) instead of being dropped.
 *
 * Kept pure (no gateway/socket deps) so the queue semantics are unit-testable. Dedupe of a
 * re-sent steer happens cloud-side (`execution_messages.consumed_at`), so there is no
 * idempotency key here — only the API's `messageId`, carried through for a late steer.
 */

/** Normalise steering text from the wire: trimmed string or null when unusable. */
export function normalizeSteeringText(text: unknown): string | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed ? trimmed : null;
}

/** A steer that has been accepted but not yet drained. */
export interface QueuedSteer {
  text: string;
  /** The API's row id for the message, when the frame carried one (a follow-up's idempotency key). */
  messageId?: number;
}

export interface SteeringChannel {
  /** Queue a steer for the live run. Returns false once the channel is closed. */
  push(text: unknown, messageId?: number): boolean;
  /** Steers queued but not yet drained. */
  pending(): number;
  /** Take every queued steer's text, oldest first — the agent's `SteeringSource` port. */
  drain(): string[];
  /** Take every queued steer with its message id, oldest first — what a settled run hands back. */
  takeAll(): QueuedSteer[];
  /** Be told the moment a steer is queued; returns the unsubscribe. */
  onPush(listener: () => void): () => void;
  /** True after {@link close}; pushes are refused from then on. */
  closed(): boolean;
  /** Refuse further pushes (the run has settled). Idempotent; what is queued stays takeable. */
  close(): void;
}

/** Create a steering channel. One per run; closed by the run's terminal handling. */
export function createSteeringChannel(): SteeringChannel {
  let queue: QueuedSteer[] = [];
  const listeners = new Set<() => void>();
  let isClosed = false;

  const takeAll = (): QueuedSteer[] => {
    const taken = queue;
    queue = [];
    return taken;
  };

  return {
    push(text, messageId) {
      const normalized = normalizeSteeringText(text);
      if (!normalized || isClosed) return false;
      queue.push(messageId !== undefined ? { text: normalized, messageId } : { text: normalized });
      for (const listener of [...listeners]) listener();
      return true;
    },
    pending: () => queue.length,
    drain: () => takeAll().map((steer) => steer.text),
    takeAll,
    onPush(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    closed: () => isClosed,
    close() {
      isClosed = true;
    },
  };
}
