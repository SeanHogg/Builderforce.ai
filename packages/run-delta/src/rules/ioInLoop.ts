/**
 * rules/ioInLoop.ts — `io-in-loop` (performance, warn; C6.1, the N+1 shape): an `await` of a registry
 * I/O call (db clients, `fetch`, fs promises, KV/R2 bindings) inside a `for` / `while` / `do` body or a
 * `.map` / `.flatMap` / `.forEach` / `.reduce` callback. Loop bodies come from brace/paren matching over
 * masked source (agent-tools `maskSource`), so a loop word in a string or comment never counts. Each
 * await is reported once, against its innermost loop. The registry regexes are repo-overridable, so each
 * is tested only against the capped expression after the `await`.
 *
 * Heuristic: text-level, no call-fact following; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isJsPath, isTestPath, type TextView } from './support/files.js';
import { loopsOf, type LoopSpan } from './support/loops.js';
import { stateSides, type Hit } from './support/stateRule.js';

const AWAIT = /(?<![\w$])await\s+/g;
const CALLEE = /^[\w$.\s]*?(?=\s*[(`])/;
/** The awaited expression a registry regex sees (bounds any backtracking). */
const MAX_EXPR = 240;

/** For each await offset (sorted), its innermost enclosing loop: one pass per loop over a binary-searched range. */
function innermost(awaits: readonly number[], loops: readonly LoopSpan[]): Map<number, LoopSpan> {
    const best = new Map<number, LoopSpan>();
    const lowerBound = (x: number) => { let lo = 0, hi = awaits.length; while (lo < hi) { const m = (lo + hi) >> 1; if (awaits[m]! < x) lo = m + 1; else hi = m; } return lo; };
    for (const loop of loops) {
        for (let i = lowerBound(loop.from); i < awaits.length && awaits[i]! < loop.to; i++) {
            const cur = best.get(awaits[i]!);
            if (!cur || loop.to - loop.from < cur.to - cur.from) best.set(awaits[i]!, loop);
        }
    }
    return best;
}

function hitsOf(view: TextView, io: readonly RegExp[]): Hit[] {
    const bare = view.bare;
    const loops = loopsOf(view);
    if (loops.length === 0) return [];
    const awaits = [...bare.matchAll(AWAIT)];
    const loopOf = innermost(awaits.map((m) => m.index), loops);
    const hits: Hit[] = [];
    for (const m of awaits) {
        const inner = loopOf.get(m.index);
        if (!inner) continue;
        const start = m.index + m[0].length;
        const window = bare.slice(start, start + MAX_EXPR);
        const stop = window.search(/[;\n]/);
        const expr = stop < 0 ? window : window.slice(0, stop);
        if (!io.some((re) => re.test(expr))) continue;
        const callee = (CALLEE.exec(expr)?.[0] ?? expr.slice(0, 40)).replace(/\s+/g, '');
        hits.push({ offset: m.index, length: m[0].length + expr.length, key: `${inner.kind}:${callee}`, params: { loop: inner.kind, call: callee } });
    }
    return hits;
}

export const ioInLoop: DeltaRule = {
    id: 'io-in-loop',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        const io = input.registries.io.map((s) => new RegExp(s));
        return stateSides(ioInLoop, {
            files: (p) => isJsPath(p) && !isTestPath(p),
            hits: (view) => hitsOf(view, io),
            severity: 'warn',
        }, input);
    },
};
