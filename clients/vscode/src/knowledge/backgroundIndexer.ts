/**
 * The background indexer's composition root (PRD 41 B6, B2 step 5, §6 "Open a folder, offline" / "Edit a file", §12.3):
 * every workspace folder is a root with its own {@link RootIndexer}; this wires them to VS Code and nothing else.
 *
 *   - it runs only while knowledge runs (`visualizerSession.ts`): a folder is indexed while a Visualizer that the person
 *     pressed Run on holds a root in it, and stops when the last such Visualizer closes; `builderforce.knowledge.autoIndex`
 *     (default OFF) is the opt-in that indexes every folder from startup. Activation alone starts nothing;
 *   - its start, a new workspace folder and every window refocus run a reconciling plan (watchers drop events);
 *   - one FileSystemWatcher per folder (`vscodeKnowledgeFs().watch`, which already drops `.builderforce/cache/**`)
 *     feeds the 100 ms coalescer (`indexWatcher.ts`);
 *   - a keystroke (a file or an untitled document) pauses the queue AND stops a running long pass, which reruns when the
 *     person is quiet; the window unfocused for 10 minutes pauses it (`indexBudget.ts`);
 *   - files open in editors first, then visible ones;
 *   - a person's review, Retry or Exclude preempts the root's pass (`preemptBackground`);
 *   - L3 (the heavy analyzers' pass) runs ON DEMAND ONLY: a person's request reaches the root's indexer through `requestL3`
 *     (`indexLevels.ts`); every {@link L3_CHECK_MS} the tick starts a request still pending once its root is quiet, the
 *     once-per-session fact-store sweep, and ONE queued L3 task an agent run asked for (idle and on mains power, `powerSource.ts`)
 *     — never an L3 pass nobody asked for;
 *   - level status goes to the bus (`indexLevels.ts`, the knowledge view's `level` event); `index.plan_ms` and
 *     `index.level_ready` go to the product-event channel and the output channel;
 *   - shutdown (`shutdownKnowledge`) waits for every root to be quiet, including a slice in flight, before stores close.
 */

import * as vscode from "vscode";
import { logLine } from "../errorReporter";
import { osPowerSource, type PowerSourcePort } from "../power/powerSource";
import { emitProductEvent } from "../telemetry/productEvents";
import { beforeKnowledgeShutdown } from "./folderKnowledge";
import { onRunStarted } from "./activeRuns";
import { ActivityGate, realClock, type Clock } from "./indexBudget";
import { hostIndexPorts } from "./indexHostPorts";
import { publishIndexLevel, registerBackgroundPreemptor, registerL3Requester, setIndexerWatching } from "./indexLevels";
import { PRIORITY } from "./indexScheduler";
import { PathCoalescer } from "./indexWatcher";
import { registerL3Runner } from "./l3Tasks";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { pathKey, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, workspaceFolders } from "./knowledgeService";
import { RootIndexer, type IndexRootPorts, type IndexTelemetry } from "./rootIndexer";
import { AUTO_INDEX_SETTING, autoIndexOn, indexesFolder, visualizerSessions } from "./visualizerSession";

/** How often the tick looks for a pending L3 request, the sweep and a queued L3 task. */
export const L3_CHECK_MS = 30_000;
/** Refocus reconciles at most this often (a focus flicker is not a reason to walk again). */
const REFOCUS_MIN_MS = 5_000;
/** The editor priorities are re-read at most this often between editor events. */
const PRIORITY_TTL_MS = 1_000;
/** Documents whose typing pauses the indexer: files and untitled buffers (not the output channel, which "types" itself). */
const TYPED_SCHEMES: ReadonlySet<string> = new Set(["file", "untitled"]);

