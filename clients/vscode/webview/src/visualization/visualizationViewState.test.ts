import { describe, expect, it } from 'vitest';

import {
  hasChanges,
  INITIAL_VIEW_STATE,
  isRunActive,
  toolCallFromArgs,
  visualizationViewReducer,
  type VisualizationAction,
  type VisualizationViewState,
} from './visualizationViewState';

/**
 * The SWAP LOGIC — the part of the panel that decides which of the two views is on
 * screen (AC4/AC5).
 *
 * `VisualizationPanel` itself is not rendered here: this bundle configures no DOM
 * renderer, so a render test would assert against a shim rather than the panel. What
 * the panel does with these frames is dispatch them VERBATIM — `onHostMessage('run.sync', …)`
 * and friends in `VisualizationPanel.tsx` build exactly the actions below, with the
 * `chatId`/`snapshot.running`/`mutating` fields off the wire. So driving the reducer
 * with the real frame shapes tests the actual decision, and a wrong wire shape shows
 * up here rather than as a silent "the panel never swaps".
 */

/** Apply a run of frames the way React's `useReducer` would, and keep the state. */
function drive(
  actions: VisualizationAction[],
  from: VisualizationViewState = INITIAL_VIEW_STATE,
): VisualizationViewState {
  return actions.reduce(visualizationViewReducer, from);
}

/**
 * The `run.sync` frames the extension really posts, verbatim off the wire:
 * liveness lives at `snapshot.running` (`RunSyncMessage` in
 * `src/brainRunHostProtocol.ts`), NOT at the top level.
 *
 * `toSyncAction` is the exact transformation `VisualizationPanel.tsx` applies in its
 * `onHostMessage('run.sync', …)` handler. It is written out here rather than inlined
 * into the constants so that the wire shape is pinned by a type-checked seam: rename
 * `snapshot` on the host and this file fails to compile, instead of the panel going
 * permanently idle with nothing in the log.
 */
const SYNC_FRAME_ACTIVE = { chatId: 7, snapshot: { running: true } };
const SYNC_FRAME_IDLE = { chatId: 7, snapshot: { running: false } };

/** The wire frame → the reducer's flattened action. Mirrors the panel's handler. */
function toSyncAction(frame: { chatId: number; snapshot?: { running?: boolean } }) {
  return { type: 'run.sync', chatId: frame.chatId, running: !!frame.snapshot?.running } as const;
}

const SYNC_ACTIVE = toSyncAction(SYNC_FRAME_ACTIVE);
const SYNC_IDLE = toSyncAction(SYNC_FRAME_IDLE);

