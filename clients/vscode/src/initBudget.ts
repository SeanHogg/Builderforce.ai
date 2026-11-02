import { withinMs } from "./contextPack/withinMs";
import { logLine } from "./errorReporter";

/**
 * How long ONE slow step of the panel's `init` (token, project names, personality, model
 * route, local models, editor context, pending changes) is waited on. The panel shows
 * "Connecting…" until the first `init` lands, so no step may hold it for a network
 * timeout: a step past its budget degrades to a safe value and the frame is re-pushed
 * once it lands.
 */
export const INIT_STEP_BUDGET_MS = 2_500;

export interface InitBudget {
  /**
   * `work`, waited on for at most the budget; `fallback` when it is late or fails.
   * `answered` tells a real answer from a soft failure that FULFILS with a degraded value
   * (a mint that resolves `undefined`, a personality fetch that returns `""` offline): only
   * a real answer that lands late re-pushes, or a hung gateway would re-push forever.
   */
  step<T>(name: string, work: Promise<T>, fallback: T, answered?: (value: T) => boolean): Promise<T>;
  /** At-most-once re-push trigger, also handed to other late sources (the grounding). */
  late(): void;
  /** Whether any step went past its budget in this build. */
  hadLate(): boolean;
}

/**
 * How many late re-pushes one surface may chain before a build completes with every step
 * on time: each re-push is a new build that can itself run late, and a gateway that
 * answers slower than the budget would otherwise keep the panel re-rendering.
 */
export const MAX_LATE_REPUSHES = 3;

export interface LateRepushLimit {
  /** Whether another late re-push may go out (and counts it). */
  allow(): boolean;
  /** A build finished; one with no late step resets the count. */
  built(hadLate: boolean): void;
  /** Start afresh: a user- or host-initiated push (not itself a late re-push). */
  reset(): void;
}

export function createLateRepushLimit(max: number = MAX_LATE_REPUSHES): LateRepushLimit {
  let used = 0;
  return {
    allow: () => used < max && ++used > 0,
    built: (hadLate) => { if (!hadLate) used = 0; },
    reset: () => { used = 0; },
  };
}

/**
 * Budget the steps of ONE init build. A step that exceeds its budget is logged by name
 * (`[init] <step> not ready after <n>ms`) and again when it finally lands, so the next
 * stall names itself; the first late REAL answer fires `onLate` (once per build). A step
 * that fails late, or lands a soft failure (`answered` false), stays quiet — it would
 * only fail again on the re-push. Chained re-pushes are capped by {@link createLateRepushLimit}.
 */
export function createInitBudget(onLate?: () => void, budgetMs: number = INIT_STEP_BUDGET_MS): InitBudget {
  let fired = false;
  let anyLate = false;
  const late = (): void => {
    if (fired || !onLate) return;
    fired = true;
    onLate();
  };
  return {
    late,
    hadLate: () => anyLate,
    async step<T>(name: string, work: Promise<T>, fallback: T, answered: (value: T) => boolean = () => true): Promise<T> {
      const started = Date.now();
      let settled = false;
      const landed = work.then(
        (value) => { settled = true; return answered(value); },
        (error: unknown) => { settled = true; logLine(`[init] ${name} failed: ${error instanceof Error ? error.message : String(error)}`); return false; },
      );
      const value = await withinMs(work, budgetMs, fallback);
      if (!settled) {
        anyLate = true;
        logLine(`[init] ${name} not ready after ${Date.now() - started}ms`);
        void landed.then((ok) => {
          if (!ok) return;
          logLine(`[init] ${name} landed after ${Date.now() - started}ms`);
          late();
        });
      }
      return value;
    },
  };
}
