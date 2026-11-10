/**
 * THE finalize gate of an autonomous run (PRD 41 §12.5): an audit, or a turn started with Auto on, is HELD — journaled
 * `awaiting_input` with a hold (`runRecovery.recordRunHeld`) — instead of being finished `completed` when its run delta
 * STORED blocking codes, or when it changed files and its delta could not be measured. Interactive runs are never
 * expected here, so they are never held.
 *
 * The seams, in the order they usually fire for one run:
 *   1. `expect(runId)` — the run host started an autonomous run it owns (`brainRunHostPorts.ts`).
 *   2. `beforeTerminal` — the run settled; the lifecycle (`hostRunLifecycle.ts`) asks before it writes the terminal status.
 *      A `failed` or `cancelled` run is never held (it is not reported successful anyway) and is decided at once. A
 *      `completed` run waits for its delta. Until the change set hands off, that wait is bounded by `finalizeCeilingMs`
 *      (finalization itself: git status, fingerprints, the change-set records).
 *   3. `port(runId).begin(changes)` — the change set handed off (`onFinalized`): THE GATE'S CLOCK STARTS HERE, `budgetMs`
 *      from now, never from the run's settle — a large repository's finalization does not eat the delta's time.
 *   4. `port(runId).block(rules)` — a delta of this run STORED a record with these blocking codes (`finalizeRunDelta.ts`
 *      calls it only after the store, and only while the computation is live). True: they hold the run. False: the
 *      verdict was already given (or the run is not gated).
 *   5. `port(runId).unmeasured()` — a delta of this run failed, was abandoned or could not be stored.
 *   6. `port(runId).settled()` — every delta of the run is settled, or none will be computed (the change set was never
 *      handed to the delta): the verdict is given now rather than at the deadline.
 *   7. `verdict(runId)` — the start that owns the run awaits the verdict before it resolves, so a caller that reports on
 *      the finished run (an audit's "complete") sees the hold first. `forget(runId)` — the start threw: nobody will read
 *      it, so nothing is kept for it.
 *
 * FAIL-CLOSED (a deliberate contract change: the gate used to hold only computed codes). A run that handed off changes
 * and whose delta errored, was abandoned, or missed the deadline is held `run_delta_unmeasured`, releasable exactly like
 * a blocking hold. So is a run whose finalization outlived its ceiling: the gate cannot tell it changed nothing. A run
 * with no change set, or one with no changes, is never held.
 */

import { RUN_DELTA_HOLD_PREFIX, RUN_DELTA_UNMEASURED, type RunHold, type RunTerminalStatus } from "../runRecovery";

/** What one run's delta tells the gate. */
export interface RunHoldPort {
  /** The change set handed off; `changes` false: it committed nothing, so there is nothing to measure. Starts the clock. */
  begin(changes: boolean): void;
  /** A delta of this run STORED these blocking codes. True when they hold the run. */
  block(rules: readonly string[]): boolean;
  /** A delta of this run could not be measured (failed, abandoned, or not stored). */
  unmeasured(): void;
  /** Every delta of this run is settled (or none will be computed). */
  settled(): void;
}

export interface RunHoldGate {
  /** An autonomous run the host owns has started: its completion waits for its delta. */
  expect(runId: string): void;
  port(runId: string): RunHoldPort;
  /** The lifecycle's `beforeTerminal`: the run's hold, or undefined. Never rejects. */
  beforeTerminal(run: { runId: string; status: RunTerminalStatus }): Promise<RunHold | undefined>;
  /**
   * The verdict `beforeTerminal` gave (or is waiting to give) this run, for the start that owns it: an autonomous start
   * resolves only after it, so its caller never reports a held run complete. Read once; resolves undefined for a run the
   * gate never decided.
   */
  verdict(runId: string): Promise<RunHold | undefined>;
  /** The owning start ended without reading its verdict (it threw): drop what the gate keeps for the run. */
  forget(runId: string): void;
}

/** The hold's reason: names the blocking rule ids. */
export const holdReason = (rules: readonly string[]): string => `${RUN_DELTA_HOLD_PREFIX}${rules.join(",")}`;

/** The unmeasured hold (fail-closed): no rules, released like any other. */
export const UNMEASURED_HOLD: Readonly<RunHold> = Object.freeze({ reason: RUN_DELTA_UNMEASURED, rules: [] });

