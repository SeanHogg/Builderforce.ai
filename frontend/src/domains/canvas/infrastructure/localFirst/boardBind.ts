/**
 * BIND A BOARD TO AN ACCOUNT — the sign-in step for a board built before anyone was signed in.
 *
 * An unbound (guest) board is records with no journal events: nothing of it was ever owed to a
 * server. Signing in does not move it by itself (an account never adopts what it did not choose);
 * `bindBoardToAccount` is the explicit, per-board act, and it is ONE transaction:
 *
 *   1. the board and every live child are re-snapshotted from `unbound` to the account destination
 *      (the destination guard refuses a forged or missing one);
 *   2. the whole board is enqueued as a journal batch in dependency order — the board first, then its
 *      media manifests, objects, connections and transcript, each `dependsOn` what it needs;
 *   3. the sync driver then pushes it, with no further work here.
 *
 * Idempotent: a board that is already bound to this destination is `already-bound` and nothing is
 * written, so a retry after a crash (or a double click) cannot enqueue a second batch. A board bound
 * to a DIFFERENT destination is refused. Media that is not uploaded yet is not journaled, nor is any
 * object that refers to it: the upload queue journals those once the bytes are on the server.
 */

import { destinationKey, guardCreationBinding, type EntityDestination, type LocalRecord } from '@builderforce/local-first';
import { appendRecordEvent, unuploadedMediaIn } from './boardJournal';
import { BoardCommitError, type BoardWriteContext } from './boardCommit';
import { childRecordsOf } from './boardReplica';
import {
  CANVAS_BOARD,
  CANVAS_MEDIA,
  CANVAS_OBJECT,
  boardCreateKey,
  eventKey,
  mediaIdsIn,
  syncedBoardPayload,
  syncedMediaPayload,
  type BoardPayload,
  type EdgePayload,
  type MediaPayload,
} from './boardRecords';

export type BindOutcome =
  | { status: 'bound'; records: number; events: number }
  | { status: 'already-bound' }
  | { status: 'missing' };

export function bindBoardToAccount(ctx: BoardWriteContext, boardId: string, destination: EntityDestination): Promise<BindOutcome> {
  return ctx.store.transact(async (tx): Promise<BindOutcome> => {
    const header = await tx.get<BoardPayload>(CANVAS_BOARD, boardId);
    if (!header || header.deletedAt) return { status: 'missing' };
    const binding = guardCreationBinding({ entityType: CANVAS_BOARD, destination, accountKnown: true });
    if (!binding.ok) throw new BoardCommitError(binding.reason);
    if (header.destination.kind === 'bound') {
      if (destinationKey(header.destination) === destinationKey(binding.destination)) return { status: 'already-bound' };
      throw new BoardCommitError('cross_destination', 'A bound board cannot be reassigned to another account.');
    }

    const to = binding.destination;
    const rebind = async <T,>(row: LocalRecord<T>): Promise<LocalRecord<T>> => {
      const moved = { ...row, destination: to };
      await tx.put(moved, row.version);
      return moved;
    };
    const outcome = { records: 0, events: 0 };
    /** Keys of the events this pass enqueued, by `type:id`, so a later event can wait on the right one. */
    const enqueued = new Map<string, string>();
    const keyOf = (type: string, id: string): string | undefined => enqueued.get(`${type}\u0000${id}`);
    const enqueue = async (record: LocalRecord, options: { boardId?: string; syncPayload?: unknown; dependsOn?: string[]; idempotencyKey?: string }): Promise<void> => {
      await appendRecordEvent(tx, record, options);
      enqueued.set(`${record.entityType}\u0000${record.id}`, options.idempotencyKey ?? eventKey(record.entityType, record.id, record.version));
      outcome.events += 1;
    };

    const movedHeader = await rebind(header);
    outcome.records += 1;
    // The board's creating write is v1 by rule, whatever local version it was edited up to while unbound:
    // it is the key every child waits on.
    await enqueue(movedHeader, { idempotencyKey: boardCreateKey(boardId), syncPayload: syncedBoardPayload(movedHeader.payload) });
    const children = await childRecordsOf(tx, boardId);

    for (const media of children.media) {
      const moved = await rebind(media);
      outcome.records += 1;
      // A local blob has nothing to tell the server yet: its upload is what journals it.
      if (media.payload.status === 'uploaded') await enqueue(moved, { boardId, syncPayload: syncedMediaPayload(moved.payload as MediaPayload) });
    }
    for (const object of children.objects) {
      const moved = await rebind(object);
      outcome.records += 1;
      if ((await unuploadedMediaIn(tx, object.payload)).length > 0) continue;
      const waits = mediaIdsIn(object.payload).map((id) => keyOf(CANVAS_MEDIA, id)).filter((key): key is string => key !== undefined);
      await enqueue(moved, { boardId, dependsOn: waits });
    }
    for (const edge of children.edges) {
      const moved = await rebind(edge);
      outcome.records += 1;
      const payload = edge.payload as EdgePayload;
      const waits = [payload.source, payload.target].map((id) => keyOf(CANVAS_OBJECT, id)).filter((key): key is string => key !== undefined);
      await enqueue(moved, { boardId, dependsOn: waits });
    }
    for (const message of children.timeline) {
      await enqueue(await rebind(message), { boardId });
      outcome.records += 1;
    }
    return { status: 'bound', ...outcome };
  });
}
