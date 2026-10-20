/**
 * Destination binding at creation (G10).
 *
 * Create paths call bindOnCreate and keep the returned record. destination is
 * always an own field: the EntityDestination the caller passed, or
 * UNBOUND_DESTINATION when they passed none. The field is never omitted.
 * This module does not look up a session, a selected tenant, or a store.
 *
 * A later sync calls refuseUnboundSync before it pushes or pulls. A returned
 * error means the record stays local. Sync must not proceed until a
 * destination is chosen (kind 'bound'), at which point this returns null.
 */

import { UNBOUND_DESTINATION, type EntityDestination } from './records.js';

/** Same code the sync protocol uses when the client did not name a bound destination. */
export const SYNC_DESTINATION_REQUIRED = 'sync_destination_required';

export interface UnboundSyncError extends Error {
  readonly code: typeof SYNC_DESTINATION_REQUIRED;
}

export interface BindOnCreateInput {
  /**
   * Destination known at creation. Omit, null, or a non-destination and the
   * record stores UNBOUND_DESTINATION. A passed EntityDestination is kept.
   */
  destination?: EntityDestination | null;
}

function isEntityDestination(value: unknown): value is EntityDestination {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'bound' || kind === 'unbound';
}

function unboundSyncError(): UnboundSyncError {
  return Object.assign(new Error('Unbound record cannot sync until a destination is chosen'), {
    name: 'UnboundSyncError',
    code: SYNC_DESTINATION_REQUIRED,
  });
}

/**
 * Stamp a destination onto a create input.
 *
 * The caller's destination is used when they passed an EntityDestination.
 * Otherwise the returned record stores UNBOUND_DESTINATION. The input is not
 * mutated, and destination is never left off the result.
 */
export function bindOnCreate<T extends BindOnCreateInput>(
  input: T,
): Omit<T, 'destination'> & { destination: EntityDestination } {
  const destination = isEntityDestination(input.destination) ? input.destination : UNBOUND_DESTINATION;
  return { ...input, destination };
}

/**
 * Gate a later sync. Returns an error when destination is missing or unbound,
 * and null when it is bound. The caller must not push, pull, or otherwise
 * proceed when this returns an error. Choosing a destination is a later
 * explicit step. This function does not invent one.
 */
export function refuseUnboundSync(
  record: { destination?: EntityDestination | null } | null | undefined,
): UnboundSyncError | null {
  const destination = record?.destination;
  if (isEntityDestination(destination) && destination.kind === 'bound') return null;
  return unboundSyncError();
}