/** Which wait ran out. */
export type RunHoldTimeout = "delta" | "finalize";

interface Pending {
  rules: Set<string>;
  unmeasured: boolean;
  settled: boolean;
  /** The change set handed off with changes: the gate's clock is running. */
  measuring: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** Set once the run has completed and waits: gives the verdict. */
  decide?: () => void;
}

export function createRunHoldGate(opts: {
  /** From hand-off: the delta's own budget plus the time to load and store it. */
  budgetMs: number;
  /** From the run's settle until hand-off: how long finalization may take before the run is held unmeasured. */
  finalizeCeilingMs: number;
  onTimeout?(runId: string, ms: number, which: RunHoldTimeout): void;
}): RunHoldGate {
  const pending = new Map<string, Pending>();
  /** The verdicts given or being given, until the owning start reads them (or forgets them). */
  const given = new Map<string, Promise<RunHold | undefined>>();
  const verdictOf = (run: Pending): RunHold | undefined => {
    const rules = [...run.rules];
    if (rules.length > 0) return { reason: holdReason(rules), rules };
    return run.unmeasured ? { ...UNMEASURED_HOLD, rules: [] } : undefined;
  };
  const arm = (run: Pending, ms: number, expire: () => void): void => {
    if (run.timer) clearTimeout(run.timer);
    run.timer = setTimeout(expire, ms);
  };
  const settle = (run: Pending): void => {
    if (run.timer) clearTimeout(run.timer);
    run.timer = undefined;
    run.settled = true;
    run.decide?.();
  };
  const begin = (runId: string, changes: boolean): void => {
    const run = pending.get(runId);
    if (!run || run.settled || !changes) return;
    run.measuring = true;
    arm(run, opts.budgetMs, () => {
      opts.onTimeout?.(runId, opts.budgetMs, "delta");
      run.unmeasured = true;
      settle(run);
    });
  };
  const block = (runId: string, rules: readonly string[]): boolean => {
    const run = pending.get(runId);
    if (!run || run.settled || rules.length === 0) return false;
    for (const rule of rules) run.rules.add(rule);
    return true;
  };
  const unmeasured = (runId: string): void => {
    const run = pending.get(runId);
    if (run && !run.settled) run.unmeasured = true;
  };
  const settled = (runId: string): void => {
    const run = pending.get(runId);
    if (run && !run.settled) settle(run);
  };
  return {
    expect(runId) {
      if (!pending.has(runId)) pending.set(runId, { rules: new Set(), unmeasured: false, settled: false, measuring: false });
    },
    port: (runId) => ({
      begin: (changes) => begin(runId, changes),
      block: (rules) => block(runId, rules),
      unmeasured: () => unmeasured(runId),
      settled: () => settled(runId),
    }),
    beforeTerminal({ runId, status }) {
      const run = pending.get(runId);
      if (!run) return Promise.resolve(undefined);
      if (status !== "completed") {
        if (run.timer) clearTimeout(run.timer);
        pending.delete(runId);
        given.set(runId, Promise.resolve(undefined));
        return Promise.resolve(undefined);
      }
      const verdict = new Promise<RunHold | undefined>((resolve) => {
        run.decide = () => {
          pending.delete(runId);
          resolve(verdictOf(run));
        };
        if (run.settled) return run.decide();
        // Not handed off yet: finalization gets its own ceiling. Handed off: the delta's deadline is already running.
        if (!run.measuring) {
          arm(run, opts.finalizeCeilingMs, () => {
            opts.onTimeout?.(runId, opts.finalizeCeilingMs, "finalize");
            run.unmeasured = true;
            settle(run);
          });
        }
      });
      given.set(runId, verdict);
      return verdict;
    },
    verdict(runId) {
      const verdict = given.get(runId) ?? Promise.resolve(undefined);
      given.delete(runId);
      return verdict;
    },
    forget(runId) {
      given.delete(runId);
      const run = pending.get(runId);
      // A run the lifecycle is still deciding keeps its entry until the verdict lands (decide deletes it); one never asked
      // about is dropped now, with its timer.
      if (run && !run.decide) {
        if (run.timer) clearTimeout(run.timer);
        pending.delete(runId);
      }
    },
  };
}
