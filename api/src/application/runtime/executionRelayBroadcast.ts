import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Concrete LIVE-STREAM fan-out for execution events — the sink that makes a run's
 * socket work across isolates.
 *
 * The hub ({@link ./executionEvents}) is env-free and only knows the event shape.
 * This sink hands each event to the execution's Durable Object room
 * ({@link ../../infrastructure/relay/broadcastRoom} `executionRoomName`), which is
 * where the viewer's WebSocket actually lives. Because a DO is a single addressable
 * instance, the isolate that EMITS (a cloud tool loop, the durable runner's alarm,
 * the crash-recovery sweep) never has to be the isolate that HOLDS the socket —
 * the whole reason cloud runs had no live tail and self-heal could not push.
 *
 * Frames go out verbatim: the room is a dumb relay, so what the client parses is
 * exactly the `ExecutionSubscriberEvent` the emitter built. Best-effort — a room
 * that is unreachable degrades to the client's reconnect/reconcile poll.
 */

import type { Env } from '../../env';
import { broadcastExecutionEvent } from '../../infrastructure/relay/broadcastRoom';
import type { ExecutionEventSink } from './executionEvents';

export function makeExecutionRelaySink(env: Env): ExecutionEventSink {
  return (event) => {
    if (!env.SESSION_ROOM) return;
    // Fire-and-forget: notifyExecutionSubscribers is synchronous and must not block
    // the run that produced the event.
    void broadcastExecutionEvent(env.SESSION_ROOM, event.executionId, JSON.stringify(event)).catch(
      (error) => reportCaughtError(error, {
        source: 'application/runtime/executionRelayBroadcast.ts',
        operation: 'makeExecutionRelaySink',
        context: { logMessage: '[execution-relay] live frame publish failed', details: { executionId: event.executionId, eventType: event.type, error } },
      }),
    );
  };
}
