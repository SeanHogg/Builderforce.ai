/**
 * VisualizationPanel — the RIGHT-HAND column of the editor (Epic #5330).
 *
 * `builderforce.openVisualization` opens this beside the chat in `ViewColumn.Beside`
 * (`src/extension.ts:306`), so the conversation and the code-change tree it produces
 * are read at once instead of traded against each other in one tab.
 *
 * ── AC3: THE CANVAS IS NOT REIMPLEMENTED HERE ───────────────────────────────────
 * The default view is the SAME `CreationCanvas` the chat panel draws, with the SAME
 * props it draws it with. It is passed in as `children` rather than imported so this
 * file cannot drift from `WorkspaceApp.tsx`: there is one mount site, and it is the
 * one that owns the session, the token gate and `HostScopeProviders`. `AC3` is the
 * canvas being UNCHANGED, and the only way to guarantee that across two mount sites
 * is to have one.
 *
 * ── AC4: WHAT "A RUN BEGAN MUTATING" MEANS ──────────────────────────────────────
 * Not a guess and not a new message: the host already relays every run frame to every
 * attached sink (`src/brainRunHostProtocol.ts`), and this panel listens for the two
 * that answer it —
 *   • `run.sync` → `snapshot.running`  → a run is live;
 *   • `run.tool` → `mutating: true`    → it is writing.
 * The FIRST `mutating: true` is the swap. See `visualizationViewState.ts` for why the
 * decision lives in a pure reducer and not in this component.
 *
 * ── AC5: THE TOGGLE OUTRANKS THE RUN ────────────────────────────────────────────
 * The toggle is always mounted, in both views, and stays live while a run is
 * streaming. Asking for the canvas PINS it: later writes keep counting into the tree
 * (that is the data) but stop stealing the view.
 *
 * ── THE KNOWLEDGE VIEW (PRD 38) ─────────────────────────────────────────────────
 * A third view, beside the canvas and the changes: the workspace's knowledge graph,
 * handed in mounted (`knowledge`) exactly as the canvas is. It is the resting view while
 * no run has written anything; the first write still swaps to the changes (AC4), and
 * Open in graph (`knowledgeRequests`) brings it back, pinned like the canvas.
 *
 * ── WHY THIS IS NOT ITS OWN BUNDLE ENTRY ───────────────────────────────────────
 * The panel is opened through the SAME `renderWebviewHtml` shell as the board,
 * Project 360 and the Evermind sidebar view, so it loads the ONE bundle at
 * `media/webview/index.js`. A second vite entry here would trip
 * `entryKeepsShellNames` in `webview/vite.config.ts` (rollup renames a colliding
 * `index.js` to `index2.js` silently and the shell then boots the wrong file), so
 * this is a COMPONENT in that bundle, routed by the host — the shape
 * `EvermindScreen` and `Project360Screen` take.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';

import './visualization.css';

import { onHostMessage } from '../bridgeTransport';
import { getPendingChanges, onPendingChanges } from '../bridgeState';
import { makeT } from '../chat/chatLabels';
import { scopeChangesToChat } from '../chatChangeScope';
import type { LabelBundle } from '../vscodeBridge';
import type { PendingChange, PendingChangeSet } from '../../../src/gitChangeModel';
import { parseUnifiedDiff, type FileDiff } from './diffModel';
import { buildChangeGraph, type ChangeGraph } from './changeGraph';
import { ChangeTree } from './ChangeTree';
import {
  hasChanges,
  isRunActive,
  visualizationViewReducer,
  INITIAL_VIEW_STATE,
  type VisualizationView,
} from './visualizationViewState';

/** The frames `src/brainRunHostProtocol.ts` defines — read, never re-declared. */
interface RunSyncFrame {
  chatId: number;
  snapshot: { running: boolean };
}
interface RunToolFrame {
  chatId: number;
  name: string;
  mutating: boolean;
}
interface RunEndedFrame {
  chatId: number;
  /** `run.failed` only. Carried through to the action for parity, not displayed. */
  error?: string;
}

