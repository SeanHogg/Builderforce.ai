/**
 * tickDispatchBudget — ONE per-tenant dispatch ceiling shared by every cron sweep
 * that can start a billable agent run.
 *
 * The `*​/5` cron tick registers ~15 independent `waitUntil` branches, four of which
 * dispatch LLM work: the autonomous executor, the AI-manager sweep, the validator
 * review sweep, and the QA exploration sweep. Each used to enforce its OWN private
 * per-tenant ceiling, so the ceilings never composed: a tenant could take 25 runs
 * from the auto-executor, then more from the manager, then more from the validator,
 * all inside the same five-minute window. The documented "25 per tenant per tick"
 * bound was therefore real for any single sweep and fictional in aggregate.
 *
 * This makes the ceiling a property of the TICK rather than of each sweep. The cron
 * handler builds one budget and hands the same object to every dispatching sweep;
 * whichever sweep asks first wins, and the tenant's total across all of them is
 * bounded by `MAX_TENANT_DISPATCHES_PER_TICK`.
 *
 * Deliberately in-memory and NOT the shared read-through cache: this is not cached
 * DATA, it is a reservation counter whose entire lifetime is one cron invocation in
 * one isolate. Persisting it would add a write per dispatch to bound something that
 * a monthly `enforceCloudRunCap` already bounds durably. The failure mode of an
 * isolate-local counter is that two concurrent ticks could each grant a full budget
 * — acceptable, and strictly better than the unbounded behaviour it replaces.
 *
 * Reserve-then-dispatch, never dispatch-then-count: a sweep must take the slot
 * BEFORE starting work, or two sweeps racing on the same tenant both see room.
 */

/** Per-tenant ceiling across ALL dispatching sweeps in a single cron tick. */
export const MAX_TENANT_DISPATCHES_PER_TICK = 25;

export interface TickDispatchBudget {
  /** Take one slot for `tenantId`. Returns false when the tenant is out of budget. */
  tryReserve(tenantId: number): boolean;
  /**
   * Hand a reserved slot back, because the dispatch it was taken for did not start.
   *
   * Reserve-then-dispatch means taking the slot BEFORE the outcome is known, and a
   * dispatcher declines for plenty of ordinary reasons (a live run, a cooldown, a lane
   * gate). Without a release the ceiling would leak on every decline and a busy project
   * would starve itself out of a budget it never spent.
   */
  release(tenantId: number): void;
  /** Slots already taken by `tenantId` this tick (any sweep). */
  reserved(tenantId: number): number;
  /** Whether `tenantId` has any slot left, without taking one. */
  hasRoom(tenantId: number): boolean;
  /** Total slots taken across every tenant this tick — for the cron log line. */
  total(): number;
}

/**
 * Build a budget for one cron tick. Sweeps accept this as an OPTIONAL parameter and
 * fall back to a fresh private budget when it's absent, so a direct call (a test, a
 * manual trigger) keeps today's standalone behaviour unchanged.
 */
export function createTickDispatchBudget(
  limit: number = MAX_TENANT_DISPATCHES_PER_TICK,
): TickDispatchBudget {
  const taken = new Map<number, number>();
  return {
    tryReserve(tenantId) {
      const used = taken.get(tenantId) ?? 0;
      if (used >= limit) return false;
      taken.set(tenantId, used + 1);
      return true;
    },
    release(tenantId) {
      const used = taken.get(tenantId) ?? 0;
      // Floored at zero: an over-release is a caller bug, and silently going negative
      // would hand the tenant free budget — the exact failure this module prevents.
      if (used > 0) taken.set(tenantId, used - 1);
    },
    reserved(tenantId) {
      return taken.get(tenantId) ?? 0;
    },
    hasRoom(tenantId) {
      return (taken.get(tenantId) ?? 0) < limit;
    },
    total() {
      let sum = 0;
      for (const n of taken.values()) sum += n;
      return sum;
    },
  };
}

/**
 * ONE tenant's view of the budget — the shape every dispatch site should hold.
 *
 * ── WHY THIS EXISTS RATHER THAN "REMEMBER TO CALL tryReserve" ────────────────────
 * The AI-manager sweep held the budget and checked `hasRoom` ONCE per project as an
 * admission gate, ran an entire pass, then replayed the spend:
 *
 *     for (let i = 0; i < s.dispatched; i++) budget.tryReserve(p.tenantId);
 *
 * That is dispatch-then-count. The boolean `tryReserve` returns was discarded because by
 * then the runs had already happened, so the ceiling could not refuse anything: measured
 * in simulation, 43 runs against a ceiling of 25 for one project, 38 across five projects
 * belonging to one tenant. The header rule was written down and the code did the opposite.
 *
 * A rule that must be remembered at each of eight dispatch sites will be forgotten at the
 * ninth. So the budget is no longer passed around as a counter to be updated afterwards —
 * it is passed as this object, whose only spending verb is {@link DispatchReserver.spend},
 * which reserves first by construction.
 */
export interface DispatchReserver {
  /** Slots left for this tenant, without taking one. */
  hasRoom(): boolean;
  /**
   * Reserve a slot, run `dispatch`, and hand the slot back when nothing started.
   * Returns `refused` when there was no room — the dispatch is never attempted.
   */
  spend<T>(dispatch: () => Promise<T>, started: (result: T) => boolean): Promise<{ refused: boolean; result: T | null }>;
  /** Slots this reserver still holds — what the caller should report as `dispatched`. */
  spent(): number;
}

export function tenantDispatchReserver(budget: TickDispatchBudget, tenantId: number): DispatchReserver {
  let held = 0;
  return {
    hasRoom: () => budget.hasRoom(tenantId),
    spent: () => held,
    async spend(dispatch, started) {
      if (!budget.tryReserve(tenantId)) return { refused: true, result: null };
      held += 1;
      let result: Awaited<ReturnType<typeof dispatch>>;
      try {
        result = await dispatch();
      } catch (error) {
        budget.release(tenantId);
        held -= 1;
        throw error;
      }
      if (!started(result)) {
        budget.release(tenantId);
        held -= 1;
      }
      return { refused: false, result };
    },
  };
}
