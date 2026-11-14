/**
 * The ONE latest-wins throttle for posts to the view (PRD 41 A10 rule 8): `emit()` sends at once when
 * {@link RUN_POST_INTERVAL_MS} has passed since the last send, else once at the interval's end. The
 * sender reads the latest state itself, so a burst of emits costs one post. No I/O: the clock and timers
 * are the globals a test fakes.
 */
/** At most 10 posts a second. */
export const RUN_POST_INTERVAL_MS = 100;
export function throttledEmit(send, intervalMs = RUN_POST_INTERVAL_MS) {
    let lastAt = Number.NEGATIVE_INFINITY;
    let timer;
    const cancel = () => { if (timer) {
        clearTimeout(timer);
        timer = undefined;
    } };
    const flush = () => {
        cancel();
        lastAt = Date.now();
        send();
    };
    return {
        flush,
        cancel,
        emit() {
            if (timer)
                return;
            const wait = intervalMs - (Date.now() - lastAt);
            if (wait <= 0)
                flush();
            else
                timer = setTimeout(flush, wait);
        },
    };
}
//# sourceMappingURL=throttledEmit.js.map