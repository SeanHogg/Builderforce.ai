/**
 * THE STUDIO'S BOARDS ON THIS DEVICE — create, list, rename, merge and remove, over the replica.
 *
 * This is what `localCanvasStore.ts` was to `localStorage`, for callers that are not an open canvas
 * (the start flow, the library, the draft notice, the Brain's `show_canvas`, a turn that outlived its
 * board). Nothing here reads or writes `localStorage` for a board: a board is records in the store, and
 * the one reader of the old key is `legacyBoardImport`.
 *
 * A board is ALWAYS created locally first (design §7), under the destination the person is in: unbound
 * for a guest or for someone with no workspace yet, the workspace's for someone in one. There is no
 * "local-" id and no fallback branch: the id is the board's id on the server too.
 *
 * THIS MODULE KNOWS NO COMPOSITION ROOT. The runtime (store, blobs) and the destination are handed in
 * through `bindStudioBoardPorts`, which `lib/pendingWork` calls when it loads this
 * module; the shell-level surfaces reach it only through that door, so the library stays out of the
 * first paint of every route.
 */

import { destinationKey, type EntityDestination, type LocalFirstStore } from '@builderforce/local-first';
import type { ChatMode } from '@/lib/brain';
import {
  mergedLocalCreationSnapshot,
  newLocalCreationBoardSnapshot,
  newLocalCreationSessionSnapshot,
  type LocalCreationSnapshot,
} from '../../domain/boardSnapshot';
import type { BlobStore } from './blobStore';
import { createBoard, deleteBoard, updateBoardHeader, type BoardWriteContext } from './boardCommit';
import { dehydrateBoardMedia } from './boardMediaUrls';
import { openBoardSession, activeBoardSession } from './boardSession';
import { listBoards, readBoard, type BoardReplica } from './boardReplica';
import type { BoardPayload } from './boardRecords';

/** One row of the device's board list: enough to list and open a board without reading it. */
export interface LocalCreationEntry {
  sessionId: string;
  title: string;
  folder?: string;
  updatedAt: string;
}

type StoredTimeline = NonNullable<LocalCreationSnapshot['timeline']>;

/** What these verbs need of the Studio runtime. */
export interface StudioBoardsRuntime {
  store: LocalFirstStore;
  ctx: BoardWriteContext;
  blobs: BlobStore;
}

export interface StudioBoardPorts {
  runtime(): Promise<StudioBoardsRuntime | undefined>;
  destination(): EntityDestination;
  /** Called once a board is gone (the checkpoint sidecar is the caller's to sweep). */
  afterRemove?(boardId: string): void;
}

let ports: StudioBoardPorts | undefined;

export function bindStudioBoardPorts(next: StudioBoardPorts): void {
  ports = next;
}

function bound(): StudioBoardPorts {
  if (!ports) throw new Error('studio_boards_unbound');
  return ports;
}

async function runtimeOrThrow(): Promise<StudioBoardsRuntime> {
  const runtime = await bound().runtime();
  if (!runtime) throw new Error('studio_storage_unavailable');
  return runtime;
}

/** Write a new board with the id the caller already handed out. Throws when the device cannot hold it. */
export async function writeNewStudioBoard(boardId: string, snapshot: LocalCreationSnapshot, destination: EntityDestination = bound().destination()): Promise<void> {
  const runtime = await runtimeOrThrow();
  await createBoard(runtime.ctx, {
    boardId,
    destination,
    header: {
      title: snapshot.title,
      ...(snapshot.folder ? { folder: snapshot.folder } : {}),
      ...(snapshot.mode ? { mode: snapshot.mode } : {}),
      ...(snapshot.initialPrompt ? { initialPrompt: snapshot.initialPrompt } : {}),
    },
    board: { nodes: snapshot.nodes, edges: snapshot.edges },
    timeline: (snapshot.timeline ?? []).map((message) => ({ ...message })),
  });
}

export const writeSessionBoard = (boardId: string, prompt: string, mode: ChatMode | undefined, destination: EntityDestination): Promise<void> =>
  writeNewStudioBoard(boardId, newLocalCreationSessionSnapshot(prompt, mode).snapshot, destination);

export const writeNotesBoard = (boardId: string, input: { title?: string; text?: string; stickies: readonly string[] }, destination: EntityDestination): Promise<void> =>
  writeNewStudioBoard(boardId, newLocalCreationBoardSnapshot(input).snapshot, destination);

/** The transcript a replica holds, in the stored shape, oldest first. */
export function storedTimelineOf(replica: BoardReplica): StoredTimeline {
  return [...replica.timeline]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((message) => ({
      clientMessageId: message.clientMessageId,
      role: message.role,
      body: message.body,
      ...(message.metadata ? { metadata: message.metadata as NonNullable<StoredTimeline[number]['metadata']> } : {}),
      createdAt: message.createdAt,
    }));
}

/** A replica in the snapshot shape the canvas's helpers (room, merge, checkpoint) speak. */
export function snapshotOfReplica(replica: BoardReplica): LocalCreationSnapshot {
  const payload = replica.header.payload;
  return {
    version: 1,
    title: payload.title,
    ...(payload.folder ? { folder: payload.folder } : {}),
    ...(payload.initialPrompt ? { initialPrompt: payload.initialPrompt } : {}),
    ...(payload.mode ? { mode: payload.mode } : {}),
    timeline: storedTimelineOf(replica),
    nodes: replica.board.nodes,
    edges: replica.board.edges,
    ...(payload.viewport ? { viewport: payload.viewport } : {}),
    updatedAt: replica.header.updatedAt,
  };
}