describe('AC4 — the view swaps the moment a run begins mutating code', () => {
  it('starts on the knowledge graph, before any run has said anything', () => {
    // Nothing has happened yet, so the workspace's knowledge graph (PRD 38) is not a
    // default to be overridden — it is the correct thing to be showing.
    expect(INITIAL_VIEW_STATE.view).toBe('knowledge');
    expect(isRunActive(INITIAL_VIEW_STATE)).toBe(false);
  });

  it('reads liveness out of the frame the host really sends', () => {
    // The mapper is the panel's `run.sync` handler. If `snapshot.running` is ever
    // renamed on the host this collapses to `false` — a panel that is permanently
    // idle and swaps to the changes on nothing. Asserted rather than eyeballed.
    expect(toSyncAction(SYNC_FRAME_ACTIVE)).toEqual({ type: 'run.sync', chatId: 7, running: true });
    expect(toSyncAction(SYNC_FRAME_IDLE)).toEqual({ type: 'run.sync', chatId: 7, running: false });
  });

  it('holds the resting view while a run is active but has not written yet', () => {
    // A run that is only reading does NOT flip the panel: swapping on `run.sync`
    // would yank the canvas away on every read-only question the user asks.
    const state = drive([SYNC_ACTIVE]);
    expect(state.view).toBe('knowledge');
    expect(isRunActive(state)).toBe(true);
  });

  it('swaps to the changes on the first mutating tool', () => {
    const state = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
    ]);
    expect(state.view).toBe('changes');
  });

  it('does not swap on a non-mutating tool', () => {
    const state = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: false },
    ]);
    expect(state.view).toBe('knowledge');
  });

  it('keeps the changes on screen once the run ends — that is what the user reads next', () => {
    const state = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'run.settled', chatId: 7 },
    ]);
    // The run being over is not a reason to discard its output: the user reads the
    // diff AFTER the run finishes, which is the whole point of the panel.
    expect(state.view).toBe('changes');
    expect(isRunActive(state)).toBe(false);
    expect(hasChanges(state)).toBe(true);
  });

  it('treats a failed run exactly like a settled one', () => {
    // A crash is still a run that wrote files, and the half-finished diff is the
    // most valuable thing on screen at that moment.
    const settled = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'run.settled', chatId: 7 },
    ]);
    const failed = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'run.settled', chatId: 7, error: 'gateway refused' },
    ]);
    expect(failed).toEqual(settled);
    expect(failed.view).toBe('changes');
  });

  it('never returns to the canvas on its own once changes exist', () => {
    // A later, unrelated run must not undo the reading the user is in the middle of.
    const state = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'run.settled', chatId: 7 },
      // A DIFFERENT chat starts and ends a read-only run. It must not disturb this
      // panel's view, nor its liveness bookkeeping.
      toSyncAction({ chatId: 9, snapshot: { running: true } }),
      { type: 'run.tool', mutating: false },
      toSyncAction({ chatId: 9, snapshot: { running: false } }),
    ]);
    expect(state.view).toBe('changes');
    expect(state.runningChats).toEqual([]);
  });
});

describe('AC5 — the manual toggle back to the canvas always works', () => {
  it('returns to the canvas and pins it, so the next write does not yank it back', () => {
    const changed = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
    ]);
    expect(changed.view).toBe('changes');

    const toggled = visualizationViewReducer(changed, { type: 'showCanvas' });
    expect(toggled.view).toBe('canvas');
    expect(toggled.pinned).toBe(true);

    // The critical case: the user chose the canvas, so a mutating tool arriving
    // afterwards must NOT drag them away from it.
    const afterWrite = visualizationViewReducer(toggled, { type: 'run.tool', mutating: true });
    expect(afterWrite.view).toBe('canvas');
  });

  it('still toggles back to the canvas WHILE a run is active', () => {
    // The toggle must never be disabled during a run: mid-run is exactly when a user
    // wants to glance at the canvas the agent is editing.
    const running = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
    ]);
    expect(isRunActive(running)).toBe(true);

    const toggled = visualizationViewReducer(running, { type: 'showCanvas' });
    expect(toggled.view).toBe('canvas');
    expect(isRunActive(toggled)).toBe(true);
  });

  it('toggles forward again from the canvas, and RELEASES the pin', () => {
    const state = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'showCanvas' },
      { type: 'showChanges' },
    ]);
    expect(state.view).toBe('changes');
    // Asking for the changes by hand is asking for live updates again, so the pin
    // must NOT survive it — otherwise a later write would silently stop swapping.
    expect(state.pinned).toBe(false);
    // And with the pin released, auto-swap is live again: from a canvas showing the
    // changes, the next write keeps it on the changes rather than pinning it stale.
    const onCanvas = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'showCanvas' },
      { type: 'showChanges' },
      { type: 'showCanvas' },
    ]);
    const later = visualizationViewReducer({ ...onCanvas, pinned: false }, { type: 'run.tool', mutating: true });
    expect(later.view).toBe('changes');
  });

  it('keeps counting writes while pinned to the canvas, without moving the view', () => {
    // The tree still has to be CURRENT when the user toggles back — so a pinned
    // panel records mutations but does not swap.
    const pinned = drive([
      SYNC_ACTIVE,
      { type: 'run.tool', mutating: true },
      { type: 'showCanvas' },
    ]);
    const after = visualizationViewReducer(pinned, { type: 'run.tool', mutating: true });
    expect(after.view).toBe('canvas');
    expect(after.mutations).toBe(pinned.mutations + 1);
  });
});

