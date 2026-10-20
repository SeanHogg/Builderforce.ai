/**
 * Explicit destination rebind (G11).
 *
 * Sync and offline reads use the destination snapshot already stored on the
 * record. `readDestination` returns that key via the pure `destinationKey`
 * function. It takes the record only: a live parent id is not a parameter,
 * and nothing here looks a parent up.
 *
 * Moving an already-written record is `rebindDestination`. That returns a new
 * record. It does not mutate the record it was given, and it does not run as
 * a side effect of a lookup.
 */

import { UNBOUND_DESTINATION, destinationKey, type DestinationBinding, type EntityDestination } from './records.js';

/** A second argument, a getter, or a function was offered as a live parent. */
export const LIVE_PARENT_LOOKUP_REFUSED = 'live_parent_lookup_refused';

/** The record has no destination snapshot to read, or `next` is not a destination. */
export const DESTINATION_REQUIRED = 'destination_required';

/** A record that already carries its destination snapshot. Not a parent pointer. */
export interface SnapshottedRecord {
  readonly destination: EntityDestination;
}

const BINDING_FIELDS = ['platformInstance', 'accountId', 'tenantId', 'projectId', 'repository'] as const;

function refuse(code: typeof LIVE_PARENT_LOOKUP_REFUSED | typeof DESTINATION_REQUIRED): never {
  throw Object.assign(new Error(code), { code });
}

/** Own data property only. A getter is a live lookup and is not invoked. */
function ownData(source: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, field);
  if (!descriptor || typeof descriptor.get === 'function') return undefined;
  return descriptor.value;
}

function isDestination(value: unknown): value is EntityDestination {
  if (typeof value !== 'object' || value === null) return false;
  const kind = ownData(value, 'kind');
  return kind === 'unbound' || kind === 'bound';
}

/**
 * Plain copy of a destination value. Identity fields are copied only when they
 * are own data strings. Getters and functions are not called. `kind: 'unbound'`
 * wins even if identity fields were also present — those fields are not read.
 */
function snapshotOf(destination: EntityDestination): EntityDestination {
  if (typeof destination !== 'object' || destination === null) refuse(DESTINATION_REQUIRED);
  const kind = ownData(destination, 'kind');
  if (kind === 'unbound') return UNBOUND_DESTINATION;
  if (kind !== 'bound') refuse(DESTINATION_REQUIRED);
  const snapshot: { kind: 'bound' } & DestinationBinding = { kind: 'bound' };
  for (const field of BINDING_FIELDS) {
    const value = ownData(destination, field);
    if (typeof value !== 'string') continue;
    snapshot[field] = value;
  }
  return Object.freeze(snapshot);
}

/**
 * Copy own data properties. Getters and functions are skipped so a parent
 * lookup on the record is not invoked. `destination` is always the explicit
 * snapshot passed in.
 */
function copyRecord<T extends SnapshottedRecord>(record: T, destination: EntityDestination): T {
  const copy: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(record)) {
    if (key === 'destination') continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || typeof descriptor.get === 'function') continue;
    if (typeof descriptor.value === 'function') continue;
    copy[key] = descriptor.value;
  }
  copy.destination = destination;
  return copy as T;
}

/**
 * Destination key snapshotted on `record`. The only argument is the record.
 * A parent id, a lookup function, or any other extra argument is refused and
 * never called. A getter on `destination` is a live lookup and is not invoked.
 */
export function readDestination(record: SnapshottedRecord, ...liveParent: never[]): string {
  if (liveParent.length > 0) refuse(LIVE_PARENT_LOOKUP_REFUSED);
  if (typeof record !== 'object' || record === null) refuse(DESTINATION_REQUIRED);
  const descriptor = Object.getOwnPropertyDescriptor(record, 'destination');
  if (descriptor && typeof descriptor.get === 'function') refuse(LIVE_PARENT_LOOKUP_REFUSED);
  const destination = descriptor?.value;
  if (typeof destination === 'function') refuse(LIVE_PARENT_LOOKUP_REFUSED);
  if (!isDestination(destination)) refuse(DESTINATION_REQUIRED);
  return destinationKey(snapshotOf(destination));
}

/**
 * Explicit rebind. Returns a new record whose destination is a copy of `next`.
 * Does not mutate `record`. Does not call `next` when it is a function, and
 * does not look up a parent to fill in a missing destination.
 */
export function rebindDestination<T extends SnapshottedRecord>(
  record: T,
  next: EntityDestination,
  ...liveParent: never[]
): T {
  if (liveParent.length > 0) refuse(LIVE_PARENT_LOOKUP_REFUSED);
  if (typeof next === 'function') refuse(LIVE_PARENT_LOOKUP_REFUSED);
  if (typeof record !== 'object' || record === null) refuse(DESTINATION_REQUIRED);
  return copyRecord(record, snapshotOf(next));
}
