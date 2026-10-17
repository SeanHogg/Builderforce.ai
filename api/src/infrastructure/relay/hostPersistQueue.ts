/**
 * The relay DO's persistence queue: host frames that must reach Postgres (tool audit,
 * usage snapshots, file changes, chat messages) leave in batches instead of one API
 * call — and one INSERT — per frame.
 *
 * Built on THE write outbox (`@builderforce/write-outbox`), not a hand-rolled buffer.
 * Each endpoint is its own lane (chat messages one lane per session), so order is
 * FIFO per kind and a batch never mixes sessions; at most one request per lane is in
 * flight. A lane leaves at {@link HOST_PERSIST_MAX_ITEMS} frames or
 * {@link HOST_PERSIST_MAX_WAIT_MS} after its first frame, whichever comes first, and on
 * {@link HostPersistQueue.flush} (the DO flushes when the host disconnects).
 *
 * Best-effort, exactly like the per-frame POSTs it replaces: a failed batch is
 * reported and dropped. Memory is bounded by {@link HOST_PERSIST_MAX_ENTRIES}; past it
 * the oldest frames are dropped and reported.
 */
import { createOutbox } from '@builderforce/write-outbox';

/** Frames per batch — also the size that sends without waiting. Under the API's
 *  per-request batch cap (`HOST_TELEMETRY_BATCH_MAX`). */
export const HOST_PERSIST_MAX_ITEMS = 50;
/** Longest a frame waits for a ride. Short enough that the portal's durable timeline
 *  trails the live one by about a second. */
export const HOST_PERSIST_MAX_WAIT_MS = 1_000;
/** Frames held across every lane before the oldest are dropped. */
export const HOST_PERSIST_MAX_ENTRIES = 1_000;

/** The batched ingest endpoints (agentHostTelemetryRoutes): body `{ events: [...] }`. */
export type HostTelemetryEndpoint = '/tool-audit' | '/usage-snapshot' | '/file-change';

export interface PersistedChatMessage {
  role: string;
  content: string;
  metadata?: string;
  seq: number;
}

export interface HostPersistQueue {
  event(endpoint: HostTelemetryEndpoint, frame: unknown): void;
  /** `sessionKey` is captured now, not at send time, so a session switch between the
   *  frame and the flush cannot file a message under the wrong session. */
  message(sessionKey: string, msg: PersistedChatMessage): void;
  flush(): Promise<void>;
}

const MESSAGES_LANE = 'messages:';

export function createHostPersistQueue(opts: {
  /** POST `body` to the host's own `/api/agent-hosts/:id{suffix}`. */
  post: (suffix: string, body: unknown) => Promise<void>;
  onError: (error: unknown) => void;
}): HostPersistQueue {
  const outbox = createOutbox<unknown, string>({
    maxItems: HOST_PERSIST_MAX_ITEMS,
    maxWaitMs: HOST_PERSIST_MAX_WAIT_MS,
    maxEntries: HOST_PERSIST_MAX_ENTRIES,
    send: (lane, items) => (lane.startsWith(MESSAGES_LANE)
      ? opts.post('/messages', { sessionKey: lane.slice(MESSAGES_LANE.length), messages: items })
      : opts.post(lane, { events: items })),
    onError: (error) => opts.onError(error),
    onDrop: (drop) => opts.onError(new Error(`host persist queue dropped ${drop.count} frame(s) on ${drop.key} (${drop.reason})`)),
  });
  return {
    event: (endpoint, frame) => { outbox.enqueue(endpoint, frame); },
    message: (sessionKey, msg) => { outbox.enqueue(`${MESSAGES_LANE}${sessionKey}`, msg); },
    flush: () => outbox.flush(),
  };
}
