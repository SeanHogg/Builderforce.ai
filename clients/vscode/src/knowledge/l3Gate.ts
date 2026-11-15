/**
 * One root's L3 gate (PRD 41 B6, §12.3). The heavy analyzers' pass runs ON DEMAND ONLY — never on its own because a session
 * started or files changed: a person opening the knowledge view on the root (or on one of its sub-folder roots) asks for it
 * ({@link L3Gate.request}, through `requestL3` in `indexLevels.ts`), and closing the view withdraws the ask
 * ({@link L3Gate.withdraw}); a review and the chat code actions run their own analysis (`l3SharedAnalysis.ts`). A request:
 *
 *   - names a SCOPE: `""` is the whole root (`ports.mapPass` with analyzers), a relative path is the sub-folder root there
 *     (`ports.subRootPass`, scoped to it — never the whole folder's analysis);
 *   - has nothing to do when the last completed pass saw this tree (the persisted sha, `l3Persist.ts`) and nothing changed since;
 *   - is refused while the crash guard quarantines the root — or, for a sub-folder root, it or its folder (`l3CrashGuard.ts`) —
 *     and one output-channel line says why;
 *   - starts when no other pass holds the root, no review of the person's runs, no agent run is active and the person is not
 *     typing — otherwise it stays requested, and the indexer's tick ({@link L3Gate.retryRequested}) starts it once the person
 *     has been idle for {@link L3_IDLE_MAINS_MS} (so typing in bursts never restarts it every tick); a keystroke or a starting
 *     agent run stops it the same way;
 *   - is done when its pass completes AND every analyzer measured: a pass whose analyzer failed (the review records it in
 *     `analyzerStatus` and goes on) is a FAILED pass — logged, not marked done, not L3-ready.
 *
 * Attempts are single-flight: a request, the tick and a reconcile's end never start two passes. The queued L3 tasks
 * (`l3Tasks.ts`: the run delta's analyzer phase — an agent run asked for them) still run on the idle and mains-power gate
 * ({@link L3Gate.runL3Task}), as does the once-per-session fact-store sweep. Split out of `rootIndexer.ts`; the indexer owns
 * the levels and hands the gate what it reads through {@link L3GateHost}.
 */

import { L3_IDLE_MAINS_MS, mayRunL3 } from "./indexBudget";
import { ALL_FACT_KINDS, type FactKind, type IndexLevel, type L3Wait } from "./indexLevels";
import type { PassGuard } from "./indexPasses";
import type { IndexPlan } from "./indexReconcile";
import { L3Tracker } from "./l3Persist";
import { L3Requests, type L3RequestOptions, type L3Ticket } from "./l3Requests";
import { requeueL3Task, takeL3Task } from "./l3Tasks";
import type { RootIndexerDeps } from "./rootIndexer";

/** What the gate reads of its indexer. */
export interface L3GateHost {
  deps: Pick<RootIndexerDeps, "gate" | "power" | "ports" | "log" | "clock">;
  passes: PassGuard;
  disposed(): boolean;
  reconciling(): boolean;
  sliceBusy(): boolean;
  ready(): IndexLevel | null;
  lastPlan(): IndexPlan | undefined;
  setWorking(level: IndexLevel | null): void;
  emit(): void;
  handover(): Promise<void>;
  factsChanged(paths: readonly string[], kinds: readonly FactKind[]): Promise<void>;
  levelReady(level: IndexLevel, since: number): void;
}

/** One scope's attempt: it ended (answered), or the root is not free and it stays requested. */
type Attempt = "settled" | "wait";

export class L3Gate {
  /** What a person asked for and how it settled, and the single-flight drive (`l3Requests.ts`). */
  private readonly requests = new L3Requests((direct) => this.attemptAll(direct), (error) => this.host.deps.log("L3 request", error));
  /** The sub-folder scopes whose pass completed since the last change. */
  private readonly currentScopes = new Set<string>();
  /**
   * The whole root's analysis may be stale since the session started: true until a pass completes, or the persisted sha says
   * the last completed pass already saw this tree (only THIS staleness is vetoed by it).
   */
  private staleSinceStart = true;
  /** Something CHANGED since the last completed pass (a file edit, a map pass): the sha never vetoes it. */
  private changedSince = false;
  /** The ask the attempt in progress took up. */
  private ask: L3Ticket | undefined;
  waiting: L3Wait | undefined;
  private sweptOnce = false;

