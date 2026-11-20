/**
 * Generic helpers for a webhook that announces a TRANSITION (a row moving into a status),
 * shared by the generic tracker emit (`segmentTrackerRoutes` — `sprint.completed`) and the
 * roadmap write step (`roadmapWrite` — `roadmap.published`).
 */

type Row = Record<string, unknown>;

/** True when a write moved `field` INTO `value` (a create counts: there was no before). */
export function isTransitionInto(field: string, value: unknown, before: Row | null, after: Row | null): boolean {
  return after != null && after[field] === value && before?.[field] !== value;
}

/**
 * The webhook `eventId` of ONE transition of `row` into `value`. It is half of the replay key
 * (`uq_webhook_delivery_event` on subscription + event type + event id), so the bare row id would
 * make a genuine re-entry (shipped → planned → shipped) collide with the first announcement and be
 * swallowed. The write's own `updatedAt` instant (every tracker and Brain write stamps it, and
 * creates get the column default) tells two transitions apart while a retried delivery of the same
 * write still collides. The `randomUUID` / `Date.now()` fallbacks never dedupe: they exist only so a
 * future tracker table without `id` / `updatedAt` still emits — give such a table an `updatedAt`.
 */
export function transitionEventId(row: Row, value: string): string {
  const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : crypto.randomUUID();
  const stamp = row.updatedAt instanceof Date ? row.updatedAt.getTime()
    : typeof row.updatedAt === 'string' && !Number.isNaN(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt)
      : Date.now();
  return `${id}:${value}:${stamp}`;
}
