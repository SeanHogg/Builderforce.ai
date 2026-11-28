/**
 * The committed state's indexes over pending journal events: by idempotency key, by the row
 * an event writes, and the running counts per destination. Kept by `CommittedState.applyDelta`
 * (and, for what a draft adds, by `Transaction`), so "which events does this row have" and
 * "how much work is left" are lookups instead of walks of the journal.
 */

import { destinationKey, type JournalEvent } from './records.js';
import { isRecordPayloadFence } from './recordPayloadMarker.js';

/**
 * Pending events by their caller-side idempotency key, so `append` finds the event a key
 * already names in O(1) instead of walking every event. A key maps to a LIST because a
 * snapshot opened from disk may carry two events with one key; the latest one in
 * iteration order is the one a lookup returns, exactly as a rebuilt Map would.
 */
export class PendingKeyIndex {
  private readonly byKey = new Map<string, JournalEvent[]>();

  add(event: JournalEvent): void {
    if (event.idempotencyKey === undefined) return;
    const list = this.byKey.get(event.idempotencyKey);
    if (list) list.push(event);
    else this.byKey.set(event.idempotencyKey, [event]);
  }

  remove(event: JournalEvent): void {
    if (event.idempotencyKey === undefined) return;
    const list = this.byKey.get(event.idempotencyKey);
    if (!list) return;
    const at = list.lastIndexOf(event);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) this.byKey.delete(event.idempotencyKey);
  }

  /** Every event filed under this key (read-only to the caller). */
  all(key: string): readonly JournalEvent[] {
    return this.byKey.get(key) ?? [];
  }

  /** The latest event with this key that `live` still accepts. */
  latest(key: string, live?: (event: JournalEvent) => boolean): JournalEvent | undefined {
    const list = this.byKey.get(key);
    if (!list) return undefined;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const event = list[index]!;
      if (!live || live(event)) return event;
    }
    return undefined;
  }

  clear(): void {
    this.byKey.clear();
  }
}

/**
 * Pending event ids by the row they write (`clientEntityId`), so "this row's pending events"
 * costs that row, not the whole journal. Every bind and bound write drops a row's older
 * pending events (`journalRules.ts`); walking every event for each row made a bind of a
 * long-offline history O(rows × events) — 75k messages × 92k events, about an hour inside
 * one transaction — so the bind never finished and nothing was ever sent or acknowledged.
 * An id set, not event objects: the caller reads the event itself through its own view, so
 * a held / dead-lettered replacement under the same id is seen as it is now.
 */
export class PendingEntityIndex {
  private readonly byEntity = new Map<string, Set<string>>();

  add(event: Pick<JournalEvent, 'eventId' | 'clientEntityId'>): void {
    const ids = this.byEntity.get(event.clientEntityId);
    if (ids) ids.add(event.eventId);
    else this.byEntity.set(event.clientEntityId, new Set([event.eventId]));
  }

  remove(event: Pick<JournalEvent, 'eventId' | 'clientEntityId'>): void {
    const ids = this.byEntity.get(event.clientEntityId);
    if (!ids) return;
    ids.delete(event.eventId);
    if (ids.size === 0) this.byEntity.delete(event.clientEntityId);
  }

  /** The ids of the row's events. Read-only to the caller. */
  of(clientEntityId: string): ReadonlySet<string> | undefined {
    return this.byEntity.get(clientEntityId);
  }

  clear(): void {
    this.byEntity.clear();
  }
}

/**
 * Running counts of the committed events per partition (`destinationKey`): how many, and how
 * many of them are dead-lettered. Kept by the same `applyDelta` path as the events, so "how much
 * work is left" is a lookup instead of a walk of the journal (`countPending`).
 */
export class PendingCounts {
  private readonly byPartition = new Map<string, { total: number; dead: number }>();
  private deadTotal = 0;

  add(event: Pick<JournalEvent, 'destination' | 'deadLetter' | 'idempotencyKey'>): void {
    this.bump(event, 1);
  }

  remove(event: Pick<JournalEvent, 'destination' | 'deadLetter' | 'idempotencyKey'>): void {
    this.bump(event, -1);
  }

  /** Events in `partition` that are not dead-lettered. */
  live(partition: string): number {
    const row = this.byPartition.get(partition);
    return row ? row.total - row.dead : 0;
  }

  /** Live events across every partition. */
  liveTotal(): number {
    let live = 0;
    for (const row of this.byPartition.values()) live += row.total - row.dead;
    return live;
  }

  /** Dead-lettered events across every partition. */
  dead(): number {
    return this.deadTotal;
  }

  clear(): void {
    this.byPartition.clear();
    this.deadTotal = 0;
  }

  private bump(event: Pick<JournalEvent, 'destination' | 'deadLetter' | 'idempotencyKey'>, by: 1 | -1): void {
    // The record-payload fence is no work and no failure: it only holds older builds off markers.
    if (isRecordPayloadFence(event)) return;
    const key = destinationKey(event.destination);
    const row = this.byPartition.get(key) ?? { total: 0, dead: 0 };
    row.total += by;
    if (event.deadLetter) {
      row.dead += by;
      this.deadTotal += by;
    }
    // A draft's adjustments may go negative (it acknowledges committed events): only zero is empty.
    if (row.total === 0 && row.dead === 0) this.byPartition.delete(key);
    else this.byPartition.set(key, row);
  }
}
