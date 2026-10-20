/**
 * Domain — parking an event whose dependency has not landed (G16).
 *
 * `dependency_pending` is a protocol receipt status that is DELIBERATELY never
 * stored as a terminal outcome: `SyncStoreSet.insertEvent` persists only
 * accepted, duplicate, conflict and rejected events, and `SyncImportOutcome`
 * refuses to store a pending one, so a parked event must stay retryable. What
 * did not exist was the other half — the place the event waits, and the rule
 * that takes it out again when its dependency arrives.
 *
 * A client event may name the client event (or already-landed entity) it
 * depends on: a ticket that links a parent project, a local audit run that
 * depends on the change set it came from. If the referenced id has not landed,
 * applying the event now would create a broken link, and refusing it outright
 * would lose the user's work. It is parked instead: held, still owned by the
 * client, with the dependency it waits on recorded.
 *
 * In-batch resolution comes first — `batchEvents` in `packages/local-first`
 * already defers an event whose dependency is later in the same push — and this
 * module is the durable half for the case where the dependency has not arrived
 * at all. The caller owns the park list and where it is kept; nothing here
 * writes, and nothing here decides when to retry.
 *
 * Pure: no database, no HTTP, no clock. Both functions are non-mutating — they
 * build a new array and copy every entry they carry — so a caller can keep the
 * previous list as the "before" state and an in-flight batch can never observe
 * a half-updated park.
 */

/** The only status a parked event carries. It is never a terminal receipt. */
export const DEPENDENCY_PARK_STATUS = 'dependency_pending' as const;

export type DependencyParkStatus = typeof DEPENDENCY_PARK_STATUS;

/** Why {@link park} refused to park an event. */
export type DependencyParkErrorCode = 'not_a_dependency';

/**
 * An event that names no dependency cannot be parked, because there is nothing
 * to wait for: parking it would park it forever. `code` is the
 * machine-readable reason (`'not_a_dependency'`), so a caller can distinguish a
 * malformed event from a real transport failure without matching on the message.
 */
export class DependencyParkError extends Error {
  readonly code: DependencyParkErrorCode = 'not_a_dependency';

  constructor(message = 'An event must name a dependency before it can be parked') {
    super(message);
    this.name = 'DependencyParkError';
  }
}

/** The ids already applied — an array, a `Set`, or any iterable of ids. */
export type LandedIds = Iterable<string>;

/**
 * One parked event: the event exactly as the client sent it, the dependency it
 * is waiting on, and the non-terminal status that says so. `dependsOn` is the
 * single unmet id, even when the event named several — the others had already
 * landed when it was parked.
 */
export interface ParkedDependency<E> {
  readonly event: E;
  readonly dependsOn: string;
  readonly status: DependencyParkStatus;
}

/**
 * The minimum an event must carry to be parkable. A wire `JournalEvent`
 * (`dependsOn: string[]`) satisfies this as-is, and a decoded unknown payload
 * with a string or string-array `dependsOn` does too.
 */
export interface DependencyLike {
  readonly eventId?: string;
  readonly dependsOn?: readonly string[] | string | null;
}

/** What {@link resume} releases: `ready` may be applied, `stillPending` may not. */
export interface ResumeResult<E> {
  readonly stillPending: ParkedDependency<E>[];
  readonly ready: E[];
}

/**
 * The dependency ids an event names, with blanks discarded.
 *
 * A missing field, `null`, an empty string, an empty array and an array of
 * whitespace-only ids all mean the same thing: this event names no dependency.
 * Surrounding whitespace is trimmed so `' project:1 '` and `'project:1'` are the
 * same id.
 */
function dependencyIdsOf(event: DependencyLike): string[] {
  const declared = event.dependsOn;
  if (declared === undefined || declared === null) return [];
  const candidates = typeof declared === 'string' ? [declared] : [...declared];
  const ids: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') ids.push(trimmed);
  }
  return ids;
}

function landedIdSet(landed: LandedIds): Set<string> {
  const ids = new Set<string>();
  for (const id of landed) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (trimmed !== '') ids.add(trimmed);
  }
  return ids;
}

/**
 * Park `event` until its dependency lands.
 *
 * The returned list is a NEW array carrying copies of the existing entries,
 * plus the new one when there is something to wait for. The input array and its
 * entries are never mutated.
 *
 * - `dependsOn` missing, empty or blank throws {@link DependencyParkError}
 *   (`code: 'not_a_dependency'`) and NOTHING is appended — a malformed event
 *   must not sit in the park forever with no dependency to release it.
 * - Every dependency already in `landed`: nothing to wait for, so the list is
 *   returned as an unchanged copy and the event is not parked.
 * - Otherwise the event is stored under `'dependency_pending'`, waiting on the
 *   FIRST id that is not in `landed`.
 *
 * This does not deduplicate by `eventId`: a replay is settled by the receipt
 * journal (`applyOnce` in `idempotentApply`), not here.
 */
export function park<E extends DependencyLike>(
  pending: readonly ParkedDependency<E>[],
  event: E,
  landed: LandedIds,
): ParkedDependency<E>[] {
  const dependencyIds = dependencyIdsOf(event);
  if (dependencyIds.length === 0) {
    throw new DependencyParkError();
  }
  const carried = pending.map((entry) => ({ ...entry }));
  const landedIds = landedIdSet(landed);
  const unmet = dependencyIds.find((id) => !landedIds.has(id));
  if (unmet === undefined) return carried;
  return [...carried, { event, dependsOn: unmet, status: DEPENDENCY_PARK_STATUS }];
}

/**
 * Release every event that was waiting on `landedId`.
 *
 * `ready` are the underlying events (not the park wrappers), in park order, and
 * none of them is left in `stillPending`. `stillPending` keeps the remaining
 * entries in their original order as fresh copies. An id nothing was waiting on
 * — including an empty or blank one — moves nothing. The input array is never
 * mutated.
 */
export function resume<E extends DependencyLike>(
  pending: readonly ParkedDependency<E>[],
  landedId: string,
): ResumeResult<E> {
  const released = typeof landedId === 'string' ? landedId.trim() : '';
  const stillPending: ParkedDependency<E>[] = [];
  const ready: E[] = [];
  for (const entry of pending) {
    if (released !== '' && entry.dependsOn === released) {
      ready.push(entry.event);
      continue;
    }
    stillPending.push({ ...entry });
  }
  return { stillPending, ready };
}