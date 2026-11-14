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
import { RUN_DELTA_HOLD_PREFIX, RUN_DELTA_UNMEASURED } from "../runRecovery";
/**
 * Per-run extension buckets, each spent ONCE per run (not per repository): the dynamic tier of all the run's repositories
 * together (60 min), and the L3 analyzer phase's wait (15 min; `analyzers/l3Phase.ts` `L3_HOLD_WAIT_MS` is this value).
 */
export const DEFAULT_EXTENSION_CAPS = { dynamic: 60 * 60_000, l3: 15 * 60_000 };
/**
 * A run's `extend` for its deltas' dynamic tier (`startRunDelta`): grants at most what is left of the run's cap AND what
 * the finalize gate grants (its `dynamic` bucket), so the delta's own deadline never outlives the gate's; `apply` moves
 * the delta's deadline by exactly what was granted. Answers the ms granted.
 */
export function runExtender(hold, apply, cap = DEFAULT_EXTENSION_CAPS.dynamic) {
    let extended = 0;
    return (ms) => {
        const runGrant = Math.min(ms, cap - extended);
        if (!(runGrant > 0))
            return 0;
        const holdGrant = hold?.extend ? hold.extend(runGrant, "dynamic") : runGrant;
        const granted = Math.max(0, Math.min(runGrant, holdGrant));
        if (granted > 0) {
            extended += granted;
            apply(granted);
        }
        return granted;
    };
}
/** The hold's reason: names the blocking rule ids. */
export const holdReason = (rules) => `${RUN_DELTA_HOLD_PREFIX}${rules.join(",")}`;
/** The unmeasured hold (fail-closed): no rules, released like any other. */
export const UNMEASURED_HOLD = Object.freeze({ reason: RUN_DELTA_UNMEASURED, rules: [] });
export function createRunHoldGate(opts) {
    const caps = opts.caps ?? DEFAULT_EXTENSION_CAPS;
    const pending = new Map();
    /** The verdicts given or being given, until the owning start reads them (or forgets them). */
    const given = new Map();
    const verdictOf = (run) => {
        const rules = [...run.rules];
        if (rules.length > 0)
            return { reason: holdReason(rules), rules };
        return run.unmeasured ? { ...UNMEASURED_HOLD, rules: [] } : undefined;
    };
    const arm = (run, ms, expire) => {
        if (run.timer)
            clearTimeout(run.timer);
        run.timer = setTimeout(expire, ms);
    };
    const settle = (run) => {
        if (run.timer)
            clearTimeout(run.timer);
        run.timer = undefined;
        run.settled = true;
        run.decide?.();
    };
    const armDelta = (runId, run, budget) => {
        arm(run, Math.max(0, run.deadline - Date.now()), () => {
            opts.onTimeout?.(runId, budget, "delta");
            run.unmeasured = true;
            settle(run);
        });
    };
    const begin = (runId, changes) => {
        const run = pending.get(runId);
        if (!run || run.settled || !changes)
            return;
        run.measuring = true;
        run.deadline = Date.now() + opts.budgetMs;
        armDelta(runId, run, opts.budgetMs);
    };
    const extend = (runId, ms, kind) => {
        const run = pending.get(runId);
        if (!run || run.settled || !run.measuring || run.deadline === undefined)
            return Math.max(0, ms);
        // Each kind's bucket is spent once per run: however many repositories ask, the run is never held open past
        // budget + dynamic cap + l3 cap.
        const granted = Math.max(0, Math.min(ms, caps[kind] - run.extended[kind]));
        if (granted === 0)
            return 0;
        run.extended[kind] += granted;
        run.deadline += granted;
        armDelta(runId, run, opts.budgetMs + run.extended.dynamic + run.extended.l3);
        return granted;
    };
    const block = (runId, rules) => {
        const run = pending.get(runId);
        if (!run || run.settled || rules.length === 0)
            return false;
        for (const rule of rules)
            run.rules.add(rule);
        return true;
    };
    const unmeasured = (runId) => {
        const run = pending.get(runId);
        if (run && !run.settled)
            run.unmeasured = true;
    };
    const settled = (runId) => {
        const run = pending.get(runId);
        if (run && !run.settled)
            settle(run);
    };
    return {
        expect(runId) {
            if (!pending.has(runId))
                pending.set(runId, { rules: new Set(), unmeasured: false, settled: false, measuring: false, extended: { dynamic: 0, l3: 0 } });
        },
        port: (runId) => ({
            begin: (changes) => begin(runId, changes),
            block: (rules) => block(runId, rules),
            unmeasured: () => unmeasured(runId),
            settled: () => settled(runId),
            extend: (ms, kind) => extend(runId, ms, kind),
        }),
        beforeTerminal({ runId, status }) {
            const run = pending.get(runId);
            if (!run)
                return Promise.resolve(undefined);
            if (status !== "completed") {
                if (run.timer)
                    clearTimeout(run.timer);
                pending.delete(runId);
                given.set(runId, Promise.resolve(undefined));
                return Promise.resolve(undefined);
            }
            const verdict = new Promise((resolve) => {
                run.decide = () => {
                    pending.delete(runId);
                    resolve(verdictOf(run));
                };
                if (run.settled)
                    return run.decide();
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
                if (run.timer)
                    clearTimeout(run.timer);
                pending.delete(runId);
            }
        },
    };
}
//# sourceMappingURL=runHoldGate.js.map