import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Per-execution live event hub — the ONE fan-out point for a single execution's
 * stream (status changes, assistant/user messages, file changes, tool events).
 *
 * ── WHY THIS IS A SINK REGISTRY AND NOT A SOCKET MAP ─────────────────────────
 * It used to hold the browser WebSockets itself, in a module-level `Map`. On
 * Workers that map is PER-ISOLATE, so a run that emitted from a different isolate
 * than the one holding the viewer's socket reached nobody — which is exactly why
 * a cloud run's tool events, and a container hard-death recovered by
 * {@link ./cloudSelfHeal}, could never push a live frame and the UI had to poll.
 *
 * The sockets now live in a Durable Object room instead (see
 * {@link ../../infrastructure/relay/broadcastRoom} `executionRoomName`), which any
 * isolate can publish into and any isolate's upgrade can attach to. This module
 * keeps only the domain event shape and the list of sinks the composition root
 * wires once per isolate — it stays env/db-free so every layer can emit into it
 * without importing infrastructure.
 */

export type ExecutionSubscriberEvent =
  | {
      type: 'status_change' | 'done';
      executionId: number;
      status: string;
      /** The full execution row (`Execution.toPlain()`). Optional: a publisher that
       *  only knows the transition — e.g. the crash recovery in `cloudSelfHeal`,
       *  which holds raw columns rather than a hydrated entity — omits it rather
       *  than shipping a half-populated object a client would render as truth. */
      execution?: unknown;
      /** The run's task, for publishers that omit `execution`. Board fan-out needs
       *  a task id to resolve the project room; it reads this first. */
      taskId?: number;
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
    }
  | {
      /**
       * One tool-audit row, pushed AS IT IS RECORDED. This is the live tail behind
       * the Logs/Timeline views: the same rows the tool-audit REST read returns,
       * delivered instead of polled. `id` is the persisted `tool_audit_events.id`,
       * so a client that also backfilled over REST dedupes exactly rather than by
       * guessing at a timestamp.
       */
      type: 'tool_event';
      executionId: number;
      id: number | null;
      cloudAgentRef: string | null;
      toolName: string;
      category: string;
      result?: string;
      durationMs?: number;
      ts: string;
    };

/**
 * A destination for execution lifecycle events. Two are wired in production:
 *
 *  • the RELAY sink — publishes the event frame into the execution's live room so
 *    whoever holds that run's socket sees it, from any isolate;
 *  • the BOARD sink — additionally pushes a `{type:"changed"}` signal to the run's
 *    PROJECT room so every board / kanban / calendar / list refetches as the run
 *    advances, even for someone who never opened the drawer.
 *
 * Both need env + a db, which this hub deliberately lacks; the composition root
 * registers concrete implementations once per isolate via
 * {@link setExecutionEventSinks}.
 */
export type ExecutionEventSink = (event: ExecutionSubscriberEvent) => void;

let executionEventSinks: ExecutionEventSink[] = [];

/** Replace (never append to) the isolate's sink list — re-running the composition
 *  root must not multiply deliveries. Call with no arguments to clear (tests). */
export function setExecutionEventSinks(...sinks: ExecutionEventSink[]): void {
  executionEventSinks = sinks;
}

/** Emit one execution event to every registered sink. Best-effort and synchronous:
 *  a live-stream failure must never fail the run that produced the event. */
export function notifyExecutionSubscribers(executionId: number, event: ExecutionSubscriberEvent): void {
  for (const sink of executionEventSinks) {
    try {
      sink(event);
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/executionEvents.ts", operation: "notifyExecutionSubscribers", context: { logMessage: '[execution-events] sink failed', details: { executionId, eventType: event.type, error } } });
    }
  }
}
