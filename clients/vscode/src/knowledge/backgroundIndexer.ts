/**
 * The background indexer's composition root (PRD 41 B6, B2 step 5, §6 "Open a folder, offline" / "Edit a file", §12.3):
 * every workspace folder is a root with its own {@link RootIndexer}; this wires them to VS Code and nothing else.
 *
 *   - `builderforce.knowledge.autoIndex` (default on) starts and stops it;
 *   - activation, a new workspace folder and every window refocus run a reconciling plan (watchers drop events);
 *   - one FileSystemWatcher per folder (`vscodeKnowledgeFs().watch`, which already drops `.builderforce/cache/**`)
 *     feeds the 100 ms coalescer (`indexWatcher.ts`);
 *   - a keystroke (a file or an untitled document) pauses the queue AND stops a running long pass, which reruns when the
 *     person is quiet; the window unfocused for 10 minutes pauses it (`indexBudget.ts`);
 *   - files open in editors first, then visible ones;
 *   - a person's review, Retry or Exclude preempts the root's pass (`preemptBackground`);
 *   - L3 is offered every {@link L3_CHECK_MS}; it runs only when idle and on mains power (`powerSource.ts`);
 *   - level status goes to the bus (`indexLevels.ts`, the knowledge view's `level` event); `index.plan_ms` and
 *     `index.level_ready` go to the product-event channel and the output channel;
 *   - shutdown (`shutdownKnowledge`) waits for every root to be quiet, including a slice in flight, before stores close.
 */

import * as vscode from "vscode";
import { logLine } from "../errorReporter";
import { osPowerSource, type PowerSourcePort } from "../power/powerSource";
import { emitProductEvent } from "../telemetry/productEvents";
import { beforeKnowledgeShutdown } from "./folderKnowledge";
import { ActivityGate, realClock, type Clock } from "./indexBudget";
import { hostIndexPorts } from "./indexHostPorts";
import { publishIndexLevel, registerBackgroundPreemptor, setIndexerWatching } from "./indexLevels";
import { PRIORITY } from "./indexScheduler";
import { PathCoalescer } from "./indexWatcher";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { pathKey, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, workspaceFolders } from "./knowledgeService";
import { RootIndexer, type IndexRootPorts, type IndexTelemetry } from "./rootIndexer";

/** `builderforce.knowledge.autoIndex`. */
export const AUTO_INDEX_SETTING = "knowledge.autoIndex";
/** How often an owed L3 pass checks its gate. */
export const L3_CHECK_MS = 30_000;
/** Refocus reconciles at most this often (a focus flicker is not a reason to walk again). */
const REFOCUS_MIN_MS = 5_000;
/** The editor priorities are re-read at most this often between editor events. */
const PRIORITY_TTL_MS = 1_000;
/** Documents whose typing pauses the indexer: files and untitled buffers (not the output channel, which "types" itself). */
const TYPED_SCHEMES: ReadonlySet<string> = new Set(["file", "untitled"]);

const autoIndexOn = (): boolean => vscode.workspace.getConfiguration("builderforce").get<boolean>(AUTO_INDEX_SETTING, true) !== false;

/** What one root needs from the host: injected so the composition is tested without an extension host. */
export interface IndexerHost {
  folders(): Array<{ path: string }>;
  rootFor(folderPath: string, folders: Array<{ path: string }>): KnowledgeRoot | undefined;
  ports(root: KnowledgeRoot): IndexRootPorts & { dispose(): void };
  /** Watches the root's folder; returns the unsubscribe. */
  watch(rootPath: string, cb: (absPaths: string[]) => void): () => void;
  /** Editor paths (slashed), for priorities: files in visible editors, and files open in tabs. */
  editors(): { visible: string[]; open: string[] };
  power: PowerSourcePort;
  clock: Clock;
  telemetry(root: KnowledgeRoot): IndexTelemetry;
  log(what: string, error: unknown): void;
}

interface HeldRoot { root: KnowledgeRoot; indexer: RootIndexer; ports: IndexRootPorts & { dispose(): void }; stopWatch: () => void; stopPreempt: () => void }

/** The indexer over every workspace folder. Host events reach it through its methods; {@link dispose} waits for quiet. */
export class BackgroundIndexer {
  private readonly roots = new Map<string, HeldRoot>();
  private readonly gate: ActivityGate;
  private readonly coalescer: PathCoalescer;
  private l3Timer: unknown;
  private focused = true;
  private lastRefocus = Number.NEGATIVE_INFINITY;
  private editorKeys: { at: number; open: Set<string>; visible: Set<string> } | undefined;
  private disposing: Promise<void> | undefined;

