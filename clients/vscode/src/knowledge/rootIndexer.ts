/**
 * One root's background indexing (PRD 41 B6, §6 "Open a folder, offline" and "Edit a file") — pure over ports:
 *
 *   reconcile  — the reconciling plan (L0) → open/visible changed files first (L1, through the edited-file queue when the
 *                root has a manifest) → the whole-tree map pass once the person is quiet (L1), with the fact graph's sync
 *                (`syncFacts`) in the same pass → `onFactsChanged` (L2) → L3 owed. A plan that found nothing moved still
 *                syncs the fact graph ONCE per session (the `facts` long pass): it lives in memory, so a reload starts empty;
 *   edits      — watcher batches go to a priority queue drained in ≤50 ms slices that yield on a keystroke; each slice
 *                re-extracts its files (`extractEdited`: unchanged content is an early cutoff, nothing more runs) and hands
 *                the changed ones to `onFactsChanged` (L2). A batch over {@link BULK_EDIT_FILES} (a branch switch) goes to
 *                the reconcile and its map pass instead. A file the manifest does not know asks for a reconcile — only when
 *                the plan would list it, and at most once per {@link UNKNOWN_RECONCILE_MS};
 *   L3         — the analyzers' pass and queued L3 tasks, only when their gate opens (`l3Gate.ts`, §12.3).
 *
 * Long passes (`indexPasses.ts`) have their own abort signal: a keystroke stops one (it reruns when quiet), a person's
 * review preempts one ({@link RootIndexer.preempt}), and slices and passes never run on the root at the same time.
 *
 * `onFactsChanged(changedPaths, changedKinds)` is the ONE step after facts change: the incremental FactRule evaluator
 * (WS4, `factIndex.ts`) has run in the ports' extract step, and `changedKinds` are the fact kinds that really moved
 * (a comment edit moves only `content`). Queue priorities: `nearPriority.ts`.
 */

import type { PowerSourcePort } from "../power/powerSource";
import { BULK_EDIT_FILES, LONG_PASS_IDLE_MS, PREEMPT_HOLD_MAX_MS, UNKNOWN_RECONCILE_MS, type ActivityGate, type Clock } from "./indexBudget";
import { ALL_FACT_KINDS, type FactKind, type IndexLevel, type IndexLevelStatus, type IndexPauseReason } from "./indexLevels";
import { PassGuard } from "./indexPasses";
import type { IndexPlan } from "./indexReconcile";
import { IndexQueue, PRIORITY, SliceRunner } from "./indexScheduler";
import { L3Gate } from "./l3Gate";
import type { L3StatePort } from "./l3Persist";
import { NearPriority } from "./nearPriority";

/** What one step of the fact graph moved. */
export interface FactsMoved { changedPaths: readonly string[]; changedKinds: readonly FactKind[] }

