/**
 * Explicit destination rebind (G11).
 *
 * A record already carries a destination snapshot. Sync and offline reads use
 * that snapshot's `destinationKey`. They do not recompute it from a live
 * parent, and they do not call `rebindDestination`. This function copies a
 * caller-supplied destination into a new snapshot, or refuses. It does not
 * read a selected project, call taskProjectId, or any other live parent
 * lookup. A UI selection change that is not passed as `proposed` cannot
 * appear in the result, so changing the selection cannot redirect pending work.
 */

import { readChildDestination, snapshotDestination, type DestinationSnapshot, type SnapshotDestinationInput } from './destinationSnapshot.js';
import { destinationKey, type EntityDestination } from './records.js';

export const REBIND_PENDING_OUTBOUND = 'pending_outbound';
export const REBIND_DESTINATION_REQUIRED = 'destination_required';

export type RebindRefusalReason = typeof REBIND_PENDING_OUTBOUND | typeof REBIND_DESTINATION_REQUIRED;

/** Caller-supplied pending outbound work. Not looked up from a queue or the UI. */
export interface RebindPendingWork {
  readonly pending?: boolean;
  readonly unsentEventId?: string | null;
}

export interface RebindDestinationInput {
  /** Destination already snapshotted on the record. Not rewritten in place. */
  readonly snapshot: DestinationSnapshot | EntityDestination | SnapshotDestinationInput;
  /**
   * The only destination a rebind may adopt. Omit it and the call refuses.
   * There is no selected project to fill in.
   */
  readonly proposed?: SnapshotDestinationInput | null;
  /** True, or `{ pending: true }`, when outbound work has not been sent. */
  readonly pending?: boolean | RebindPendingWork | null;
  /** An unsent event id. A non-empty id is pending work. */
  readonly unsentEventId?: string | null;
  /**
   * A live parent lookup, such as taskProjectId. Accepted only so a caller can
   * prove it is never invoked. Omitting `proposed` does not call it.
   */
  readonly liveLookup?: () => unknown;
  /**
   * A UI selection observed at call time. Never read. Passing it is not an
   * explicit rebind, and it must not appear in the result.
   */
  readonly liveSelection?: unknown;
}

export type RebindDestinationResult =
  | { readonly ok: true; readonly destination: DestinationSnapshot }
  | { readonly ok: false; readonly reason: RebindRefusalReason };

function nonEmptyId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

function hasPendingOutbound(input: RebindDestinationInput): boolean {
  if (input.pending === true) return true;
  if (nonEmptyId(input.unsentEventId)) return true;
  if (input.pending && typeof input.pending === 'object') {
    if (input.pending.pending === true) return true;
    if (nonEmptyId(input.pending.unsentEventId)) return true;
  }
  return false;
}

/**
 * Rebind only when the caller passes an explicit destination and no pending
 * outbound work. The record snapshot is not mutated. `liveLookup` and
 * `liveSelection` are not consulted.
 */
export function rebindDestination(input: RebindDestinationInput): RebindDestinationResult {
  void input.snapshot;
  void input.liveLookup;
  void input.liveSelection;
  if (hasPendingOutbound(input)) {
    return { ok: false, reason: REBIND_PENDING_OUTBOUND };
  }
  if (input.proposed == null) {
    return { ok: false, reason: REBIND_DESTINATION_REQUIRED };
  }
  return { ok: true, destination: snapshotDestination(input.proposed) };
}

const BINDING_FIELDS = ['platformInstance', 'accountId', 'tenantId', 'projectId', 'repository'] as const;

type BindingField = (typeof BINDING_FIELDS)[number];

/**
 * Own data property only. A getter is a live lookup — `taskProjectId()`, the
 * selected project — and is never invoked.
 */
function ownData(source: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, field);
  if (!descriptor || typeof descriptor.get === 'function') return undefined;
  return descriptor.value;
}

