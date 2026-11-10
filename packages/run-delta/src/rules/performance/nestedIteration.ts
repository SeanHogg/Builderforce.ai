/**
 * rules/performance/nestedIteration.ts — `nested-iteration` (performance, warn; C6.1): a quadratic
 * shape inside a collection iteration (a loop or a callback scan) of a changed non-test JS/TS file:
 *
 *  - a callback scan (`.find`, `.filter`, `.some`, …) inside it — a lookup per element (use a Map/Set);
 *  - `.includes` / `.indexOf` inside it on a receiver known to be a collection (the outer one, or one
 *    the file iterates elsewhere);
 *  - a loop over the SAME collection as the outer one.
 *
 * An inner iteration over something DERIVED from the outer element (`items.map(i => i.tags.map(…))`, a
 * tree walk, linear overall) is not reported. Each inner site is reported once, against its innermost
 * enclosing iteration, found by ONE stack sweep over the position-sorted spans (bodies nest, so the
 * enclosing ones are exactly the open spans on the stack): O(n log n), never pairwise.
 *
 * Heuristic: text-level, no types; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isJsPath, isTestPath, type TextView } from '../support/files.js';
import { iterationsOf, mentions, type Iteration } from '../support/iteration.js';
import { stateSides, type Hit } from '../support/stateRule.js';

const isOuter = (it: Iteration): boolean => !it.scan || it.callback;

/** Each iteration → its innermost enclosing outer iteration (body wholly containing it), by a stack sweep. */
function enclosing(all: readonly Iteration[]): Map<Iteration, Iteration> {
    // Events: an outer OPENS at its body start; every iteration is CHECKED at its own start. Opens first on ties.
    const events: Array<{ at: number; open: boolean; it: Iteration }> = [];
    for (const it of all) {
        events.push({ at: it.offset, open: false, it });
        if (isOuter(it)) events.push({ at: it.from, open: true, it });
    }
    events.sort((a, b) => a.at - b.at || (a.open === b.open ? 0 : a.open ? -1 : 1));
    const stack: Iteration[] = [];
    const out = new Map<Iteration, Iteration>();
    for (const e of events) {
        while (stack.length > 0 && stack[stack.length - 1]!.to <= e.at) stack.pop();
        if (e.open) { stack.push(e.it); continue; }
        for (let k = stack.length - 1; k >= 0; k--) {
            const o = stack[k]!;
            if (o !== e.it && e.it.to <= o.to) { out.set(e.it, o); break; }
        }
    }
    return out;
}

function hitsOf(view: TextView): Hit[] {
    const all = iterationsOf(view);
    const iterated = new Set(all.filter(isOuter).map((it) => it.root).filter(Boolean));
    const outerOf = enclosing(all);
    const hits: Hit[] = [];
    for (const inner of all) {
        const outer = outerOf.get(inner);
        if (!outer || mentions(inner.collection, outer.bindings)) continue;
        const sameCollection = inner.root !== '' && inner.root === outer.root;
        const quadratic = inner.scan
            ? inner.callback || sameCollection || (inner.root !== '' && iterated.has(inner.root))
            : sameCollection;
        if (!quadratic) continue;
        hits.push({
            offset: inner.offset, length: Math.max(1, inner.from - inner.offset),
            key: `${outer.kind}>${inner.kind}:${inner.root}`,
            params: { loop: outer.kind, call: inner.kind, ...(inner.root ? { collection: inner.root } : {}) },
        });
    }
    return hits;
}

export const nestedIteration: DeltaRule = {
    id: 'nested-iteration',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        return stateSides(nestedIteration, { files: (p) => isJsPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};
