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
  runner: Pick<SkillRunner, "active" | "start" | "blockedElsewhere">;
  /** The helper can run here (a repeat tick on an unsupported system does nothing). */
  supported(): Promise<boolean>;
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
  /** The last failure reported: the same one repeating every 30 s is reported once. */
  let lastFailure: string | undefined;

  const fail = (error: unknown, operation: string): void => {
    const key = `${operation}:${error instanceof Error ? error.message : String(error)}`;
    if (key === lastFailure) return;
    lastFailure = key;
    deps.report(error, operation);
  };

  async function tick(): Promise<void> {
    if (ticking || !deps.enabled() || deps.runner.active) return;
    ticking = true;
    try {
      if (!(await deps.supported())) return;
      // Another window is running a skill: leave the routine due for a later tick.
      if (await deps.runner.blockedElsewhere()) return;
      const [first] = await deps.due();
      if (!first) return;
      const started = await deps.runner.start({ skillId: first.id, trigger: "routine" });
      if (started.ok) lastFailure = undefined;
      else fail(new Error(started.error), "routineScheduler:start");
    } catch (error) {
      fail(error, "routineScheduler:tick");
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
