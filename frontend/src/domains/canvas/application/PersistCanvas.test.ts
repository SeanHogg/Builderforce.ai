/**
 * Autosave, the conflict merge and the status line — none of which had a test,
 * because all three lived inside a `useEffect` in a 13,000-line component.
 *
 * The conflict path is the one that matters most: `Session changed` is not a
 * failure, it is a collaborator having saved first, and the difference between
 * those two readings is whether the person watching loses their edit.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  boardSignature,
  createCanvasNotices,
  persistBoard,
  saveAttemptKey,
  SESSION_CHANGED,
  type CanvasSessionPort,
} from './PersistCanvas';
import type { CanvasObject } from '../domain/canvasObject';

const t = (key: string) => key;

/** A manually-fired stand-in for setTimeout, so the expiry timer tests without waiting on one. */
type TimerHandle = ReturnType<typeof setTimeout>;
type FakeTimer = { run: () => void; ms: number };

/**
 * A scheduler the test can drive by hand. The production signature types the handle as
 * the runtime's timer handle, which `createCanvasNotices` only ever hands back to
 * `cancel` — so the fake's own record crosses that boundary as an opaque handle and is
 * read back on this side, keeping `pending`/`cancelled` typed for the assertions.
 */
function fakeScheduler() {
  const pending: FakeTimer[] = [];
  const cancelled: FakeTimer[] = [];
  const schedule = (run: () => void, ms: number): TimerHandle => {
    const timer: FakeTimer = { run, ms };
    pending.push(timer);
    return timer as unknown as TimerHandle;
  };
  const cancel = (handle: TimerHandle) => { cancelled.push(handle as unknown as FakeTimer); };
  return { schedule, cancel, pending, cancelled };
}

function object(id: string, title: string): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'task' as CanvasObject['data']['kind'], title } };
}

function persisted(id: string, title: string) {
  return { id, kind: 'task', canvasData: { x: 0, y: 0 }, content: { kind: 'task', title } };
}

describe('createCanvasNotices', () => {
  it('lets an outcome hold the line against the save confirmation behind it', () => {
    // Autosave is debounced 300ms behind the edit, so without this rule every
    // outcome was wiped a third of a second after it appeared — too fast to read,
    // and the one message the person was waiting for.
    const shown: string[] = [];
    let time = 0;
    const { schedule, cancel } = fakeScheduler();
    const notices = createCanvasNotices((text) => shown.push(text), { holdMs: 4_000, now: () => time, schedule, cancel });

    notices.outcome('Sketch added');
    time = 300;
    notices.saveState('Saving…');

    expect(shown).toEqual(['Sketch added']);
  });

  it('lets the save state through once the outcome has had its moment', () => {
    const shown: string[] = [];
    let time = 0;
    const { schedule, cancel } = fakeScheduler();
    const notices = createCanvasNotices((text) => shown.push(text), { holdMs: 4_000, now: () => time, schedule, cancel });
    notices.outcome('Sketch added');
    time = 4_500;
    notices.saveState('Saved on this device');
    expect(shown).toEqual(['Sketch added', 'Saved on this device']);
  });

  it('never suppresses an outcome, however fast they arrive', () => {
    const shown: string[] = [];
    const { schedule, cancel } = fakeScheduler();
    const notices = createCanvasNotices((text) => shown.push(text), { now: () => 0, schedule, cancel });
    notices.outcome('one');
    notices.outcome('two');
    expect(shown).toEqual(['one', 'two']);
  });

  it('clears itself once the hold expires, so a pill nobody edits past does not sit in the corner forever', () => {
    // "Shared — send the link to invite people" is shown once, on a click, and often
    // nothing else touches the board afterward — there is no later save to piggyback
    // a clear on, and the pill itself has no dismiss button.
    const shown: string[] = [];
    const { schedule, cancel, pending } = fakeScheduler();
    const notices = createCanvasNotices((text) => shown.push(text), { holdMs: 4_000, now: () => 0, schedule, cancel });

    notices.outcome('Shared — send the link to invite people');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.ms).toBe(4_000);

    pending[0]!.run();

    expect(shown).toEqual(['Shared — send the link to invite people', '']);
  });

  it('cancels the pending clear when a new outcome supersedes it', () => {
    const shown: string[] = [];
    const { schedule, cancel, pending, cancelled } = fakeScheduler();
    const notices = createCanvasNotices((text) => shown.push(text), { now: () => 0, schedule, cancel });

    notices.outcome('one');
    notices.outcome('two');

    expect(cancelled).toEqual([pending[0]]);
    // Only the SECOND clear should still be able to fire.
    pending[1]!.run();
    expect(shown).toEqual(['one', 'two', '']);
  });
});

