/**
 * WHEN the editor's chat-sync pass runs (`chatSyncHost.ts` decides WHAT a pass does).
 *
 * Single-flight: a trigger during a pass asks for ONE more pass after it (`again`), never two at
 * once. Debounced: writes arrive in bursts. And a pass that stopped with work left says when the
 * next may start (`resumeAt`: a 429's `Retry-After`, or the tenant's request bucket at its
 * reserve) — nothing runs before then: not a queued `again`, not a store-change trigger, not the
 * heartbeat. The next pass is left to the timer, which fires at `resumeAt`.
 */
/** The longest delay `setTimeout` honours. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
export function createPassScheduler(ports) {
    const now = ports.now ?? Date.now;
    const setTimer = ports.setTimer ?? ((run, ms) => setTimeout(run, ms));
    const clearTimer = ports.clearTimer ?? ((timer) => clearTimeout(timer));
    let running = false;
    let again = false;
    let disposed = false;
    let resumeAt;
    let timer;
    const deferred = () => resumeAt !== undefined && resumeAt > now();
    const schedule = () => {
        if (disposed || !ports.enabled())
            return;
        if (timer !== undefined)
            clearTimer(timer);
        // Clamped to what a timer can hold (2^31-1 ms): a longer delay would fire at once instead.
        const delay = Math.min(MAX_TIMER_MS, Math.max(ports.debounceMs, (resumeAt ?? 0) - now()));
        timer = setTimer(() => {
            timer = undefined;
            void run();
        }, delay);
    };
    const run = async () => {
        if (disposed)
            return;
        if (running) {
            again = true;
            return;
        }
        // Deferred by the last pass: not before `resumeAt` — the timer comes back then.
        if (deferred()) {
            schedule();
            return;
        }
        running = true;
        try {
            do {
                again = false;
                const outcome = await ports.pass();
                resumeAt = outcome?.resumeAt;
            } while (again && !disposed && !deferred());
        }
        catch (error) {
            ports.onError(error);
        }
        finally {
            running = false;
        }
        // Work left (deferred), or a trigger that arrived while deferred: the timer takes it.
        if (resumeAt !== undefined || again)
            schedule();
    };
    return {
        schedule,
        run,
        resumeAt: () => resumeAt,
        running: () => running,
        dispose() {
            disposed = true;
            if (timer !== undefined)
                clearTimer(timer);
            timer = undefined;
        },
    };
}
//# sourceMappingURL=syncPassScheduler.js.map