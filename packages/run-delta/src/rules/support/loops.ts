/**
 * rules/support/loops.ts — loop bodies of one JS/TS source by brace/paren matching over masked text
 * (strings and comments blanked): `for (…) {…}` / `for (…) stmt;`, `while (…)`, `do {…} while`, and
 * the callback span of `.map(`, `.flatMap(`, `.forEach(`, `.reduce(`.
 */

import { matchClose, type TextView } from './files.js';
import { glued } from './statements.js';

export interface LoopSpan {
    kind: 'for' | 'while' | 'do' | 'map' | 'flatMap' | 'forEach' | 'reduce';
    /** Body span `[from, to)` in the masked text. */
    from: number;
    to: number;
}

// Literal-led (no leading lookbehind, so the engine can skip to the literal); the preceding char is checked after.
const KEYWORD_LOOP = /(for|while)(?:\s+await)?\s*\(/g;
const DO_LOOP = /do\s*\{/g;
const CALL_LOOP = /\.\s*(map|flatMap|forEach|reduce)\s*\(/g;

/** The end (exclusive) of the statement starting at `at`: its block, or up to the `;`/newline at depth 0. */
function statementEnd(bare: string, at: number): number {
    let i = at;
    while (i < bare.length && /\s/.test(bare[i]!)) i++;
    if (bare[i] === '{') {
        const close = matchClose(bare, i);
        return close < 0 ? bare.length : close + 1;
    }
    let depth = 0;
    for (; i < bare.length; i++) {
        const ch = bare[i]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return i; depth--; }
        else if (depth === 0 && (ch === ';' || ch === '\n')) return i + 1;
    }
    return bare.length;
}

export function loopSpans(bare: string): LoopSpan[] {
    const out: LoopSpan[] = [];
    for (const m of bare.matchAll(KEYWORD_LOOP)) {
        if (glued(bare, m.index)) continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0) continue;
        // `} while (cond);` closing a do-loop has no body of its own.
        if (m[1] === 'while' && /\}\s*$/.test(bare.slice(Math.max(0, m.index - 40), m.index)) && /^\s*;/.test(bare.slice(close + 1, close + 41))) continue;
        out.push({ kind: m[1] as 'for' | 'while', from: close + 1, to: statementEnd(bare, close + 1) });
    }
    for (const m of bare.matchAll(DO_LOOP)) {
        if (glued(bare, m.index)) continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close >= 0) out.push({ kind: 'do', from: open, to: close + 1 });
    }
    for (const m of bare.matchAll(CALL_LOOP)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close >= 0) out.push({ kind: m[1] as LoopSpan['kind'], from: open + 1, to: close });
    }
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** {@link loopSpans} of one view, computed once (io-in-loop, nested-iteration and render-hot share it). */
export function loopsOf(view: TextView): LoopSpan[] {
    return view.memo('loops', () => loopSpans(view.bare));
}
