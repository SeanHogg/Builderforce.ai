/**
 * One root's background indexing (PRD 41 B6, §6 "Open a folder, offline" and "Edit a file") — pure over ports:
 *
 *   reconcile  — the reconciling plan (L0) → open/visible changed files first (L1, through the edited-file queue when the
 *                root has a manifest) → the whole-tree map pass once the person is quiet (L1) → `onFactsChanged` (L2)
 *                → L3 owed;
 *   edits      — watcher batches go to a priority queue drained in ≤50 ms slices that yield on a keystroke; each slice
 *                re-extracts its files (`extractEdited`: unchanged content is an early cutoff, nothing more runs) and hands
 *                the changed ones to `onFactsChanged` (L2). A batch over {@link BULK_EDIT_FILES} (a branch switch) goes to
 *                the reconcile and its map pass instead. A file the manifest does not know asks for a reconcile — only when
 *                the plan would list it, and at most once per {@link UNKNOWN_RECONCILE_MS};
 *   L3         — the analyzers' pass, only when its gate opens (idle and on mains power, §12.3).
 *
 * Long passes (`indexPasses.ts`) have their own abort signal: a keystroke stops one (it reruns when quiet), a person's
 * review preempts one ({@link RootIndexer.preempt}), and slices and passes never run on the root at the same time.
 *
 * `onFactsChanged(changedPaths, changedKinds)` is the ONE step after facts change: the seam the incremental FactRule
 * evaluator (WS4) plugs into.
 */

import type { PowerSourcePort } from "../power/powerSource";
import {
  BULK_EDIT_FILES, L3_IDLE_MAINS_MS, LONG_PASS_IDLE_MS, mayRunL3, PREEMPT_HOLD_MAX_MS, UNKNOWN_RECONCILE_MS, type ActivityGate, type Clock,
} from "./indexBudget";
import { ALL_FACT_KINDS, type FactKind, type IndexLevel, type IndexLevelStatus, type IndexPauseReason, type L3Wait } from "./indexLevels";
import { PassGuard } from "./indexPasses";
import type { IndexPlan } from "./indexReconcile";
import { IndexQueue, PRIORITY, SliceRunner } from "./indexScheduler";

export interface IndexRootPorts {
  rootId: string;
  /** The reconciling plan (L0). */
  plan(): Promise<IndexPlan>;
  /** Re-extracts edited files: `changed` had new content (their facts moved), `unreviewed` are not in the manifest. */
  extractEdited(paths: readonly string[]): Promise<{ changed: string[]; unreviewed: string[] }>;
  /** A map-only pass of the review over `plan` (L1); with `analyzers` the bundled analyzers run too (L3). Returns the paths it extracted. */
  mapPass(plan: IndexPlan, opts: { analyzers: boolean; signal: AbortSignal }): Promise<{ changed: string[] }>;
  /** The step after facts changed (L2): today the findings path; WS4's incremental FactRule evaluator plugs in here. */
  onFactsChanged(changedPaths: readonly string[], changedKinds: readonly FactKind[]): Promise<void>;
  /** A review of the root is running (the person's): long passes wait for it. */
  busy?(): boolean;
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
  publish(status: IndexLevelStatus): void;
  telemetry: IndexTelemetry;
  log(what: string, error: unknown): void;
  /** How often a long pass re-checks that the person is quiet. */
  quietPollMs?: number;
}

/** How long `dispose` waits for a plan walk in progress. */
export const DISPOSE_PLAN_WAIT_MS = 2_000;

export class RootIndexer {
  private readonly queue = new IndexQueue();
  private readonly runner: SliceRunner;
  private readonly passes: PassGuard;
  private ready: IndexLevel | null = null;
  private working: IndexLevel | null = null;
  private files: number | undefined;
  private lastPlan: IndexPlan | undefined;
  private reconciling: Promise<void> | undefined;
  private reconcileAgain = false;
  /** The last map pass was aborted: the next cycle waits for quiet before it plans again. */
  private resumeAfterAbort = false;
  private l3Owed = true; // the first cycle of a session runs the analyzers once (they cache by input)
  private l3Waiting: L3Wait | undefined;
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

  /**
   * A person's review needs the root: the long pass stops, and this resolves once it has, with the release of the hold that
   * keeps new passes off until the person's review holds the root itself (see `preemptBackground`).
   */
  preempt(): Promise<() => void> {
    return this.passes.preempt(PREEMPT_HOLD_MAX_MS);
  }

