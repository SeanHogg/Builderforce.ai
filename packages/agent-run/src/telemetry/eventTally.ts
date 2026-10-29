/**
 * telemetry/eventTally — fold a `RunEvent` trace into the base outcome counts.
 *
 * The trace is what every adapter must match (the conformance oracle), and the
 * outcome row's base counts (steps, toolCalls, toolErrors, model) are exactly the
 * fold of that trace. A live adapter that streams events but never reaches a
 * terminal `run.finished` (a crash, a killed process) still leaves a tally a
 * caller can persist; a completed run's `settle()` builds the row from the same
 * fold, so the two never disagree.
 *
 * PURE: the tally is plain JSON, folded one event at a time.
 */

import type { ModelUsage, RunEvent } from "../contract.js";
import { foldTurnCost, reportedRunCost, type RunCost } from "./costTally.js";

/** The base counts folded from a run's event trace. */
export interface EventTally {
  steps: number;
  toolCalls: number;
  toolErrors: number;
  /** The model the run locked onto (the last one a turn completed with). */
  model?: string;
  /** Sum of input+output tokens across turns. */
  tokens?: number;
  /** Sum of cache-read tokens across turns. */
  cacheReadTokens?: number;
  /** The run's cost as it is REPORTED: the sum when every turn was priced, undefined when any turn was
   *  not (unknown, never a partial sum) or none ran (see `costTally.ts`). */
  cost?: number;
  /** The running sum of the priced turns and the unpriced latch behind `cost` — fold state, not a figure. */
  costRun?: RunCost;
}

/** An empty tally — a run that emitted nothing has all-zero counts. */
export function emptyTally(): EventTally {
  return { steps: 0, toolCalls: 0, toolErrors: 0 };
}

/** Fold one event into the tally. Unknown event kinds change nothing. */
export function foldEvent(tally: EventTally, event: RunEvent): EventTally {
  switch (event.kind) {
    case "run.started":
    case "turn.started":
      // Steps advance on the run/turn boundary; the driver's state.step is the
      // authoritative count, the trace just observes it.
      break;
    case "model.completed": {
      if (event.model) tally.model = event.model;
      const usage: ModelUsage | undefined = event.usage;
      tally.costRun = foldTurnCost(tally.costRun ?? {}, usage?.costMc);
      tally.cost = reportedRunCost(tally.costRun);
      if (usage) {
        const turnTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        tally.tokens = (tally.tokens ?? 0) + turnTokens;
        if (usage.cacheReadTokens) {
          tally.cacheReadTokens = (tally.cacheReadTokens ?? 0) + usage.cacheReadTokens;
        }
      }
      break;
    }
    case "tool.dispatched":
      tally.toolCalls += 1;
      if (!event.ok) tally.toolErrors += 1;
      break;
    case "turn.finished":
      tally.steps += 1;
      break;
    case "run.finished":
      // The terminal boundary; the outcome kind is not a count.
      break;
  }
  return tally;
}

/** Fold a whole trace in order. */
export function foldTrace(events: Iterable<RunEvent>): EventTally {
  const tally = emptyTally();
  for (const event of events) foldEvent(tally, event);
  return tally;
}