/** What one root needs from the host: injected so the composition is tested without an extension host. */
export interface IndexerHost {
  folders(): Array<{ path: string }>;
  rootFor(folderPath: string, folders: Array<{ path: string }>): KnowledgeRoot | undefined;
  /** Whether this folder's root is indexed now (`visualizerSession.indexesFolder`). Absent ⇒ every folder. */
  includes?(root: KnowledgeRoot): boolean;
  ports(root: KnowledgeRoot): IndexRootPorts & { dispose(): void };
  /** Watches the root's folder; returns the unsubscribe. */
  watch(rootPath: string, cb: (absPaths: string[]) => void): () => void;
  /** Editor paths (slashed), for priorities: files in visible editors, and files open in tabs. */
  editors(): { visible: string[]; open: string[] };
  power: PowerSourcePort;
  clock: Clock;
  /** Calls back when an agent/chat run starts (`activeRuns.ts`); returns the unsubscribe. Absent ⇒ never. */
  runStarted?(listener: () => void): () => void;
  telemetry(root: KnowledgeRoot): IndexTelemetry;
  log(what: string, error: unknown): void;
}

interface HeldRoot { root: KnowledgeRoot; indexer: RootIndexer; ports: IndexRootPorts & { dispose(): void }; stopWatch: () => void; unregister: () => void }

/** The indexer over every workspace folder. Host events reach it through its methods; {@link dispose} waits for quiet. */
export class BackgroundIndexer {
  private readonly roots = new Map<string, HeldRoot>();
  private readonly gate: ActivityGate;
  private readonly coalescer: PathCoalescer;
  private l3Timer: unknown;
  private stopL3Runner: (() => void) | undefined;
  private stopRunWatch: (() => void) | undefined;
  private focused = true;
  private lastRefocus = Number.NEGATIVE_INFINITY;
  private editorKeys: { at: number; open: Set<string>; visible: Set<string>; openPaths: string[] } | undefined;
  private disposing: Promise<void> | undefined;

  constructor(private readonly host: IndexerHost) {
    this.gate = new ActivityGate(host.clock, () => { for (const h of this.roots.values()) void h.indexer.resume(); });
    this.coalescer = new PathCoalescer(host.clock, (rootId, paths) => { void this.roots.get(rootId)?.indexer.edited(paths); });
  }

  start(focused: boolean): void {
    this.focused = focused;
    this.gate.focus(focused);
    const tick = (): void => {
      // A pending request, the sweep, then ONE queued L3 task of the root (the run delta's analyzer phase): nothing unrequested.
      for (const h of this.roots.values()) void h.indexer.tick(h.root.rootPath).catch((error: unknown) => this.host.log("index tick", error));
      this.l3Timer = this.host.clock.setTimeout(tick, L3_CHECK_MS);
    };
    this.l3Timer = this.host.clock.setTimeout(tick, L3_CHECK_MS);
    this.stopL3Runner = registerL3Runner(() => [...this.roots.values()].map((h) => h.root.rootPath));
    // An agent/chat run that starts mid-pass stops the long pass at once (with the L3 worker, terminating it); it stays owed.
    this.stopRunWatch = this.host.runStarted?.(() => { for (const h of this.roots.values()) h.indexer.pauseL3(); });
    this.syncFolders();
  }

  get rootIds(): string[] { return [...this.roots.keys()]; }

  /** The person typed: the queues yield, and a running long pass stops (it reruns when quiet). */
  keystroke(): void {
    this.gate.keystroke();
    for (const h of this.roots.values()) h.indexer.pauseLongPass();
  }

  activity(): void { this.gate.activity(); }

  editorsChanged(): void { this.editorKeys = undefined; }

  windowFocus(focused: boolean): void {
    const was = this.focused;
    this.focused = focused;
    this.gate.focus(focused);
    // Watchers drop events (B2 step 5): every refocus runs the reconciling plan.
    const now = this.host.clock.now();
    if (focused && !was && now - this.lastRefocus >= REFOCUS_MIN_MS) {
      this.lastRefocus = now;
      for (const h of this.roots.values()) void h.indexer.reconcile();
    }
  }

  /** One indexer per included workspace folder: new (or newly running) folders start and reconcile, removed ones stop. */
  syncFolders(): void {
    if (this.disposing) return;
    const folders = this.host.folders();
    const wanted = new Map<string, KnowledgeRoot>();
    for (const f of folders) {
      const root = this.host.rootFor(f.path, folders);
      if (root && root.rel === "" && (this.host.includes?.(root) ?? true)) wanted.set(root.rootId, root);
    }
    for (const [rootId, held] of [...this.roots]) if (!wanted.has(rootId)) void this.stopRoot(rootId, held);
    for (const [rootId, root] of wanted) if (!this.roots.has(rootId)) this.startRoot(root);
  }

