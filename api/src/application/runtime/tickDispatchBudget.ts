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
