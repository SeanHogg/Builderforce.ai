/**
 * Presentation — sync batch handler (G15).
 *
 * Plain function. Not registered on the app. No fetch, no database, no route
 * mount. The caller injects `apply`; this only owns the batch envelope.
 *
 * Events are applied in array order through `applyBatch`. The first rejection
 * stops the batch: later events are not applied. `nextCursor` advances only
 * by the accepted prefix.
 *
 * An event that carries `occurredAt` is gated with `rejectInvalidOccurredAt`
 * before `apply`. A refusal writes nothing and stops the batch. A historical
 * past timestamp is allowed through. Events with no `occurredAt` are the G15
 * envelope and are not a client-time claim.
 */

import { rejectInvalidOccurredAt } from '../../application/sync/occurredAtGate';
import { applyBatch, type ApplyOneResult, type BatchRejection } from '../../domain/sync/batchSync';
import { decodeCursor, encodeCursor } from '../../domain/sync/cursorCodec';

/** Injected apply. Tests pass a fake; a future route would pass the real one. */
export interface SyncBatchDeps<E> {
  apply: (event: E) => ApplyOneResult;
  /** Server clock for the occurredAt gate. One value for the whole batch. */
  now?: Date;
}

/** A body that is not a batch object. `apply` is not called. */
export interface SyncBatchInvalid {
  status: 400;
  code: 'invalid_batch';
}

/**
 * Accepted prefix of one batch.
 *
 * `stoppedAt` is the first rejection from `applyBatch`, or null when every
 * event was accepted (including an empty batch).
 * `nextCursor` is the input cursor plus the number of accepted events when
 * that cursor is a finite number or a cursor this server encoded. Anything
 * else is returned unchanged. A rejection does not advance past itself.
 */
export interface SyncBatchOk<E> {
  applied: E[];
  stoppedAt: BatchRejection<E> | null;
  nextCursor: unknown;
}

export type SyncBatchResult<E> = SyncBatchOk<E> | SyncBatchInvalid;

function isBatchObject(body: unknown): body is { events?: unknown; cursor?: unknown } {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Client time on this event, or undefined when the event makes no claim. */
function clientOccurredAt(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(event, 'occurredAt')) return undefined;
  const value = (event as { occurredAt: unknown }).occurredAt;
  return typeof value === 'string' ? value : '';
}

/**
 * Call the occurredAt gate before `apply`. A code is a refusal: `apply` is
 * not called, so nothing is written. `null` — including a historical past
 * timestamp — falls through to `apply`.
 */
function applyAfterOccurredAtGate<E>(event: E, deps: SyncBatchDeps<E>, now: Date): ApplyOneResult {
  const occurredAt = clientOccurredAt(event);
  if (occurredAt !== undefined) {
    const code = rejectInvalidOccurredAt(occurredAt, now);
    if (code !== null) return { ok: false, reason: code };
  }
  return deps.apply(event);
}

function advanceCursor(cursor: unknown, appliedCount: number): unknown {
  if (appliedCount === 0) return cursor;
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    return cursor + appliedCount;
  }
  if (typeof cursor !== 'string') return cursor;
  const seq = decodeCursor(cursor);
  if (seq === null) return cursor;
  try {
    return encodeCursor(seq + appliedCount);
  } catch {
    return cursor;
  }
}

/**
 * Apply one `{ events, cursor }` batch. Stops at the first rejection.
 *
 * A body that is not a plain object — including null, a primitive, or an
 * array — returns `{ status: 400, code: 'invalid_batch' }` and calls nothing.
 * The same refusal applies when `events` is not an array.
 *
 * When an event carries `occurredAt`, {@link rejectInvalidOccurredAt} runs
 * before `apply`. A refusal stops the batch and writes nothing.
 */
export function handleSyncBatch<E>(body: unknown, deps: SyncBatchDeps<E>): SyncBatchResult<E> {
  if (!isBatchObject(body) || !Array.isArray(body.events)) {
    return { status: 400, code: 'invalid_batch' };
  }
  const events = body.events as readonly E[];
  const now = deps.now ?? new Date();
  const result = applyBatch(events, (event) => applyAfterOccurredAtGate(event, deps, now));
  return {
    applied: result.applied,
    stoppedAt: result.rejected,
    nextCursor: advanceCursor(body.cursor, result.applied.length),
  };
}