export interface IndexRootPorts {
  rootId: string;
  /** The reconciling plan (L0). */
  plan(): Promise<IndexPlan>;
  /**
   * Re-extracts edited files: `changed` had new content, `unreviewed` are not in the manifest. `changedKinds` are the
   * fact kinds that moved (PRD 41 §B1, from the fact graph's kind hashes); absent ⇒ every kind.
   */
  extractEdited(paths: readonly string[]): Promise<{ changed: string[]; unreviewed: string[]; changedKinds?: readonly FactKind[] }>;
  /** A map-only pass of the review over `plan` (L1); with `analyzers` the bundled analyzers run too (L3). Returns the paths it extracted and, when known, the kinds that moved. */
  mapPass(plan: IndexPlan, opts: { analyzers: boolean; signal: AbortSignal }): Promise<{ changed: string[]; changedKinds?: readonly FactKind[] }>;
  /** The fact graph catches up with the plan's whole listing (extracts what moved, drops what is gone). Absent ⇒ no fact graph. */
  syncFacts?(plan: IndexPlan, signal: AbortSignal): Promise<FactsMoved>;
  /** Sweeps the fact store's unreferenced objects (run from the L3 gate's idle hook, once per session). Absent ⇒ no store. */
  sweepFacts?(): Promise<number>;
  /** The step after facts changed (L2): the incremental FactRule evaluator has run; the graph's readers re-read. */
  onFactsChanged(changedPaths: readonly string[], changedKinds: readonly FactKind[]): Promise<void>;
  /** The files within 2 import hops of these (B6 scheduling 3), by the root's current facts. Absent ⇒ no near level. */
  near?(seeds: readonly string[]): ReadonlySet<string>;
  /** A review of the root is running (the person's): long passes wait for it. */
  busy?(): boolean;
  /** An agent/chat run is executing: only L3 (the analyzers, seconds of CPU) waits for it. */
  agentBusy?(): boolean;
  /** What L3 completed, kept across restarts (`l3Persist.ts`). Absent ⇒ L3 is owed afresh every session. */
  l3State?: L3StatePort;
  /** Files the root's recent commits touched (`git log -n 200`): queued ahead of the rest (B6 scheduling 4). */
  recent?(): Promise<ReadonlySet<string>>;
  /** Of these unknown paths, the ones the plan would list (not ignored, not under a skipped folder). Absent ⇒ all. */
  wouldList?(paths: readonly string[]): Promise<string[]>;
  /** Resolves once the live view's own watcher has no batch in flight on the root (bounded): awaited before the first write. */
  liveIdle?(): Promise<void>;
}

export type IndexTelemetry = (name: "index.level_ready" | "index.plan_ms", props: Record<string, number | string>) => void;

export interface RootIndexerDeps {
  ports: IndexRootPorts;
  clock: Clock;
  gate: Pick<ActivityGate, "pausedBy" | "idleForMs">;
  power: PowerSourcePort;
  /** The file's queue priority (open in an editor, visible, …) — {@link PRIORITY}. */
  priorityOf(path: string): number;
  /** Root-relative paths of the files open in editors: the seeds of the near level. Absent ⇒ no near level. */
  openPaths?(): readonly string[];
  publish(status: IndexLevelStatus): void;
  telemetry: IndexTelemetry;
  log(what: string, error: unknown): void;
  /** How often a long pass re-checks that the person is quiet. */
  quietPollMs?: number;
}

/** How long `dispose` waits for a plan walk in progress. */
export const DISPOSE_PLAN_WAIT_MS = 2_000;

const union = (...lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())].sort();

export class RootIndexer {
  private readonly queue = new IndexQueue();
  private readonly runner: SliceRunner;
  private readonly passes: PassGuard;
  private readonly l3: L3Gate;
  private readonly near: NearPriority;
  private ready: IndexLevel | null = null;
  private working: IndexLevel | null = null;
  private files: number | undefined;
  private lastPlan: IndexPlan | undefined;
  private reconciling: Promise<void> | undefined;
  private reconcileAgain = false;
  /** The last long pass was aborted: the next cycle waits for quiet before it plans again. */
  private resumeAfterAbort = false;
  /** The fact graph caught up with a whole listing this session. */
  private factsSynced = false;
  private cycleStart = 0;
  private planned = false;
  private recent: ReadonlySet<string> = new Set();
  /** The hand-over from the live view's own watcher: waited for once, before this indexer's first write on the root. */
  private liveHandover: Promise<void> | undefined;
  private lastUnknownReconcile = Number.NEGATIVE_INFINITY;
  private unknownTimer: unknown;
  private disposed = false;

