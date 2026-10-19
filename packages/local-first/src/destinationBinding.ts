/**
 * Destination binding at creation (G10).
 *
 * Identity is an explicit argument. This module does not look up a signed-in
 * user, a tenant selection, a token, or any other live setting. Whatever of
 * platform instance, account, tenant, project, and repository is known at
 * creation is copied onto the record as a snapshot.
 *
 * A project, ticket, chat, audit, or run is created only with a bound
 * destination. A missing destination, an unbound destination, and an empty
 * destination key throw `unbound_destination` before a record is built, so
 * nothing is written for a later account to adopt. Other entity types with
 * no known field stay in the unbound partition until assignDestination. A
 * bound account or tenant is never rewritten, including from absent to a
 * later sign-in. This module does not add a rebind operation.
 */

import { newLocalRecord } from './store.js';
import {
  UNBOUND_DESTINATION,
  destinationKey,
  type DestinationBinding,
  type EntityDestination,
  type LocalEntityType,
  type LocalRecord,
} from './records.js';

export type DestinationBindingCode =
  | 'destination_account_mismatch'
  | 'destination_tenant_mismatch'
  | 'destination_rebind_refused';

/** Project, ticket, chat, audit, and run. Audit stores as `audit-run`; a run stores as `execution`. */
export const DESTINATION_CREATION_KINDS = ['project', 'ticket', 'chat', 'audit', 'run'] as const;

export type DestinationCreationKind = (typeof DESTINATION_CREATION_KINDS)[number];

/** Missing, unbound, or empty destination at creation of a gated kind. */
export const UNBOUND_DESTINATION_CODE = 'unbound_destination';

export interface UnboundDestinationError extends Error {
  code: typeof UNBOUND_DESTINATION_CODE;
  entityType: string;
}

const KIND_TO_ENTITY: Record<DestinationCreationKind, LocalEntityType> = {
  project: 'project',
  ticket: 'ticket',
  chat: 'chat',
  audit: 'audit-run',
  run: 'execution',
};

const GATED_CREATION_TYPES: ReadonlySet<string> = new Set([
  'project',
  'ticket',
  'chat',
  'audit',
  'audit-run',
  'run',
  'execution',
]);

export interface NewLocalRecordInput<T> {
  id: string;
  entityType: LocalEntityType;
  payload: T;
  deviceId: string;
  occurredAt?: string;
  schemaVersion?: number;
}

export interface BindLocalRecordInput<T> {
  /** An existing record. Omit this when creating one. */
  existing?: LocalRecord<T>;
  /** Required when `existing` is omitted. */
  create?: NewLocalRecordInput<T>;
  /**
   * Explicit destination snapshot. Only platformInstance, accountId, tenantId,
   * projectId, and repository are copied. Any other field is ignored.
   */
  destination?: DestinationBinding | EntityDestination;
  /**
   * The only way to move an existing unbound record into a bound partition.
   * Creation stamps `destination` without this flag.
   */
  assign?: boolean;
}

type SnapshotField = 'platformInstance' | 'accountId' | 'tenantId' | 'projectId' | 'repository';

function knownString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Own data property only. A getter is a live lookup and is not invoked. */
function ownValue(source: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, field);
  if (!descriptor || typeof descriptor.get === 'function') return undefined;
  return descriptor.value;
}

/**
 * Copy the known snapshot. Never retains the caller's object.
 * No known field means the unbound partition. `kind: 'unbound'` wins even
 * if identity fields were also present — those fields are not read.
 */
export function bindingSnapshot(destination: DestinationBinding | EntityDestination | undefined): EntityDestination {
  if (!destination || typeof destination !== 'object') return UNBOUND_DESTINATION;
  if (ownValue(destination, 'kind') === 'unbound') return UNBOUND_DESTINATION;
  const platformInstance = knownString(ownValue(destination, 'platformInstance'));
  const accountId = knownString(ownValue(destination, 'accountId'));
  const tenantId = knownString(ownValue(destination, 'tenantId'));
  const projectId = knownString(ownValue(destination, 'projectId'));
  const repository = knownString(ownValue(destination, 'repository'));
  if (!platformInstance && !accountId && !tenantId && !projectId && !repository) return UNBOUND_DESTINATION;
  const snapshot: { kind: 'bound' } & DestinationBinding = { kind: 'bound' };
  if (platformInstance) snapshot.platformInstance = platformInstance;
  if (accountId) snapshot.accountId = accountId;
  if (tenantId) snapshot.tenantId = tenantId;
  if (projectId) snapshot.projectId = projectId;
  if (repository) snapshot.repository = repository;
  return Object.freeze(snapshot);
}

function fieldOf(destination: EntityDestination, field: SnapshotField): string | undefined {
  if (destination.kind !== 'bound') return undefined;
  return destination[field];
}

/**
 * Refusal code when `proposed` would replace a bound snapshot.
 * `null` when the proposal does not change account, tenant, or any other
 * snapshotted field. An unbound existing destination is not a rebind.
 */