  private startRoot(root: KnowledgeRoot): void {
    const ports = this.host.ports(root);
    const indexer = new RootIndexer({
      ports, clock: this.host.clock, gate: this.gate, power: this.host.power,
      priorityOf: (rel) => this.priorityOf(`${root.rootPath}/${rel}`),
      openPaths: () => this.openUnder(root.rootPath),
      publish: publishIndexLevel,
      telemetry: this.host.telemetry(root),
      log: (what, error) => this.host.log(`index ${what}`, error),
    });
    const stopWatch = this.host.watch(root.rootPath, (paths) => this.coalescer.push(root, paths));
    const stopPreempt = registerBackgroundPreemptor(root.rootId, () => indexer.preempt());
    const stopRequests = registerL3Requester(root.rootId, { request: (scope, opts) => indexer.requestL3(scope, opts), withdraw: (scope) => indexer.withdrawL3(scope) });
    this.roots.set(root.rootId, { root, indexer, ports, stopWatch, unregister: () => { stopPreempt(); stopRequests(); } });
    setIndexerWatching(root.rootId, true);
    void indexer.reconcile();
  }

  private async stopRoot(rootId: string, held: HeldRoot): Promise<void> {
    this.roots.delete(rootId);
    held.stopWatch();
    held.unregister();
    try {
      await held.indexer.dispose();
    } finally {
      held.ports.dispose();
      // Only once nothing of this indexer writes any more: the live view's own watcher takes over from here — unless the
      // root was started again meanwhile (a folder removed and re-added), whose new indexer is the root's watcher.
      if (!this.roots.has(rootId)) setIndexerWatching(rootId, false);
    }
  }

  /** Files open in editors first, then visible ones, then everything else (B6 scheduling 1, 2, 5). */
  private priorityOf(absPath: string): number {
    const keys = this.editors();
    const key = pathKey(absPath);
    if (keys.open.has(key)) return PRIORITY.open;
    if (keys.visible.has(key)) return PRIORITY.visible;
    return PRIORITY.rest;
  }

  /** The editors' paths, re-read at most every {@link PRIORITY_TTL_MS} (or after an editor event): ONE read serves every lookup. */
  private editors(): NonNullable<BackgroundIndexer["editorKeys"]> {
    const now = this.host.clock.now();
    if (!this.editorKeys || now - this.editorKeys.at > PRIORITY_TTL_MS) {
      const { visible, open } = this.host.editors();
      this.editorKeys = { at: now, open: new Set(open.map((p) => pathKey(p))), visible: new Set(visible.map((p) => pathKey(p))), openPaths: open.map((p) => p.replace(/\\/g, "/")) };
    }
    return this.editorKeys;
  }

  /** The files open in editors under `rootPath`, root-relative (the near level's seeds, B6 scheduling 3). */
  private openUnder(rootPath: string): string[] {
    const base = `${rootPath.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
    const baseKey = `${pathKey(base)}/`; // `pathKey` drops the trailing slash: put it back, so `/root2` is not under `/root`
    return this.editors().openPaths.filter((p) => pathKey(p).startsWith(baseKey)).map((p) => p.slice(base.length));
  }

  /** Stops every root and resolves once all are quiet: no reconcile, no long pass, no slice in flight. */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      if (this.l3Timer !== undefined) this.host.clock.clearTimeout(this.l3Timer);
      this.l3Timer = undefined;
      this.stopL3Runner?.(); // what is still queued runs now, ungated: it is never lost
      this.stopL3Runner = undefined;
      this.stopRunWatch?.();
      this.stopRunWatch = undefined;
      this.coalescer.dispose();
      this.gate.dispose();
      await Promise.all([...this.roots].map(([rootId, held]) => this.stopRoot(rootId, held)));
    })();
    return this.disposing;
  }
}

/** The VS Code host of the indexer. */
function vscodeIndexerHost(secrets: vscode.SecretStorage): IndexerHost {
  const watchFs = vscodeKnowledgeFs({ watchDebounceMs: 0 }); // the coalescer settles bursts at its own 100 ms
  return {
    folders: workspaceFolders,
    rootFor: rootForPath,
    includes: indexesFolder,
    ports: (root) => hostIndexPorts(secrets, root),
    watch: (rootPath, cb) => watchFs.watch?.(rootPath, cb) ?? (() => undefined),
    editors: () => ({
      visible: vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath),
      open: vscode.window.tabGroups.all.flatMap((g) => g.tabs).flatMap((t) => (t.input instanceof vscode.TabInputText ? [t.input.uri.fsPath] : [])),
    }),
    power: osPowerSource(),
    clock: realClock,
    runStarted: (listener) => onRunStarted(listener),
    telemetry: (root) => (name, props) => {
      emitProductEvent(name, { surface: "vsix", ...props });
      logLine(`[index] ${root.title}: ${name} ${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    },
    log,
  };
}

