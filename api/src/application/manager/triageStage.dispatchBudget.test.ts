import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyRemedy, decideRemedyExecution, MAX_TRIAGE_DISPATCHES_PER_RUN, type TriageTask, type TriagePolicy } from './triageStage';
import { coordinateTicket } from './coordinateTicket';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * THE BILLABLE-RUN CEILING, asserted as a property of every remedy rather than of the
 * three that happen to consult it.
 *
 * `MAX_TRIAGE_DISPATCHES_PER_RUN` exists because starting work is expensive and the
 * backlog is enormous: without it a remedy that starts a run fires up to
 * `MAX_TRIAGE_PER_RUN` times per project per five-minute tick — thousands of paid runs a
 * day, spent re-attempting work that a fresh run does not fix. Its own doc comment says
 * so.
 *
 * MEASURED LIVE, project 11, 2026-07-28T01:52 — the pass reported:
 *
 *     {"stalled":12,"unstuck":7,"deferred":4,"dispatched":7,"dispatchCap":3}
 *
 * Seven billable runs against a cap of three, on a workspace whose `effectivePlan` is
 * `free`. The ceiling is not being enforced.
 *
 * The leak was structural, not arithmetic. `decideRemedyExecution` classifies `coordinate`
 * as a NON-dispatching remedy — "costs no run" — and therefore hands it
 * `mayStartRun: false`. But `applyRemedy`'s coordinate branch did not consult that flag:
 * it called `coordinateTicket`, which calls `maybeAutoRunOnLaneEntry` internally and
 * started a run whatever the budget said. The remedy was classified by what it was
 * *intended* to cost, and nothing checked what it actually cost. It was the only one of
 * eight branches that read neither flag.
 *
 * That misclassification mattered much more since 2026-07-28: `coordinate` is the remedy
 * for `managed_no_role`, which was 447 of 679 stalled tickets, and it runs on far more of
 * them per pass.
 *
 * `coordinateTicket` now takes an explicit `dispatch` flag, so the refusal is passed DOWN
 * into the thing that spends rather than being asserted about afterwards — and the last
 * test here states the property over ALL EIGHT remedies rather than one at a time, which
 * is how the eighth got missed.
 */

vi.mock('./coordinateTicket', () => ({ coordinateTicket: vi.fn() }));
vi.mock('../swimlane/evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('../swimlane/laneEntryTrigger', () => ({ maybeAutoRunOnLaneEntry: vi.fn() }));
vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));
vi.mock('../kanban/driveSignoffs', () => ({ driveOutstandingSignoffs: vi.fn() }));
vi.mock('./staffUnfilledRole', () => ({ staffUnfilledRole: vi.fn() }));

const mockCoordinate = vi.mocked(coordinateTicket);

const env = {} as Env;
/** Enough drizzle to let the branches that WRITE before deciding reach their decision. */
const db = { update: () => ({ set: () => ({ where: async () => [] }) }) } as unknown as Db;
const runtime = {} as RuntimeService;

const task: TriageTask = {
  id: 169, title: 'OKR 3 (Analytics)', description: null, status: 'ready',
  createdAt: new Date('2026-07-01T00:00:00Z'), taskType: 'epic', actionType: null,
  gitBranch: null, githubPrUrl: null,
  assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
};

const policy: TriagePolicy = {
  requireSignoffToComplete: true, prMergePolicy: 'on_green',
  allowAutoMerge: true, autoAssign: true, managerRef: null,
};

beforeEach(() => {
  mockCoordinate.mockReset();
});

describe('decideRemedyExecution never authorises a run once the budget is spent', () => {
  const REMEDIES = ['assign', 'dispatch', 'coordinate', 'reset_breaker', 'drive_signoff', 'resolve_conflict', 'return_to_implementation', 'reconcile_pr'];

  it.each(REMEDIES)('%s may not start or race a run with no budget left', (remedy) => {
    const plan = decideRemedyExecution({
      remedy, actionable: true, alreadyConducted: false,
      ownsDispatch: true, budgetLeft: false,
    });
    expect(plan.mayStartRun).toBe(false);
    expect(plan.mayRaceExecutor).toBe(false);
  });
});

