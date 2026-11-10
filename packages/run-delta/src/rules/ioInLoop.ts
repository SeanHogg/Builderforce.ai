/**
 * rules/ioInLoop.ts — `io-in-loop` (performance, warn; C6.1, the N+1 shape): an `await` of a registry
 * I/O call (db clients, `fetch`, fs promises, KV/R2 bindings) inside a `for` / `while` / `do` body or a
 * `.map` / `.flatMap` / `.forEach` / `.reduce` callback. Loop bodies come from brace/paren matching over
 * masked source (agent-tools `maskSource`), so a loop word in a string or comment never counts. Each
 * await is reported once, against its innermost loop.
 *
 * Heuristic: text-level, no call-fact following; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isJsPath, isTestPath, masked } from './support/files.js';
import { loopSpans } from './support/loops.js';
import { stateSides, type Hit } from './support/stateRule.js';

const AWAIT = /(?<![\w$])await\s+/g;
const CALLEE = /^[\w$.\s]*?(?=\s*[(`])/;

function hitsOf(text: string, path: string, io: readonly RegExp[]): Hit[] {
    const { bare } = masked(text, path);
    const loops = loopSpans(bare);
    if (loops.length === 0) return [];
    const hits: Hit[] = [];
    for (const m of bare.matchAll(AWAIT)) {
        const at = m.index;
        const inner = loops.filter((l) => at >= l.from && at < l.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
        if (!inner) continue;
        const start = at + m[0].length;
        const stop = bare.slice(start, start + 240).search(/[;\n]/);
        const expr = bare.slice(start, stop < 0 ? start + 240 : start + stop);
        if (!io.some((re) => re.test(expr))) continue;
        const callee = (CALLEE.exec(expr)?.[0] ?? expr.slice(0, 40)).replace(/\s+/g, '');
        hits.push({ offset: at, key: `${inner.kind}:${callee}`, params: { loop: inner.kind, call: callee } });
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
            hits: (text, path) => hitsOf(text, path, io),
            severity: 'warn',
        }, input);
    },
};