export function destinationRebindCode(
  existing: EntityDestination,
  proposed: EntityDestination,
): DestinationBindingCode | null {
  if (existing.kind !== 'bound') return null;
  if (fieldOf(existing, 'tenantId') !== fieldOf(proposed, 'tenantId')) return 'destination_tenant_mismatch';
  if (fieldOf(existing, 'accountId') !== fieldOf(proposed, 'accountId')) return 'destination_account_mismatch';
  if (destinationKey(existing) !== destinationKey(proposed)) return 'destination_rebind_refused';
  return null;
}

function refuse(code: DestinationBindingCode, existing: EntityDestination, proposed: EntityDestination): never {
  throw Object.assign(new Error(code), {
    code,
    existing: destinationKey(existing),
    proposed: destinationKey(proposed),
  });
}

function isGatedCreation(entityType: string): boolean {
  return GATED_CREATION_TYPES.has(entityType);
}

/**
 * An explicit destinationKey that is missing, blank, or the unbound sentinel.
 * Present even when identity fields were also smuggled onto the same object.
 * A function key is not called.
 */
function emptyDestinationKey(destination: unknown): boolean {
  if (typeof destination !== 'object' || destination === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(destination, 'destinationKey');
  if (!descriptor) return false;
  if (typeof descriptor.get === 'function' || typeof descriptor.value === 'function') return true;
  const key = descriptor.value;
  if (typeof key !== 'string') return true;
  const trimmed = key.trim();
  return trimmed.length === 0 || trimmed === 'unbound';
}

function refusesCreation(destination: unknown): boolean {
  if (typeof destination === 'function') return true;
  if (emptyDestinationKey(destination)) return true;
  return bindingSnapshot(destination as DestinationBinding | EntityDestination | undefined).kind !== 'bound';
}

function refuseUnbound(entityType: string): never {
  throw Object.assign(new Error(UNBOUND_DESTINATION_CODE), {
    code: UNBOUND_DESTINATION_CODE,
    entityType,
  }) as UnboundDestinationError;
}

function stamp<T>(record: LocalRecord<T>, destination: EntityDestination): LocalRecord<T> {
  if (destination === record.destination) return record;
  return { ...record, destination };
}

/**
 * Stamp a destination onto a new record, keep an existing snapshot, or
 * assign one explicitly. Does not read a live tenant selection.
 */
export function bindLocalRecord<T>(input: BindLocalRecordInput<T>): LocalRecord<T> {
  if (
    !input.existing
    && input.create
    && isGatedCreation(input.create.entityType)
    && refusesCreation(input.destination)
  ) {
    refuseUnbound(input.create.entityType);
  }
  const proposed = bindingSnapshot(input.destination);
  if (!input.existing) {
    if (!input.create) throw new Error('destination_record_required');
    const created = newLocalRecord({
      id: input.create.id,
      entityType: input.create.entityType,
      payload: input.create.payload,
      deviceId: input.create.deviceId,
      destination: UNBOUND_DESTINATION,
      ...(input.create.occurredAt ? { occurredAt: input.create.occurredAt } : {}),
      ...(input.create.schemaVersion !== undefined ? { schemaVersion: input.create.schemaVersion } : {}),
    });
    return stamp(created, proposed);
  }
  const existing = input.existing.destination;
  if (existing.kind === 'unbound') {
    if (!input.assign) return input.existing;
    return stamp(input.existing, proposed);
  }
  const code = destinationRebindCode(existing, proposed);
  if (code && input.destination !== undefined) refuse(code, existing, proposed);
  return input.existing;
}

/** Create a record with its destination snapshotted at creation. */
export function createBoundRecord<T>(
  input: NewLocalRecordInput<T> & { destination?: DestinationBinding | EntityDestination },
): LocalRecord<T> {
  return bindLocalRecord({ create: input, destination: input.destination });
}

/**
 * Create a project, ticket, chat, audit, or run. A bound destination is copied
 * onto the record. Anything else throws `unbound_destination` and returns no
 * record, so the caller has nothing to write.
 */
export function createDestinationBoundRecord<T>(
  kind: DestinationCreationKind,
  input: Omit<NewLocalRecordInput<T>, 'entityType'> & {
    destination?: DestinationBinding | EntityDestination;
  },
): LocalRecord<T> {
  if (!(DESTINATION_CREATION_KINDS as readonly string[]).includes(kind)) {
    throw Object.assign(new Error('unknown_kind'), { code: 'unknown_kind', kind });
  }
  return createBoundRecord({ ...input, entityType: KIND_TO_ENTITY[kind] });
}

/**
 * Explicit destination assignment. Unbound records stay unbound when the
 * argument names no snapshot field. A different account or tenant on an
 * already bound record is refused.
 */
export function assignDestination<T>(
  record: LocalRecord<T>,
  destination: DestinationBinding | EntityDestination,
): LocalRecord<T> {
  return bindLocalRecord({ existing: record, destination, assign: true });
}