/** A plain copy of a destination data property. Getters are not copied. */
function plainDestination(value: unknown): EntityDestination | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const kind = ownData(value, 'kind');
  if (kind === 'unbound') return Object.freeze({ kind: 'unbound' });
  if (kind !== 'bound') return undefined;
  const copy: { kind: 'bound' } & Partial<Record<BindingField, string>> = { kind: 'bound' };
  for (const field of BINDING_FIELDS) {
    const fieldValue = ownData(value, field);
    if (typeof fieldValue === 'string') copy[field] = fieldValue;
  }
  return Object.freeze(copy);
}

export interface SnapshottedRecord {
  readonly destination?: unknown;
  readonly destinationKey?: string | null;
}

/**
 * The destination key a sync or offline read must use.
 *
 * Reads the snapshot stored on the written record: `destination` when that is
 * own data, otherwise the stored `destinationKey` string. `liveParent` is the
 * lookup this replaces. It is not called and not read, and this function does
 * not rebind.
 */
export function snapshottedDestinationKey(written: SnapshottedRecord, liveParent?: unknown): string {
  void liveParent;
  if (written && typeof written === 'object') {
    const destination = plainDestination(ownData(written, 'destination'));
    if (destination) return destinationKey(destination);
    const stored = ownData(written, 'destinationKey');
    if (typeof stored === 'string' || stored == null) {
      return readChildDestination({ destinationKey: typeof stored === 'string' ? stored : null });
    }
  }
  return readChildDestination({ destinationKey: null });
}

/**
 * The destination object a sync push must name. Copied from the written
 * record's own data. A key-only snapshot has no object to invent, and a live
 * parent is not a substitute. This does not rebind.
 */
export function snapshottedDestination(written: SnapshottedRecord, liveParent?: unknown): EntityDestination {
  void liveParent;
  if (written && typeof written === 'object') {
    const destination = plainDestination(ownData(written, 'destination'));
    if (destination) return destination;
  }
  const key = snapshottedDestinationKey(written, liveParent);
  if (key === 'unbound') return Object.freeze({ kind: 'unbound' });
  throw Object.assign(new Error('destination_snapshot_required'), { code: 'destination_snapshot_required' });
}

/** Offline read: each record's destination key is its snapshot, not the live parent. */
export function readOfflineDestinations<T extends SnapshottedRecord>(
  records: readonly T[],
  liveParent?: unknown,
): ReadonlyArray<{ readonly record: T; readonly destinationKey: string }> {
  void liveParent;
  return records.map((record) => ({
    record,
    destinationKey: snapshottedDestinationKey(record, liveParent),
  }));
}

export interface SnapshottedSyncPlan {
  readonly bound: readonly EntityDestination[];
  readonly unboundRefused: number;
}

/**
 * Destinations a sync may name, taken from written events and records.
 * Unbound events are refused here and are not given a destination. `liveParent`
 * is not read. This does not rebind and does not mutate the inputs.
 */
export function destinationsForSync(
  events: readonly SnapshottedRecord[],
  records: readonly SnapshottedRecord[] = [],
  liveParent?: unknown,
): SnapshottedSyncPlan {
  void liveParent;
  const bound = new Map<string, EntityDestination>();
  let unboundRefused = 0;
  for (const event of events) {
    const destination = snapshottedDestination(event, liveParent);
    const key = destinationKey(destination);
    if (destination.kind === 'unbound' || key === 'unbound') {
      unboundRefused += 1;
      continue;
    }
    if (!bound.has(key)) bound.set(key, destination);
  }
  for (const record of records) {
    let destination: EntityDestination;
    try {
      destination = snapshottedDestination(record, liveParent);
    } catch {
      continue;
    }
    if (destination.kind === 'unbound') continue;
    const key = destinationKey(destination);
    if (key === 'unbound' || bound.has(key)) continue;
    bound.set(key, destination);
  }
  return { bound: [...bound.values()], unboundRefused };
}
