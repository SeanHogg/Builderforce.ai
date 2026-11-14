/**
 * Turns that arrive for a key whose run is still live - never dropped.
 *
 * A re-submitted steer turn races the run that woke for it: the later `run.start` found
 * the key claimed and returned at once, and the person's turn was silently lost. Now a turn
 * for a key THIS host is carrying parks here and runs, in order, once the live run has
 * settled; a turn for a key another path owns (the native participant) waits for the key to
 * go idle. A Stop ends the work, the turns parked behind it included (`drop`) - but a turn
 * typed AFTER the Stop is the person's new request and survives. No `vscode` import.
 */
const DEFAULT_RECHECK_MS = 1_000;
export function createTurnQueue(deps) {
    const parked = new Map();
    const waiting = new Set();
    const drop = (key) => {
        const line = parked.get(key);
        if (!line)
            return;
        parked.delete(key);
        for (const turn of line)
            turn.resolve();
    };
    return {
        park(key, spec) {
            return new Promise((resolve, reject) => {
                const line = parked.get(key) ?? [];
                line.push({ spec, resolve, reject });
                parked.set(key, line);
            });
        },
        whenIdle(key) {
            return new Promise((resolve) => {
                if (!deps.isRunning(key))
                    return resolve();
                let off = () => undefined;
                let timer;
                const end = () => {
                    off();
                    if (timer !== undefined)
                        clearInterval(timer);
                    waiting.delete(end);
                    resolve();
                };
                const check = () => {
                    if (!deps.isRunning(key))
                        end();
                };
                off = deps.subscribe(key, check);
                timer = setInterval(check, deps.recheckMs ?? DEFAULT_RECHECK_MS);
                waiting.add(end);
            });
        },
        drop,
        settled(key) {
            const line = parked.get(key);
            if (!line?.length)
                return;
            // Claimed again already (a wake started a run): the parked turns keep their place, and
            // that run asks again when IT settles. Re-parking the head would put it at the tail.
            if (deps.isLive(key))
                return;
            const next = line.shift();
            if (line.length === 0)
                parked.delete(key);
            void deps.run(next.spec).then(next.resolve, next.reject);
        },
        dispose() {
            for (const key of [...parked.keys()])
                drop(key);
            for (const end of [...waiting])
                end();
        },
    };
}
//# sourceMappingURL=runTurnQueue.js.map