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
import { createOutbox, type Outbox } from "@builderforce/write-outbox/core";

/** Events per POST, and the count that sends without waiting. */
const TOOL_AUDIT_MAX_ITEMS = 25;
/** Longest an event waits for a ride. */
const TOOL_AUDIT_MAX_WAIT_MS = 1_500;
/** Events held before the oldest are dropped — bounds memory if the API is unreachable. */
const TOOL_AUDIT_MAX_ENTRIES = 500;
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
  /**
   * Live AND durable, exactly once: the event goes as a `tool.audit` frame over the
   * relay socket when it is up — the relay DO fans it out live and persists it — and
   * over HTTP only when the socket is down or the send failed. Sending both used to
   * write every event twice.
   */
  emit(event: ToolAuditEvent): void;
  /** Durable only (HTTP), for events that have no live frame. */
  persist(event: ToolAuditEvent): void;
  /** Send everything queued. `final` = the process is going away. Never rejects. */
  flush(opts?: { final?: boolean }): Promise<void>;
  close(): void;
}

/** The single-event wire shape every API version accepts — and the body of the live
 *  frame, so the DO-persisted row and the HTTP row are identical (both go through the
 *  same ingest). Stamped once, here, so a batch delay or a fallback never shifts an
 *  event's place on the timeline. */
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
  /** Put a frame on the relay socket; false when it is down or the send threw. */
  sendLive?: (frame: Record<string, unknown>) => boolean;
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
    // A failed batch already reached onError; onDrop reports only what was never sent
    // (overflow), so one failed batch is reported once.
    onDrop: (drop) => {
      if (drop.reason === "failed") return;
      opts.onError(new Error(`tool-audit queue dropped ${drop.count} event(s) (${drop.reason})`));
    },
  });

  return {
    emit: (event) => {
      const wire = toWire(event);
      if (opts.sendLive?.({ type: "tool.audit", ...wire })) return;
      outbox.enqueue("tool-audit", wire);
    },
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

const REMOTE_CHUNK_COALESCE_MS = 250;

/** Join adjacent pieces of the same correlation into one chunk. */
function coalesceRemoteChunks(items: RemoteChunk[]): RemoteChunk[] {
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
