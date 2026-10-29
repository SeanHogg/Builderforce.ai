/**
 * The Brain's EVENT SINK (PRD 35 §3.2 `EventSink`) — the agent's typed `RunEvent` stream
 * rendered as the live trace the panel shows and the durable step rows a reopened chat
 * reads. The labels are the ones every diagnostics reader already keys on
 * (`model.preflight`, `llm.model_downgrade`, `steer.applied`), so a run driven by the agent
 * reads exactly like one driven by the Brain's own loop.
 *
 * The sink renders; it never decides. A run's lifecycle events (`run.started`,
 * `turn.started`, `run.finished` …) have no step of their own — the run cell's `running`
 * flag and activity already say what they say — and are not recorded.
 */

import type { EventSink, RunEvent, RunOutcomeRow } from '@builderforce/agent-run';
import type { BrainTraceEvent } from '../brainTriage';
import type { RunCell } from '../runStore/runCell';
import { emit, nowIso, pushTrace } from '../runStore/runCells';

/** The trace step for an event, or null when the event has no step of its own. Pure. */
export function traceStepFor(event: RunEvent, ts: string): BrainTraceEvent | null {
  switch (event.kind) {
    case 'model.preflight':
      if (event.notices.length === 0) return null;
      return {
        ts,
        category: 'message',
        label: 'model.preflight',
        args: { status: event.status },
        result: `Before the first turn: ${event.notices.join(' ')}`,
      };
    case 'llm.model_downgrade':
      return {
        ts,
        category: 'message',
        label: 'llm.model_downgrade',
        args: { requestedModel: event.requestedModel, model: event.model, step: event.step },
        result: event.reason,
      };
    case 'steer.applied':
      return {
        ts,
        category: 'message',
        label: 'steer.applied',
        args: { step: event.step, messages: 1 },
        result: 'The person sent direction while the run was working; it reached the next model call.',
      };
    default:
      return null;
  }
}

/** Where the run's outcome row goes — the host's usage ledger / learned-routing report. */
export type OutcomeReport = (row: RunOutcomeRow) => Promise<unknown> | void;

/**
 * Build the sink over a run cell. `outcome` is told the uniform §8.2 row once, at the end —
 * it is the host's to store; a rejection is the host's to handle, never the run's.
 */
export function brainEventSink(c: RunCell, outcome?: OutcomeReport): EventSink {
  return {
    emit(event: RunEvent): void {
      const step = traceStepFor(event, nowIso());
      if (step) {
        pushTrace(c, step);
        return;
      }
      // Lifecycle events have no step; the live view still repaints on each of them.
      emit(c);
    },
    ...(outcome ? { outcome: (row: RunOutcomeRow) => outcome(row) } : {}),
  };
}
