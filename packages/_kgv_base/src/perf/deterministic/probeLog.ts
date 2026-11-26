/**
 * Where did each compute task run? The client reports every execution to a `ComputeProbe`; this one keeps the events. The
 * deterministic suite's central claim ("the heavy work is off the main thread") is `mainThreadAbove(INLINE_WEIGHT)` being empty
 * for a big graph, and "a small graph computes in the same render" is every event being `main-inline`.
 *
 * Each event is weighed when it happens (`weigh`, the size of the graph it ran on): the view computes the empty placeholder graph
 * inline while the real one is still loading, which is no work at all and must not read as main-thread compute on the big one.
 */

import type { ComputeProbe, ComputeRealm, ComputeTaskEvent } from '../../compute/client';
import type { GraphId } from '../../compute/protocol';

/** The weight of the graph an event ran on; undefined when it cannot be told (counted as heavy). */
export type Weigh = (graph: GraphId) => number | undefined;

export class ProbeLog implements ComputeProbe {
    private readonly log: ComputeTaskEvent[] = [];
    private readonly weights: Array<number | undefined> = [];

    constructor(private readonly weigh: Weigh = () => undefined) {}

    task(event: ComputeTaskEvent): void {
        this.log.push(event);
        this.weights.push(this.weigh(event.graph));
    }

    get events(): readonly ComputeTaskEvent[] { return this.log; }

    /** Events per `realm:kind`, keys sorted. */
    counts(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const e of this.log) { const key = `${e.realm}:${e.kind}`; out[key] = (out[key] ?? 0) + 1; }
        return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }

    /** Events that ran on the main thread, in any form (idle steps or inline). */
    mainThread(): ComputeTaskEvent[] { return this.log.filter((e) => e.realm !== 'worker'); }

    /** Main-thread events on a graph heavier than `limit` elements, or of unknown weight. */
    mainThreadAbove(limit: number): ComputeTaskEvent[] {
        return this.log.filter((e, i) => e.realm !== 'worker' && !((this.weights[i] ?? Infinity) <= limit));
    }

    ofRealm(realm: ComputeRealm): ComputeTaskEvent[] { return this.log.filter((e) => e.realm === realm); }

    /** Marks a position, so a view's own events can be cut out: `since(mark)`. */
    mark(): number { return this.log.length; }

    since(mark: number): ComputeTaskEvent[] { return this.log.slice(mark); }
}
