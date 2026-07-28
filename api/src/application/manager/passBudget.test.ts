import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createPassBudget, finalizeManagerRunTask, MANAGER_PASS_BUDGET_MS, MANAGER_TRIAGE_RESERVE_MS,
  MIN_DISPATCH_WINDOW_MS, type ManagerRunSummary,
} from './ManagerService';

/**
 * THE EVICTION. A manager pass runs inside ONE Worker invocation. On project 11 (673
 * tickets, 354 open PRs) it was dying partway through the PR/merge loop: `manager_actions`
 * showed triage journalling every few minutes, while the `manager.pass` activity row that
 * CLOSES a pass had not been written since 2026-07-13 and `lastRunAt` sat 6 hours stale
 * against a 5-minute cadence.
 *
 * The lost work was the smaller half of the problem. The larger half: nothing recorded
 * that the pass had been cut short, so a truncated pass and a clean one were
 * indistinguishable — the manager reported health it had never verified.
 */
afterEach(() => { vi.useRealTimers(); });

describe('createPassBudget', () => {
  it('is under budget at the start and over it once the window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    const budget = createPassBudget(Date.now(), 20_000, 0);
    expect(budget.over()).toBe(false);
    vi.advanceTimersByTime(19_999);
    expect(budget.over()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(budget.over()).toBe(true);
  });

  it('reports elapsed wall-clock so the closing row can state WHERE the time went', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    const budget = createPassBudget(Date.now(), 20_000);
    vi.advanceTimersByTime(7_500);
    expect(budget.elapsedMs()).toBe(7_500);
  });

  it('records each shed stage ONCE, in order — the loop calls it per iteration', () => {
    const budget = createPassBudget(Date.now(), 20_000);
    expect(budget.shed('pr_conduct')).toBe(true);
    expect(budget.shed('pr_conduct')).toBe(false);
    expect(budget.shed('pr_merge')).toBe(true);
    expect(budget.shed('triage')).toBe(true);
    expect(budget.truncated).toEqual(['pr_conduct', 'pr_merge', 'triage']);
  });

  it('starts with nothing truncated, so a complete pass reports an empty list', () => {
    expect(createPassBudget(Date.now()).truncated).toEqual([]);
  });

  /**
   * THE STARVATION. A plain deadline does not decide WHETHER a stage is shed, only WHICH
   * one — and the answer was always the last stage. Triage runs seventh, so on project 11
   * every observed pass truncated it, and its 12 stuck-register remedies sat at
   * `attempts=0` for 26 days. Worse than no triage: an attempt that never happens cannot
   * fail, so the 3-attempt escalation ceiling is never reached either and nothing is ever
   * handed to a human. The skip journal even promised "it runs first on the next pass" —
   * a rotation that did not exist, because every pass restarts at stage 1.
   */
  describe('the triage reservation', () => {
    it('stops the discretionary stages EARLY so the reserved stage still has room', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      const budget = createPassBudget(Date.now(), 20_000, 6_000);
      vi.advanceTimersByTime(14_000);
      // Stages 1-6 are done for this pass...
      expect(budget.over()).toBe(true);
      // ...but triage, which checks the absolute deadline, still runs. This single
      // divergence is the whole fix.
      expect(budget.exhausted()).toBe(false);
    });

    it('still stops triage once the WHOLE budget including the reserve is gone', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      const budget = createPassBudget(Date.now(), 20_000, 6_000);
      vi.advanceTimersByTime(20_000);
      expect(budget.exhausted()).toBe(true);
    });

    it('reserves a real slice of a real budget — a zero reserve would restore the starvation', () => {
      expect(MANAGER_TRIAGE_RESERVE_MS).toBeGreaterThan(0);
      expect(MANAGER_TRIAGE_RESERVE_MS).toBeLessThan(MANAGER_PASS_BUDGET_MS);
    });

    it('cannot invert the two deadlines when the reserve exceeds the budget', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      // A misconfiguration must not make `over()` true before the pass has started, which
      // would shed every stage on every pass.
      const budget = createPassBudget(Date.now(), 5_000, 30_000);
      expect(budget.over()).toBe(true);
      expect(budget.exhausted()).toBe(false);
      vi.advanceTimersByTime(5_000);
      expect(budget.exhausted()).toBe(true);
    });
  });

  /**
   * WHY `over()` WAS NOT ENOUGH. It answers "has the deadline passed?", which cannot stop
   * a unit that has not started from running straight through it. Measured on project 11,
   * 2026-07-28: the PR loop began an iteration at ~11s of the 14s discretionary window,
   * hit a merge conflict, dispatched a recovery run, and returned at 27.6s — past the
   * WHOLE 20s budget, reserve and all, with triage journalling `elapsedMs: 27648`. The
   * expensive units now ask whether they FIT rather than only whether they are late.
   */
  describe('canAfford — refusing a unit that cannot fit', () => {
    it('affords a unit while the discretionary window still covers it', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      const budget = createPassBudget(Date.now(), 20_000, 6_000);
      expect(budget.remainingMs()).toBe(14_000);
      expect(budget.canAfford(5_000)).toBe(true);
    });

    it('refuses a unit larger than the window that is left, while `over()` still says no', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      const budget = createPassBudget(Date.now(), 20_000, 6_000);
      vi.advanceTimersByTime(11_000);
      // This is the exact measured moment: 3s of window left, and the loop was about to
      // start a 16.4s dispatch. The deadline check alone waves it through.
      expect(budget.over()).toBe(false);
      expect(budget.canAfford(MIN_DISPATCH_WINDOW_MS)).toBe(false);
    });

    it('reports no remaining window once the discretionary deadline passes, never a negative', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
      const budget = createPassBudget(Date.now(), 20_000, 6_000);
      vi.advanceTimersByTime(30_000);
      expect(budget.remainingMs()).toBe(0);
      expect(budget.canAfford(1)).toBe(false);
      expect(budget.canAfford(0)).toBe(true);
    });

    /**
     * A dispatch measured at 16.4s does not fit in a 14s window at all, so gating on its
     * REAL cost would refuse every conflict recovery forever — trading a starved triage
     * stage for a remedy that never runs. The floor is deliberately smaller than the
     * window; the guarantee that triage runs is made by the rotation, not by this.
     */
    it('keeps the dispatch floor small enough that a fresh pass can still start one', () => {
      expect(MIN_DISPATCH_WINDOW_MS).toBeGreaterThan(0);
      expect(MIN_DISPATCH_WINDOW_MS).toBeLessThan(MANAGER_PASS_BUDGET_MS - MANAGER_TRIAGE_RESERVE_MS);
    });
  });

  it('leaves headroom for the closing journal rather than running to the Worker ceiling', () => {
    // The budget exists to GUARANTEE the pass reaches `manager.pass`. A value at or above
    // the invocation ceiling would defeat the entire mechanism.
    expect(MANAGER_PASS_BUDGET_MS).toBeGreaterThan(5_000);
    expect(MANAGER_PASS_BUDGET_MS).toBeLessThan(30_000);
  });
});