export interface VisualizationPanelProps {
  /** Localized strings supplied by the extension host with its `init` frame. */
  labels?: LabelBundle;
  /**
   * The working tree, as the host detected it (`pendingChanges`). Optional so the
   * panel still mounts — on the canvas — if no tree has arrived yet.
   */
  pendingChanges?: PendingChangeSet | null;
  /**
   * The working tree's unified diff — the before/after rows. A PROP so this panel stays
   * host-free: the editor supplies it from `usePendingDiff` (the host's `changes.diff`,
   * `detectPendingDiff` in `src/gitChanges.ts`); another host supplies its own.
   */
  diffText?: string;
  /** Which chat's changes to show. Omitted ⇒ the union of every chat's. */
  chatId?: number | null;
  /**
   * The paths that chat wrote, as the host recorded them. Scoped with the SHARED
   * matcher (`scopeChangesToChat`) so this panel and the chat's own change list
   * agree on what "this chat's files" means — `chatChangeScope.ts` exists precisely
   * because that answer is subtle (relative vs absolute, single-segment names).
   * Omitted ⇒ every change in the working tree.
   */
  chatFiles?: readonly string[] | null;
  /** The canvas, mounted and mounted UNCHANGED. See AC3 above. */
  children?: ReactNode;
  /**
   * The Knowledge view (PRD 38), handed in mounted like the canvas — this file never
   * imports the graph view. Absent ⇒ the switch offers Canvas and Changes only.
   */
  knowledge?: ReactNode;
  /** Moves whenever the host asks for the Knowledge view (Open in graph): it is shown and pinned. */
  knowledgeRequests?: number;
}

/** The views, in the switch's order. */
const VIEWS: ReadonlyArray<{ id: VisualizationView; action: 'showKnowledge' | 'showCanvas' | 'showChanges'; label: [string, string]; hint: [string, string] }> = [
  { id: 'knowledge', action: 'showKnowledge', label: ['viz.button.knowledge', 'Knowledge'], hint: ['viz.showKnowledge', 'Show what this workspace knows: its knowledge graph'] },
  { id: 'canvas', action: 'showCanvas', label: ['viz.button.canvas', 'Canvas'], hint: ['viz.showCanvas', 'Back to the Creation Canvas'] },
  { id: 'changes', action: 'showChanges', label: ['viz.button.changes', 'Changes'], hint: ['viz.showChanges', 'Show the code changes this run made'] },
];

/**
 * Read the panel's working tree off the shared bridge, when the host pushed one.
 * `onPendingChanges` signals `undefined` to mean "nothing pending"; the panel holds
 * the last known set in that case rather than blanking mid-run.
 */
function useHostPendingChanges(hostValue: PendingChangeSet | null | undefined): PendingChangeSet | null {
  const [host, setHost] = useState<PendingChangeSet | null>(hostValue ?? null);
  useEffect(() => { if (hostValue !== undefined) setHost(hostValue); }, [hostValue]);
  useEffect(() => {
    const current = getPendingChanges();
    if (current) setHost(current);
    return onPendingChanges((next) => { if (next) setHost(next); });
  }, []);
  return host;
}

