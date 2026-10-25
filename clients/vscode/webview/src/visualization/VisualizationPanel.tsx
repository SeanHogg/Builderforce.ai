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
import { buildChangeGraph, parseUnifiedDiff, type ChangeGraph, type FileDiff } from './diffModel';
import {
  hasChanges,
  isRunActive,
  visualizationViewReducer,
  INITIAL_VIEW_STATE,
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
}

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
}: VisualizationPanelProps) {
  const t = makeT(labels ?? {});
  const [state, dispatch] = useReducer(visualizationViewReducer, INITIAL_VIEW_STATE);

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
  const showCanvas = state.view === 'canvas';
  const toggle = useCallback(() => {
    dispatch({ type: showCanvas ? 'showChanges' : 'showCanvas' });
  }, [showCanvas]);

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

        {/* AC5. Always mounted, in BOTH views, never disabled — including mid-run,
            which is exactly when a user reaches for it. */}
        <button
          type="button"
          className="bf-viz__toggle"
          onClick={toggle}
          aria-pressed={!showCanvas}
          title={showCanvas
            ? t('viz.showChanges', 'Show the code changes this run made')
            : t('viz.showCanvas', 'Back to the Creation Canvas')}
        >
          {showCanvas ? t('viz.button.changes', 'Changes') : t('viz.button.canvas', 'Canvas')}
        </button>
      </header>

      {showCanvas ? (
        // AC3: handed in mounted. This file never imports CreationCanvas.
        <div className="bf-viz__canvas">{children}</div>
      ) : (
        <ChangeTree graph={visible} labels={labels ?? {}} hasEverWritten={hasChanges(state)} />
      )}
    </section>
  );
}

/** Git's status word, as the Source Control view beside it words it. */
const STATUS_GLYPH: Record<string, string> = {
  added: 'A', untracked: 'U', modified: 'M', deleted: 'D', renamed: 'R', conflict: '!',
};

/**
 * THE CHANGE TREE — every file the run touched, its place in the graph, and the
 * before/after of each hunk.
 *
 * The diff ROWS are rendered, not summarised: `+`/`-`/` ` per line with the line
 * number on each side is the only representation of a change that reconciles with the
 * Source Control view the user has open in the same window.
 */
function ChangeTree({ graph, labels, hasEverWritten }: { graph: ChangeGraph; labels: LabelBundle; hasEverWritten: boolean }) {
  const t = makeT(labels);
  /**
   * WHICH file is expanded, as a tri-state:
   *   undefined → follow the first node (the default: open what matters most);
   *   a path   → the user picked this one;
   *   null     → the user closed it, and "closed" must be distinguishable from
   *              "not chosen yet" — otherwise collapsing the first file silently
   *              re-opens it on the next render.
   *
   * It has to be derived rather than seeded: the panel swaps to this view on the
   * FIRST write, which can beat the host's change list, so `nodes` is often still
   * empty at mount and a value seeded once would open nothing when it fills in.
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const open = picked === undefined ? graph.nodes[0]?.path ?? null : picked;
  const linked = useMemo(() => {
    const bySource = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = bySource.get(edge.from);
      if (list) list.push(edge.to);
      else bySource.set(edge.from, [edge.to]);
    }
    return bySource;
  }, [graph.edges]);

  if (graph.nodes.length === 0) {
    // Two empties that mean opposite things, so they must not read alike: a run that
    // has not written yet is still coming, and "nothing has changed" as the answer to
    // that would tell the user the opposite.
    return (
      <div className="bf-viz__empty">
        <p>{hasEverWritten
          ? t('viz.empty', 'This run has not changed any files yet.')
          : t('viz.emptyIdle', 'No run has changed anything yet.')}</p>
      </div>
    );
  }

  return (
    <div className="bf-viz__tree">
      <ul className="bf-viz__files" role="tree" aria-label={t('viz.filesLabel', 'Files changed by this run')}>
        {graph.nodes.map((node) => {
          const expanded = open === node.path;
          const outs = linked.get(node.path) ?? [];
          return (
            <li key={node.path} role="treeitem" aria-expanded={expanded}>
              <button type="button" className="bf-viz__file" onClick={() => setPicked(expanded ? null : node.path)}>
                <span className="bf-viz__glyph" data-status={node.status}>{STATUS_GLYPH[node.status] ?? '?'}</span>
                <span className="bf-viz__path">{node.dir ? `${node.dir}/` : ''}<strong>{node.name}</strong></span>
                <span className="bf-viz__tally"><span className="bf-viz__add">+{node.diff.added}</span>{' '}<span className="bf-viz__del">-{node.diff.removed}</span></span>
              </button>

              {/* THE MATRIX: who this file talks to, and who touched it. */}
              <dl className="bf-viz__matrix">
                <dt>{t('viz.relations', 'References')}</dt>
                <dd>{outs.length === 0 ? t('viz.noRelations', 'none in this change') : outs.join(', ')}</dd>
                <dt>{t('viz.tools', 'Written by')}</dt>
                <dd>{node.tools.length === 0 ? t('viz.noTools', 'no recorded tool call') : node.tools.join(', ')}</dd>
                {!node.diff.tracked && <><dt>{t('viz.untracked', 'State')}</dt><dd>{t('viz.untrackedNote', 'untracked — git has no diff for it')}</dd></>}
              </dl>

              {expanded && (
                <div className="bf-viz__diff" role="group" aria-label={t('viz.diffLabel', 'Before and after')}>
                  {node.diff.hunks.length === 0
                    ? <p className="bf-viz__nodiff">{t('viz.noDiff', 'No diff to show (untracked file).')}</p>
                    : node.diff.hunks.map((hunk, i) => (
                        <table key={i} className="bf-viz__hunk">
                          <caption>{hunk.header}</caption>
                          <tbody>
                            {hunk.rows.map((row, j) => (
                              <tr key={j} data-kind={row.kind} className={`bf-viz__row bf-viz__row--${row.kind}`}>
                                <td className="bf-viz__num">{row.oldLine ?? ''}</td>
                                <td className="bf-viz__num">{row.newLine ?? ''}</td>
                                <td className="bf-viz__sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</td>
                                <td className="bf-viz__code">{row.text}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default VisualizationPanel;