  /** Present when the root persists what L3 completed (`l3Persist.ts`): the sha says whether a request has work to do. */
  private readonly tracker: L3Tracker | undefined;

  constructor(private readonly host: L3GateHost) {
    const { l3State } = host.deps.ports;
    this.tracker = l3State ? new L3Tracker(l3State) : undefined;
  }

  /** Whether a request waits to run. */
  get pending(): boolean { return this.requests.size > 0; }

  /** The tree changed (an edit, a map pass): the next request runs a pass whatever the sha says. Starts nothing. */
  changed(): void {
    this.changedSince = true;
    this.currentScopes.clear();
  }

  /** Nothing else runs on the root and the person is not typing: a long pass may start. */
  quietForLongPass(): boolean {
    const h = this.host;
    return !h.disposed() && !h.passes.running && !h.passes.held() && !h.reconciling() && !h.sliceBusy() && !h.deps.gate.pausedBy();
  }

  /**
   * A person asked for L3 on `scope` (`""`: the root; else its sub-folder root there): runs the pass now when it has work and
   * may start; else it stays requested. True when that scope's analysis is current at the end (it ran, or had nothing to do).
   * An `explicit` ask (the retry command) runs a pass even when the analysis looks current.
   */
  async request(scope = "", opts: L3RequestOptions = {}): Promise<boolean> {
    this.requests.add(scope, opts);
    await this.requests.drive(true);
    return this.requests.answer(scope);
  }

  /** The person no longer looks (the knowledge view closed): a request not started yet is dropped — never an explicit one. */
  withdraw(scope = ""): void {
    this.requests.withdraw(scope);
    if (this.requests.size === 0 && this.waiting) { this.waiting = undefined; this.host.emit(); }
  }

  /**
   * Starts pending requests when the root allows it: the tick and every later reconcile (`direct` false: only after
   * {@link L3_IDLE_MAINS_MS} idle) and the session's FIRST reconcile (`direct` true: the levels just became ready). Joins an
   * attempt already in progress.
   */
  retryRequested(direct = false): Promise<void> {
    return this.requests.size === 0 ? Promise.resolve() : this.requests.drive(direct);
  }

  /**
   * The idle hook's housekeeping: the fact store's sweep (`ports.sweepFacts`, §B4) — at most ONCE per session per root,
   * only when the person is idle and nothing else runs on the root (a short long-pass a keystroke stops; it then retries
   * at the next idle check). The port itself skips a store whose version has not moved since its last sweep. True when it ran.
   */
  async maybeSweep(): Promise<boolean> {
    const { deps } = this.host;
    if (this.sweptOnce || !deps.ports.sweepFacts || !this.quietForLongPass() || deps.gate.idleForMs() < L3_IDLE_MAINS_MS || deps.ports.busy?.()) return false;
    try {
      const outcome = await this.host.passes.run("sweep", () => deps.ports.sweepFacts!());
      if ("aborted" in outcome) return false;
      this.sweptOnce = true;
      return true;
    } catch (error) {
      deps.log("fact store sweep", error);
      this.sweptOnce = true; // a failing sweep is not retried this session
      return false;
    }
  }

  /** Runs ONE queued L3 task of this root (an agent run asked for it) on the idle and mains-power gate; true when one ran to the end. */
  async runL3Task(rootPath: string): Promise<boolean> {
    const { deps } = this.host;
    if (!this.quietForLongPass() || deps.gate.idleForMs() < L3_IDLE_MAINS_MS || deps.ports.busy?.() || deps.ports.agentBusy?.()) return false;
    if (!mayRunL3(await deps.power.current(), deps.gate.idleForMs()) || !this.quietForLongPass() || deps.ports.agentBusy?.()) return false;
    const task = takeL3Task(rootPath);
    if (!task) return false;
    try {
      const outcome = await this.host.passes.run("l3", (signal) => task.run(signal));
      if ("aborted" in outcome) { requeueL3Task(task); return false; }
      return true;
    } catch (error) {
      deps.log("L3 task", error);
      return false;
    }
  }

  /** Every pending scope in turn (the whole root first), until one finds the root not free. */
  private async attemptAll(direct: boolean): Promise<void> {
    for (const scope of this.requests.scopes()) {
      if (!this.requests.has(scope)) continue; // withdrawn meanwhile
      if ((await this.attempt(scope, direct)) === "wait") return;
    }
  }