export async function readLocalCreationSession(boardId: string): Promise<LocalCreationSnapshot | null> {
  const runtime = await bound().runtime();
  const replica = runtime ? await readBoard(runtime.store, boardId) : undefined;
  return replica ? snapshotOfReplica(replica) : null;
}

async function entries(keep: (destination: EntityDestination) => boolean): Promise<LocalCreationEntry[]> {
  const runtime = await bound().runtime();
  if (!runtime) return [];
  return (await listBoards(runtime.store))
    .filter((entry) => keep(entry.destination))
    .map((entry) => ({ sessionId: entry.boardId, title: entry.title, ...(entry.folder ? { folder: entry.folder } : {}), updatedAt: entry.updatedAt }));
}

/** Boards built before anybody was signed in (or with no workspace yet): the ones sign-in can bind. Newest first. */
export const listLocalCreationSessions = (): Promise<LocalCreationEntry[]> => entries((destination) => destination.kind === 'unbound');

/** Boards bound to the workspace in use: the library's offline list (the server's list stays the online one). */
export function listWorkspaceBoards(): Promise<LocalCreationEntry[]> {
  const mine = destinationKey(bound().destination());
  return entries((destination) => destination.kind === 'bound' && destinationKey(destination) === mine);
}

/**
 * Write the CONTENT of a board — objects, connections, transcript, this device's camera — through the
 * open session if there is one. A board the device does not hold yet is created from the snapshot, so
 * a room joiner's first board is kept (the old store wrote it whole).
 */
export async function writeLocalCreationSession(boardId: string, snapshot: Pick<LocalCreationSnapshot, 'nodes' | 'edges' | 'timeline' | 'viewport'> & Partial<Pick<LocalCreationSnapshot, 'title'>>): Promise<void> {
  const runtime = await runtimeOrThrow();
  const state = { board: { nodes: snapshot.nodes, edges: snapshot.edges }, timeline: snapshot.timeline ?? [], ...(snapshot.viewport ? { viewport: snapshot.viewport } : {}) };
  const open = activeBoardSession(boardId);
  if (open) {
    await open.commit(state);
    return;
  }
  const replica = await readBoard(runtime.store, boardId);
  if (!replica) {
    const board = dehydrateBoardMedia({ nodes: snapshot.nodes, edges: snapshot.edges });
    await writeNewStudioBoard(boardId, { version: 1, title: snapshot.title ?? 'Untitled session', nodes: board.nodes, edges: board.edges, ...(snapshot.timeline ? { timeline: snapshot.timeline } : {}), ...(snapshot.viewport ? { viewport: snapshot.viewport } : {}), updatedAt: new Date().toISOString() });
    return;
  }
  const session = openBoardSession(runtime.ctx, replica);
  try {
    await session.commit(state);
  } finally {
    session.dispose();
  }
}

/** Rename, file or change the mode of a board — the header, which syncs. */
export async function updateLocalCreationSession(
  boardId: string,
  patch: { title?: string; folder?: string | null; mode?: ChatMode; role?: BoardPayload['role'] },
): Promise<void> {
  const runtime = await bound().runtime();
  const replica = runtime ? await readBoard(runtime.store, boardId) : undefined;
  if (!runtime || !replica) return;
  const current = replica.header.payload;
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 80) || current.title;
  const folder = patch.folder === undefined ? current.folder : patch.folder?.trim().slice(0, 120) || undefined;
  // A role the board already carries is not a write (the server detail is read on every poll).
  if (Object.keys(patch).every((key) => key === 'role') && patch.role === current.role) return;
  await updateBoardHeader(runtime.ctx, boardId, { title, folder, ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.role ? { role: patch.role } : {}) });
}

/**
 * Delete a board: tombstoned (it syncs as a delete), its local bytes released, and — only once the
 * delete has committed — its sidecars swept. A failed delete keeps the checkpoints with the board.
 */
export async function removeLocalCreationSession(boardId: string): Promise<void> {
  const runtime = await bound().runtime();
  const replica = runtime ? await readBoard(runtime.store, boardId) : undefined;
  if (runtime && replica) {
    await deleteBoard(runtime.ctx, boardId);
    for (const media of replica.media) await runtime.blobs.delete(media.id);
  }
  bound().afterRemove?.(boardId);
}

/** Fold source boards into the target and remove the now-redundant sources. */
export async function mergeLocalCreationSessions(targetBoardId: string, sourceBoardIds: string[]): Promise<LocalCreationSnapshot | null> {
  const target = await readLocalCreationSession(targetBoardId);
  if (!target) return null;
  const sources: LocalCreationSnapshot[] = [];
  const merged: string[] = [];
  for (const id of sourceBoardIds.filter((candidate) => candidate !== targetBoardId)) {
    const snapshot = await readLocalCreationSession(id);
    if (snapshot) { sources.push(snapshot); merged.push(id); }
  }
  if (!sources.length) return target;
  const next = mergedLocalCreationSnapshot(target, sources);
  await writeLocalCreationSession(targetBoardId, next);
  for (const id of merged) await removeLocalCreationSession(id);
  return next;
}
