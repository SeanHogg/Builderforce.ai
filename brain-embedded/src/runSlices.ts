/**
 * A chat's trace, cut into its RUNS.
 *
 * A copied diagnostic carries the whole chat's trace — every message, every run, over
 * hours. Scored as one run, chat #5739 reported "51% of calls revisited ground, 138 EXACT
 * duplicates" across its runs and twenty-five hours: re-reads after its own edits, and
 * reads in a fresh run whose cache had started empty, all counted as one loop. The loop
 * was real, but it was two runs, and the headline could not say which.
 *
 * No run marker is persisted, but every run's model turns count `step` from its start, so
 * a run begins where that count RESETS. Each reset takes the latest message from the
 * person before it as its ask (none ⇒ a wake run with no ask); a person message that
 * arrives with no reset after it was steered INTO the running run and stays inside it
 * (chat #5739's "runs" 2 and 3 were steers at steps 11 and 15). A trace with no step
 * numbers falls back to cutting at each person message. Pure.
 */

import type { BrainTraceEvent } from './brainTriage';
import type { BrainMessage } from './types';

export interface RunSlice {
  /** The person's message that started this run ('' for a wake run or a trace with none). */
  ask: string;
  events: BrainTraceEvent[];
  /** This run's messages: its starting message and everything up to the next run. */
  messages: BrainMessage[];
}

const at = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

const stepOf = (ev: BrainTraceEvent): number | null => {
  if (ev.label !== 'llm.complete') return null;
  const step = (ev.args as { step?: unknown } | undefined)?.step;
  return typeof step === 'number' && Number.isFinite(step) ? step : null;
};

/** Where each run starts: `{ t, ask }`, oldest first. */
function runStarts(events: readonly BrainTraceEvent[], persons: readonly BrainMessage[]): Array<{ t: number; ask: string }> {
  const turns = events
    .map((ev) => ({ t: at(ev.ts), step: stepOf(ev) }))
    .filter((x): x is { t: number; step: number } => x.step !== null && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (turns.length === 0) return persons.map((m) => ({ t: at(m.createdAt), ask: m.content }));
  const starts: Array<{ t: number; ask: string }> = [];
  let prevStep = Number.POSITIVE_INFINITY;
  let prevTurn = Number.NEGATIVE_INFINITY;
  let prevStart = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    // A count that went DOWN is a new run. The same step again is one only when a person
    // message came between (two one-turn runs); otherwise it is the same turn re-asked
    // (the coder re-ask, the forced closing answer).
    const messaged = persons.some((m) => at(m.createdAt) > prevTurn && at(m.createdAt) <= turn.t);
    const reset = starts.length === 0 || turn.step < prevStep || (turn.step === prevStep && messaged);
    prevStep = turn.step;
    prevTurn = turn.t;
    if (!reset) continue;
    // The run's ask: the latest person message since the previous run began.
    const asked = [...persons].reverse().find((m) => at(m.createdAt) <= turn.t && at(m.createdAt) > prevStart);
    const t = asked ? at(asked.createdAt) : turn.t;
    starts.push({ t, ask: asked?.content ?? '' });
    prevStart = t;
  }
  return starts;
}

/** Cut `events` / `messages` into runs, oldest first. Always at least one slice. */
export function splitRuns(events: readonly BrainTraceEvent[], messages: readonly BrainMessage[]): RunSlice[] {
  const persons = messages
    .filter((m) => m.role === 'user' && Number.isFinite(at(m.createdAt)))
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
  const starts = persons.length === 0 ? [] : runStarts(events, persons);
  if (starts.length <= 1) return [{ ask: starts[0]?.ask ?? persons[0]?.content ?? '', events: [...events], messages: [...messages] }];

  const slices: RunSlice[] = starts.map((s) => ({ ask: s.ask, events: [], messages: [] }));
  // The slice an instant belongs to: the last run started at or before it.
  const sliceAt = (iso: string): RunSlice => {
    const t = at(iso);
    let i = 0;
    if (Number.isFinite(t)) while (i + 1 < starts.length && starts[i + 1]!.t <= t) i++;
    return slices[i]!;
  };
  for (const ev of events) sliceAt(ev.ts).events.push(ev);
  for (const m of messages) sliceAt(m.createdAt).messages.push(m);
  return slices;
}
