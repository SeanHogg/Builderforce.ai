/**
 * engine/impactSet.ts — the C2 impact set: the changed files, their reverse dependents up to
 * {@link DEPENDENT_HOPS} hops in the file import graph, and the entry points (files carrying an
 * {@link ENTRY_BADGES entry badge}) that reach a changed file through imports at any depth.
 *
 * The graph is the UNION of both sides' `SideFacts.imports`, so a file that imported a now-deleted
 * file still counts as its dependent. Every walk visits nodes in sorted order; outputs are sorted.
 */

import type { SideFacts } from '../contract.js';
import { compareStr, sortedUnique } from './text.js';

export const DEPENDENT_HOPS = 2;

/** File badges that mark an entry point: a package manifest's `entry`, or a file declaring `routes`. */
export const ENTRY_BADGES: readonly string[] = ['entry', 'routes'];

export interface ImpactSet {
    dependents: string[];
    entryPoints: string[];
}

/** Reverse adjacency (imported → importers) of both sides' import maps. */
export function reverseImports(...sides: readonly SideFacts[]): Map<string, string[]> {
    const rev = new Map<string, Set<string>>();
    for (const side of sides) {
        for (const [from, targets] of side.imports) {
            for (const to of targets) {
                if (to === from) continue;
                (rev.get(to) ?? rev.set(to, new Set()).get(to)!).add(from);
            }
        }
    }
    return new Map([...rev].map(([k, v]) => [k, [...v].sort(compareStr)]));
}

function hasEntryBadge(path: string, sides: readonly SideFacts[]): boolean {
    for (const side of sides) {
        const badges = side.badges.get(path);
        if (!badges) continue;
        for (const key of ENTRY_BADGES) {
            const v = badges[key];
            if (v !== undefined && v !== 0 && v !== '') return true;
        }
    }
    return false;
}

export function impactSet(changedFiles: readonly string[], before: SideFacts, after: SideFacts): ImpactSet {
    const rev = reverseImports(before, after);
    const changed = new Set(changedFiles);

    // Reverse dependents, breadth-first, up to DEPENDENT_HOPS.
    const dependents = new Set<string>();
    let frontier = sortedUnique(changedFiles);
    const seen = new Set(frontier);
    for (let hop = 0; hop < DEPENDENT_HOPS && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const f of frontier) {
            for (const importer of rev.get(f) ?? []) {
                if (seen.has(importer)) continue;
                seen.add(importer);
                next.push(importer);
                if (!changed.has(importer)) dependents.add(importer);
            }
        }
        frontier = next.sort(compareStr);
    }

    // Everything that reaches a changed file (unbounded reverse walk), then its entry-badged members.
    const reaches = new Set(changedFiles);
    const stack = sortedUnique(changedFiles).reverse();
    while (stack.length > 0) {
        const f = stack.pop()!;
        for (const importer of rev.get(f) ?? []) {
            if (reaches.has(importer)) continue;
            reaches.add(importer);
            stack.push(importer);
        }
    }
    const entryPoints = [...reaches].filter((p) => hasEntryBadge(p, [after, before])).sort(compareStr);

    return { dependents: [...dependents].sort(compareStr), entryPoints };
}
