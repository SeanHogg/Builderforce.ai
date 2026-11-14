import { withinMs } from "./contextPack/withinMs";
import { hostLog } from "./hostLog";
/**
 * How long ONE slow step of the panel's `init` (token, project names, personality, model
 * route, local models, editor context, pending changes) is waited on. The panel shows
 * "Connecting…" until the first `init` lands, so no step may hold it for a network
 * timeout: a step past its budget degrades to a safe value and the frame is re-pushed
 * once it lands.
 */
export const INIT_STEP_BUDGET_MS = 2_500;
/**
 * How many late re-pushes one surface may chain before a build completes with every step
 * on time: each re-push is a new build that can itself run late, and a gateway that
 * answers slower than the budget would otherwise keep the panel re-rendering.
 */
export const MAX_LATE_REPUSHES = 3;
export function createLateRepushLimit(max = MAX_LATE_REPUSHES) {
    let used = 0;
    return {
        allow: () => used < max && ++used > 0,
        built: (hadLate) => { if (!hadLate)
            used = 0; },
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
export function createInitBudget(onLate, budgetMs = INIT_STEP_BUDGET_MS) {
    let fired = false;
    let anyLate = false;
    const late = () => {
        if (fired || !onLate)
            return;
        fired = true;
        onLate();
    };
    return {
        late,
        hadLate: () => anyLate,
        async step(name, work, fallback, answered = () => true) {
            const started = Date.now();
            let settled = false;
            const landed = work.then((value) => { settled = true; return answered(value); }, (error) => { settled = true; hostLog(`[init] ${name} failed: ${error instanceof Error ? error.message : String(error)}`); return false; });
            const value = await withinMs(work, budgetMs, fallback);
            if (!settled) {
                anyLate = true;
                hostLog(`[init] ${name} not ready after ${Date.now() - started}ms`);
                void landed.then((ok) => {
                    if (!ok)
                        return;
                    hostLog(`[init] ${name} landed after ${Date.now() - started}ms`);
                    late();
                });
            }
            return value;
        },
    };
}
//# sourceMappingURL=initBudget.js.map