/**
 * rules/support/entryDiff.ts — route registrations (C5.1 entry points) present on only one side of a
 * changed file. A route keyed the same on both sides is unchanged here (its guards are
 * `guard-removed`/`guard-weakened`'s concern).
 */

import type { RuleInput } from '../../contract.js';
import { filePairs, isCodePath } from './files.js';
import { routesOf, type RouteFact } from './routes.js';

export interface EntryChange {
    path: string;
    sidePath: string;
    route: RouteFact;
}

export function entryChanges(input: RuleInput, which: 'added' | 'removed'): EntryChange[] {
    const ranks = input.registries.guards;
    const out: EntryChange[] = [];
    for (const pair of filePairs(input)) {
        if (!isCodePath(pair.path)) continue;
        const b = pair.before ? routesOf(pair.before.text, pair.path, ranks) : [];
        const a = pair.after ? routesOf(pair.after.text, pair.path, ranks) : [];
        const [from, to, side] = which === 'added' ? [a, b, pair.after] : [b, a, pair.before];
        if (!side) continue;
        const other = new Set(to.map((r) => r.key));
        for (const route of from) if (!other.has(route.key)) out.push({ path: pair.path, sidePath: side.path, route });
    }
    return out;
}
