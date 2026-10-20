/**
 * Client pull plan (G18).
 *
 * The caller has already decoded the cursor. This module does not encode or
 * decode cursors, does not read a sequence out of the cursor, and does not
 * treat a missing or blank cursor as sequence 0. A cursor the caller could
 * not decode arrives as null. Null, blank, or expired means a full resnapshot
 * — never a partial merge.
 *
 * No fetch, no database, no server route.
 */

export interface PullChange<T = unknown> {
  readonly clientEntityId: string;
  readonly deletedAt?: string | null;
  readonly body?: T;
  /** Local-record body, when the caller has not already renamed it to `body`. */
  readonly payload?: T;
}

export interface PlanPullInput<T = unknown> {
  readonly cursor: string | null;
  readonly changes?: readonly PullChange<T>[] | null;
  readonly expired?: boolean;
}

export interface PlannedUpsert<T = unknown> {
  readonly clientEntityId: string;
  readonly op: 'upsert';
  readonly body: T | undefined;
}

export interface PlannedTombstone {
  readonly clientEntityId: string;
  readonly op: 'delete';
  readonly deletedAt: string;
}

export type PlannedEntity<T = unknown> = PlannedUpsert<T> | PlannedTombstone;

export interface ApplyPullPlan<T = unknown> {
  readonly action: 'apply';
  readonly cursor: string;
  readonly changes: readonly PullChange<T>[];
  readonly entities: readonly PlannedEntity<T>[];
}

export interface ResnapshotPullPlan {
  readonly action: 'resnapshot';
}

export type PullPlan<T = unknown> = ApplyPullPlan<T> | ResnapshotPullPlan;

const RESNAPSHOT: ResnapshotPullPlan = Object.freeze({ action: 'resnapshot' });

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function copyBody<T>(body: T): T {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.slice() as T;
  return { ...(body as object) } as T;
}

function isTombstone(change: PullChange): boolean {
  return isNonBlank(change.deletedAt);
}

function withoutBody<T>(change: PullChange<T>): PullChange<T> {
  const copy = { ...change } as PullChange<T> & { body?: T; payload?: T };
  delete copy.body;
  delete copy.payload;
  return copy;
}

/** A new change object. Tombstones keep the row and drop the body. */
function copyChange<T>(change: PullChange<T>): PullChange<T> {
  if (isTombstone(change)) return Object.freeze(withoutBody(change));
  const copy = { ...change } as PullChange<T> & { body?: T };
  if (copy.body !== undefined) copy.body = copyBody(copy.body);
  return Object.freeze(copy);
}

function entityBody<T>(change: PullChange<T>): T | undefined {
  if (change.body !== undefined) return change.body;
  return change.payload;
}

function toEntity<T>(change: PullChange<T>): PlannedEntity<T> {
  if (isTombstone(change)) {
    return Object.freeze({
      clientEntityId: change.clientEntityId,
      op: 'delete',
      deletedAt: change.deletedAt as string,
    });
  }
  return Object.freeze({
    clientEntityId: change.clientEntityId,
    op: 'upsert',
    body: entityBody(change),
  });
}

/**
 * Last change for each clientEntityId, ordered by that winning change.
 * Earlier rows stay in `changes`; they do not stay in the collapsed plan.
 */
function collapse<T>(changes: readonly PullChange<T>[]): PlannedEntity<T>[] {
  const last = new Map<string, PullChange<T>>();
  const lastIndex = new Map<string, number>();
  changes.forEach((change, index) => {
    if (!isNonBlank(change.clientEntityId)) return;
    last.set(change.clientEntityId, change);
    lastIndex.set(change.clientEntityId, index);
  });
  return [...lastIndex.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([id]) => toEntity(last.get(id) as PullChange<T>));
}

/**
 * Plan how a client applies an already-decoded pull.
 *
 * - `cursor` null, blank, or `expired === true`: `{ action: 'resnapshot' }` only.
 * - Otherwise `{ action: 'apply', cursor, changes, entities }`. `changes` is a
 *   copy of every row in the given order. A non-blank `deletedAt` marks that
 *   clientEntityId deleted and the plan does not keep its body. A later row
 *   with the same clientEntityId wins. The input array is not mutated.
 */
export function planPull<T>(input: PlanPullInput<T> | null | undefined): PullPlan<T> {
  if (!input || input.expired === true || !isNonBlank(input.cursor)) return RESNAPSHOT;

  const source = Array.isArray(input.changes) ? input.changes : [];
  const changes = source.map((change) => copyChange(change));
  const entities = collapse(changes);
  return Object.freeze({
    action: 'apply',
    cursor: input.cursor,
    changes: Object.freeze(changes),
    entities: Object.freeze(entities),
  });
}
