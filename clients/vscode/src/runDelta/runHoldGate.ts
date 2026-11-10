/**
 * THE finalize gate of an autonomous run (PRD 41 §12.5): an audit, or a turn started with Auto on, whose run delta has
 * blocking codes is HELD — journaled `awaiting_input` with the blocking rule ids (`runRecovery.recordRunHeld`) — instead
 * of being finished `completed`. Interactive runs are never expected here, so they are never held.
 *
 * The seams, in the order they fire for one run:
 *   1. `expect(runId)` — the run host started an autonomous run it owns (`brainRunHostPorts.ts`).
 *   2. `beforeTerminal` — the run settled; the lifecycle (`hostRunLifecycle.ts`) asks before it writes the terminal status.
 *      A `failed` or `cancelled` run is never held (it is not reported successful anyway) and is released at once. A
 *      `completed` run waits for its delta, at most `budgetMs` (the delta's own budget, `RUN_DELTA_BUDGET_MS`).
 *   3. `port(runId).block(rules)` — a delta of this run computed blocking codes (`finalizeRunDelta.ts`). True: they hold
 *      the run, and the delta's record carries them as `blocked`. False: the verdict was already given (or the run is not
 *      gated), so nothing it says can hold the run any more and the record does not claim it did.
 *   4. `port(runId).settled()` — every delta of the run is settled (stored, failed or abandoned), or none will be computed
 *      (the change set was never handed to the delta): the verdict is given now rather than at the deadline.
 *   5. `verdict(runId)` — the start that owns the run awaits the verdict before it resolves, so a caller that reports on
 *      the finished run (an audit's "complete") sees the hold first.
 *
 * Fail-closed only for COMPUTED blocking codes: a delta that fails, is abandoned or misses the deadline holds nothing.
 */

import type { RunHold, RunTerminalStatus } from "../runRecovery";

/** What one run's delta tells the gate. */
export interface RunHoldPort {
  /** A delta of this run computed these blocking codes. True when they hold the run. */
  block(rules: readonly string[]): boolean;
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
}

/** The hold's reason: names the blocking rule ids. */
export const holdReason = (rules: readonly string[]): string => `run_delta_blocking:${rules.join(",")}`;

interface Pending {
  rules: Set<string>;
  settled: boolean;
  /** Set once the run has completed and waits: gives the verdict. */
  decide?: () => void;
}

export function createRunHoldGate(opts: { budgetMs: number; onTimeout?(runId: string, budgetMs: number): void }): RunHoldGate {
  const pending = new Map<string, Pending>();
  /** The verdicts given or being given, until the owning start reads them. */
  const given = new Map<string, Promise<RunHold | undefined>>();
  const verdictOf = (run: Pending): RunHold | undefined => {
    const rules = [...run.rules];
    return rules.length > 0 ? { reason: holdReason(rules), rules } : undefined;
  };
  const block = (runId: string, rules: readonly string[]): boolean => {
    const run = pending.get(runId);
    if (!run || rules.length === 0) return false;
    for (const rule of rules) run.rules.add(rule);
    return true;
  };
  const settled = (runId: string): void => {
    const run = pending.get(runId);
    if (!run) return;
    run.settled = true;
    run.decide?.();
  };
  return {
    expect(runId) {
      if (!pending.has(runId)) pending.set(runId, { rules: new Set(), settled: false });
    },
    port: (runId) => ({ block: (rules) => block(runId, rules), settled: () => settled(runId) }),
    beforeTerminal({ runId, status }) {
      const run = pending.get(runId);
      if (!run) return Promise.resolve(undefined);
      if (status !== "completed") {
        pending.delete(runId);
        given.set(runId, Promise.resolve(undefined));
        return Promise.resolve(undefined);
      }
      const verdict = new Promise<RunHold | undefined>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        run.decide = () => {
          if (timer) clearTimeout(timer);
          pending.delete(runId);
          resolve(verdictOf(run));
        };
        if (run.settled) return run.decide();
        timer = setTimeout(() => {
          opts.onTimeout?.(runId, opts.budgetMs);
          run.decide?.();
        }, opts.budgetMs);
      });
      given.set(runId, verdict);
      return verdict;
    },
    verdict(runId) {
      const verdict = given.get(runId) ?? Promise.resolve(undefined);
      given.delete(runId);
      return verdict;
    },
  };
}
