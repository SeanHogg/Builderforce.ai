/**
 * Client apply of one server pull page (G18, ticket #5852).
 *
 * Pure. No fetch, no database, no store. Not imported by `sync.ts` or the app.
 * A bad page does not merge: the result is `{ resnapshotRequired: true }` and
 * nothing else — not sequence 0, and not a prefix of the page.
 *
 * Cursor rejection matches `decodeSyncCursor` in
 * `api/src/domain/sync/syncProtocol.ts` (base64url JSON, `v` must be 1 so a
 * future version is rejected, a delta `seq` must be a finite non-negative
 * integer). That module imports this package, so this file cannot import it.
 * The rule is duplicated here. A `bfc1.` sequence token from
 * `api/src/domain/sync/cursorCodec.ts` is not this codec and is a resnapshot.
 */

import type { EntityDestination, LocalEntityType, LocalRecord } from './records.js';

export interface ServerCursorChange<T = unknown> {
  readonly clientEntityId?: string;
  readonly id?: string;
  readonly entityType?: LocalEntityType;
  readonly tombstone?: boolean;
  readonly operation?: string;
  readonly deletedAt?: string | null;
  readonly body?: T;
  readonly payload?: T;
  readonly record?: LocalRecord<T> | null;
  readonly version?: number;
  readonly schemaVersion?: number;
  readonly occurredAt?: string;
  readonly updatedAt?: string;
  readonly destination?: EntityDestination;
  readonly provenance?: LocalRecord['provenance'];
}

/**
 * One pull page. `records` are the server `sync_records` projection (applied
 * first). `changes` are the ordered `sync_changes` delta (applied after, so a
 * later tombstone deletes a record from the same page). `local` is the client
 * set those rows merge onto. None of the arrays are mutated.
 */
export interface ApplyServerCursorInput<T = unknown> {
  readonly cursor: string | null;
  readonly changes?: readonly ServerCursorChange<T>[] | null;
  readonly records?: ReadonlyArray<LocalRecord<T> | ServerCursorChange<T>> | null;
  readonly local?: readonly LocalRecord<T>[] | null;
  readonly expired?: boolean;
  readonly resnapshotRequired?: boolean;
}

export interface AppliedDelete {
  readonly op: 'delete';
  readonly id: string;
  readonly entityType?: LocalEntityType;
  readonly deletedAt?: string;
}

export interface AppliedUpsert<T = unknown> {
  readonly op: 'upsert';
  readonly id: string;
  readonly entityType: LocalEntityType;
  readonly record: LocalRecord<T>;
}

export type AppliedChange<T = unknown> = AppliedDelete | AppliedUpsert<T>;

export interface AppliedServerCursor<T = unknown> {
  readonly resnapshotRequired: false;
  readonly cursor: string;
  /** Local rows after the page. Tombstones are absent — they were deleted. */
  readonly records: readonly LocalRecord<T>[];
  readonly deleted: readonly string[];
  readonly applied: readonly AppliedChange<T>[];
}

export interface ServerCursorResnapshot {
  readonly resnapshotRequired: true;
}

export type ApplyServerCursorResult<T = unknown> = AppliedServerCursor<T> | ServerCursorResnapshot;

export type DecodedServerCursor =
  | { readonly v: 1; readonly kind: 'delta'; readonly seq: number }
  | {
      readonly v: 1;
      readonly kind: 'snapshot';
      readonly afterEntityType: string;
      readonly afterClientEntityId: string;
    };

const RESNAPSHOT: ServerCursorResnapshot = Object.freeze({ resnapshotRequired: true });

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Same rejection as `decodeSyncCursor`: not base64url JSON, `v` other than 1
 * (including a future version), or a delta `seq` that is not a finite
 * non-negative integer. Never throws. Never returns 0 for a bad token.
 */