  private async attempt(scope: string, direct: boolean): Promise<Attempt> {
    const { deps } = this.host;
    // The ask this attempt takes up (attempts are single-flight): an ask that comes meanwhile is not settled by it.
    this.ask = this.requests.ticket(scope);
    if (!this.mayLookAtL3()) return "wait";
    if (!direct && deps.gate.idleForMs() < L3_IDLE_MAINS_MS) return "wait";
    if (deps.ports.busy?.() || deps.ports.agentBusy?.()) return this.wait("busy");
    if (this.tracker) {
      const verdict = await this.tracker.verdict();
      if (verdict !== "unknown") this.staleSinceStart = verdict === "owed";
      // A quarantined root is refused before anything starts (the guard logs why, once): a later request asks again.
      if (await this.tracker.blocked(scope || undefined)) return this.settle(scope, false);
    }
    const current = scope ? this.currentScopes.has(scope) : !this.staleSinceStart && !this.changedSince;
    if (current && !this.ask?.explicit) return this.settle(scope, true); // the retry command forces a pass
    if (scope && !deps.ports.subRootPass) {
      deps.log("L3 analyzers", `no sub-folder pass for ${scope} on this host`);
      return this.settle(scope, false);
    }
    // Anything may have started during the git reads — an agent run included.
    if (!this.mayLookAtL3() || deps.ports.busy?.() || deps.ports.agentBusy?.()) return this.wait("busy");
    return this.runPass(scope);
  }

  /** The requested pass itself. Stopped ⇒ still requested; failed (thrown, or an analyzer that failed) ⇒ logged, and the request ends. */
  private async runPass(scope: string): Promise<Attempt> {
    const { deps } = this.host;
    this.waiting = undefined;
    this.host.setWorking(3);
    this.host.emit();
    const started = deps.clock.now();
    // An explicit ask runs the analyzers afresh: no cached analysis stands in for them.
    const fresh = this.ask?.explicit === true;
    let bailed = false;
    try {
      const outcome = await this.host.passes.run("l3", async (signal) => {
        await this.host.handover();
        // An agent run may have started while the pass waited for its turn.
        if (deps.ports.agentBusy?.()) { bailed = true; return { changed: [] as string[] }; }
        return scope
          ? { changed: [] as string[], ...(await deps.ports.subRootPass!(scope, signal, { fresh })) }
          : deps.ports.mapPass(this.host.lastPlan()!, { analyzers: true, signal, ...(fresh ? { fresh } : {}) });
      });
      if (bailed || this.host.disposed() || "aborted" in outcome) return "wait"; // still requested: it reruns when the root is quiet
      const failures = outcome.value.analyzerFailures ?? [];
      if (failures.length > 0) {
        // The review records an analyzer failure and goes on; for L3 it is a failed pass: never marked done, never L3-ready.
        deps.log("L3 analyzers", new Error(failures.join("; ")));
        return this.settle(scope, false);
      }
      if (scope) {
        this.currentScopes.add(scope);
        return this.settle(scope, true);
      }
      this.staleSinceStart = false;
      this.changedSince = false;
      this.tracker?.completed();
      this.settle(scope, true);
      // The analysis moved even when no file did: the derived step always reruns, for every kind.
      await this.host.factsChanged(outcome.value.changed, ALL_FACT_KINDS);
      this.host.levelReady(3, started);
      return "settled";
    } catch (error) {
      deps.log("L3 analyzers", error);
      return this.settle(scope, false);
    } finally {
      this.host.setWorking(null);
      this.host.emit();
    }
  }

  /** The cheap conditions of a start: the levels are there and nothing else runs on the root. */
  private mayLookAtL3(): boolean {
    const ready = this.host.ready();
    return this.quietForLongPass() && !!this.host.lastPlan() && ready !== null && ready >= 2;
  }

  private settle(scope: string, current: boolean): Attempt {
    this.requests.settle(scope, current, this.ask);
    if (this.requests.size === 0 && this.waiting) { this.waiting = undefined; this.host.emit(); }
    return "settled";
  }

  private wait(reason: L3Wait): Attempt {
    if (reason !== this.waiting) { this.waiting = reason; this.host.emit(); }
    return "wait";
  }
}
