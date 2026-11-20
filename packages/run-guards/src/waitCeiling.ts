/**
 * The CEILING on waiting (VS Code chat #157440): a turn that only waits on children or a
 * background job that are still running is not idle — but a wait with no ceiling lets a run
 * sit on a hung child (or a `command_status` on a dev server that never exits) forever.
 *
 * So the ceiling counts CONSECUTIVE wait-only turns with no ground progress, whatever they
 * wait on: past {@link MAX_WAIT_TURNS} of them a waiting turn is idle again and the ladder runs
 * normally. Only ground progress (a delivered report or child-report credit, changed files, a
 * new path, test or check movement) or a call that is not a wait starts the count over. What
 * the waits are waiting ON (their digest — the running handles, a job's id and status;
 * `waitDigestOf` in `delegatedChanges.ts`) is kept for diagnostics only: a run that alternates
 * between waiting on `a1` and on `a2`, or polls two jobs in turn, is still waiting on nothing
 * that moves, and a changed digest must not reset the count.
 *
 * The bound: an owner's `wait_agents` blocks up to `DEFAULT_WAIT_SECONDS` = 300 s
 * (`@builderforce/agent-tools`), so 12 wait-only turns with nothing delivered is about an hour
 * of children that never report — long past a healthy fan-out, short of a run left hanging.
 *
 * The ONE reading of that rule: the progress detector's no-progress window and the
 * diagnostics report (`brain-embedded` `runProgress.ts`) both use it. Pure; plain-JSON state.
 */

/** Consecutive wait-only turns with no ground progress before waiting counts as idle:
 *  3 × `NO_PROGRESS_TURNS` (a literal here so this module imports nothing; a test pins the ratio). */
export const MAX_WAIT_TURNS = 12;

/** The ceiling's plain-JSON state. Both fields are omitted when empty. */
export interface WaitCeilingState {
  /** Consecutive wait-only turns with no ground progress. */
  waitTurns?: number;
  /** What the latest of those turns waited on — for diagnostics only; it never resets the count. */
  waitDigest?: string;
}

export class WaitCeiling {
  private turns: number;
  private digest: string | undefined;

  constructor(state: WaitCeilingState = {}) {
    this.turns = state.waitTurns ?? 0;
    this.digest = state.waitDigest;
  }

  /** One wait-only turn (or wait call) with no ground progress, waiting on `digest`. Returns whether it is still exempt from idling. */
  waited(digest: string): boolean {
    this.turns += 1;
    this.digest = digest;
    return this.turns <= MAX_WAIT_TURNS;
  }

  /** Ground progress, or a call that is not a wait: the count starts over. */
  reset(): void {
    this.turns = 0;
    this.digest = undefined;
  }

  snapshot(): WaitCeilingState {
    return this.turns > 0 ? { waitTurns: this.turns, ...(this.digest !== undefined ? { waitDigest: this.digest } : {}) } : {};
  }
}