export function decodeServerCursor(raw: string): DecodedServerCursor | null {
  try {
    const value: unknown = JSON.parse(b64urlDecode(raw));
    if (typeof value !== 'object' || value === null) return null;
    const cursor = value as Record<string, unknown>;
    if (cursor.v !== 1) return null;
    if (cursor.kind === 'delta') {
      if (
        typeof cursor.seq !== 'number'
        || !Number.isFinite(cursor.seq)
        || !Number.isInteger(cursor.seq)
        || cursor.seq < 0
      ) {
        return null;
      }
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

function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function copyBody<T>(body: T): T {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.slice() as T;
  return { ...(body as object) } as T;
}

function copyDestination(destination: EntityDestination): EntityDestination {
  if (destination.kind === 'unbound') return { kind: 'unbound' };
  return { ...destination };
}

function copyRecord<T>(record: LocalRecord<T>): LocalRecord<T> {
  return {
    ...record,
    destination: copyDestination(record.destination),
    payload: copyBody(record.payload),
    ...(record.provenance ? { provenance: { ...record.provenance } } : {}),
  };
}

function isLocalRecord<T>(value: unknown): value is LocalRecord<T> {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<LocalRecord<T>>;
  return (
    isNonBlank(row.id)
    && isNonBlank(row.entityType)
    && typeof row.version === 'number'
    && Number.isFinite(row.version)
    && typeof row.schemaVersion === 'number'
    && row.destination !== undefined
    && isNonBlank(row.occurredAt)
    && isNonBlank(row.updatedAt)
    && 'payload' in row
  );
}

function rowId(row: { clientEntityId?: string; id?: string }): string | null {
  if (isNonBlank(row.clientEntityId)) return row.clientEntityId.trim();
  if (isNonBlank(row.id)) return row.id.trim();
  return null;
}

function isTombstone(row: { tombstone?: boolean; operation?: string; deletedAt?: string | null }): boolean {
  if (row.tombstone === true) return true;
  if (row.operation === 'delete') return true;
  return isNonBlank(row.deletedAt);
}

function storageKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function materialize<T>(
  row: LocalRecord<T> | ServerCursorChange<T>,
  existing: LocalRecord<T> | undefined,
): LocalRecord<T> | null {
  const change = row as ServerCursorChange<T>;
  if (change.record && isLocalRecord<T>(change.record)) return copyRecord(change.record);
  if (isLocalRecord<T>(row)) return copyRecord(row);

  const id = rowId(change);
  const entityType = change.entityType ?? existing?.entityType;
  if (!id || !entityType) return null;
  const body = change.body !== undefined ? change.body : change.payload !== undefined ? change.payload : existing?.payload;
  const stamp = change.updatedAt ?? change.occurredAt ?? existing?.updatedAt ?? existing?.occurredAt ?? '1970-01-01T00:00:00.000Z';
  const provenance = change.provenance ?? existing?.provenance;
  return {
    id,
    entityType,
    schemaVersion: change.schemaVersion ?? existing?.schemaVersion ?? 1,
    version: change.version ?? existing?.version ?? 1,
    ...(existing?.baseVersion !== undefined ? { baseVersion: existing.baseVersion } : {}),
    destination: change.destination ? copyDestination(change.destination) : existing ? copyDestination(existing.destination) : { kind: 'unbound' },
    occurredAt: change.occurredAt ?? existing?.occurredAt ?? stamp,
    updatedAt: change.updatedAt ?? stamp,
    payload: copyBody(body as T),
    ...(provenance ? { provenance: { ...provenance } } : {}),
  };
}

interface ApplyState<T> {
  readonly map: Map<string, LocalRecord<T>>;
  readonly order: string[];
  readonly applied: AppliedChange<T>[];
  readonly deleted: string[];
  readonly deletedSeen: Set<string>;
}

function findExisting<T>(state: ApplyState<T>, id: string, entityType: LocalEntityType | undefined): LocalRecord<T> | undefined {
  if (entityType) return state.map.get(storageKey(entityType, id));
  for (const record of state.map.values()) {
    if (record.id === id) return record;
  }
  return undefined;
}

function forgetDeleted<T>(state: ApplyState<T>, id: string): void {
  if (!state.deletedSeen.has(id)) return;
  state.deletedSeen.delete(id);
  const index = state.deleted.indexOf(id);
  if (index >= 0) state.deleted.splice(index, 1);
}

function noteDeleted<T>(state: ApplyState<T>, id: string): void {
  if (state.deletedSeen.has(id)) return;
  state.deletedSeen.add(id);
  state.deleted.push(id);
}

function removeRows<T>(state: ApplyState<T>, id: string, entityType: LocalEntityType | undefined): void {
  const keys = entityType
    ? [storageKey(entityType, id)]
    : [...state.map.keys()].filter((key) => state.map.get(key)?.id === id);
  for (const key of keys) {
    if (!state.map.delete(key)) continue;
    const index = state.order.indexOf(key);
    if (index >= 0) state.order.splice(index, 1);
  }
}

function applyRow<T>(state: ApplyState<T>, row: LocalRecord<T> | ServerCursorChange<T>): void {
  const change = row as ServerCursorChange<T> & Partial<LocalRecord<T>>;
  const id = rowId(change);
  if (!id) return;
  const entityType = change.entityType;

  if (isTombstone(change)) {
    removeRows(state, id, entityType);
    noteDeleted(state, id);
    const deletedAt = isNonBlank(change.deletedAt) ? change.deletedAt : undefined;
    state.applied.push(Object.freeze({
      op: 'delete',
      id,
      ...(entityType ? { entityType } : {}),
      ...(deletedAt ? { deletedAt } : {}),
    }));
    return;
  }

  const next = materialize(row, findExisting(state, id, entityType));
  if (!next) return;
  const key = storageKey(next.entityType, next.id);
  if (!state.map.has(key)) state.order.push(key);
  state.map.set(key, next);
  forgetDeleted(state, next.id);
  state.applied.push(Object.freeze({
    op: 'upsert',
    id: next.id,
    entityType: next.entityType,
    record: next,
  }));
}

/**
 * Merge one pull page onto local records.
 *
 * - Missing page, blank cursor, decode failure, future `v`, non-finite or
 *   non-integer `seq`, `expired`, or `resnapshotRequired`: resnapshot only.
 *   The page's changes and records are not applied and are not returned.
 * - A cursor this codec accepts: `records`, then `changes`, in the given
 *   order. A tombstone flag, a `delete` operation, or a non-blank `deletedAt`
 *   removes that local record. A later row for the same id wins.
 */
export function applyServerCursor<T>(
  input: ApplyServerCursorInput<T> | null | undefined,
): ApplyServerCursorResult<T> {
  if (!input || input.expired === true || input.resnapshotRequired === true || !isNonBlank(input.cursor)) {
    return RESNAPSHOT;
  }
  if (decodeServerCursor(input.cursor) === null) return RESNAPSHOT;

  const state: ApplyState<T> = {
    map: new Map(),
    order: [],
    applied: [],
    deleted: [],
    deletedSeen: new Set(),
  };
  for (const row of input.local ?? []) {
    if (!isLocalRecord<T>(row)) continue;
    const copy = copyRecord(row);
    const key = storageKey(copy.entityType, copy.id);
    if (!state.map.has(key)) state.order.push(key);
    state.map.set(key, copy);
  }
  for (const row of input.records ?? []) applyRow(state, row);
  for (const row of input.changes ?? []) applyRow(state, row);

  return Object.freeze({
    resnapshotRequired: false as const,
    cursor: input.cursor,
    records: Object.freeze(state.order.map((key) => state.map.get(key) as LocalRecord<T>)),
    deleted: Object.freeze(state.deleted),
    applied: Object.freeze(state.applied),
  });
}
