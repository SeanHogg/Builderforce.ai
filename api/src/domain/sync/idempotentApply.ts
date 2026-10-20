/**
 * Domain — idempotent ordered sync apply (G16).
 *
 * Receipts already answer `duplicate`, but nothing in the server domain was
 * tested to apply a client event once. A replayed `eventId` must return the
 * server id from the first insert and must not add a second row.
 *
 * `seen` is the receipt journal, keyed by client `eventId` (the unique
 * `(tenant, device, event)` constraint). Pure: no database, no HTTP, no
 * vscode. The caller owns the map inside the transaction that writes the
 * mutation and the receipt together.
 *
 * A different `eventId` is a different apply, even when it names the same
 * `clientEntityId` (a later update is not a replay). Client-entity uniqueness
 * for creates lives on the mapping table, not on this receipt rule.
 *
 * Ordering is array order. An event whose `dependsOn` names an id that has
 * not landed — not in the caller's landed set, and not accepted earlier in
 * this batch — returns `dependency_pending` and writes nothing. A later event
 * is not reordered ahead of that gap, and an unmet dependency does not stop
 * an unrelated later event.
 *
 * Event-id uniqueness does not survive purge. A replay after purge is a new
 * event, not a silent duplicate. `seen` holds only receipts that still exist.
 * Once the sweeper has removed the row, the same event id must not be passed
 * back in as a live receipt; {@link applyOnce} then accepts it as a new event.
 * A caller that still holds a stale row past the retention window passes
 * `receiptAgeDays` so the apply refuses to answer `duplicate`.
 */

import { uniquenessSurvivesRetention } from './syncRetention';

/**
 * Event-id uniqueness does not survive purge. A replay after purge is a new
 * event, not a silent duplicate.
 */
export const IDEMPOTENT_APPLY_RETENTION_NOTE =
  'Event-id uniqueness does not survive purge. A replay after purge is a new event, not a silent duplicate.';

export type IdempotentApplyStatus = 'accepted' | 'duplicate';

export interface IdempotentApplyResult {
  status: IdempotentApplyStatus;
  serverId: string;
}

export type OrderedApplyStatus = IdempotentApplyStatus | 'dependency_pending';

export interface OrderedApplyReceipt {
  eventId: string;
  status: OrderedApplyStatus;
  /** Present when a receipt row exists. Absent for `dependency_pending`. */
  serverId?: string;
}

export interface OrderedApplyEvent {
  eventId: string;
  clientEntityId: string;
  dependsOn?: readonly string[] | string | null;
  /**
   * Age of a receipt the caller still holds for this event id. At or past the
   * event retention window the row has been swept, so the apply must not
   * treat it as a duplicate.
   */
  receiptAgeDays?: number;
}

function newServerId(): string {
  return crypto.randomUUID();
}

function receiptWasPurged(receiptAgeDays: number | undefined): boolean {
  return receiptAgeDays !== undefined && !uniquenessSurvivesRetention(receiptAgeDays);
}

function dependencyIds(dependsOn: readonly string[] | string | null | undefined): string[] {
  if (dependsOn === undefined || dependsOn === null) return [];
  const candidates = typeof dependsOn === 'string' ? [dependsOn] : [...dependsOn];
  const ids: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') ids.push(trimmed);
  }
  return ids;
}

function unmetDependency(
  dependsOn: readonly string[] | string | null | undefined,
  satisfied: ReadonlySet<string>,
): string | undefined {
  return dependencyIds(dependsOn).find((id) => !satisfied.has(id));
}

/**
 * Apply `event` at most once.
 *
 * The first call inserts one row (`serverId`) and returns `accepted`. A later
 * call with the same `eventId` returns `duplicate` and the first insert's
 * `serverId`, and does not add or replace a row.
 *
 * A receipt at or past retention is not that row anymore. Pass
 * `receiptAgeDays` when the caller still holds a stale entry: the apply
 * accepts a new event instead of answering `duplicate`.
 */
export function applyOnce(
  seen: Map<string, { serverId: string }>,
  event: { eventId: string; clientEntityId: string },
  options?: { receiptAgeDays?: number },
): IdempotentApplyResult {
  const existing = receiptWasPurged(options?.receiptAgeDays) ? undefined : seen.get(event.eventId);
  if (existing) {
    return { status: 'duplicate', serverId: existing.serverId };
  }
  const serverId = newServerId();
  seen.set(event.eventId, { serverId });
  return { status: 'accepted', serverId };
}

/**
 * Apply `events` in array order.
 *
 * A duplicate `eventId` returns the first receipt and does not write a second
 * row. An unmet `dependsOn` returns `dependency_pending` and writes nothing —
 * the journal is unchanged for that event, and the id does not satisfy a
 * later event. The input array is not mutated.
 *
 * `landed` is the set of dependency ids already accepted before this batch.
 * Event ids accepted earlier in this batch count too. Receipts already in
 * `seen` count, unless this batch says that receipt was purged.
 */
export function applyOrdered(
  seen: Map<string, { serverId: string }>,
  events: readonly OrderedApplyEvent[],
  landed: Iterable<string> = [],
): OrderedApplyReceipt[] {
  const satisfied = new Set<string>();
  for (const id of landed) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (trimmed !== '') satisfied.add(trimmed);
  }
  const purgedIds = new Set(
    events.filter((event) => receiptWasPurged(event.receiptAgeDays)).map((event) => event.eventId),
  );
  for (const eventId of seen.keys()) {
    if (!purgedIds.has(eventId)) satisfied.add(eventId);
  }

  const receipts: OrderedApplyReceipt[] = [];
  for (const event of events) {
    const existing = receiptWasPurged(event.receiptAgeDays) ? undefined : seen.get(event.eventId);
    if (existing) {
      receipts.push({ eventId: event.eventId, status: 'duplicate', serverId: existing.serverId });
      continue;
    }
    if (unmetDependency(event.dependsOn, satisfied) !== undefined) {
      receipts.push({ eventId: event.eventId, status: 'dependency_pending' });
      continue;
    }
    const applied = applyOnce(
      seen,
      event,
      event.receiptAgeDays === undefined ? undefined : { receiptAgeDays: event.receiptAgeDays },
    );
    receipts.push({ eventId: event.eventId, status: applied.status, serverId: applied.serverId });
    satisfied.add(event.eventId);
  }
  return receipts;
}
