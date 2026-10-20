/**
 * Domain — server batch sync push and pull (G15, epic #5747 item 5).
 *
 * A push is a list of events applied in array order. A pull is the change log
 * after a cursor. Pure: no database, no HTTP. Idempotency, import bounds,
 * occurredAt checks, retention, and conflict policy stay in their own modules;
 * this file only owns the batch envelope.
 *
 * A later event is never applied after an earlier one in the same batch was
 * rejected. Pull order is the cursor, never `occurredAt`.
 */

/** What `applyOne` returns for one event. `ok: false` stops the batch. */
export type ApplyOneResult = { ok: true } | { ok: false; reason: string };

/** The event that stopped the batch, and why `applyOne` refused it. */
export interface BatchRejection<E> {
  event: E;
  reason: string;
}

/**
 * Outcome of one push batch.
 *
 * `applied` is the prefix `applyOne` accepted, in input order.
 * `rejected` is the first refusal, or null when every event was accepted
 * (including an empty batch).
 * `rest` is the suffix that was not attempted, in input order. It does not
 * include the rejected event.
 */
export interface BatchApplyResult<E> {
  applied: E[];
  rejected: BatchRejection<E> | null;
  rest: E[];
}

/**
 * Apply `events` in array order. Stop at the first rejection.
 *
 * `applyOne` is not called for any event after the one it rejects, so a later
 * event cannot land after an earlier one failed. An empty batch does not call
 * `applyOne` and returns `{ applied: [], rejected: null, rest: [] }`.
 * The input array is not mutated.
 */
export function applyBatch<E>(
  events: readonly E[],
  applyOne: (event: E) => ApplyOneResult,
): BatchApplyResult<E> {
  const applied: E[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i] as E;
    const decision = applyOne(event);
    if (decision.ok) {
      applied.push(event);
      continue;
    }
    return {
      applied,
      rejected: { event, reason: decision.reason },
      rest: events.slice(i + 1),
    };
  }
  return { applied, rejected: null, rest: [] };
}

/**
 * Changes strictly after `cursor`, in ascending cursor order.
 *
 * `cursor` is the order. `occurredAt` is never consulted, even when it would
 * sort the other way. A cursor at or ahead of every change — and a non-finite
 * cursor — returns `[]`. The input array is not mutated.
 */
export function pullSince<T extends { cursor: number }>(
  changes: readonly T[],
  cursor: number,
): T[] {
  if (!Number.isFinite(cursor)) return [];
  return changes
    .filter((change) => Number.isFinite(change.cursor) && change.cursor > cursor)
    .sort((a, b) => a.cursor - b.cursor);
}
