/**
 * The host's relay to its panels: every attached sink, and what each was last sent of
 * each run (the delta bookkeeping `syncMessageFor` keeps). Lifted out of `brainRunHost.ts`,
 * which owns the runs; this owns only who hears about them.
 */
import { syncMessageFor } from "./brainRunHostProtocol";
export function createRunRelay() {
    const sinks = new Set();
    const forget = (runKey) => {
        for (const entry of sinks)
            entry.sent.delete(runKey);
    };
    const sync = (runKey) => {
        for (const entry of sinks)
            entry.sink.post(syncMessageFor(entry, runKey));
    };
    return {
        broadcast(message) {
            for (const entry of sinks)
                entry.sink.post(message);
        },
        sync,
        forget,
        resync(runKey) {
            forget(runKey);
            sync(runKey);
        },
        attach(sink, runKeys) {
            const entry = { sink, sent: new Map() };
            sinks.add(entry);
            for (const runKey of runKeys)
                sink.post(syncMessageFor(entry, runKey));
            return () => {
                sinks.delete(entry);
            };
        },
        dispose() {
            sinks.clear();
        },
    };
}
//# sourceMappingURL=runRelay.js.map