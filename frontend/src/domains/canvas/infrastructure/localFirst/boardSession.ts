/**
 * ONE OPEN BOARD — what the canvas holds between "the board opened" and "the board closed", over the
 * local-first store.
 *
 * The canvas renders React state, and the replica is the thing that is kept. A `BoardSession` is the
 * seam between them: it remembers the board AS LAST COMMITTED (so an autosave is a per-object diff,
 * not a rewrite), the record versions this tab holds (so another tab's edit of the same object is a
 * conflict, not a silent overwrite), and the transcript ids already written (so a message is appended
 * once). Every write of this board from this tab — autosave, a held Brain write, a room snapshot —
 * goes through the same session and is serialised, so the tab can never conflict with itself.
 *
 * It is plain TypeScript: no React, no network. The hooks (`useCanvasSession`, `useCanvasSessionSync`)
 * call `commit` and `rebase`; they do not decide what a diff is.
 */

import { boardSignature } from '../../application/PersistCanvas';
import type { CanvasBoard } from '../../domain/canvasBoard';
import type { LocalCreationSnapshot } from '../../domain/boardSnapshot';
import { appendTimelineMessage, commitBoardDiff, updateBoardHeader, type BoardCommitResult, type BoardWriteContext } from './boardCommit';
import { dehydrateBoardMedia } from './boardMediaUrls';
import type { BoardReplica } from './boardReplica';
import type { BoardViewport } from './boardRecords';

type StoredTimeline = NonNullable<LocalCreationSnapshot['timeline']>;

/** The part of the canvas that is kept: the board, its transcript, and this device's own camera. */
export interface BoardState {
  board: CanvasBoard;
  timeline: StoredTimeline;
  viewport?: BoardViewport;
}

export interface BoardSession {
  readonly boardId: string;
  /** Write what changed since the last commit, in order after any earlier commit. */
  commit(state: BoardState): Promise<BoardCommitResult>;
  /** Append transcript rows now (commenters and viewers keep their chat turns; nothing waits on the autosave debounce). */
  appendMessages(messages: StoredTimeline): Promise<void>;
  /** The store's board replaced what this session holds (a server reconcile): diff from it from now on. */
  rebase(replica: BoardReplica): void;
  /** Whether the store holds a record this tab did not write (another tab's edit, a seed). */
  changedExternally(replica: BoardReplica): boolean;
  /** Whether a commit is in flight or queued. */
  busy(): boolean;
  dispose(): void;
}

const openSessions = new Map<string, BoardSession>();

let onScreen: string | null = null;

/** The board the person is looking at — what media added through a bare `File` belongs to. */
export function setOnScreenBoard(boardId: string | null): void {
  onScreen = boardId;
}

export function onScreenBoardId(): string | null {
  return onScreen;
}

/** The session of the board this tab has open, when it has one — every in-tab writer of that board goes through it. */
export function activeBoardSession(boardId: string): BoardSession | undefined {
  return openSessions.get(boardId);
}

const sameViewport = (a: BoardViewport | undefined, b: BoardViewport): boolean => a !== undefined && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

export function openBoardSession(ctx: BoardWriteContext, replica: BoardReplica): BoardSession {
  const boardId = replica.boardId;
  let prev = replica.board;
  let prevSignature = boardSignature(prev);
  let versions: Record<string, number> = { ...replica.versions };
  const written = new Set(replica.timeline.map((message) => message.clientMessageId));
  let viewport = replica.header.payload.viewport;
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0;

  const writeMessages = async (messages: StoredTimeline): Promise<void> => {
    for (const message of messages) {
      if (written.has(message.clientMessageId)) continue;
      await appendTimelineMessage(ctx, boardId, {
        clientMessageId: message.clientMessageId,
        role: message.role,
        body: message.body,
        ...(message.metadata ? { metadata: message.metadata } : {}),
        createdAt: message.createdAt,
      });
      written.add(message.clientMessageId);
    }
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    queued += 1;
    const run = tail.then(work).finally(() => { queued -= 1; });
    tail = run.catch(() => undefined);
    return run;
  };

  const session: BoardSession = {
    boardId,
    commit: (state) => serial(async () => {
      const result: BoardCommitResult = { written: 0, deleted: 0, conflicts: [], versions: {} };
      // The store holds `media:<id>`, never the object URL the page renders the bytes with.
      const board = dehydrateBoardMedia(state.board);
      const signature = boardSignature(board);
      if (signature !== prevSignature) {
        const committed = await commitBoardDiff(ctx, boardId, prev, board, { baseVersions: versions });
        const kept = new Set([...board.nodes.map((node) => node.id), ...board.edges.map((edge) => edge.id)]);
        versions = Object.fromEntries(Object.entries({ ...versions, ...committed.versions }).filter(([id]) => kept.has(id)));
        prev = board;
        prevSignature = signature;
        Object.assign(result, committed);
      }
      await writeMessages(state.timeline);
      if (state.viewport && !sameViewport(viewport, state.viewport)) {
        // This device's own camera: written locally, never journaled (its synced payload is unchanged).
        await updateBoardHeader(ctx, boardId, { viewport: state.viewport });
        viewport = state.viewport;
      }
      return result;
    }),
    appendMessages: (messages) => serial(() => writeMessages(messages)),
    rebase(next) {
      prev = next.board;
      prevSignature = boardSignature(prev);
      versions = { ...next.versions };
      for (const message of next.timeline) written.add(message.clientMessageId);
      viewport = next.header.payload.viewport;
    },
    changedExternally(next) {
      const ours = Object.keys(versions);
      const theirs = Object.keys(next.versions);
      return ours.length !== theirs.length || theirs.some((id) => versions[id] !== next.versions[id]);
    },
    busy: () => queued > 0,
    dispose() {
      if (openSessions.get(boardId) === session) openSessions.delete(boardId);
    },
  };
  openSessions.set(boardId, session);
  return session;
}
