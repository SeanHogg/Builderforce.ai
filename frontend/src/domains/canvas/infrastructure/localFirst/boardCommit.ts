/**
 * THE BOARD COMMIT — every edit to a board is ONE transaction: the changed records and their
 * journal events commit together or not at all.
 *
 * `commitBoardDiff(prev, next)` is the autosave: it diffs the two boards per object and per
 * connection (the signature of design §3) and writes only what changed — adds, edits, and deletes as
 * tombstones — so an edit's journal event is the size of one card, not of the board. The rules about
 * WHEN a write is journaled, what operation and base version it carries, and what it waits on live in
 * `boardJournal.ts`; this module decides WHAT is written.
 *
 * A board is always created locally first (`createBoard`), under the destination the creation guard
 * allows: unbound for a signed-out caller, the account's for a signed-in one. A viewport-only change
 * is a local write (this device's own, never journaled, never merged).
 */

import {
  guardCreationBinding,
  type EntityDestination,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import { persistedGraphFromBoard, type CanvasBoard } from '../../domain/canvasBoard';
import { writeRecord, type JournalContext } from './boardJournal';
import { childRecordsOf } from './boardReplica';
import {
  CANVAS_BOARD,
  CANVAS_EDGE,
  CANVAS_OBJECT,
  CANVAS_TIMELINE,
  diffGraphs,
  edgePayloadOf,
  objectPayloadOf,
  syncedBoardPayload,
  timelineRecordId,
  type BoardPayload,
  type EdgePayload,
  type ObjectPayload,
  type TimelinePayload,
} from './boardRecords';

export interface BoardWriteContext extends JournalContext {
  store: LocalFirstStore;
}

export type BoardCommitErrorCode = 'board_not_found' | 'board_exists' | 'destination_forged' | 'destination_required' | 'cross_destination';

export class BoardCommitError extends Error {
  constructor(readonly code: BoardCommitErrorCode, message: string = code) {
    super(message);
    this.name = 'BoardCommitError';
  }
}

export interface BoardCommitResult {
  written: number;
  deleted: number;
}

const EMPTY_BOARD: CanvasBoard = { nodes: [], edges: [] };

async function liveHeader(tx: LocalFirstTransaction, boardId: string): Promise<LocalRecord<BoardPayload>> {
  const header = await tx.get<BoardPayload>(CANVAS_BOARD, boardId);
  if (!header || header.deletedAt) throw new BoardCommitError('board_not_found', `No local board: ${boardId}`);
  return header;
}

/** The header write: journaled only when what SYNCS changed (title, folder, mode, …). */
async function writeHeader(
  tx: LocalFirstTransaction,
  ctx: JournalContext,
  existing: LocalRecord<BoardPayload> | undefined,
  boardId: string,
  payload: BoardPayload,
  destination: EntityDestination,
): Promise<LocalRecord<BoardPayload>> {
  const syncedChanged = !existing || JSON.stringify(syncedBoardPayload(existing.payload)) !== JSON.stringify(syncedBoardPayload(payload));
  return writeRecord(tx, ctx, existing, {
    entityType: CANVAS_BOARD,
    id: boardId,
    payload,
    destination,
    syncPayload: syncedBoardPayload(payload),
    journal: syncedChanged,
  });
}

/** Write a diff of objects and connections under `boardId`; returns how many rows it wrote and tombstoned. */
async function writeGraphDiff(
  tx: LocalFirstTransaction,
  ctx: JournalContext,
  header: LocalRecord<BoardPayload>,
  prev: CanvasBoard,
  next: CanvasBoard,
): Promise<BoardCommitResult> {
  const boardId = header.id;
  const diff = diffGraphs(persistedGraphFromBoard(prev), persistedGraphFromBoard(next));
  const result: BoardCommitResult = { written: 0, deleted: 0 };
  for (const object of diff.upsertObjects) {
    const existing = await tx.get<ObjectPayload>(CANVAS_OBJECT, object.id);
    await writeRecord(tx, ctx, existing, { entityType: CANVAS_OBJECT, id: object.id, payload: objectPayloadOf(boardId, object), destination: header.destination, boardId });
    result.written += 1;
  }
  for (const connection of diff.upsertConnections) {
    const existing = await tx.get<EdgePayload>(CANVAS_EDGE, connection.id);
    await writeRecord(tx, ctx, existing, { entityType: CANVAS_EDGE, id: connection.id, payload: edgePayloadOf(boardId, connection), destination: header.destination, boardId });
    result.written += 1;
  }
  // Edges first: nothing may point at an object the same commit removes.
  for (const [type, ids] of [[CANVAS_EDGE, diff.deleteConnectionIds], [CANVAS_OBJECT, diff.deleteObjectIds]] as const) {
    for (const id of ids) {
      const existing = await tx.get<EdgePayload | ObjectPayload>(type, id);
      if (!existing || existing.deletedAt) continue;
      await writeRecord(tx, ctx, existing, { entityType: type, id, payload: existing.payload, destination: header.destination, boardId, deleted: true });
      result.deleted += 1;
    }
  }
  return result;
}

async function writeTimelineMessage(
  tx: LocalFirstTransaction,
  ctx: JournalContext,
  header: LocalRecord<BoardPayload>,
  message: Omit<TimelinePayload, 'boardId'>,
): Promise<boolean> {
  const id = timelineRecordId(header.id, message.clientMessageId);
  // Append-only and immutable: a message already written is never rewritten.
  if (await tx.get(CANVAS_TIMELINE, id)) return false;
  await writeRecord(tx, ctx, undefined, {
    entityType: CANVAS_TIMELINE,
    id,
    payload: { ...message, boardId: header.id } satisfies TimelinePayload,
    destination: header.destination,
    boardId: header.id,
  });
  return true;
}

export interface NewBoardInput {
  boardId: string;
  header: BoardPayload;
  board?: CanvasBoard;
  timeline?: ReadonlyArray<Omit<TimelinePayload, 'boardId'>>;
  /** The creation destination: unbound when signed out, the account's when signed in. */
  destination: EntityDestination;
}

/** `createBoard` inside the caller's transaction (the legacy import adds its own marker to the same one). */
export async function writeNewBoard(tx: LocalFirstTransaction, ctx: JournalContext, input: NewBoardInput): Promise<BoardCommitResult> {
  const binding = guardCreationBinding({ entityType: CANVAS_BOARD, destination: input.destination, accountKnown: input.destination.kind === 'bound' });
  if (!binding.ok) throw new BoardCommitError(binding.reason);
  if (await tx.get(CANVAS_BOARD, input.boardId)) throw new BoardCommitError('board_exists', `Board already exists: ${input.boardId}`);
  const header = await writeHeader(tx, ctx, undefined, input.boardId, input.header, binding.destination);
  const result = await writeGraphDiff(tx, ctx, header, EMPTY_BOARD, input.board ?? EMPTY_BOARD);
  for (const message of input.timeline ?? []) {
    if (await writeTimelineMessage(tx, ctx, header, message)) result.written += 1;
  }
  return result;
}

/** Create a board on this device — always local first, then synced. */
export function createBoard(ctx: BoardWriteContext, input: NewBoardInput): Promise<BoardCommitResult> {
  return ctx.store.transact((tx) => writeNewBoard(tx, ctx, input));
}

/** The autosave: ONE transaction writing exactly what changed between `prev` and `next`. */
export function commitBoardDiff(ctx: BoardWriteContext, boardId: string, prev: CanvasBoard, next: CanvasBoard): Promise<BoardCommitResult> {
  return ctx.store.transact(async (tx) => writeGraphDiff(tx, ctx, await liveHeader(tx, boardId), prev, next));
}

/** Rename, file, or change the mode of a board — and carry this device's viewport, which is never journaled. */
export function updateBoardHeader(ctx: BoardWriteContext, boardId: string, patch: Partial<BoardPayload>): Promise<LocalRecord<BoardPayload>> {
  return ctx.store.transact(async (tx) => {
    const header = await liveHeader(tx, boardId);
    return writeHeader(tx, ctx, header, boardId, { ...header.payload, ...patch }, header.destination);
  });
}

/** Append one transcript message (immutable, keyed by `clientMessageId`). Returns whether it was new. */
export function appendTimelineMessage(ctx: BoardWriteContext, boardId: string, message: Omit<TimelinePayload, 'boardId'>): Promise<boolean> {
  return ctx.store.transact(async (tx) => writeTimelineMessage(tx, ctx, await liveHeader(tx, boardId), message));
}

/** Delete a board: its header is tombstoned with an event; its children go with it locally. */
export function deleteBoard(ctx: BoardWriteContext, boardId: string): Promise<void> {
  return ctx.store.transact(async (tx) => {
    const header = await liveHeader(tx, boardId);
    const children = await childRecordsOf(tx, boardId);
    for (const row of [...children.edges, ...children.objects, ...children.timeline, ...children.media]) {
      await writeRecord(tx, ctx, row, { entityType: row.entityType, id: row.id, payload: row.payload, destination: row.destination, boardId, journal: false, deleted: true });
    }
    await writeRecord(tx, ctx, header, { entityType: CANVAS_BOARD, id: boardId, payload: header.payload, destination: header.destination, syncPayload: syncedBoardPayload(header.payload), deleted: true });
  });
}