  constructor(private readonly deps: RootIndexerDeps) {
    this.runner = new SliceRunner(this.queue, {
      clock: deps.clock,
      pausedBy: () => this.pausedBy(),
      work: (batch) => this.editedSlice(batch),
      onDrained: () => { if (!this.passes.running) this.working = null; this.emit(); },
      onPaused: () => this.emit(),
      onError: (error) => deps.log("index slice", error),
    });
    this.passes = new PassGuard(deps.clock, () => this.runner.settled(), () => { if (!this.disposed) void this.runner.kick(); });
    this.near = new NearPriority({
      priorityOf: (p) => deps.priorityOf(p),
      ...(deps.openPaths ? { openPaths: () => deps.openPaths!() } : {}),
      ...(deps.ports.near ? { near: (seeds: readonly string[]) => deps.ports.near!(seeds) } : {}),
    });
    this.l3 = new L3Gate({
      deps, passes: this.passes,
      disposed: () => this.disposed, reconciling: () => !!this.reconciling, sliceBusy: () => this.runner.busy,
      ready: () => this.ready, lastPlan: () => this.lastPlan,
      setWorking: (level) => { this.working = level; }, emit: () => this.emit(), handover: () => this.handover(),
      factsChanged: (paths, kinds) => this.factsChanged(paths, kinds), levelReady: (level, since) => this.levelReady(level, since),
    });
  }

  get rootId(): string { return this.deps.ports.rootId; }

