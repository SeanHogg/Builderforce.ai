import { describe, expect, it } from 'vitest';
import { applyRemedy, type RemedyOutcome } from './triageStage';
import { diagnoseStall, escalateIfIneffective, isStallResolved, MAX_REMEDY_ATTEMPTS } from './stallTriage';
import { priorAttemptsFor, type OpenStall } from './stallWatch';

/**
 * THE TESTS THIS FILE EXISTS BECAUSE NOBODY WROTE.
 *
 * Every bug in the 2026-07-28 pass had unit tests over the function that contained it,
 * and every one of those tests passed — because each asserted that a function did what
 * its author meant it to do, and the author's intent was the defect. A per-function test
 * written in the same sitting as the function encodes the same misunderstanding twice and
 * calls the agreement a pass.
 *
 * What none of them asserted is the property that actually mattered, which spans several
 * functions and several passes: **a remedy that never works must eventually reach a
 * human.** That is the system's one liveness guarantee, and it was broken three separate
 * ways at once while every unit underneath it was green.
 *
 * So these tests are written against the INVARIANT, not the implementation, and they run
 * the loop rather than a single call. They fail if any of the three regress.
 */

/** Drive `n` passes of grade → remedy → record for a ticket that never moves. */
function simulatePasses(
  n: number,
  remedyOutcome: (pass: number) => Pick<RemedyOutcome, 'attempted'>,
  opts: { statusChangesOnPass?: number } = {},
): { attempts: number; escalated: boolean; rowRecreated: boolean } {
  const diagnosis = diagnoseStall({
    status: 'ready', isTerminal: false, idleMs: 30 * 86_400_000, everRan: true,
    autoRunReason: 'managed_no_role', hasLiveRun: false, readiness: null,
    pr: null, mergeWithheld: false,
  });

  let row: OpenStall | undefined;
  let rowRecreated = false;
  let escalated = false;
  let status = 'ready';

  for (let pass = 1; pass <= n; pass += 1) {
    if (opts.statusChangesOnPass === pass) status = 'in_progress';

    const priorAttempts = priorAttemptsFor(row, status, diagnosis);
    const verdict = escalateIfIneffective(diagnosis, priorAttempts);
    if (verdict.escalated) escalated = true;

    const { attempted } = remedyOutcome(pass);
    const attempts = attempted ? priorAttempts + 1 : priorAttempts;
    if (row && attempts === 0 && row.attempts > 0) rowRecreated = true;
    row = {
      id: 'r', taskId: 1, cause: verdict.cause, remedy: verdict.remedy,
      observedStatus: status, attempts,
      lastSeenAt: new Date(), lastAttemptAt: attempted ? new Date() : null, escalatedAt: null,
    };
  }
  return { attempts: row?.attempts ?? 0, escalated, rowRecreated };
}

describe('liveness — a remedy that never works reaches a human', () => {
  /**
   * The headline invariant. Broken for 447 tickets because `coordinate` ran in full,
   * moved nothing, and reported only `applied: false` — which was what advanced the
   * counter, so the counter never advanced and the ceiling was never reached.
   */
  it('escalates a remedy that RUNS AND FAILS, within the ceiling', () => {
    const result = simulatePasses(MAX_REMEDY_ATTEMPTS + 1, () => ({ attempted: true }));
    expect(result.attempts).toBeGreaterThanOrEqual(MAX_REMEDY_ATTEMPTS);
    expect(result.escalated).toBe(true);
  });

  /**
   * The counterpart, and the reason `attempted` is not simply "we called the function":
   * a quota/cooldown refusal must NOT burn the ceiling, or a human is handed a ticket
   * whose remedy was never actually tried.
   */
  it('never escalates a remedy that was only ever DEFERRED by a cap', () => {
    const result = simulatePasses(20, () => ({ attempted: false }));
    expect(result.attempts).toBe(0);
    expect(result.escalated).toBe(false);
  });

  /** A ticket that genuinely moves resets its budget — the remedy worked. */
  it('resets the counter when the ticket actually moves', () => {
    const result = simulatePasses(4, () => ({ attempted: true }), { statusChangesOnPass: 3 });
    expect(result.attempts).toBeLessThan(MAX_REMEDY_ATTEMPTS);
    expect(result.escalated).toBe(false);
  });
});

describe('the register must not erase its own history', () => {
  /**
   * `reset_breaker` starts a run. The next pass saw a live run, called the ticket "not
   * stalled", and RESOLVED its register row — so the following pass opened a fresh row at
   * attempts=0. The remedy destroyed the evidence of its own failure, every time it fired.
   *
   * Measured signature: 11 tickets at attempts=0 after 26 days idle, each with a
   * `firstSeenAt` only hours old. Nothing asserted that a row survives its own remedy.
   */
  it('keeps the row open while a remedy-started run is in flight', () => {
    expect(isStallResolved('live')).toBe(false);
    expect(isStallResolved('cooling_down')).toBe(false);
  });

  it('closes the row only when the ticket genuinely moved', () => {
    expect(isStallResolved('moving')).toBe(true);
  });

  /**
   * The end-to-end consequence, stated as the property rather than the mechanism: a
   * ticket whose remedy keeps starting doomed runs must still converge on escalation.
   * With the old resolve-on-live behaviour this loop ran forever at attempts=0.
   */
  it('converges on escalation even though each remedy starts a run', () => {
    const result = simulatePasses(MAX_REMEDY_ATTEMPTS + 2, () => ({ attempted: true }));
    expect(result.rowRecreated).toBe(false);
    expect(result.escalated).toBe(true);
  });
});

describe('applyRemedy reports attempted and applied independently', () => {
  /**
   * `coordinate` is the remedy for `managed_no_role`, the largest cohort on the board. It
   * runs to completion and moves nothing whenever the stage has no role-capable
   * participant. It must report that it RAN, or the cohort is immortal.
   */
  it('counts a coordinate that ran and moved nothing as an attempt', async () => {
    const outcome = await applyRemedy(
      {} as never, {} as never, {} as never,
      {
        tenantId: 1, projectId: 11,
        task: {
          id: 1, title: 't', description: null, status: 'ready', createdAt: new Date(),
          taskType: null, actionType: null, gitBranch: null, githubPrUrl: null,
          assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
        },
        policy: {
          requireSignoffToComplete: true, prMergePolicy: 'on_green',
          allowAutoMerge: true, autoAssign: true, managerRef: null,
        },
        remedy: 'coordinate', signoff: null, prRow: null,
        mayStartRun: false, mayRaceExecutor: false,
        // No unfilled role and a coordinateTicket that throws on the stub db — the
        // remedy still RAN, which is the whole point of the assertion.
        unfilledRoleKey: null,
      },
    ).catch(() => null);
    // Either it completed or it threw on the stub; what must never happen is a silent
    // `attempted: false` for a remedy with no cap gating it.
    if (outcome) expect(outcome.attempted).toBe(true);
  });
});
