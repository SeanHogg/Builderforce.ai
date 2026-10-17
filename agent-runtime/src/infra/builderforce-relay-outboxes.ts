/**
 * The relay's background HTTP writers, both on THE write outbox
 * (`@builderforce/write-outbox`) rather than hand-rolled buffers:
 *
 *  - {@link createToolAuditPersister}: the durable tool-audit trail. A run emits one
 *    event per tool call, which used to be one POST — and one INSERT — each. Events now
 *    leave in batches: at {@link TOOL_AUDIT_MAX_ITEMS}, {@link TOOL_AUDIT_MAX_WAIT_MS}
 *    after the first, when a run ends, and on shutdown.
 *  - {@link createRemoteChunkQueue}: live assistant output for a remote session,
 *    coalesced for 250 ms per session (the chunk buffer this replaces).
 *
 * Both stay best-effort, as before: a failed send is logged and dropped, never thrown.
 */
import { createOutbox, type Outbox } from "@builderforce/write-outbox";

/** Events per POST, and the count that sends without waiting. */
export const TOOL_AUDIT_MAX_ITEMS = 25;
/** Longest an event waits for a ride. */
export const TOOL_AUDIT_MAX_WAIT_MS = 1_500;
/** Events held before the oldest are dropped — bounds memory if the API is unreachable. */
export const TOOL_AUDIT_MAX_ENTRIES = 500;
const TOOL_AUDIT_TIMEOUT_MS = 10_000;

export interface ToolAuditEvent {
  executionId?: number;
  toolName: string;
  toolCallId?: string;
  category?: string;
  args?: unknown;
  result?: string;
}

export interface ToolAuditPersister {
  persist(event: ToolAuditEvent): void;
  /** Send everything queued. `final` = the process is going away. Never rejects. */
  flush(opts?: { final?: boolean }): Promise<void>;
  close(): void;
}

/** The single-event wire shape every API version accepts. Stamped when queued, so a
 *  batch delay never shifts an event's place on the timeline. */
function toWire(event: ToolAuditEvent): Record<string, unknown> {
  return {
    // Tie the event to its execution so it's queryable per-run as well as per-host.
    // sessionKey 'main' matches the live relay frame.
    executionId: event.executionId,
    runId: event.executionId != null ? `exec-${event.executionId}` : undefined,
    sessionKey: "main",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    category: event.category,
    args: event.args,
    result: event.result,
    ts: new Date().toISOString(),
  };
}

export function createToolAuditPersister(opts: {
  /** `POST /api/agent-hosts/:id/tool-audit`. */
  url: string;
  apiKey: string;
  onError: (error: unknown) => void;
  fetchImpl?: typeof fetch;
}): ToolAuditPersister {
  const doFetch = opts.fetchImpl ?? fetch;
  const post = (body: unknown): Promise<Response> =>
    doFetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TOOL_AUDIT_TIMEOUT_MS),
    });

  const outbox: Outbox<Record<string, unknown>, string> = createOutbox({
    maxItems: TOOL_AUDIT_MAX_ITEMS,
    maxWaitMs: TOOL_AUDIT_MAX_WAIT_MS,
    maxEntries: TOOL_AUDIT_MAX_ENTRIES,
    send: async (_key, items) => {
      // A lone event goes in the single-event shape, which every API accepts.
      if (items.length === 1) {
        await post(items[0]);
        return;
      }
      const res = await post({ events: items });
      // An API older than batch ingest reads `{ events }` as one nameless event and
      // answers 400: resend one by one, in order, so nothing is lost on a lagging API.
      if (res.status === 400) {
        for (const item of items) await post(item);
      }
    },
    onError: (error) => opts.onError(error),
    onDrop: (drop) => opts.onError(new Error(`tool-audit queue dropped ${drop.count} event(s) (${drop.reason})`)),
  });

  return {
    persist: (event) => { outbox.enqueue("tool-audit", toWire(event)); },
    flush: (flushOpts) => outbox.flush(undefined, flushOpts),
    close: () => outbox.close(),
  };
}

/** One piece of a remote session's live output, with the correlation it belongs to
 *  captured when it was produced (the correlation may be gone by the time it sends). */
export interface RemoteChunk {
  callbackAgentNodeId: string;
  correlationId: string;
  piece: string;
}

export const REMOTE_CHUNK_COALESCE_MS = 250;

/** Join adjacent pieces of the same correlation into one chunk. */
export function coalesceRemoteChunks(items: RemoteChunk[]): RemoteChunk[] {
  const out: RemoteChunk[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.correlationId === item.correlationId && last.callbackAgentNodeId === item.callbackAgentNodeId) {
      last.piece += item.piece;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

/** Per-session (the key) coalescing queue for remote live output. */
export function createRemoteChunkQueue(
  dispatch: (chunk: RemoteChunk) => Promise<void>,
  onError: (error: unknown) => void,
): Outbox<RemoteChunk, string> {
  return createOutbox<RemoteChunk, string>({
    // Only the timer (or an explicit flush) sends: pieces are tiny and many.
    maxItems: 10_000,
    maxWaitMs: REMOTE_CHUNK_COALESCE_MS,
    coalesce: coalesceRemoteChunks,
    send: async (_session, chunks) => {
      for (const chunk of chunks) await dispatch(chunk);
    },
    onError: (error) => onError(error),
  });
}
