/**
 * rules/support/guardDiff.ts — per route present on BOTH sides of a changed file, how its guard chain
 * changed, by registry rank (C5.1):
 *  - a removed guard with an equal-or-stronger guard still on the chain: no change;
 *  - a removed guard while weaker guards remain: `weakened` (to the strongest remaining);
 *  - a removed guard and nothing left on the chain: `removed`.
 */

import type { RuleInput } from '../../contract.js';
import { filePairs, isCodePath } from './files.js';
import { maxRank, routesOf, type RouteFact } from './routes.js';

export interface GuardChange {
    path: string;
    beforePath: string;
    afterPath: string;
    before: RouteFact;
    after: RouteFact;
    kind: 'removed' | 'weakened';
    guard: string;
    /** For `weakened`: the strongest guard left on the chain. */
    replacement?: string;
}

export function guardChanges(input: RuleInput): GuardChange[] {
    const ranks = input.registries.guards;
    const out: GuardChange[] = [];
    for (const pair of filePairs(input)) {
        if (!pair.before || !pair.after || !isCodePath(pair.path)) continue;
        const before = new Map(routesOf(pair.before.text, pair.path, ranks).map((r) => [r.key, r]));
        for (const after of routesOf(pair.after.text, pair.path, ranks)) {
            const prev = before.get(after.key);
            if (!prev) continue;
            const left = new Set(after.guards);
            const strongestLeft = [...after.guards].sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0) || (a < b ? -1 : 1))[0];
            for (const guard of prev.guards) {
                if (left.has(guard)) continue;
                if (maxRank(after.guards, ranks) >= (ranks[guard] ?? 0) && after.guards.length > 0) continue;
                out.push({
                    path: pair.path, beforePath: pair.before.path, afterPath: pair.after.path, before: prev, after, guard,
                    ...(strongestLeft ? { kind: 'weakened' as const, replacement: strongestLeft } : { kind: 'removed' as const }),
                });
            }
        }
    }
    return out;
}