/** Wires VS Code's events into a running indexer; returns their disposables. */
function wireEvents(indexer: BackgroundIndexer): vscode.Disposable[] {
  return [
    vscode.workspace.onDidChangeWorkspaceFolders(() => indexer.syncFolders()),
    vscode.workspace.onDidChangeTextDocument((e) => { if (e.contentChanges.length > 0 && TYPED_SCHEMES.has(e.document.uri.scheme)) indexer.keystroke(); }),
    vscode.window.onDidChangeTextEditorSelection(() => indexer.activity()),
    vscode.window.onDidChangeActiveTextEditor(() => { indexer.activity(); indexer.editorsChanged(); }),
    vscode.window.onDidChangeVisibleTextEditors(() => indexer.editorsChanged()),
    vscode.window.tabGroups.onDidChangeTabs(() => indexer.editorsChanged()),
    vscode.window.onDidChangeWindowState((state) => indexer.windowFocus(state.focused)),
  ];
}

/**
 * Wires the background indexer to when knowledge runs (`visualizerSession.ts`): nothing starts here at activation; the
 * indexer starts when a Visualizer's Run makes a root run (or `builderforce.knowledge.autoIndex` is turned on), follows the
 * running roots' folders, and stops when none runs and the setting is off. Shutdown (`shutdownKnowledge`, also run by
 * deactivation) waits for it to be quiet before the stores close; the returned disposable stops it too.
 */
export function startBackgroundIndexer(context: Pick<vscode.ExtensionContext, "secrets">): vscode.Disposable {
  let running: { indexer: BackgroundIndexer; events: vscode.Disposable[] } | undefined;
  /** The last stop, still settling or settled: every caller (the dispose, the setting, shutdown) awaits the SAME quiet. */
  let stopping: Promise<void> = Promise.resolve();
  const stop = (): Promise<void> => {
    const held = running;
    running = undefined;
    if (held) {
      for (const d of held.events) d.dispose();
      stopping = held.indexer.dispose();
    }
    return stopping;
  };
  /** Knowledge runs somewhere: the opt-in setting, or a root a Visualizer is running. */
  const wanted = (): boolean => autoIndexOn() || visualizerSessions.runningRoots().length > 0;
  const apply = (): void => {
    try {
      if (wanted() && !running) {
        const indexer = new BackgroundIndexer(vscodeIndexerHost(context.secrets));
        running = { indexer, events: wireEvents(indexer) };
        indexer.start(vscode.window.state.focused);
      } else if (wanted() && running) {
        // Another root started or stopped running: the folders indexed follow it.
        running.indexer.syncFolders();
      } else if (!wanted() && running) {
        void stop().catch((error: unknown) => log("background indexer stop", error));
      }
    } catch (error) {
      log("background indexer start", error);
    }
  };
  const config = vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`builderforce.${AUTO_INDEX_SETTING}`)) apply(); });
  const sessions = visualizerSessions.onChange(apply);
  // Stays registered for the process: whichever runs first, the dispose below or `shutdownKnowledge`, the shutdown
  // still awaits the stop in flight before the stores close.
  beforeKnowledgeShutdown(stop);
  // Only the opt-in starts it here; without it nothing runs until a Visualizer's Run.
  apply();
  return { dispose: () => { config.dispose(); sessions(); void stop().catch(() => undefined); } };
}
