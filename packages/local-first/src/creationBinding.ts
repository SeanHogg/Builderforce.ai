/**
 * Creation-time destination guard (G10).
 *
 * Project, ticket, chat, audit (`audit-run`), and run (`execution`) creation
 * must ask this guard before a record exists. It does not write a store and
 * does not call the network. It does not read a session, a token, or a
 * selected tenant.
 *
 * An unknown account may only create the unbound partition. A tenant, project,
 * or any other binding field on that call is a forged destination — this guard
 * will not invent one from whoever signs in next, including a tenant smuggled
 * onto `{ kind: 'unbound' }`.
 *
 * A known account must name a bound destination. The destination is the
 * existing `EntityDestination` (`{ kind: 'bound' }` plus `DestinationBinding`).
 * There is no second shape. Missing, unbound, or empty identity is refused so
 * a caller that skips the coordinator cannot leave an unbound record for a
 * later account to adopt.
 */

import {
  UNBOUND_DESTINATION,
  type DestinationBinding,
  type EntityDestination,
  type LocalEntityType,
} from './records.js';

/** Creation sites this guard is for. Audit is `audit-run`; a run is `execution`. */
export const CREATION_ENTITY_TYPES = ['project', 'ticket', 'chat', 'audit-run', 'execution'] as const;

export type CreationEntityType = (typeof CREATION_ENTITY_TYPES)[number];

/** Signed-out caller named a tenant or another binding field. */
export const DESTINATION_FORGED = 'destination_forged';

/** Signed-in caller did not name a bound destination. */
export const DESTINATION_REQUIRED = 'destination_required';

export type CreationBindingReason = typeof DESTINATION_FORGED | typeof DESTINATION_REQUIRED;

export type CreationBindingResult =
  | { ok: true; destination: EntityDestination }
  | { ok: false; reason: CreationBindingReason };

export interface CreationBindingInput {
  entityType: CreationEntityType | LocalEntityType;
  /**
   * Proposed destination. `EntityDestination`, or a `DestinationBinding`
   * without `kind`. Omitted means unbound.
   */
  destination?: EntityDestination | DestinationBinding | null;
  /** True only when an account is already known. Not an account id. */
  accountKnown: boolean;
}

type BindingField = 'platformInstance' | 'accountId' | 'tenantId' | 'projectId' | 'repository';

const BINDING_FIELDS: readonly BindingField[] = [
  'platformInstance',
  'accountId',
  'tenantId',
  'projectId',
  'repository',
];

function knownString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ProposedBinding {
  /** `kind: 'unbound'` was explicit. Identity fields on that object are still read. */
  explicitUnbound: boolean;
  /** `kind` was absent or `bound`. Any other kind is not the binding type. */
  kindLegal: boolean;
  fields: DestinationBinding;
  hasIdentity: boolean;
}

function readProposed(destination: CreationBindingInput['destination']): ProposedBinding {
  if (!isRecord(destination)) {
    return { explicitUnbound: false, kindLegal: true, fields: {}, hasIdentity: false };
  }
  const kind = destination.kind;
  const explicitUnbound = kind === 'unbound';
  const kindLegal = kind === undefined || kind === 'bound' || kind === 'unbound';
  const fields: DestinationBinding = {};
  let hasIdentity = false;
  for (const field of BINDING_FIELDS) {
    const value = knownString(destination[field]);
    if (!value) continue;
    fields[field] = value;
    hasIdentity = true;
  }
  return { explicitUnbound, kindLegal, fields, hasIdentity };
}

function boundDestination(fields: DestinationBinding): EntityDestination {
  return Object.freeze({ kind: 'bound', ...fields });
}

/**
 * Decide the destination a creation may stamp.
 *
 * Signed out: only {@link UNBOUND_DESTINATION}. A forged tenant is refused.
 * Signed in: a frozen copy of a bound `EntityDestination`. Unbound is refused.
 */
export function guardCreationBinding(input: CreationBindingInput): CreationBindingResult {
  const proposed = readProposed(input.destination);
  if (!input.accountKnown) {
    if (proposed.hasIdentity) return { ok: false, reason: DESTINATION_FORGED };
    return { ok: true, destination: UNBOUND_DESTINATION };
  }
  if (!proposed.kindLegal || proposed.explicitUnbound || !proposed.hasIdentity) {
    return { ok: false, reason: DESTINATION_REQUIRED };
  }
  return { ok: true, destination: boundDestination(proposed.fields) };
}