  /** The reconciling plan and the levels after it. Coalesces: a call while one runs runs once more after it. */
  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.reconciling) { this.reconcileAgain = true; return this.reconciling; }
    const loop = async (): Promise<void> => {
      do {
        this.reconcileAgain = false;
        if (this.resumeAfterAbort && !(await this.whenQuiet())) return;
        this.resumeAfterAbort = false;
        await this.reconcileOnce().catch((error: unknown) => this.deps.log("reconcile", error));
      } while (this.reconcileAgain && !this.disposed);
    };
    this.reconciling = loop().finally(() => { this.reconciling = undefined; this.working = null; this.emit(); });
    return this.reconciling;
  }

  /** Watcher batch (root-relative paths): queued by priority and drained in slices; a bulk batch goes to the reconcile. */
  edited(paths: readonly string[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (paths.length > BULK_EDIT_FILES) return this.reconcile();
    for (const p of paths) this.queue.push(p, this.priorityOf(p));
    this.emit();
    return this.runner.kick();
  }

  /** The gate opened again (typing stopped, focus returned): the queue resumes. */
  resume(): Promise<void> {
    this.emit();
    return this.runner.kick();
  }

  /** A keystroke: the long pass running now stops at once; it reruns when the person is quiet. */
  pauseLongPass(): void {
    this.passes.abort();
  }

  /** An agent run started: a running L3 pass (and queued L3 task) stops; the map and facts passes carry on. */
  pauseL3(): void {
    this.passes.abortKind("l3");
  }

  /**
   * A person's review needs the root: the long pass stops, and this resolves once it has, with the release of the hold that
   * keeps new passes off until the person's review holds the root itself (see `preemptBackground`).
   */
  preempt(): Promise<() => void> {
    return this.passes.preempt(PREEMPT_HOLD_MAX_MS);
  }

  /**
   * The L3 gate's idle check (`l3Gate.ts`): runs L3 when it is owed and its gate is open (true when it ran to the end), then
   * the once-per-session fact-store sweep when the root is still idle and quiet.
   */
  async maybeRunL3(): Promise<boolean> {
    const ran = await this.l3.maybeRunL3();
    await this.l3.maybeSweep();
    return ran;
  }

  /** Runs ONE queued L3 task of this root under the L3 gate; true when one ran to the end (`l3Gate.ts`). */
  runL3Task(rootPath: string): Promise<boolean> {
    return this.l3.runL3Task(rootPath);
  }

  status(): IndexLevelStatus {
    const paused = this.queue.size > 0 ? this.pausedBy() : undefined;
    return {
      rootId: this.rootId,
      ready: this.ready,
      working: this.working,
      pending: this.queue.size,
      ...(this.files !== undefined ? { files: this.files } : {}),
      ...(paused ? { paused } : {}),
      ...(this.l3.owed && this.l3.waiting ? { l3Waiting: this.l3.waiting } : {}),
    };
  }

  /**
   * Stops everything and resolves once nothing writes: the long pass and the slice in flight are awaited to their end.
   * A plan walk in progress (it cannot be aborted, and writes only its stat rows, whose failed save is logged) is awaited
   * at most {@link DISPOSE_PLAN_WAIT_MS}.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.unknownTimer !== undefined) this.deps.clock.clearTimeout(this.unknownTimer);
    this.passes.dispose();
    this.runner.stop();
    const quiet = <T>(p: Promise<T> | undefined): Promise<unknown> => (p ?? Promise.resolve()).catch(() => undefined);
    const planWait = new Promise<void>((resolve) => { this.deps.clock.setTimeout(resolve, DISPOSE_PLAN_WAIT_MS); });
    await Promise.all([quiet(this.passes.settled()), quiet(this.runner.settled()), Promise.race([quiet(this.reconciling), planWait])]);
  }

  private handover(): Promise<void> {
    return (this.liveHandover ??= (this.deps.ports.liveIdle?.() ?? Promise.resolve()).catch((error: unknown) => this.deps.log("live hand-over", error)));
  }

  private pausedBy(): IndexPauseReason | undefined {
    return this.deps.gate.pausedBy() ?? (this.passes.running ? "pass" : undefined);
  }

  private emit(): void {
    if (!this.disposed) this.deps.publish(this.status());
  }

  private priorityOf(path: string): number {
    return this.near.priorityOf(path, this.recent);
  }

  /** The L2 step; the near level re-reads the import graph only when `structure` moved. */
  private async factsChanged(paths: readonly string[], kinds: readonly FactKind[] | undefined): Promise<void> {
    const moved = kinds ?? ALL_FACT_KINDS;
    await this.deps.ports.onFactsChanged(paths, moved);
    this.near.factsChanged(moved);
  }

  /** A level reached. Telemetry only when the level actually changed (a refocus that finds nothing new reports nothing). */
  private levelReady(level: IndexLevel, since: number = this.cycleStart): void {
    const changed = this.ready !== level;
    this.ready = level;
    if (changed) this.deps.telemetry("index.level_ready", { level, ms: Math.max(0, this.deps.clock.now() - since), files: this.files ?? 0 });
    this.emit();
  }

  /** A long pass was stopped: what it did not finish is still owed; the reconcile reruns when quiet. */
  private passAborted(): void {
    this.resumeAfterAbort = true;
    this.reconcileAgain = true;
  }

  private async reconcileOnce(): Promise<void> {
    this.cycleStart = this.deps.clock.now();
    this.working = 0;
    this.emit();
    // Read beside the plan, never waited on by it: a slow or absent git only loses the ordering hint.
    void this.deps.ports.recent?.().then((r) => { this.recent = r; }, (error: unknown) => this.deps.log("recent commits", error));
    const plan = await this.deps.ports.plan();
    if (this.disposed) return;
    this.lastPlan = plan;
    this.files = plan.files;
    const moved = plan.changed.length > 0 || plan.removed.length > 0;
    if (!this.planned || moved) this.deps.telemetry("index.plan_ms", { ms: plan.ms, files: plan.files, changed: plan.changed.length });
    this.planned = true;
    if (!moved) {
      // Nothing moved since the manifest: the knowledge and what is derived from it are current (L3 stays as it was)…
      if (this.ready === null || this.ready < 2) { this.levelReady(0); this.levelReady(1); this.levelReady(2); }
      // …but the fact graph lives in memory: once per session it catches up with the listing, as a long pass.
      if (!this.factsSynced && this.deps.ports.syncFacts) await this.factsPass(plan);
      return;
    }
    this.levelReady(0);
    this.working = 1;
    // Open and visible files first: a reviewed root re-extracts them through the edited-file queue right away.
    if (plan.reviewed) {
      // Only files the manifest knows: a new one has no reviewed hash to re-extract against and waits for the map pass.
      const first = plan.changed.filter((p) => plan.detail.prior.has(p) && this.priorityOf(p) <= PRIORITY.visible);
      if (first.length > 0) await this.edited(first);
    }
    // The whole tree waits until the person is quiet (and no review of theirs runs): it is the long pass.
    if (!(await this.whenQuiet())) return;
    const outcome = await this.passes.run("map", async (signal) => {
      await this.handover();
      const map = await this.deps.ports.mapPass(plan, { analyzers: false, signal });
      const facts = signal.aborted || !this.deps.ports.syncFacts ? undefined : await this.deps.ports.syncFacts(plan, signal);
      return { map, facts };
    });
    if (this.disposed) return;
    if ("aborted" in outcome) { this.passAborted(); return; }
    this.levelReady(1);
    this.working = 2;
    this.emit();
    const { map, facts } = outcome.value;
    if (facts) this.factsSynced = true;
    // The knowledge graph's sources moved (content); the fact graph says which kinds of facts did.
    const kinds = facts ? ALL_FACT_KINDS.filter((k) => k === "content" || facts.changedKinds.includes(k)) : map.changedKinds;
    await this.factsChanged(union(map.changed, plan.removed, facts?.changedPaths ?? []), kinds);
    this.l3.owed = true;
    this.levelReady(2);
  }

  /** The once-per-session fact-graph sync of an unchanged tree: a long pass after quiet, reported through the L2 step. */
  private async factsPass(plan: IndexPlan): Promise<void> {
    if (!(await this.whenQuiet())) return;
    this.working = 2;
    this.emit();
    const outcome = await this.passes.run("facts", async (signal) => { await this.handover(); return this.deps.ports.syncFacts!(plan, signal); });
    if (this.disposed) return;
    if ("aborted" in outcome) { this.passAborted(); return; }
    this.factsSynced = true;
    const { changedPaths, changedKinds } = outcome.value;
    if (changedPaths.length > 0 || changedKinds.length > 0) await this.factsChanged(changedPaths, changedKinds);
  }

  /** Resolves true once the person is quiet, no review runs, no preemption holds and no pass (an L3) runs; false when disposed meanwhile. */
  private async whenQuiet(): Promise<boolean> {
    const poll = this.deps.quietPollMs ?? 500;
    while (!this.disposed) {
      const quiet = !this.deps.gate.pausedBy() && this.deps.gate.idleForMs() >= LONG_PASS_IDLE_MS && !this.passes.held() && !this.passes.running
        && !this.deps.ports.busy?.();
      if (quiet) return true;
      await new Promise<void>((resolve) => { this.deps.clock.setTimeout(resolve, poll); });
    }
    return false;
  }

  private async editedSlice(batch: string[]): Promise<void> {
    this.working = 1;
    this.emit();
    await this.handover();
    if (this.disposed) return;
    const { changed, unreviewed, changedKinds } = await this.deps.ports.extractEdited(batch);
    if (this.disposed) return;
    if (unreviewed.length > 0) void this.unknownPaths(unreviewed);
    // Early cutoff: content unchanged ⇒ no facts moved ⇒ nothing derived reruns.
    if (changed.length === 0) return;
    this.working = 2;
    this.emit();
    await this.factsChanged(changed, changedKinds);
    this.l3.owed = true;
    if (this.ready === 3) this.ready = 2;
  }

  /**
   * Files the manifest does not know (new, or a root never mapped): a reconcile picks them up — only for files the plan
   * would list (an ignored build output or a file under a skipped folder never walks the tree), and at most once per
   * {@link UNKNOWN_RECONCILE_MS}; later ones in the window share one reconcile at its end.
   */
  private async unknownPaths(paths: readonly string[]): Promise<void> {
    const listed = this.deps.ports.wouldList ? await this.deps.ports.wouldList(paths).catch((error: unknown) => { this.deps.log("would list", error); return [...paths]; }) : paths;
    if (listed.length === 0 || this.disposed || this.unknownTimer !== undefined) return;
    const wait = this.lastUnknownReconcile + UNKNOWN_RECONCILE_MS - this.deps.clock.now();
    const go = (): void => {
      this.unknownTimer = undefined;
      this.lastUnknownReconcile = this.deps.clock.now();
      void this.reconcile();
    };
    if (wait <= 0) go();
    else this.unknownTimer = this.deps.clock.setTimeout(go, wait);
  }
}