describe('run bookkeeping', () => {
  it('tracks one running chat without losing another', () => {
    // Two chats can be live at once (the roster starts a background one), and a panel
    // scoped to chat 7 must not go idle just because chat 9 ended.
    const state = drive([
      { type: 'run.sync', chatId: 7, running: true },
      { type: 'run.sync', chatId: 9, running: true },
      { type: 'run.settled', chatId: 9 },
    ]);
    expect(state.runningChats).toEqual([7]);
    expect(isRunActive(state)).toBe(true);
  });

  it('goes idle only when every chat it is tracking has ended', () => {
    const state = drive([
      { type: 'run.sync', chatId: 7, running: true },
      { type: 'run.sync', chatId: 9, running: true },
      { type: 'run.settled', chatId: 7 },
      { type: 'run.settled', chatId: 9 },
    ]);
    expect(state.runningChats).toEqual([]);
    expect(isRunActive(state)).toBe(false);
  });

  it('ignores the running flag when a run.sync says the run is over', () => {
    const state = drive([
      SYNC_ACTIVE,
      SYNC_IDLE,
    ]);
    expect(state.runningChats).toEqual([]);
  });

  it('keeps the running list sorted and duplicate-free', () => {
    // Frames are relayed per chat and can interleave out of order; a list that grew
    // `[9, 7]` then `[9, 7, 9]` would make the indicator flap.
    const state = drive([
      { type: 'run.sync', chatId: 9, running: true },
      { type: 'run.sync', chatId: 7, running: true },
      { type: 'run.sync', chatId: 9, running: true },
    ]);
    expect(state.runningChats).toEqual([7, 9]);
  });
});

describe('reading a written path out of a trace event', () => {
  it('takes the path from whichever key the write tool used', () => {
    // The trace's `args` is `unknown` — one event type carries every tool's arguments
    // — so the path has to be dug out by key, and a tool that took none must not
    // invent one.
    expect(toolCallFromArgs({ path: 'src/a.ts' })).toEqual({ tool: 'tool', path: 'src/a.ts' });
    expect(toolCallFromArgs({ tool: 'write_file', file_path: 'src/b.ts' }))
      .toEqual({ tool: 'write_file', path: 'src/b.ts' });
    expect(toolCallFromArgs({ filePath: 'src/c.ts' })?.path).toBe('src/c.ts');
    expect(toolCallFromArgs({ abs_path: 'src/d.ts' })?.path).toBe('src/d.ts');
    expect(toolCallFromArgs({ target_file: 'src/e.ts' })?.path).toBe('src/e.ts');
  });

  it('yields nothing for an argument shape that names no file', () => {
    expect(toolCallFromArgs({ query: 'search for something' })).toBeUndefined();
    expect(toolCallFromArgs({ path: '' })).toBeUndefined();
    expect(toolCallFromArgs({ path: 42 })).toBeUndefined();
    expect(toolCallFromArgs(null)).toBeUndefined();
    expect(toolCallFromArgs('read_file')).toBeUndefined();
  });
});

describe('the Knowledge view (PRD 38)', () => {
  it('returns to the knowledge graph and pins it, so the next write does not yank it back', () => {
    const changed = drive([SYNC_ACTIVE, { type: 'run.tool', mutating: true }]);
    expect(changed.view).toBe('changes');
    const shown = visualizationViewReducer(changed, { type: 'showKnowledge' });
    expect(shown).toMatchObject({ view: 'knowledge', pinned: true });
    expect(visualizationViewReducer(shown, { type: 'run.tool', mutating: true }).view).toBe('knowledge');
  });

  it('swaps from the knowledge graph to the changes on the first write, unpinned', () => {
    expect(INITIAL_VIEW_STATE.pinned).toBe(false);
    expect(drive([SYNC_ACTIVE, { type: 'run.tool', mutating: true }]).view).toBe('changes');
  });
});
