/**
 * The gate between "your collaborator's edit arrives" and "your unsaved work
 * disappears".
 *
 * It was a bare boolean expression — `saveInFlight || currentGraph !==
 * lastSavedGraph` — repeated inside two `useEffect`s and named nowhere, so the
 * only way to exercise it was to mount the canvas, race a save against a poll,
 * and hope.
 */

import { describe, expect, it, vi } from 'vitest';
import { adoptRemoteBoard, remoteBoardBlocked, type LocalBoardState } from './AdoptRemoteBoard';
import type { CanvasSessionPort } from './PersistCanvas';

function persisted(id: string, title: string) {
  return { id, kind: 'task', canvasData: { x: 0, y: 0 }, content: { kind: 'task', title } };
}

/** A browser holding nothing unsaved, at revision 4. */
const settled: LocalBoardState = { saving: false, signature: 'sig-a', savedSignature: 'sig-a', revision: 4 };

function sessions(snapshot: Partial<Awaited<ReturnType<CanvasSessionPort['read']>>> = {}): CanvasSessionPort {
  return {
    replaceGraph: vi.fn(),
    read: vi.fn(async () => ({
      graph: { objects: [persisted('a', 'Theirs')], connections: [] },
      revision: 9,
      title: 'Their board',
      members: [],
      ...snapshot,
    })),
  };
}

describe('remoteBoardBlocked', () => {
  it('lets a newer board land on a settled browser', () => {
    expect(remoteBoardBlocked(settled)).toBeNull();
  });

  it('holds a newer board out while a save is on the wire', () => {
    // The server is about to be newer for a reason THIS browser caused; adopting
    // now would roll the save being written back off the screen.
    expect(remoteBoardBlocked({ ...settled, saving: true })).toBe('saving');
  });

  it('holds a newer board out while there are edits nobody has saved', () => {
    // This is the one that costs work: adopting deletes them, with no undo and
    // no message.
    expect(remoteBoardBlocked({ ...settled, signature: 'sig-b' })).toBe('unsaved-edits');
  });
});

describe('adoptRemoteBoard', () => {
  it('does not even READ the session while the local board is unsafe to replace', async () => {
    const port = sessions();
    const decision = await adoptRemoteBoard('s1', { ...settled, signature: 'sig-b' }, port);
    expect(decision).toEqual({ adopt: false, reason: 'unsaved-edits' });
    expect(port.read).not.toHaveBeenCalled();
  });

  it('refuses a board that is not actually newer', async () => {
    // Re-checked AFTER the read, not only before it: a save can land while the
    // request is in flight, and adopting then would roll this browser backwards.
    const decision = await adoptRemoteBoard('s1', settled, sessions({ revision: 4 }));
    expect(decision).toEqual({ adopt: false, reason: 'not-newer' });
  });

  it('carries the board, the revision, the title and the roster', async () => {
    const decision = await adoptRemoteBoard('s1', settled, sessions({ members: [{ userId: 'u1', role: 'editor', displayName: 'Ada' }] }));
    expect(decision.adopt).toBe(true);
    if (!decision.adopt) return;
    expect(decision.board.nodes.map((node) => node.id)).toEqual(['a']);
    expect(decision.revision).toBe(9);
    expect(decision.title).toBe('Their board');
    expect(decision.members).toEqual([{ userId: 'u1', role: 'editor', displayName: 'Ada' }]);
  });

  it('REPORTS what the collaborator sent that this build cannot render', async () => {
    // Both call sites used to drop these in silence, while the initial load —
    // three hundred lines away in the same component — said so out loud.
    const decision = await adoptRemoteBoard('s1', settled, sessions({
      graph: { objects: [persisted('a', 'Theirs'), { id: 'z', kind: 'from-a-newer-build', canvasData: {}, content: {} }], connections: [] },
    }));
    expect(decision.adopt).toBe(true);
    if (!decision.adopt) return;
    expect(decision.rejected.map((entry) => entry.kind)).toEqual(['from-a-newer-build']);
    // The refused object is not on the board it hands back.
    expect(decision.board.nodes.map((node) => node.id)).toEqual(['a']);
  });

  it('signs the board it adopted, so the next save compares against the right thing', async () => {
    const decision = await adoptRemoteBoard('s1', settled, sessions());
    expect(decision.adopt).toBe(true);
    if (!decision.adopt) return;
    expect(decision.signature).toBe(JSON.stringify({ nodes: decision.board.nodes, edges: decision.board.edges }));
  });
});
