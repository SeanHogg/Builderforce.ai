/**
 * The no-progress breaker: a run whose calls keep being answered from its OWN read cache
 * is circling, and nothing else in the loop can see it.
 *
 * The COUNTER (`CacheServedStreak`, its thresholds) lives once, in `@builderforce/agent-run` (`policy/tools/cacheServedStreak`),
 * where the agent feeds it. What stays here is the Brain's own half: the forced turn a due streak earns, which is written in the Brain's
 * vocabulary (`hand_off`, its change tools), over its run context and trace (`noProgressTurn`).
 *
 * The read guards (`callPreflight.ts`, over `readCoverage.ts`) answer an exact repeat with a stub, a covered
 * window or a replay — correctly, and as a SUCCESS. The kernel's only breaker counts
 * failures, so every one of those answers reset it: chat #5739's run 5 made 40 exact
 * repeats, 20 covered re-reads and 60 replays in 52 turns and changed nothing, and no
 * rule fired. Here a REPEAT the read cache answered counts (a narrower search served from
 * a wider one is reuse, not a repeat, and does not); a call the host actually ran clears
 * the count; a conversational result (`hand_off`, `ask_user`, a router lookup) is neither.
 *
 * Past `CACHE_SERVED_STREAK` in a row, spread over at least
 * `MIN_STREAK_TURNS` model turns (one turn fanning out six reads of a file it holds
 * is not circling), the next turn of a change request that has NOT yet made its change is
 * forced the way the budgets force theirs (`progressBudget.ts`): while planning,
 * `hand_off` alone; once coding, the change tools alone. Never while verifying — a review
 * re-reads the author's files by design. At most `MAX_NO_PROGRESS_TURNS` per run.
 */

import type { BrainToolSpec } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import type { BrainRunContext } from './brainRunContext';
import { budgeted, forcedProgressTurn, progressed, type ForcedTurn } from './progressBudget';

const circling = (n: number): string =>
  `YOU ARE CIRCLING. Your last ${n} calls were all answered from this run's read cache — you already have every one of those results, and re-reading them changes nothing.`;

/**
 * The forced turn a circling change request gets, called after selection with this
 * turn's tools. Null when the run is not circling, is not a change request, has already
 * made its change, is verifying, or has used its forced turns.
 */
export function noProgressTurn(run: BrainRunContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  if (!budgeted(run) || progressed(run) || run.policy.phase === 'verify' || !run.cacheStreak.due()) return null;
  const n = run.cacheStreak.count;
  // No change tool on this turn's menu: the streak waits for one.
  const out = forcedProgressTurn(run, selected, circling(n));
  if (!out) return null;
  run.cacheStreak.consume();
  trace(run, step, n, out.forced);
  return out.turn;
}

function trace(run: BrainRunContext, step: number, streak: number, forced: 'hand_off' | 'change'): void {
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.no_progress',
    args: { step, streak, forced },
    result: `${streak} consecutive call(s) answered from the read cache — this turn offers ${forced === 'hand_off' ? 'hand_off alone' : 'the change tools alone'} and requires a call.`,
  });
}
