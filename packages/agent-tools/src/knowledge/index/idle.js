/**
 * The knowledge index's idle work — re-embedding after a fingerprint change, compaction
 * after churn, persistence — runs when the host is quiet, never on a query's path. A
 * debounced timer: each new request pushes the run back, so a burst of saves costs one
 * pass. The timer never holds the process open.
 */
/** The default quiet period before the idle pass. */
export const KNOWLEDGE_IDLE_MS = 5_000;
export function debouncedIdle(delayMs = KNOWLEDGE_IDLE_MS, onError) {
    let timer;
    let running;
    let next;
    const fire = () => {
        timer = undefined;
        const task = next;
        next = undefined;
        if (!task)
            return;
        // One pass at a time: a request during a pass re-arms after it.
        running = (running ?? Promise.resolve())
            .then(task)
            .catch((e) => onError?.(e))
            .finally(() => { running = undefined; });
    };
    return (task) => {
        next = task;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(fire, delayMs);
        timer.unref?.();
    };
}
//# sourceMappingURL=idle.js.map