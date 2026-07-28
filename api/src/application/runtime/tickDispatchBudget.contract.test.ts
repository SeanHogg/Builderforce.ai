import { describe, expect, it } from 'vitest';
import { createTickDispatchBudget, MAX_TENANT_DISPATCHES_PER_TICK, tenantDispatchReserver } from './tickDispatchBudget';

/**
 * THE TENANT'S PER-TICK CEILING, asserted as the property it claims to be.
 *
 * `tickDispatchBudget.ts` exists because four cron sweeps each held a PRIVATE per-tenant
 * ceiling, so "25 per tenant per tick" was "real for any single sweep and fictional in
 * aggregate" (its own words). It states one rule in bold, in its header:
 *
 *     "Reserve-then-dispatch, never dispatch-then-count: a sweep must take the slot
 *      BEFORE starting work, or two sweeps racing on the same tenant both see room."
 *
 * The autonomous executor obeys it — `if (!budget.hasRoom(tenantId)) break;` inside the
 * per-candidate loop, checked before every single dispatch.
 *
 * The AI-manager sweep did not. `runManagerSweep` checked `hasRoom` ONCE per project as
 * an admission gate, ran the entire pass — which starts as many runs as its own internal
 * stage caps allow — and only afterwards replayed the spend:
 *
 *     for (let i = 0; i < s.dispatched; i++) budget.tryReserve(p.tenantId);
 *
 * That is dispatch-then-count, and the boolean `tryReserve` returns was discarded, because
 * by then the runs had already happened. The ceiling could not refuse anything.
 *
 * It now holds a {@link tenantDispatchReserver} instead of the raw counter, whose only
 * spending verb reserves first. The rule is no longer something eight dispatch sites must
 * each remember — it is the only way to spend.
 *
 * These tests contrast the two accounting patterns against the SAME budget object, so the
 * difference is the only variable. No database, no mocks — the budget is pure in-memory
 * bookkeeping, which is exactly why there is no excuse for this being unasserted.
 */

const TENANT = 1;

/** The executor's pattern: ask before every dispatch. */
function reserveThenDispatch(budget: ReturnType<typeof createTickDispatchBudget>, want: number): number {
  let started = 0;
  for (let i = 0; i < want; i += 1) {
    if (!budget.hasRoom(TENANT)) break;
    budget.tryReserve(TENANT);
    started += 1; // the run happens only after the slot is taken
  }
  return started;
}

/**
 * The manager sweep's OLD pattern: one admission check, spend, then backfill the counter.
 * Kept as the counter-example — these tests exist to prove the difference is real, so the
 * broken pattern has to be here to be measured against.
 */
function dispatchThenCount(budget: ReturnType<typeof createTickDispatchBudget>, want: number): number {
  if (!budget.hasRoom(TENANT)) return 0;
  const started = want;                                   // the whole pass runs first
  for (let i = 0; i < started; i += 1) budget.tryReserve(TENANT); // …then we "reserve"
  return started;
}

/**
 * The pattern the manager sweep uses NOW: it holds a {@link DispatchReserver} rather than
 * the raw counter, and `spend` reserves before invoking the dispatch by construction.
 * A dispatch that declines hands its slot straight back.
 */
async function spendThroughReserver(
  budget: ReturnType<typeof createTickDispatchBudget>,
  want: number,
  starts: (i: number) => boolean = () => true,
): Promise<number> {
  const reserver = tenantDispatchReserver(budget, TENANT);
  let started = 0;
  for (let i = 0; i < want; i += 1) {
    const { refused, result } = await reserver.spend(async () => starts(i), (v) => v);
    if (refused) break;
    if (result) started += 1;
  }
  return started;
}

