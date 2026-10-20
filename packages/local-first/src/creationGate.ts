/**
 * Creation gate (G10).
 *
 * Project, ticket, chat, audit, and run creation must pass a bound destination
 * value. This function does not look up a session, a tenant, a store, or the
 * network, and it does not write a record. A function argument is not invoked.
 *
 * A missing destination, an unbound destination, and an empty destinationKey
 * are the same refusal: the caller did not name a bound destination, so nothing
 * is created for a later account to adopt.
 */

import { destinationKey, type EntityDestination } from './records.js';

export const CREATION_KINDS = ['project', 'ticket', 'chat', 'audit', 'run'] as const;

export type CreationKind = (typeof CREATION_KINDS)[number];

/** Destination was missing, unbound, or had an empty key. */
export const UNBOUND_DESTINATION = 'unbound_destination';

/** Kind is not project, ticket, chat, audit, or run. */
export const UNKNOWN_KIND = 'unknown_kind';

export interface BoundCreation {
  readonly kind: CreationKind;
  readonly destinationKey: string;
}

const BINDING_FIELDS = ['platformInstance', 'accountId', 'tenantId', 'projectId', 'repository'] as const;

type BindingField = (typeof BINDING_FIELDS)[number];

function refuse(code: typeof UNBOUND_DESTINATION | typeof UNKNOWN_KIND): never {
  throw Object.assign(new Error(code), { code });
}

function isCreationKind(kind: string): kind is CreationKind {
  return (CREATION_KINDS as readonly string[]).includes(kind);
}

function knownKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Key copied from the destination value. A function is not called.
 * `undefined` means missing, unbound, or empty.
 */
function destinationKeyOf(destination: unknown): string | undefined {
  if (typeof destination === 'function' || destination == null) return undefined;
  if (typeof destination === 'string') {
    const key = knownKey(destination);
    if (!key || key === 'unbound') return undefined;
    return key;
  }
  if (!isRecord(destination)) return undefined;
  if (destination.kind === 'unbound') return undefined;
  if (destination.kind !== undefined && destination.kind !== 'bound') return undefined;
  if ('destinationKey' in destination) {
    const key = knownKey(destination.destinationKey);
    if (!key || key === 'unbound') return undefined;
    return key;
  }
  const fields: { kind: 'bound' } & Partial<Record<BindingField, string>> = { kind: 'bound' };
  let hasIdentity = false;
  for (const field of BINDING_FIELDS) {
    const value = knownKey(destination[field]);
    if (!value) continue;
    fields[field] = value;
    hasIdentity = true;
  }
  if (!hasIdentity) return undefined;
  const key = destinationKey(fields as EntityDestination);
  return key.length > 0 && key !== 'unbound' ? key : undefined;
}

/**
 * Accept a creation only when `kind` is a creation kind and `destination` is
 * already a bound value. Does not call `destination` when it is a function,
 * and does not write a record on success or on refusal.
 */
export function createBound(kind: string, destination: unknown): BoundCreation {
  if (typeof kind !== 'string' || !isCreationKind(kind)) refuse(UNKNOWN_KIND);
  const key = destinationKeyOf(destination);
  if (!key) refuse(UNBOUND_DESTINATION);
  return Object.freeze({ kind, destinationKey: key });
}