describe('boardSignature', () => {
  it('changes when an object does', () => {
    expect(boardSignature({ nodes: [object('a', 'One')], edges: [] }))
      .not.toBe(boardSignature({ nodes: [object('a', 'Two')], edges: [] }));
  });

  it('ignores the viewport, so panning is not an edit', () => {
    // A save per pan frame is a revision per pan frame.
    const board = { nodes: [object('a', 'One')], edges: [] };
    expect(boardSignature({ ...board, viewport: { x: 1, y: 1, zoom: 1 } } as typeof board))
      .toBe(boardSignature({ ...board, viewport: { x: 900, y: 40, zoom: 3 } } as typeof board));
  });
});

describe('saveAttemptKey', () => {
  it('keeps the key stable so a retry is the SAME write', () => {
    const first = saveAttemptKey(null, 'sig-1');
    expect(saveAttemptKey(first, 'sig-1')).toBe(first);
  });

  it('mints a new key when the board moved on', () => {
    const first = saveAttemptKey(null, 'sig-1');
    const second = saveAttemptKey(first, 'sig-2');
    expect(second.key).not.toBe(first.key);
    expect(second.signature).toBe('sig-2');
  });
});

describe('persistBoard', () => {
  const board = { nodes: [object('a', 'Mine')], edges: [] };
  const attempt = { sessionId: 's1', board, expectedRevision: 4, idempotencyKey: 'key-1', signature: boardSignature(board) };

  it('reports the new revision and what is now stored', async () => {
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => ({ revision: 5 })),
      read: vi.fn(),
    };

    const result = await persistBoard(attempt, sessions, t);

    expect(result).toEqual({ outcome: 'saved', revision: 5, signature: attempt.signature, objectIds: ['a'] });
    expect(sessions.replaceGraph).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4, idempotencyKey: 'key-1' }));
  });

  it('treats a stale revision as a collaborator, not a failure — and keeps LOCAL edits', async () => {
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => { throw new Error(SESSION_CHANGED); }),
      read: vi.fn(async () => ({
        graph: { objects: [persisted('a', 'Theirs'), persisted('b', 'Also theirs')], connections: [] },
        revision: 9, title: 'Board', members: [],
      })),
    };

    const result = await persistBoard(attempt, sessions, t);

    expect(result.outcome).toBe('merged');
    if (result.outcome !== 'merged') return;
    expect(result.revision).toBe(9);
    // Their object survives, AND the edit the person in front of the screen is
    // holding wins over the copy the server had.
    expect(result.board.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(result.board.nodes.find((node) => node.id === 'a')?.data.title).toBe('Mine');
    expect(result.notice).toBe('noticeConcurrentMerged');
  });

  it('signs the REMOTE board, so the merge is not mistaken for something already saved', async () => {
    const remoteObjects = [persisted('a', 'Theirs')];
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => { throw new Error(SESSION_CHANGED); }),
      read: vi.fn(async () => ({ graph: { objects: remoteObjects, connections: [] }, revision: 9, title: 'Board', members: [] })),
    };

    const result = await persistBoard(attempt, sessions, t);

    expect(result.outcome).toBe('merged');
    if (result.outcome !== 'merged') return;
    // Signing the MERGED board would mark a board that has never been written as
    // saved, and the local edit would sit there unsaved until the next keystroke.
    expect(result.signature).not.toBe(boardSignature(result.board));
  });

  it('names the kinds a collaborator sent that this build cannot render', async () => {
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => { throw new Error(SESSION_CHANGED); }),
      read: vi.fn(async () => ({
        graph: { objects: [persisted('a', 'Theirs'), { id: 'z', kind: 'from-a-newer-build', canvasData: {}, content: {} }], connections: [] },
        revision: 9, title: 'Board', members: [],
      })),
    };

    const result = await persistBoard(attempt, sessions, t);

    expect(result.outcome).toBe('merged');
    if (result.outcome !== 'merged') return;
    expect(result.rejected.map((entry) => entry.kind)).toEqual(['from-a-newer-build']);
  });

  it('surfaces the server’s own message for an ordinary failure', async () => {
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => { throw new Error('Payload too large'); }),
      read: vi.fn(),
    };
    expect(await persistBoard(attempt, sessions, t)).toEqual({ outcome: 'failed', notice: 'Payload too large' });
  });

  it('says the conflict, not the recovery, when the re-read also fails', async () => {
    // The raw `Session changed` used to reach the pill untranslated, in every locale.
    const sessions: CanvasSessionPort = {
      replaceGraph: vi.fn(async () => { throw new Error(SESSION_CHANGED); }),
      read: vi.fn(async () => { throw new Error('offline'); }),
    };
    expect(await persistBoard(attempt, sessions, t)).toEqual({ outcome: 'failed', notice: 'noticeSaveConflict' });
  });
});
