/**
 * Which entry points get a line (PRD 41 A9 rule 4). Lines are allotted round-robin across the
 * systems, the largest system first, so one system cannot take all of `max`. Inside a system the
 * entries keep the order they came in (the station model's: busiest first). A root with one system
 * (or none tagged) is just the first `max` entries, as before.
 */

import { cmp } from '../order';
import type { Station } from './stations';

export interface Allotment {
    chosen: Station[];
    /** Entry points past the cap that were not given a line. */
    omitted: number;
}

/** `order` is the system paths, largest first; a system not named there (or no system) goes last, by path. */
export function allotEntries(entries: readonly Station[], order: readonly string[], max: number): Allotment {
    const rank = new Map(order.map((path, i) => [path, i] as const));
    const queues = new Map<string, Station[]>();
    for (const e of entries) {
        const key = e.system ?? '';
        (queues.get(key) ?? queues.set(key, []).get(key)!).push(e);
    }
    const keys = [...queues.keys()].sort((a, b) => (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length) || cmp(a, b));
    const chosen: Station[] = [];
    for (let round = 0; chosen.length < max; round++) {
        let took = false;
        for (const key of keys) {
            const next = queues.get(key)![round];
            if (!next || chosen.length >= max) continue;
            chosen.push(next);
            took = true;
        }
        if (!took) break;
    }
    return { chosen, omitted: entries.length - chosen.length };
}
