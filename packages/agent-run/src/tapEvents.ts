/**
 * tapEvents — the ONE way to observe or extend a run's event sink without replacing it. The wrapped sink still receives every event
 * unchanged (and keeps its `outcome` row); `before` sees each event first, `after` runs once the sink has taken it and may emit
 * further events through the sink it is handed (openRun's `run.routed`).
 */
import type { EventSink } from "./contract.js";
import type { RunEvent } from "./runEvents.js";

export interface EventTap {
  before?(event: RunEvent, meta?: { durationMs?: number }): void;
  after?(event: RunEvent, sink: EventSink | undefined): Promise<void> | void;
}

export function tapEvents(sink: EventSink | undefined, tap: EventTap): EventSink {
  return {
    emit: async (event, meta) => {
      tap.before?.(event, meta);
      await sink?.emit(event, meta);
      await tap.after?.(event, sink);
    },
    ...(sink?.outcome ? { outcome: (row) => sink.outcome?.(row) } : {}),
  };
}
