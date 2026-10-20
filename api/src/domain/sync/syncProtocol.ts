/**
 * Domain — Synchronization protocol rules (the pure half).
 *
 * The wire contract itself lives in `packages/local-first` (`SyncPushBatch`,
 * `SyncReceipt`, `SyncPullResult`, `JournalEvent`, `LocalRecord`); this module
 * holds the SERVER-side rules over that contract that need no database and no
 * HTTP: payload integrity hashing (the same FNV-1a the client store stamps),
 * opaque pull cursors, destination-binding verification (client-supplied
 * identifiers never grant access — they must AGREE with the authenticated
 * context), and occurred-at sanity bounds (G25).
 *
 * Everything here is a pure function so the rules are testable without a
 * database and reusable by any future transport adapter.
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
 * The entity types this server build can apply. Every `LocalEntityType` is
 * ACCEPTED into the protocol; the ones without an owning-context importer land
 * in the mirror store as client-reported history (see
 * `application/sync/importMirrorRecord`).
 */
export const DOMAIN_IMPORTED_ENTITY_TYPES = ['ticket', 'project'] as const satisfies readonly LocalEntityType[];

/** The highest event `schemaVersion` this build understands. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Client clocks drift; historical import makes `occurredAt` arbitrarily OLD by
 * design, so only the future direction is bounded. Past this skew the claim is
 * treated as a client defect, not history.
 */
export const MAX_FUTURE_CLOCK_SKEW_MS = 15 * 60 * 1000;

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

// ── Opaque pull cursors ──────────────────────────────────────────────────────
//
// A cursor is base64url JSON so clients treat it as opaque, but the server can
// still reject a garbled one deterministically. Two shapes: a DELTA cursor names
// the last `sync_changes.seq` the device saw; a SNAPSHOT cursor keysets a
// bounded bootstrap over `sync_records`. A delta cursor whose rows have been
// retention-swept is answered with `resnapshotRequired`, never with a gap.

export interface DeltaCursor {
  v: 1;
  kind: 'delta';
  seq: number;
}

export interface SnapshotCursor {
  v: 1;
  kind: 'snapshot';
  /** Keyset: the last `(entityType, clientEntityId)` pair served. */
  afterEntityType: string;
  afterClientEntityId: string;
}

export type SyncCursor = DeltaCursor | SnapshotCursor;

const b64urlEncode = (text: string): string =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (text: string): string => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

export function encodeSyncCursor(cursor: SyncCursor): string {
  return b64urlEncode(JSON.stringify(cursor));
}

/** Parse an opaque cursor; `null` when it is not one of ours (treated as expired). */
export function decodeSyncCursor(raw: string): SyncCursor | null {
  try {
    const value: unknown = JSON.parse(b64urlDecode(raw));
    if (typeof value !== 'object' || value === null) return null;
    const cursor = value as Record<string, unknown>;
    if (cursor.v !== 1) return null;
    if (cursor.kind === 'delta' && typeof cursor.seq === 'number' && Number.isInteger(cursor.seq) && cursor.seq >= 0) {
      return { v: 1, kind: 'delta', seq: cursor.seq };
    }
    if (
      cursor.kind === 'snapshot'
      && typeof cursor.afterEntityType === 'string'
      && typeof cursor.afterClientEntityId === 'string'
    ) {
      return {
        v: 1,
        kind: 'snapshot',
        afterEntityType: cursor.afterEntityType,
        afterClientEntityId: cursor.afterClientEntityId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Destination binding (G10/G11: the client NAMES its destination; the server decides) ──

export type DestinationBindingError =
  | 'sync_destination_required'
  | 'destination_tenant_mismatch'
  | 'destination_account_mismatch';

/**
 * Verify a pushed destination against the authenticated context. A bound
 * destination that contradicts the token's tenant or user is a protocol
 * violation, not an authorization failure — the client is claiming to be
 * someone it is not, so the whole batch is refused before any per-event work.
 */
export function destinationBindingError(
  destination: EntityDestination,
  auth: { tenantId: number; userId: string },
): DestinationBindingError | null {
  if (destination.kind !== 'bound') return 'sync_destination_required';
  if (destination.tenantId !== undefined && destination.tenantId !== String(auth.tenantId)) {
    return 'destination_tenant_mismatch';
  }
  if (destination.accountId !== undefined && destination.accountId !== auth.userId) {
    return 'destination_account_mismatch';
  }
  return null;
}

/** Why a client `occurredAt` cannot be stored. */
export type OccurredAtErrorCode = 'occurred_at_invalid' | 'occurred_at_in_future';

/** Is `occurredAt` a parseable timestamp within the allowed future skew? */
export function occurredAtError(occurredAt: string, now: Date): OccurredAtErrorCode | null {
  const at = Date.parse(occurredAt);
  if (Number.isNaN(at)) return 'occurred_at_invalid';
  if (at > now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) return 'occurred_at_in_future';
  return null;
}

/**
 * Trust label for a client clock the server accepted. Imported evidence is a
 * claim, not a server observation — billing and audit must not treat
 * `occurredAt` as time the server witnessed.
 */
export const CLIENT_REPORTED_EVIDENCE = 'client-reported' as const;

/**
 * The pair a push must persist: the client's `occurredAt` unchanged, plus the
 * server clock at apply time. Historical past values stay on `occurredAt`.
 */
export interface AppliedClientTime {
  occurredAt: string;
  receivedAt: string;
  evidence: typeof CLIENT_REPORTED_EVIDENCE;
}

export type ApplyClientOccurredAtResult =
  | { ok: true; time: AppliedClientTime }
  | { ok: false; error: OccurredAtErrorCode };

/**
 * Domain apply for G25, before any insert. There is no sync route yet; this is
 * the one place the clock rule is applied. An invalid or too-future client time
 * is refused via {@link occurredAtError}. An accepted time — including an
 * arbitrarily old historical import — keeps the client's `occurredAt` and stamps
 * a separate server `receivedAt`. The evidence is always client-reported.
 */
export function applyClientOccurredAt(occurredAt: string, now: Date): ApplyClientOccurredAtResult {
  const error = occurredAtError(occurredAt, now);
  if (error) return { ok: false, error };
  return {
    ok: true,
    time: {
      occurredAt,
      receivedAt: now.toISOString(),
      evidence: CLIENT_REPORTED_EVIDENCE,
    },
  };
}
