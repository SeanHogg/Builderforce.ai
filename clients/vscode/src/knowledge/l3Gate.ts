/**
 * One root's L3 gate (PRD 41 B6, §12.3): the bundled analyzers' pass and the queued L3 tasks (`l3Tasks.ts`: the run delta's
 * analyzer phase) run only when the person is idle and on mains power, no review of theirs runs and no other pass holds
 * the root — as a long pass a keystroke stops (it reruns when the gate opens again). Split out of `rootIndexer.ts`; the
 * indexer owns the levels and hands the gate what it reads through {@link L3GateHost}.
 */

import { L3_IDLE_MAINS_MS, mayRunL3 } from "./indexBudget";
import { ALL_FACT_KINDS, type FactKind, type IndexLevel, type L3Wait } from "./indexLevels";
import type { PassGuard } from "./indexPasses";
import type { IndexPlan } from "./indexReconcile";
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

export class L3Gate {
  /** The first cycle of a session runs the analyzers once (they cache by input). */
  owed = true;
  waiting: L3Wait | undefined;
  private sweptOnce = false;

  constructor(private readonly host: L3GateHost) {}

  /** Nothing else runs on the root and the person is not typing: a long pass may start. */
  quietForLongPass(): boolean {
    const h = this.host;
    return !h.disposed() && !h.passes.running && !h.passes.held() && !h.reconciling() && !h.sliceBusy() && !h.deps.gate.pausedBy();
  }

  /** Runs L3 when it is owed and its gate is open; true when it ran to the end. */
  async maybeRunL3(): Promise<boolean> {
    const { deps } = this.host;
    if (!this.mayStart()) return false;
    // Idle first: the power source is asked only when L3 could start on it.
    if (deps.gate.idleForMs() < L3_IDLE_MAINS_MS) return this.wait("idle-wait");
    if (deps.ports.busy?.()) return this.wait("busy");
    const power = await deps.power.current();
    // Anything may have started during the power query.
    if (!this.mayStart()) return false;
    if (!mayRunL3(power, deps.gate.idleForMs())) return this.wait(power === "battery" ? "battery" : "idle-wait");
    this.waiting = undefined;
    this.host.setWorking(3);
    this.host.emit();
    const started = deps.clock.now();
    try {
      const outcome = await this.host.passes.run("l3", async (signal) => {
        await this.host.handover();
        return deps.ports.mapPass(this.host.lastPlan()!, { analyzers: true, signal });
      });
      if (this.host.disposed() || "aborted" in outcome) return false; // still owed: it reruns when the gate opens again
      this.owed = false;
      // The analysis moved even when no file did: the derived step always reruns, for every kind.
      await this.host.factsChanged(outcome.value.changed, ALL_FACT_KINDS);
      this.host.levelReady(3, started);
      return true;
    } catch (error) {
      deps.log("L3 analyzers", error);
      return false;
    } finally {
      this.host.setWorking(null);
      this.host.emit();
    }
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

  /** Runs ONE queued L3 task of this root under the same gate; true when one ran to the end. */
  async runL3Task(rootPath: string): Promise<boolean> {
    const { deps } = this.host;
    if (!this.quietForLongPass() || deps.gate.idleForMs() < L3_IDLE_MAINS_MS || deps.ports.busy?.()) return false;
    if (!mayRunL3(await deps.power.current(), deps.gate.idleForMs()) || !this.quietForLongPass()) return false;
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

  private mayStart(): boolean {
    const ready = this.host.ready();
    return this.owed && this.quietForLongPass() && !!this.host.lastPlan() && ready !== null && ready >= 2;
  }

  private wait(reason: L3Wait): false {
    if (reason !== this.waiting) { this.waiting = reason; this.host.emit(); }
    return false;
  }
}
