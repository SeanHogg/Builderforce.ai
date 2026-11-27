import type { Skill } from "@seanhogg/builderforce-memory-engine";
import type { SkillRunner } from "./skillRunner";

/**
 * The routine scheduler: every 30 s it looks for skills whose routine is due and runs
 * the first one (least recently run first, as the engine orders them) with trigger
 * `routine`. It does nothing while agents are off or a run is already active, so a
 * routine never queues behind or interrupts a person's own run. Disposable.
 */

export const TICK_MS = 30_000;

export interface RoutineSchedulerDeps {
  /** `builderforce.agents.enabled`. */
  enabled(): boolean;
  runner: Pick<SkillRunner, "active" | "start">;
  /** The skills due now (`skillsDue` over the store). */
  due(): Promise<Skill[]>;
  report(error: unknown, operation: string): void;
  /** Timer seam; defaults to the global timers. */
  timers?: {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
  };
}

export interface RoutineScheduler {
  /** One pass (what the timer runs); exposed for tests. */
  tick(): Promise<void>;
  dispose(): void;
}

export function createRoutineScheduler(deps: RoutineSchedulerDeps): RoutineScheduler {
  const timers = deps.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  };
  let ticking = false;

  async function tick(): Promise<void> {
    if (ticking || !deps.enabled() || deps.runner.active) return;
    ticking = true;
    try {
      const [first] = await deps.due();
      if (!first) return;
      const started = await deps.runner.start({ skillId: first.id, trigger: "routine" });
      if (!started.ok) deps.report(new Error(started.error), "routineScheduler:start");
    } catch (error) {
      deps.report(error, "routineScheduler:tick");
    } finally {
      ticking = false;
    }
  }

  const handle = timers.setInterval(() => void tick(), TICK_MS);
  return {
    tick,
    dispose: () => timers.clearInterval(handle),
  };
}