  /** Runs L3 when it is owed and its gate is open; true when it ran to the end. */
  async maybeRunL3(): Promise<boolean> {
    if (!this.mayStartL3()) return false;
    const idle = this.deps.gate.idleForMs();
    // Idle first: the power source is asked only when L3 could start on it.
    if (idle < L3_IDLE_MAINS_MS) return this.waitL3("idle-wait");
    if (this.deps.ports.busy?.()) return this.waitL3("busy");
    const power = await this.deps.power.current();
    // Anything may have started during the power query.
    if (!this.mayStartL3()) return false;
    if (!mayRunL3(power, this.deps.gate.idleForMs())) return this.waitL3(power === "battery" ? "battery" : "idle-wait");
    this.l3Waiting = undefined;
    this.working = 3;
    this.emit();
    const started = this.deps.clock.now();
    try {
      const outcome = await this.passes.run("l3", async (signal) => {
        await this.handover();
        return this.deps.ports.mapPass(this.lastPlan!, { analyzers: true, signal });
      });
      if (this.disposed || "aborted" in outcome) return false; // still owed: it reruns when the gate opens again
      this.l3Owed = false;
      // The analysis moved even when no file did: the derived step always reruns.
      await this.deps.ports.onFactsChanged(outcome.value.changed, ALL_FACT_KINDS);
      this.levelReady(3, started);
      return true;
    } catch (error) {
      this.deps.log("L3 analyzers", error);
      return false;
    } finally {
      this.working = null;
      this.emit();
    }
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
      ...(this.l3Owed && this.l3Waiting ? { l3Waiting: this.l3Waiting } : {}),
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

  private mayStartL3(): boolean {
    return !this.disposed && this.l3Owed && !this.passes.running && !this.passes.held() && !this.reconciling && !this.runner.busy
      && !!this.lastPlan && this.ready !== null && this.ready >= 2 && !this.deps.gate.pausedBy();
  }

  private waitL3(reason: L3Wait): false {
    if (reason !== this.l3Waiting) { this.l3Waiting = reason; this.emit(); }
    return false;
  }

  private emit(): void {
    if (!this.disposed) this.deps.publish(this.status());
  }

  /** The editor's priority (open, visible), else recently committed, else the rest. */
  private priorityOf(path: string): number {
    const editor = this.deps.priorityOf(path);
    return this.recent.has(path) ? Math.min(editor, PRIORITY.recent) : editor;
  }

  /** A level reached. Telemetry only when the level actually changed (a refocus that finds nothing new reports nothing). */
  private levelReady(level: IndexLevel, since: number = this.cycleStart): void {
    const changed = this.ready !== level;
    this.ready = level;
    if (changed) this.deps.telemetry("index.level_ready", { level, ms: Math.max(0, this.deps.clock.now() - since), files: this.files ?? 0 });
    this.emit();
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
      // Nothing moved since the manifest: the facts and what is derived from them are current (L3 stays as it was).
      if (this.ready === null || this.ready < 2) { this.levelReady(0); this.levelReady(1); this.levelReady(2); }
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
      return this.deps.ports.mapPass(plan, { analyzers: false, signal });
    });
    if (this.disposed) return;
    if ("aborted" in outcome) {
      // A keystroke or a person's review stopped it: what it did not finish is still owed; rerun when quiet.
      this.resumeAfterAbort = true;
      this.reconcileAgain = true;
      return;
    }
    this.levelReady(1);
    this.working = 2;
    this.emit();
    await this.deps.ports.onFactsChanged([...new Set([...outcome.value.changed, ...plan.removed])].sort(), ALL_FACT_KINDS);
    this.l3Owed = true;
    this.levelReady(2);
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
    const { changed, unreviewed } = await this.deps.ports.extractEdited(batch);
    if (this.disposed) return;
    if (unreviewed.length > 0) void this.unknownPaths(unreviewed);
    // Early cutoff: content unchanged ⇒ no facts moved ⇒ nothing derived reruns.
    if (changed.length === 0) return;
    this.working = 2;
    this.emit();
    await this.deps.ports.onFactsChanged(changed, ALL_FACT_KINDS);
    this.l3Owed = true;
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