/**
 * THE COMPOSITION, not the primitive.
 *
 * `createPassBudget` being correct proves nothing about the promise the budget exists to
 * keep: that a truncated pass still CLOSES, and says what it shed. The measured failure
 * was a pass that never wrote its closing row at all for two weeks, so the closing row —
 * and the sentence the diagnostics report parses back out of it — is the thing under test.
 */
describe('a truncated pass still closes, and names what it deferred', () => {
  /** Captures the row `finalizeManagerRunTask` writes. */
  function stubDb() {
    const writes: Array<Record<string, unknown>> = [];
    const chain = (): Record<string, unknown> => {
      const self: Record<string, unknown> = {};
      self.set = (v: Record<string, unknown>) => { writes.push(v); return self; };
      self.where = () => self;
      self.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
      return self;
    };
    return { db: { update: () => chain() } as never, writes };
  }

  const summary = (truncated: string[]): ManagerRunSummary => ({
    scored: 3, ranked: 300, assigned: 1, prsConducted: 0, prsMerged: 0, dispatched: 2,
    audited: 40, flagged: 5, remediated: 0, remediationDeferred: 0, stalled: 0, unstuck: 0,
    escalated: 0, stallsResolved: 0, staleRunTasksClosed: 0, censusStalled: 0,
    censusTopCause: null, systemicFindings: 0, systemicTicketsCreated: 0, scheduled: 0,
    truncated,
  } as unknown as ManagerRunSummary);

  it('marks the run card DONE and lists the shed stages', async () => {
    const { db, writes } = stubDb();
    await finalizeManagerRunTask(db, { taskId: 1031, summary: summary(['pr_conduct', 'triage']), ok: true });

    const row = writes[0]!;
    expect(row.status).toBe('done');
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(String(row.description)).toContain('deferred: pr_conduct, triage');
  });

  // A complete pass must be DISTINGUISHABLE from a truncated one — that indistinguishability
  // was the larger half of the original failure.
  it('says nothing about deferral on a complete pass', async () => {
    const { db, writes } = stubDb();
    await finalizeManagerRunTask(db, { taskId: 1031, summary: summary([]), ok: true });
    expect(String(writes[0]!.description)).not.toContain('deferred');
  });
});
