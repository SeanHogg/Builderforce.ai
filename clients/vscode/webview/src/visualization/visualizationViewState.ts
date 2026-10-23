/**
 * THE VIEW STATE of the right-hand Visualization panel — as a PURE REDUCER, with no
 * React in it at all.
 *
 * ── WHY IT IS ITS OWN FILE ─────────────────────────────────────────────────────
 * Acceptance criterion 4 is one sentence: *"While no run is active the Visualization
 * shows the canvas. The MOMENT a run begins mutating code, it swaps to a change
 * tree."* That sentence is the whole product decision of this panel, and it is a
 * decision about ORDERING — about which of two facts is read first — so it has to be
 * reproducible without a DOM, without a bridge frame and without a running extension
 * host. `webview/` has no jsdom (this package's vitest runs `environment: 'node'`,
 * see `clients/vscode/vitest.config.ts`), so the switch has to be pure for it to be
 * tested at all. `VisualizationPanel.tsx` is then a RENDERING of this reducer, and
 * this file's suite is the regression pin on AC4.
 *
 * ── WHAT COUNTS AS "THE RUN HAS BEGUN MUTATING" ─────────────────────────────────
 * The extension host already streams run activity to every webview that attaches a
 * sink — `src/brainRunHostProtocol.ts` defines the frames, `src/brainRunHost.ts`
 * broadcasts each one to every registered `RunSink`, and `workspaceSurface.ts`
 * registers this panel's sink on `ready`. So there is nothing to invent:
 *
 *   • `run.sync` — `RunSyncMessage` carries `snapshot.running` (from
 *                  `BrainRunSnapshot` in brain-embedded). True means a run is live.
 *   • `run.tool` — `RunToolMessage` carries `{ name, mutating, remote, ok }`. A frame
 *                  with `mutating === true` IS the write having happened; there is no
 *                  earlier signal and none is needed.
 *
 * ── THE SWAP IS AUTOMATIC; THE TOGGLE OUTRANKS IT ──────────────────────────────
 * The two halves are deliberately asymmetric, because the two requirements are:
 *
 *   • Upward to `changes` is automatic and fires on the FIRST mutating tool.
 *   • Back to `canvas` is the user's (AC5), so `showCanvas` PINS the panel there.
 *     While pinned, later mutating tools still COUNT — they are what the tree shows,
 *     and dropping them would freeze the data to satisfy the chrome — but they no
 *     longer yank the view back. That pin is the whole of AC5: without it a run
 *     writing six files would steal the panel out from under the user on file six.
 *
 * Nothing here resets on run end: a finished run's changes are exactly what the user
 * wants to read next, so `run.settled` / `run.failed` only clear liveness.
 */

/** Which of the panel's two views is on screen. */
export type VisualizationView = 'canvas' | 'changes';

export interface VisualizationViewState {
  /** What the panel is showing. */
  view: VisualizationView;
  /**
   * The chats with a live run, ascending. A SET rather than a boolean because the
   * host relays per chat: two chats running, one finishing, must not read as "idle"
   * — the chat surface's cross-chat indicator treats exactly that as still busy.
   */
  runningChats: number[];
  /** How many mutating tool calls this panel has seen. A re-key for consumers. */
  mutations: number;
  /**
   * The user picked a view by hand. Auto-swap is suspended while pinned, so the
   * toggle keeps working for as long as the run keeps writing (AC5).
   */
  pinned: boolean;
}

export type VisualizationAction =
  /** `run.sync` — `snapshot.running` for one chat. */
  | { type: 'run.sync'; chatId: number; running: boolean }
  /** `run.tool` — `mutating` for a finished tool call. */
  | { type: 'run.tool'; mutating: boolean }
  /**
   * The run ended, however it ended. `error` is carried for parity with the host's
   * `run.failed` frame; this panel shows a failed run's changes like any other.
   */
  | { type: 'run.settled'; chatId: number; error?: string }
  /** AC5 — the user asked for the canvas. Pins until they ask for something else. */
  | { type: 'showCanvas' }
  /** AC5 — the user asked for the change tree; also releases the pin. */
  | { type: 'showChanges' };

export const INITIAL_VIEW_STATE: VisualizationViewState = {
  view: 'canvas',
  runningChats: [],
  mutations: 0,
  pinned: false,
};

/** Is any run live? The canvas is the right answer whenever this is false. */
export function isRunActive(state: VisualizationViewState): boolean {
  return state.runningChats.length > 0;
}

/**
 * Is there anything to put in the change tree? A run that has only read is not a
 * change tree, so the `changes` toggle is offered from the first WRITE, not the
 * first run.
 */
export function hasChanges(state: VisualizationViewState): boolean {
  return state.mutations > 0;
}

/** Add/remove `chatId`, keeping the list sorted and duplicate-free. */
function withChat(chats: readonly number[], chatId: number, running: boolean): number[] {
  const next = running ? [...new Set([...chats, chatId])] : chats.filter((id) => id !== chatId);
  return next.sort((a, b) => a - b);
}

export function visualizationViewReducer(
  state: VisualizationViewState = INITIAL_VIEW_STATE,
  action: VisualizationAction,
): VisualizationViewState {
  switch (action.type) {
    // Liveness only. A run that has not written yet leaves the canvas alone: AC4
    // swaps on the run BEGINNING TO MUTATE, not on the run starting.
    case 'run.sync':
      return { ...state, runningChats: withChat(state.runningChats, action.chatId, action.running) };

    // The write itself. A read-only tool call is a frame like any other and must
    // not move the panel — the tree would be empty and the user would think the
    // agent had broken the editor.
    case 'run.tool': {
      if (!action.mutating) return state;
      const mutations = state.mutations + 1;
      if (state.pinned) return { ...state, mutations };
      if (state.view === 'changes') return { ...state, mutations };
      return { ...state, mutations, view: 'changes' };
    }

    // A settled and a failed run are the same event to this panel: the chat is no
    // longer writing. `error` rides along so the caller can forward it verbatim.
    case 'run.settled':
      return { ...state, runningChats: withChat(state.runningChats, action.chatId, false) };

    case 'showCanvas':
      return { ...state, view: 'canvas', pinned: true };

    case 'showChanges':
      return { ...state, view: 'changes', pinned: false };

    default: {
      // Compile-time exhaustiveness: adding an action without handling it is a type
      // error HERE, at the switch, rather than a panel that silently stops updating.
      const exhausted: never = action;
      throw new Error(`Unhandled visualization action: ${JSON.stringify(exhausted)}`);
    }
  }
}

/**
 * The tool-call records `buildChangeGraph` takes, read out of a live trace.
 *
 * `BrainTraceEvent.args` is `unknown` by design (one event type carries every
 * tool's arguments), so the path is read from the keys the write tools actually
 * use and is `undefined` for everything else — and `buildChangeGraph` drops a path
 * no changed file matches, which is the correct outcome for a tool that took none.
 */
export function toolCallFromArgs(args: unknown): { tool: string; path: string } | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  const candidates = [record.path, record.file_path, record.filePath, record.abs_path, record.target_file];
  const path = candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
  if (path === undefined) return undefined;
  return { tool: typeof record.tool === 'string' ? record.tool : 'tool', path };
}