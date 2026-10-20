/**
 * Domain — Synchronization protocol rules (the pure half).
 *
 * The wire contract itself lives in `packages/local-first` (`SyncPushBatch`,
 * `SyncReceipt`, `SyncPullResult`, `JournalEvent`, `LocalRecord`); this module
 * holds the SERVER-side rules over that contract that need no database and no
 * HTTP: payload integrity hashing (the same FNV-1a the client store stamps) and
 * destination normalisation (client-supplied identifiers never grant access —
 * they must AGREE with the authenticated context, and the tenant is always the
 * caller's).
 *
 * The other pure rules each have ONE home beside this file:
 *   - pull cursors            → `cursorCodec.ts`
 *   - client clock (G25)      → `occurredAtGate.ts`
 *   - conflict verdicts       → `conflictPolicy.ts`
 *   - pull page bound         → `importBounds.ts`
 *   - retention windows       → `syncRetention.ts`
 */

import {
  SYNC_PROTOCOL_VERSION,
  destinationKey,
  type EntityDestination,
  type LocalEntityType,
} from '@builderforce/local-first';

export {
  SYNC_PROTOCOL_VERSION,
  destinationKey,
  /** The ONE event-id shape check — the client store mints exactly this. */
  isJournalEventId,
  type EntityDestination,
  type JournalEvent,
  type LocalEntityType,
  type LocalRecord,
  type SyncPullResult,
  type SyncPushBatch,
  type SyncReceipt,
} from '@builderforce/local-first';

/** The receipt statuses the protocol can answer with (contract-fixed). */
export type SyncReceiptStatus = 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'dependency_pending';

/**
 * The entity types this server build applies through an owning-context importer.
 * Every other accepted `LocalEntityType` lands in the mirror as client-reported
 * history (see `application/sync/importers/importMirrorRecord`).
 */
export const DOMAIN_IMPORTED_ENTITY_TYPES = ['ticket', 'project'] as const satisfies readonly LocalEntityType[];

/** The highest event `schemaVersion` this build understands. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * FNV-1a over `JSON.stringify(payload)` — byte-identical to the hash the client
 * journal stamps (`packages/local-first/src/store.ts`), so the server can VERIFY
 * the hash a batch carries instead of trusting it, and dedupe equal payloads
 * under one client entity id.
 */
export function hashSyncPayload(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

// ── Destination binding (G10/G11: the client NAMES its destination; the server decides) ──

/** A bound destination whose `tenantId` is the authenticated tenant, always. */
export type NormalisedDestination = Extract<EntityDestination, { kind: 'bound' }> & { tenantId: string };

export type DestinationBindingError =
  | 'sync_destination_required'
  | 'destination_tenant_mismatch'
  | 'destination_account_mismatch';

export type NormaliseDestinationResult =
  | { ok: true; destination: NormalisedDestination }
  | { ok: false; code: DestinationBindingError };

/**
 * Verify a pushed or pulled destination against the authenticated context and
 * return it with the tenant taken FROM AUTH.
 *
 * An explicit tenant or account that contradicts the token is a protocol
 * violation — the client claims to be someone it is not. An OMITTED tenant is
 * not trusted either: it is filled from the token, so `{ kind: 'bound' }` and
 * `{ kind: 'bound', tenantId: '<mine>' }` name the same destination key and can
 * never resolve to a second partition (or to another tenant's).
 */
export function normaliseSyncDestination(
  destination: EntityDestination,
  auth: { tenantId: number; userId: string },
): NormaliseDestinationResult {
  if (destination.kind !== 'bound') return { ok: false, code: 'sync_destination_required' };
  const tenantId = String(auth.tenantId);
  if (destination.tenantId !== undefined && destination.tenantId !== tenantId) {
    return { ok: false, code: 'destination_tenant_mismatch' };
  }
  if (destination.accountId !== undefined && destination.accountId !== auth.userId) {
    return { ok: false, code: 'destination_account_mismatch' };
  }
  return { ok: true, destination: { ...destination, tenantId } };
}