describe('a remedy must not start a billable run the budget refused', () => {
  /**
   * THE ASSERTION that would have caught `dispatched: 7` against `dispatchCap: 3` before
   * it reached a live free-plan workspace.
   *
   * `coordinate` is handed `mayStartRun: false` and `mayRaceExecutor: false` and must act
   * like it. It used to report a started run anyway, because `coordinateTicket` dispatched
   * internally and this branch checked neither flag.
   */
  it('coordinate does not start a run when the budget said no', async () => {
    mockCoordinate.mockResolvedValue({ ok: true, status: 'ready', dispatched: false, requiredOutstanding: 2 });

    const outcome = await applyRemedy(env, db, runtime, {
      tenantId: 1, projectId: 11, task, policy, remedy: 'coordinate',
      signoff: null, prRow: null,
      mayStartRun: false,     // the budget refused
      mayRaceExecutor: false, // and the executor owns dispatch
      unfilledRoleKey: null,
    });

    expect(outcome.startedRun).toBe(false);
    // The refusal is passed DOWN, not merely observed afterwards: coordination still runs
    // in full (it syncs, rewinds and advances for free) but is told it may not spend.
    expect(mockCoordinate).toHaveBeenCalledWith(
      env, db, runtime, expect.objectContaining({ taskId: 169, dispatch: false }),
    );
  });

  it('coordinate is allowed to spend when the budget permits', async () => {
    mockCoordinate.mockResolvedValue({ ok: true, status: 'ready', dispatched: true, requiredOutstanding: 2 });

    await applyRemedy(env, db, runtime, {
      tenantId: 1, projectId: 11, task, policy, remedy: 'coordinate',
      signoff: null, prRow: null,
      mayStartRun: false, mayRaceExecutor: true, // non-dispatching remedy, executor idle
      unfilledRoleKey: null,
    });

    expect(mockCoordinate).toHaveBeenCalledWith(
      env, db, runtime, expect.objectContaining({ dispatch: true }),
    );
  });

  /**
   * The same property stated as the arithmetic the pass reports, which is the number a
   * reader sees. `dispatched` is what the sweep reserves against the tenant's shared
   * per-tick budget, so a remedy spending outside the cap silently outspends the
   * autonomous executor drawing on the same pool.
   */
  it('the runs a pass reports never exceed the cap it reports', async () => {
    // The mock honours the flag exactly as the real `coordinateTicket` now does.
    mockCoordinate.mockImplementation(async (_e, _d, _r, a) =>
      ({ ok: true, status: 'ready', dispatched: a.dispatch !== false, requiredOutstanding: 2 }));

    let dispatched = 0;
    for (let i = 0; i < 12; i += 1) {
      const budgetLeft = dispatched < MAX_TRIAGE_DISPATCHES_PER_RUN;
      const plan = decideRemedyExecution({
        remedy: 'coordinate', actionable: true, alreadyConducted: false,
        ownsDispatch: true, budgetLeft,
      });
      if (!plan.act) continue;
      const acted = await applyRemedy(env, db, runtime, {
        tenantId: 1, projectId: 11, task, policy, remedy: 'coordinate',
        signoff: null, prRow: null,
        mayStartRun: plan.mayStartRun, mayRaceExecutor: plan.mayRaceExecutor,
        unfilledRoleKey: null,
      });
      if (acted.startedRun) dispatched += 1;
    }

    // Measured live before the fix: 7 against a cap of 3.
    expect(dispatched).toBe(MAX_TRIAGE_DISPATCHES_PER_RUN);
  });

  /**
   * THE PROPERTY OVER EVERY REMEDY, not just the one that broke. A remedy told it may
   * neither start a run nor race the executor must not start one, whatever it is. This is
   * the assertion whose absence let `coordinate` — the eighth branch — slip through while
   * the other seven were checked individually.
   */
  it.each(['assign', 'dispatch', 'coordinate', 'reset_breaker', 'drive_signoff', 'resolve_conflict', 'return_to_implementation', 'reconcile_pr'])(
    '%s starts no run when both flags are false',
    async (remedy) => {
      mockCoordinate.mockResolvedValue({ ok: true, status: 'ready', dispatched: false, requiredOutstanding: 2 });
      const outcome = await applyRemedy(env, db, runtime, {
        tenantId: 1, projectId: 11, task, policy, remedy,
        signoff: null, prRow: null,
        mayStartRun: false, mayRaceExecutor: false,
        unfilledRoleKey: null,
      });
      expect(outcome.startedRun).toBe(false);
    },
  );
});

describe('coordinate still works when it IS allowed to spend (regression lock)', () => {
  it('reports the run it started when the budget permits', async () => {
    mockCoordinate.mockResolvedValue({ ok: true, status: 'in_progress', dispatched: true, requiredOutstanding: 0 });

    const outcome = await applyRemedy(env, db, runtime, {
      tenantId: 1, projectId: 11, task, policy, remedy: 'coordinate',
      signoff: null, prRow: null,
      mayStartRun: true, mayRaceExecutor: true,
      unfilledRoleKey: null,
    });

    expect(outcome).toMatchObject({ attempted: true, applied: true, startedRun: true });
  });

  it('counts a coordinate that moved nothing as an attempt, never as a dispatch', async () => {
    mockCoordinate.mockResolvedValue({ ok: true, status: 'ready', dispatched: false, requiredOutstanding: 2 });

    const outcome = await applyRemedy(env, db, runtime, {
      tenantId: 1, projectId: 11, task, policy, remedy: 'coordinate',
      signoff: null, prRow: null,
      mayStartRun: true, mayRaceExecutor: true,
      unfilledRoleKey: null,
    });

    expect(outcome).toMatchObject({ attempted: true, applied: false, startedRun: false });
  });
});
