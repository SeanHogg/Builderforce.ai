/**
 * Where did each compute task run? The client reports every execution to a `ComputeProbe`; this one keeps the events. The
 * deterministic suite's central claim ("the heavy work is off the main thread") is `mainThread()` being empty for a big graph,
 * and "a small graph computes in the same render" is every event being `main-inline`.
 */

import type { ComputeProbe, ComputeRealm, ComputeTaskEvent } from '../../compute/client';

export class ProbeLog implements ComputeProbe {
    private readonly log: ComputeTaskEvent[] = [];

    task(event: ComputeTaskEvent): void { this.log.push(event); }

    get events(): readonly ComputeTaskEvent[] { return this.log; }

    /** Events per `realm:kind`, keys sorted. */
    counts(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const e of this.log) { const key = `${e.realm}:${e.kind}`; out[key] = (out[key] ?? 0) + 1; }
        return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }

    /** Events that ran on the main thread, in any form (idle steps or inline). */
    mainThread(): ComputeTaskEvent[] { return this.log.filter((e) => e.realm !== 'worker'); }

    ofRealm(realm: ComputeRealm): ComputeTaskEvent[] { return this.log.filter((e) => e.realm === realm); }

    /** Marks a position, so a view's own events can be cut out: `since(mark)`. */
    mark(): number { return this.log.length; }

    since(mark: number): ComputeTaskEvent[] { return this.log.slice(mark); }
}
