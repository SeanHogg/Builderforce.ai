/**
 * rules/matcherWeakened.ts — `matcher-weakened` (quality, error; C8.2): a test present on both sides
 * swapped strong matchers for weaker ones by the registry's strength classes (strongest first, e.g.
 * `toEqual` > `toMatchObject` > `toBeTruthy`). With the same or more classified matchers after, the
 * test is weakened when, for some class k, fewer matchers of class ≤ k remain. (Fewer matchers
 * overall is `assertions-reduced`.) Blocks an autonomous run.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { sharedTests, testFinding, testPairs } from './support/testPairs.js';

function classIndex(classes: readonly (readonly string[])[]): Map<string, number> {
    const out = new Map<string, number>();
    classes.forEach((names, k) => { for (const n of names) if (!out.has(n)) out.set(n, k); });
    return out;
}

/** Matchers in `a` not matched by one in `b` (multiset difference), strongest first. */
function minus(a: readonly string[], b: readonly string[], cls: Map<string, number>): string[] {
    const left = [...b];
    const out: string[] = [];
    for (const m of a) {
        const i = left.indexOf(m);
        if (i >= 0) left.splice(i, 1);
        else out.push(m);
    }
    return out.sort((x, y) => (cls.get(x)! - cls.get(y)!) || (x < y ? -1 : x > y ? 1 : 0));
}

export function weakened(before: readonly string[], after: readonly string[], classes: readonly (readonly string[])[]): { from: string; to: string } | undefined {
    const cls = classIndex(classes);
    const b = before.filter((m) => cls.has(m)), a = after.filter((m) => cls.has(m));
    if (a.length < b.length) return undefined;
    for (let k = 0; k < classes.length - 1; k++) {
        const cumB = b.filter((m) => cls.get(m)! <= k).length, cumA = a.filter((m) => cls.get(m)! <= k).length;
        if (cumA < cumB) {
            const lost = minus(b, a, cls), gained = minus(a, b, cls).reverse();
            return { from: lost[0] ?? '', to: gained[0] ?? '' };
        }
    }
    return undefined;
}

export const matcherWeakened: DeltaRule = {
    id: 'matcher-weakened',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                const w = weakened(t.before.matchers, t.after.matchers, input.registries.matchers);
                if (w) after.push(testFinding(matcherWeakened, pair, t.key, 'error', w, t));
            }
        }
        return { before: [], after };
    },
};
