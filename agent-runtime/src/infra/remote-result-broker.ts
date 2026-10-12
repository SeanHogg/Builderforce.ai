/**
 * RemoteResultBroker — resolves pending remote dispatch callbacks.
 *
 * When the orchestrator dispatches a task to a remote agentNode, it registers a
 * pending callback keyed by correlationId. When the remote agentNode sends the
 * result back (via remote.task.result relay message), the relay calls
 * resolveRemoteResult() to unblock the waiting orchestrator task.
 *
 * P4-3: Adds backpressure — when more than maxConcurrentRemote pending tasks
 * exist, new awaits are queued (FIFO) until a slot becomes available.
 */

type PendingCallback = {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  onChunk?: (chunk: string) => void;
};

/** A live chunk or terminal result from a remote agentNode. */
export type RemoteCallbackFrame =
  | { kind: "chunk"; correlationId: string; chunk: string }
  | { kind: "result"; correlationId: string; result: string };

/**
 * Normalize the two on-wire protocols into one frame:
 *   - runtime:  `remote.task.chunk` / `remote.task.result` + `correlationId`
 *   - docs/DO:  `remote.result.chunk` / `remote.result` + `taskCorrelationId`
 */
export function parseRemoteCallbackFrame(msg: Record<string, unknown>): RemoteCallbackFrame | null {
  const type = typeof msg.type === "string" ? msg.type : "";
  const correlationId =
    (typeof msg.correlationId === "string" && msg.correlationId) ||
    (typeof msg.taskCorrelationId === "string" && msg.taskCorrelationId) ||
    "";
  if (!correlationId) {
    return null;
  }
  if (type === "remote.task.chunk" || type === "remote.result.chunk") {
    const chunk =
      typeof msg.chunk === "string" ? msg.chunk : typeof msg.result === "string" ? msg.result : "";
    return { kind: "chunk", correlationId, chunk };
  }
  if (type === "remote.task.result" || type === "remote.result") {
    const result = typeof msg.result === "string" ? msg.result : "";
    return { kind: "result", correlationId, result };
  }
  return null;
}

/**
 * Fold an assistant event into the accumulated remote-task text.
 * Prefers `delta` (incremental) so we don't double-count full-text snapshots.
 */
export function applyAssistantChunk(
  accumulated: string,
  data: { delta?: unknown; text?: unknown },
): { accumulated: string; piece: string } {
  const delta = typeof data.delta === "string" ? data.delta : "";
  const text = typeof data.text === "string" ? data.text : "";
  if (delta) {
    return { accumulated: accumulated + delta, piece: delta };
  }
  if (text) {
    return { accumulated: text, piece: text };
  }
  return { accumulated, piece: "" };
}

const pending = new Map<string, PendingCallback>();

// ── Backpressure queue (P4-3) ────────────────────────────────────────────────

/** Queue of register-callbacks waiting for a dispatch slot. */
const waitQueue: Array<() => void> = [];

/** Maximum number of simultaneously active remote result awaits. Configurable via setMaxConcurrentRemote(). */
let maxConcurrentRemote = 5;

/** Update the maximum concurrent remote task limit. */
export function setMaxConcurrentRemote(max: number): void {
  maxConcurrentRemote = Math.max(1, max);
}

/** Release a dispatch slot, unblocking the next waiter if any. */
function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
  }
}

/** Register the timeout + pending entry. Single source for slow + fast paths (DRY). */
function registerPending(
  correlationId: string,
  timeoutMs: number,
  resolve: (result: string) => void,
  reject: (err: Error) => void,
  onChunk?: (chunk: string) => void,
): void {
  const timeoutHandle = setTimeout(() => {
    pending.delete(correlationId);
    releaseSlot();
    reject(
      new Error(
        `Remote task timed out after ${timeoutMs / 1000}s (correlationId=${correlationId})`,
      ),
    );
  }, timeoutMs);
  pending.set(correlationId, { resolve, reject, timeoutHandle, onChunk });
}

/**
 * Wait up to timeoutMs for a result keyed by correlationId.
 * Rejects with a timeout error if no result arrives in time.
 *
 * Fast path (slot available): the `pending` entry is registered **synchronously**
 * before this function returns, so callers can race a `resolveRemoteResult` /
 * `pendingRemoteCount` call right after the call without a missing-entry race.
 *
 * Slow path (`pending.size >= maxConcurrentRemote`): the registration is queued
 * FIFO and runs once an earlier task releases its slot.
 */
export function awaitRemoteResult(
  correlationId: string,
  timeoutMs = 300_000,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (pending.size < maxConcurrentRemote) {
      registerPending(correlationId, timeoutMs, resolve, reject, onChunk);
    } else {
      waitQueue.push(() => registerPending(correlationId, timeoutMs, resolve, reject, onChunk));
    }
  });
}

/**
 * Resolve a pending remote result. Called by the relay when remote.task.result arrives.
 */
export function resolveRemoteResult(correlationId: string, result: string): boolean {
  const cb = pending.get(correlationId);
  if (!cb) {
    return false;
  }
  clearTimeout(cb.timeoutHandle);
  pending.delete(correlationId);
  releaseSlot();
  cb.resolve(result);
  return true;
}

/**
 * Push a live result chunk to whoever is awaiting this correlationId.
 * Returns false when no waiter is registered (chunk is dropped).
 */
export function pushRemoteResultChunk(correlationId: string, chunk: string): boolean {
  const cb = pending.get(correlationId);
  if (!cb || !chunk) {
    return false;
  }
  cb.onChunk?.(chunk);
  return true;
}

/** How many pending callbacks are waiting. */
export function pendingRemoteCount(): number {
  return pending.size;
}
