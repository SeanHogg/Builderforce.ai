/**
 * First-load triage for the Knowledge view: times each call the view's first paint waits on
 * (`scopes`, `lastSeen`, `load`, `baseline`, `syncStatus`, and the `rememberLastSeen` write after a
 * full load), with a load's phases (`partitions`, `index`, `nearDuplicates`, `build`, `pack`,
 * `server`, `notHere`). The latest {@link TRACE_CAPACITY} finished calls stay in a ring; a call still
 * running says which phase it is in and since when, so a stuck load names its phase. Each finished
 * call is one `timing` line in the output channel.
 *
 * Pure apart from the lag sampler (`reviewHostLag.ts`, a seam): no `vscode` here. The bridge owns ONE
 * recorder and threads a call's {@link LoadTimer} into `loadGraph`; a caller without one passes nothing.
 */
import { startHostLag } from "./review/reviewHostLag";
/** Finished calls kept. */
export const TRACE_CAPACITY = 20;
/** No timing: what `loadGraph` uses when its caller passes no timer. */
export const UNTIMED = { phase: (_name, run) => run() };
const isThenable = (v) => !!v && typeof v.then === "function";
/** `load root=… 1234ms ok partitions=12ms index=3ms … nodes=900 edges=2000`: one line, keys in a fixed order. */
export function traceLine(e) {
    const parts = [e.op, ...(e.rootId ? [`root=${e.rootId}`] : []), `${e.durationMs}ms`, e.outcome];
    if (e.error)
        parts.push(`error=${JSON.stringify(e.error)}`);
    for (const p of e.phases)
        parts.push(`${p.phase}=${p.ms}ms`);
    const extra = [
        ["via", e.via], ["nodes", e.nodes], ["edges", e.edges], ["sources", e.sources], ["truncated", e.truncated], ["focus", e.focus],
        ["maxNodes", e.maxNodes], ["count", e.count], ["nearDuplicates", e.nearDuplicates],
    ];
    for (const [k, v] of extra)
        if (v !== undefined)
            parts.push(`${k}=${String(v)}`);
    if (e.hostLag)
        parts.push(`lagMax=${e.hostLag.maxMs}ms lagP99=${e.hostLag.p99Ms}ms`);
    return parts.join(" ");
}
export function createLoadTrace(opts = {}) {
    const now = opts.now ?? Date.now;
    const capacity = opts.capacity ?? TRACE_CAPACITY;
    const entries = [];
    const running = new Set();
    let phaseSeq = 0;
    const keep = (entry) => {
        entries.push(entry);
        if (entries.length > capacity)
            entries.splice(0, entries.length - capacity);
        opts.log?.(traceLine(entry));
    };
    return {
        async run(op, rootId, fn, describe) {
            const startedAt = now();
            const live = { op, startedAt, active: new Map(), ...(rootId ? { rootId } : {}), ...(op === "load" ? { lag: startHostLag(opts.lagSampler) } : {}) };
            running.add(live);
            const phases = [];
            let fields = {};
            // Set once the call's entry is written: a phase that settles later (a sibling of a rejected
            // `Promise.all`) is not appended to a finished entry.
            let finished = false;
            const timer = {
                phase(name, runPhase) {
                    const id = ++phaseSeq;
                    const t0 = now();
                    live.active.set(id, { phase: name, startedAt: t0 });
                    const end = () => {
                        live.active.delete(id);
                        if (!finished)
                            phases.push({ phase: name, ms: Math.max(0, now() - t0) });
                    };
                    let out;
                    try {
                        out = runPhase();
                    }
                    catch (error) {
                        end();
                        throw error;
                    }
                    if (!isThenable(out)) {
                        end();
                        return out;
                    }
                    return Promise.resolve(out).then((v) => { end(); return v; }, (error) => { end(); throw error; });
                },
            };
            const finish = (outcome, error) => {
                finished = true;
                running.delete(live);
                const hostLag = live.lag?.read();
                live.lag?.stop();
                keep({
                    op, ...(rootId ? { rootId } : {}), startedAt, durationMs: Math.max(0, now() - startedAt), outcome, ...(error ? { error } : {}),
                    phases: [...phases], ...fields, ...(hostLag ? { hostLag } : {}),
                });
            };
            try {
                const result = await fn({ timer, set: (f) => { fields = { ...fields, ...f }; } });
                if (describe && result !== null && result !== undefined) {
                    try {
                        fields = { ...fields, ...describe(result) };
                    }
                    catch { /* a count that cannot be read is left out */ }
                }
                finish(result === null || result === undefined ? "null" : "ok");
                return result;
            }
            catch (error) {
                finish("error", error instanceof Error ? error.message : String(error));
                throw error;
            }
        },
        snapshot() {
            const inFlight = [...running].map((r) => {
                const hostLag = r.lag?.read();
                return {
                    op: r.op, ...(r.rootId ? { rootId: r.rootId } : {}), startedAt: r.startedAt,
                    phases: [...r.active.values()].map((p) => ({ ...p })), ...(hostLag ? { hostLag } : {}),
                };
            });
            return { now: now(), entries: entries.map((e) => ({ ...e, phases: [...e.phases] })), inFlight };
        },
    };
}
//# sourceMappingURL=knowledgeLoadTrace.js.map