  constructor(private readonly host: IndexerHost) {
    this.gate = new ActivityGate(host.clock, () => { for (const h of this.roots.values()) void h.indexer.resume(); });
    this.coalescer = new PathCoalescer(host.clock, (rootId, paths) => { void this.roots.get(rootId)?.indexer.edited(paths); });
  }

  start(focused: boolean): void {
    this.focused = focused;
    this.gate.focus(focused);
    const tick = (): void => {
      for (const h of this.roots.values()) void h.indexer.maybeRunL3();
      this.l3Timer = this.host.clock.setTimeout(tick, L3_CHECK_MS);
    };
    this.l3Timer = this.host.clock.setTimeout(tick, L3_CHECK_MS);
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

  /** One indexer per workspace folder: new folders start (and reconcile), removed ones stop. */
  syncFolders(): void {
    if (this.disposing) return;
    const folders = this.host.folders();
    const wanted = new Map<string, KnowledgeRoot>();
    for (const f of folders) {
      const root = this.host.rootFor(f.path, folders);
      if (root && root.rel === "") wanted.set(root.rootId, root);
    }
    for (const [rootId, held] of [...this.roots]) if (!wanted.has(rootId)) void this.stopRoot(rootId, held);
    for (const [rootId, root] of wanted) if (!this.roots.has(rootId)) this.startRoot(root);
  }

  private startRoot(root: KnowledgeRoot): void {
    const ports = this.host.ports(root);
    const indexer = new RootIndexer({
      ports, clock: this.host.clock, gate: this.gate, power: this.host.power,
      priorityOf: (rel) => this.priorityOf(`${root.rootPath}/${rel}`),
      publish: publishIndexLevel,
      telemetry: this.host.telemetry(root),
      log: (what, error) => this.host.log(`index ${what}`, error),
    });
    const stopWatch = this.host.watch(root.rootPath, (paths) => this.coalescer.push(root, paths));
    const stopPreempt = registerBackgroundPreemptor(root.rootId, () => indexer.preempt());
    this.roots.set(root.rootId, { root, indexer, ports, stopWatch, stopPreempt });
    setIndexerWatching(root.rootId, true);
    void indexer.reconcile();
  }

  private async stopRoot(rootId: string, held: HeldRoot): Promise<void> {
    this.roots.delete(rootId);
    held.stopWatch();
    held.stopPreempt();
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
    const now = this.host.clock.now();
    if (!this.editorKeys || now - this.editorKeys.at > PRIORITY_TTL_MS) {
      const { visible, open } = this.host.editors();
      this.editorKeys = { at: now, open: new Set(open.map((p) => pathKey(p))), visible: new Set(visible.map((p) => pathKey(p))) };
    }
    const key = pathKey(absPath);
    if (this.editorKeys.open.has(key)) return PRIORITY.open;
    if (this.editorKeys.visible.has(key)) return PRIORITY.visible;
    return PRIORITY.rest;
  }

  /** Stops every root and resolves once all are quiet: no reconcile, no long pass, no slice in flight. */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      if (this.l3Timer !== undefined) this.host.clock.clearTimeout(this.l3Timer);
      this.l3Timer = undefined;
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
    ports: (root) => hostIndexPorts(secrets, root),
    watch: (rootPath, cb) => watchFs.watch?.(rootPath, cb) ?? (() => undefined),
    editors: () => ({
      visible: vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath),
      open: vscode.window.tabGroups.all.flatMap((g) => g.tabs).flatMap((t) => (t.input instanceof vscode.TabInputText ? [t.input.uri.fsPath] : [])),
    }),
    power: osPowerSource(),
    clock: realClock,
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
 * Starts the background indexer when `builderforce.knowledge.autoIndex` is on, and follows the setting. Shutdown
 * (`shutdownKnowledge`, also run by deactivation) waits for it to be quiet before the stores close; the returned
 * disposable stops it too.
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
  const apply = (): void => {
    if (autoIndexOn() && !running) {
      const indexer = new BackgroundIndexer(vscodeIndexerHost(context.secrets));
      running = { indexer, events: wireEvents(indexer) };
      indexer.start(vscode.window.state.focused);
    } else if (!autoIndexOn() && running) {
      void stop().catch((error: unknown) => log("background indexer stop", error));
    }
  };
  const config = vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`builderforce.${AUTO_INDEX_SETTING}`)) apply(); });
  // Stays registered for the process: whichever runs first, the dispose below or `shutdownKnowledge`, the shutdown
  // still awaits the stop in flight before the stores close.
  beforeKnowledgeShutdown(stop);
  try {
    apply();
  } catch (error) {
    log("background indexer start", error);
  }
  return { dispose: () => { config.dispose(); void stop().catch(() => undefined); } };
}
