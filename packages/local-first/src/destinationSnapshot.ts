/**
 * Destination snapshot (G11).
 *
 * A destination binding is a copy taken at creation, not a live lookup of the
 * currently selected tenant or of a parent whose destination later changes.
 * An entity created while tenant A is selected keeps tenant A after the user
 * selects tenant B. A child stores the parent's destination key captured at
 * creation; changing the parent afterwards does not move the child. Unknown
 * identity stays unknown: a null tenant must not adopt whoever signs in next.
 *
 * This module does not write records, does not read settings, and has no
 * rebind operation. A later destination is a new record, not an edit of the
 * key already stored.
 */

import { destinationKey, type EntityDestination } from './records.js';

export interface DestinationSnapshot {
  readonly accountId: string | null;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly capturedAt: string;
}

/** The three identity fields a live UI selection can offer. Not a binding. */
export interface DestinationSelection {
  readonly accountId?: string | null;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
}

export type SnapshotDestinationInput =
  | (DestinationSelection & { readonly capturedAt?: string })
  | (EntityDestination & { readonly capturedAt?: string });

function copyId(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function readIdentity(input: SnapshotDestinationInput): {
  accountId: string | null;
  tenantId: string | null;
  projectId: string | null;
} {
  if ('kind' in input && input.kind === 'unbound') {
    return { accountId: null, tenantId: null, projectId: null };
  }
  const selected = input as DestinationSelection;
  return {
    accountId: copyId(selected.accountId),
    tenantId: copyId(selected.tenantId),
    projectId: copyId(selected.projectId),
  };
}

/**
 * Copy account, tenant, and project into a frozen snapshot. Missing identity
 * is null, not "fill this in later". `capturedAt` stamps when the copy was taken.
 */
export function snapshotDestination(input: SnapshotDestinationInput): DestinationSnapshot {
  const identity = readIdentity(input);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  return Object.freeze({
    accountId: identity.accountId,
    tenantId: identity.tenantId,
    projectId: identity.projectId,
    capturedAt,
  });
}

/**
 * Always the snapshot taken at creation. A later UI selection is ignored,
 * so changing the selected tenant or project cannot redirect pending work.
 */
export function resolveDestination(
  snapshot: DestinationSnapshot,
  liveSelection: DestinationSelection | EntityDestination,
): DestinationSnapshot {
  void liveSelection;
  return snapshot;
}

/**
 * Sign-in does not assign ownership. A null tenant stays null. A tenant that
 * differs from the signed-in tenant stays the tenant captured at creation.
 * A matching sign-in is not a rewrite either.
 */
export function adoptOnSignIn(
  snapshot: DestinationSnapshot,
  signedInTenant: string | null,
): DestinationSnapshot {
  if (snapshot.tenantId == null || snapshot.tenantId !== signedInTenant) {
    return snapshot;
  }
  return snapshot;
}

/**
 * A parent at the moment a child is created. `destinationKey`, when present,
 * is the snapshot already stored on that parent. `destination` is the parent's
 * destination value, read only when the parent has no snapshot key.
 * A function is not a parent: this module never calls a live lookup.
 */
export interface ChildDestinationParent {
  readonly destinationKey?: string;
  readonly destination?: EntityDestination;
}

/** Destination key copied onto a child at creation. Not a live parent pointer. */
export interface ChildDestinationRecord {
  readonly destinationKey: string;
  readonly capturedAt: string;
}

/** The child has no destination key to read, and a live parent must not fill it. */
export const DESTINATION_SNAPSHOT_REQUIRED = 'destination_snapshot_required';

function storedKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Whitespace is not a key. A real key is copied unchanged, not trimmed.
  return value.trim().length > 0 ? value : undefined;
}

function refuseMissingSnapshot(): never {
  throw Object.assign(new Error(DESTINATION_SNAPSHOT_REQUIRED), { code: DESTINATION_SNAPSHOT_REQUIRED });
}

/**
 * Key to copy at creation. The snapshot field wins over `destination`, so a
 * parent whose live destination has already moved cannot be what the child
 * stores. There is no lookup function to call.
 */
function keyCapturedFromParent(parent: ChildDestinationParent): string {
  const snapshotted = storedKey(parent.destinationKey);
  if (snapshotted) return snapshotted;
  const destination = parent.destination;
  if (destination && typeof destination === 'object' && 'kind' in destination) {
    return destinationKey(destination);
  }
  return refuseMissingSnapshot();
}

/**
 * Copy the parent's destination key onto a new child. The child keeps that
 * string. It does not keep the parent, so a later change to the parent's
 * destination cannot move the child. There is no rebind.
 */
export function snapshotChildDestination(
  parent: ChildDestinationParent,
  capturedAt?: string,
): ChildDestinationRecord {
  const key = keyCapturedFromParent(parent);
  return Object.freeze({
    destinationKey: key,
    capturedAt: capturedAt ?? new Date().toISOString(),
  });
}

/**
 * Destination a send or publish path must use. Reads the snapshot field
 * stored on the child. `liveParent` is the lookup this replaces —
 * `taskProjectId()`, the selected project, or the parent record after its
 * destination changed. It is never called and never read.
 */
export function readChildDestination(
  child: { readonly destinationKey?: string | null },
  liveParent?: unknown,
): string {
  void liveParent;
  const key = storedKey(child?.destinationKey);
  if (!key) return refuseMissingSnapshot();
  return key;
}