export function VisualizationPanel({
  labels,
  pendingChanges,
  diffText = '',
  chatId = null,
  chatFiles = null,
  children,
  knowledge,
  knowledgeRequests = 0,
}: VisualizationPanelProps) {
  const t = makeT(labels ?? {});
  const [state, dispatch] = useReducer(
    visualizationViewReducer,
    INITIAL_VIEW_STATE,
    // No Knowledge view to rest on ⇒ the canvas is the resting view, as before PRD 38.
    (initial) => (knowledge === undefined ? { ...initial, view: 'canvas' as const } : initial),
  );
  useEffect(() => { if (knowledgeRequests > 0) dispatch({ type: 'showKnowledge' }); }, [knowledgeRequests]);

  // ── The run frames (AC4) ─────────────────────────────────────────────────────
  // When the caller names a chat, only that chat's run drives the swap — every frame
  // carries its `chatId`, so a background chat finishing elsewhere must not yank this
  // panel off the canvas. Unnamed ⇒ any run counts.
  const owns = useCallback((frameChatId: number) => chatId == null || frameChatId === chatId, [chatId]);

  useEffect(() => {
    const offSync = onHostMessage<RunSyncFrame>('run.sync', (m) => {
      if (!owns(m.chatId)) return;
      dispatch({ type: 'run.sync', chatId: m.chatId, running: !!m.snapshot?.running });
    });
    const offTool = onHostMessage<RunToolFrame>('run.tool', (m) => {
      if (!owns(m.chatId)) return;
      dispatch({ type: 'run.tool', mutating: !!m.mutating });
    });
    // A settled and a failed run are the same event to this panel: the chat is no
    // longer writing. The CHANGES stay on screen — that is what the user reads next.
    const offSettled = onHostMessage<RunEndedFrame>('run.settled', (m) => {
      if (!owns(m.chatId)) return;
      dispatch({ type: 'run.settled', chatId: m.chatId });
    });
    const offFailed = onHostMessage<RunEndedFrame>('run.failed', (m) => {
      if (!owns(m.chatId)) return;
      dispatch({ type: 'run.settled', chatId: m.chatId, error: m.error });
    });
    return () => { offSync(); offTool(); offSettled(); offFailed(); };
  }, [owns]);

  const changes = useHostPendingChanges(pendingChanges);

  // ── The tree (AC4) ───────────────────────────────────────────────────────────
  const flat: PendingChange[] = useMemo(() => changes?.repos.flatMap((repo) => repo.changes) ?? [], [changes]);

  /**
   * Scope to THIS chat before building the graph, not after: `buildChangeGraph` takes
   * the whole `PendingChangeSet`, and a post-filter on `ChangeGraph.nodes` would drop
   * edges whose endpoint went out of scope and leave a node pointing at a file that
   * is no longer listed. Narrowing the input keeps the graph internally consistent.
   *
   * No file list ⇒ everything in the working tree. Hiding unattributable work behind
   * an empty state would read as "nothing changed", which is the worse lie.
   */
  const scoped: PendingChangeSet = useMemo(() => {
    if (!changes) return { total: 0, repos: [] };
    const keep = chatFiles ? scopeChangesToChat(flat, chatFiles) : flat;
    if (keep.length === flat.length) return changes;
    const kept = new Set(keep);
    return { ...changes, total: keep.length, repos: changes.repos.map((repo) => ({
      ...repo,
      changes: repo.changes.filter((c) => kept.has(c)),
    })) };
  }, [changes, flat, chatFiles]);

  // Untracked files have no diff in `git diff` output, so they are passed in by path
  // and rendered from their own content — see `parseUnifiedDiff`'s second parameter.
  const untracked = useMemo(() => flat.filter((c) => c.status === 'untracked').map((c) => c.relativePath), [flat]);
  const diffs: FileDiff[] = useMemo(() => (diffText ? parseUnifiedDiff(diffText, untracked) : []), [diffText, untracked]);

  const visible: ChangeGraph = useMemo(
    () => buildChangeGraph(scoped, diffs, []),
    [scoped, diffs],
  );

  const running = isRunActive(state);
  const views = knowledge === undefined ? VIEWS.filter((v) => v.id !== 'knowledge') : VIEWS;

  return (
    <section className="bf-viz" aria-label={t('viz.ariaLabel', 'BuilderForce Visualization')} data-view={state.view}>
      <header className="bf-viz__bar">
        <div className="bf-viz__meters" role="status">
          <span className="bf-viz__stat" data-active={running || undefined}>
            {running ? t('viz.running', 'Run in progress') : t('viz.idle', 'Idle')}
          </span>
          <span className="bf-viz__stat">{t('viz.fileCount', '{n} files').replace('{n}', String(visible.fileCount))}</span>
          <span className="bf-viz__stat bf-viz__stat--add">+{visible.added}</span>
          <span className="bf-viz__stat bf-viz__stat--del">-{visible.removed}</span>
        </div>

        {/* AC5. Always mounted, in EVERY view, never disabled — including mid-run,
            which is exactly when a user reaches for it. */}
        <div className="bf-viz__views" role="group" aria-label={t('viz.views', 'Visualization views')}>
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className="bf-viz__toggle"
              onClick={() => dispatch({ type: v.action })}
              aria-pressed={state.view === v.id}
              title={t(v.hint[0], v.hint[1])}
            >
              {t(v.label[0], v.label[1])}
            </button>
          ))}
        </div>
      </header>

      {state.view === 'knowledge' && knowledge !== undefined ? (
        // Handed in mounted, like the canvas: this file never imports the graph view.
        knowledge
      ) : state.view === 'changes' ? (
        <ChangeTree graph={visible} labels={labels ?? {}} hasEverWritten={hasChanges(state)} />
      ) : (
        // AC3: handed in mounted. This file never imports CreationCanvas.
        <div className="bf-viz__canvas">{children}</div>
      )}
    </section>
  );
}

export default VisualizationPanel;