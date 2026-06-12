/**
 * Per-execution live event hub — the in-isolate WebSocket fan-out for a single
 * execution's stream (status changes, assistant/user messages, file changes).
 *
 * Extracted from the runtime routes so the cloud-execution engine, the dispatch
 * layer, and the HTTP routes all depend on ONE shared notifier instead of the
 * routes file being a god module that owns everything. The subscriber map is
 * deliberately per-Worker-isolate (a transient WS registry); cross-isolate
 * durability is the job of the persisted telemetry + steering thread, not this.
 */

export type ExecutionSubscriberEvent =
  | {
      type: 'status_change' | 'done';
      executionId: number;
      status: string;
      execution: unknown;
      ts: string;
    }
  | {
      /** A user direction sent to a running execution, or an assistant text delta. */
      type: 'message';
      executionId: number;
      role: 'user' | 'assistant';
      text: string;
      ts: string;
    }
  | {
      /** A file the agent created / modified / deleted during the run. */
      type: 'file_change';
      executionId: number;
      path: string;
      change: 'created' | 'modified' | 'deleted';
      ts: string;
    };

const executionSubscribers = new Map<number, Set<WebSocket>>();

export function subscribeExecution(executionId: number, socket: WebSocket): void {
  const set = executionSubscribers.get(executionId) ?? new Set<WebSocket>();
  set.add(socket);
  executionSubscribers.set(executionId, set);
}

export function unsubscribeExecution(executionId: number, socket: WebSocket): void {
  const set = executionSubscribers.get(executionId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) executionSubscribers.delete(executionId);
}

export function notifyExecutionSubscribers(executionId: number, event: ExecutionSubscriberEvent): void {
  const set = executionSubscribers.get(executionId);
  if (!set || set.size === 0) return;

  const payload = JSON.stringify(event);
  for (const socket of set) {
    try {
      socket.send(payload);
    } catch {
      // ignore broken sockets; close handlers clean up subscriptions.
    }
  }
}
