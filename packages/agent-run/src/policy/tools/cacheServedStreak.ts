/**
 * policy/tools/cacheServedStreak - the no-progress breaker's counter.
 *
 * A run whose calls keep being answered from its OWN read cache is circling, and nothing else in the loop can see it:
 * the read guards (`readCoverage.ts`) answer an exact repeat, a covered window or a replay correctly and as a SUCCESS, and
 * the kernel's only breaker counts failures, so every one of those answers reset it. Here a repeat the cache answered
 * counts; a call that actually ran clears the count; a conversational answer (a tool lookup, a hand-off) is neither.
 *
 * The count is the agent's, fed from where it answers a covered read (`kernelHooks.ts`) and where a surface says its own
 * cache did (`PlatformToolResult.cached`). What a surface DOES about a due streak - force a turn that must change something -
 * is the surface's menu (`PlatformTools.turn`), because which tools "change" and "hand off" are the surface's vocabulary.
 *
 * Ported from `brain-embedded/src/runStore/cacheServedStreak.ts`. Plain JSON in `RunState.reads.servedStreak`, so a stepped
 * run keeps its count. No `node:*` imports, no DOM.
 */

/** Consecutive cache-answered repeats that mark a run as circling. */
export const CACHE_SERVED_STREAK = 6;
/** Distinct model turns the streak must span (one turn fanning out six reads of a file it holds is not circling). */
export const MIN_STREAK_TURNS = 2;
/** Forced no-progress turns one run may have. */
export const MAX_NO_PROGRESS_TURNS = 2;

/** The counter as it crosses a step boundary. */
export interface ServedStreakState {
  streak: number;
  turns: number[];
  fired: number;
}

export class CacheServedStreak {
  private streak: number;
  private readonly turns: Set<number>;
  private fired: number;

  constructor(saved?: ServedStreakState) {
    this.streak = saved?.streak ?? 0;
    this.turns = new Set(saved?.turns ?? []);
    this.fired = saved?.fired ?? 0;
  }

  /** A repeat the read cache answered (stub, covered window, replay, repeated write), on `step`. */
  served(step: number): void {
    this.streak += 1;
    this.turns.add(step);
  }

  /** A call the host actually ran - the run touched the world again. */
  ran(): void {
    this.streak = 0;
    this.turns.clear();
  }

  get count(): number {
    return this.streak;
  }

  /** Whether the streak is due a forced turn. */
  due(): boolean {
    return this.streak >= CACHE_SERVED_STREAK && this.turns.size >= MIN_STREAK_TURNS && this.fired < MAX_NO_PROGRESS_TURNS;
  }

  /** A forced turn was spent on the streak: the count starts over. */
  consume(): void {
    this.ran();
    this.fired += 1;
  }

  /** The counter as plain data. */
  state(): ServedStreakState {
    return { streak: this.streak, turns: [...this.turns], fired: this.fired };
  }
}
