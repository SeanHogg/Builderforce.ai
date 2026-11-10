/**
 * rules/performance/cacheBypass.ts — `cache-bypass` (performance, warn; C6.1, a repo rule): a call to a
 * repository read registered as cacheable (`registries.cacheable.reads`) that does not sit inside the
 * arguments of a registered read-through helper (`registries.cacheable.readThrough`, `getOrSetCached`
 * here), in a changed non-test JS/TS file. Declarations (`function name(`, `async name(…) {`) are not
 * calls. With no cacheable reads registered the rule reads nothing (and reports nothing).
 *
 * Heuristic: text-level, same-file wrapping only; WS4 call facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { escapeRegex, isJsPath, isTestPath, matchClose, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';

const callRe = (names: readonly string[]) => new RegExp(`(?<![\\w$])(${names.map(escapeRegex).join('|')})\\s*\\(`, 'g');

function hitsOf(view: TextView, reads: RegExp, helpers: RegExp | undefined): Hit[] {
    const { bare } = view;
    const wrapped: Array<[number, number]> = [];
    if (helpers) {
        for (const m of bare.matchAll(helpers)) {
            const open = m.index + m[0].length - 1;
            const close = matchClose(bare, open);
            if (close > 0) wrapped.push([open, close]);
        }
    }
    const hits: Hit[] = [];
    for (const m of bare.matchAll(reads)) {
        if (/\bfunction\s*\*?\s*$/.test(bare.slice(Math.max(0, m.index - 20), m.index))) continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close > 0 && /^\s*(?::[^{;=]*)?\{/.test(bare.slice(close + 1, close + 200)) && !/[=(,]\s*$/.test(bare.slice(Math.max(0, m.index - 20), m.index))) continue; // a method declaration
        if (wrapped.some(([a, b]) => m.index > a && m.index < b)) continue;
        hits.push({ offset: m.index, length: m[0].length, key: m[1]!, params: { call: m[1]! } });
    }
    return hits;
}

export const cacheBypass: DeltaRule = {
    id: 'cache-bypass',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        const { reads, readThrough } = input.registries.cacheable;
        if (reads.length === 0) return { before: [], after: [] };
        const readRe = callRe(reads), helperRe = readThrough.length > 0 ? callRe(readThrough) : undefined;
        return stateSides(cacheBypass, {
            files: (p) => isJsPath(p) && !isTestPath(p),
            hits: (view) => hitsOf(view, readRe, helperRe),
            severity: 'warn',
        }, input);
    },
};