describe('the per-tick ceiling actually bounds a tenant', () => {
  it('holds when every dispatcher reserves before starting work', () => {
    const budget = createTickDispatchBudget();
    const started = reserveThenDispatch(budget, MAX_TENANT_DISPATCHES_PER_TICK * 3);
    expect(started).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
    expect(budget.reserved(TENANT)).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  /**
   * THE REGRESSION THIS PINS. The scenario is the ordinary one, not a contrived edge: the
   * executor runs first in the same tick and takes most of the budget, the manager sweep
   * is then admitted on the one remaining slot, and its pass wants a full stage's worth.
   *
   * A manager PASS can want 12 (stage 5's `MAX_DISPATCHES_PER_RUN`) plus whatever triage
   * starts — measured live on project 11 at 2026-07-28T01:52: `dispatched: 7` against
   * `dispatchCap: 3`. One project. The sweep runs up to 200 per tick.
   */
  it('holds when the sweep spends through its reserver', async () => {
    const budget = createTickDispatchBudget();

    // The autonomous executor goes first and takes all but one slot.
    const byExecutor = reserveThenDispatch(budget, MAX_TENANT_DISPATCHES_PER_TICK - 1);
    expect(byExecutor).toBe(MAX_TENANT_DISPATCHES_PER_TICK - 1);

    // The manager sweep is admitted on that single remaining slot and wants a pass.
    const byManager = await spendThroughReserver(budget, 19); // 12 dispatch stage + 7 triage

    expect(byManager).toBe(1);
    expect(byExecutor + byManager).toBeLessThanOrEqual(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  /**
   * The multi-project form, which is how it compounded: one tenant owning several managed
   * projects got a fresh admission check per project, because the gate was `hasRoom` (a
   * boolean) rather than a reservation. The reserver makes each project's spend visible
   * to the next one.
   */
  it('holds across several projects belonging to one tenant', async () => {
    const budget = createTickDispatchBudget();
    let started = 0;
    for (let project = 0; project < 5; project += 1) {
      started += await spendThroughReserver(budget, 19);
    }
    expect(started).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  /**
   * THE COUNTER-EXAMPLE, asserted rather than described. If the old accounting were still
   * in place these numbers are what it would produce — 43 and 38 against a ceiling of 25.
   * Keeping it executable means "we fixed it" is a measurement, not a claim.
   */
  it('records what dispatch-then-count actually produced', () => {
    const one = createTickDispatchBudget();
    const byExecutor = reserveThenDispatch(one, MAX_TENANT_DISPATCHES_PER_TICK - 1);
    expect(byExecutor + dispatchThenCount(one, 19)).toBe(43);

    const many = createTickDispatchBudget();
    let started = 0;
    for (let project = 0; project < 5; project += 1) started += dispatchThenCount(many, 19);
    expect(started).toBe(38);
    expect(started).toBeGreaterThan(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  /**
   * A dispatch that DECLINES — a live run, a cooldown, a closed lane gate — must not
   * consume a slot. Without the release the ceiling leaks on every decline and a busy
   * project starves itself out of budget it never spent.
   */
  it('hands the slot back when the dispatch does not start', async () => {
    // Two of every three attempts decline. If a decline consumed a slot the tenant would
    // be exhausted after 25 ATTEMPTS (8 runs); it must be exhausted after 25 RUNS.
    const budget = createTickDispatchBudget();
    const started = await spendThroughReserver(budget, 90, (i) => i % 3 === 0);
    expect(started).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
    expect(budget.reserved(TENANT)).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  it('releases the slot when the dispatch throws, and lets the error through', async () => {
    const budget = createTickDispatchBudget();
    const reserver = tenantDispatchReserver(budget, TENANT);
    await expect(reserver.spend(async () => { throw new Error('dispatcher exploded'); }, () => true))
      .rejects.toThrow('dispatcher exploded');
    expect(budget.reserved(TENANT)).toBe(0);
    expect(reserver.spent()).toBe(0);
  });

  it('never lets a release push a tenant below zero into free budget', () => {
    const budget = createTickDispatchBudget();
    budget.release(TENANT);
    budget.release(TENANT);
    expect(budget.reserved(TENANT)).toBe(0);
    expect(reserveThenDispatch(budget, 100)).toBe(MAX_TENANT_DISPATCHES_PER_TICK);
  });

  it('records that a refused reservation is reported, so a caller COULD honour it', () => {
    // `tryReserve` does its job — it returns false past the ceiling. The defect is
    // entirely in the caller discarding that answer after the fact.
    const budget = createTickDispatchBudget();
    for (let i = 0; i < MAX_TENANT_DISPATCHES_PER_TICK; i += 1) {
      expect(budget.tryReserve(TENANT)).toBe(true);
    }
    expect(budget.tryReserve(TENANT)).toBe(false);
    expect(budget.hasRoom(TENANT)).toBe(false);
  });

  it('keeps tenants independent', () => {
    const budget = createTickDispatchBudget();
    reserveThenDispatch(budget, MAX_TENANT_DISPATCHES_PER_TICK);
    expect(budget.hasRoom(TENANT)).toBe(false);
    expect(budget.hasRoom(2)).toBe(true);
  });
});
