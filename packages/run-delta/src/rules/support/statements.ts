/**
 * rules/support/statements.ts — expression-statement boundaries over masked JS/TS source, for rules
 * that read a whole call chain (`db.select().from(t).where(…).limit(1)`), a call's arguments or a
 * declaration. Semicolon-free code is handled: a newline ends a statement where ASI would.
 */

import type { TextView } from './files.js';

const IDENT_CHAR = /[\w$.]/;

/** Whether the match at `i` is glued to a preceding identifier char or `.` (so `for` in `format(` is not `for`). */
export const glued = (text: string, i: number): boolean => i > 0 && IDENT_CHAR.test(text[i - 1]!);

/** Whether the `\n` at `nl` ends a statement by ASI: the line before ends an expression and the next line does not continue it. */
function asiBreak(bare: string, nl: number): boolean {
    let p = nl - 1;
    while (p >= 0 && (bare[p] === ' ' || bare[p] === '\t' || bare[p] === '\r')) p--;
    if (p < 0 || !/[\w$)\]'"`]/.test(bare[p]!)) return false;
    const word = /[A-Za-z_$][\w$]*$/.exec(bare.slice(Math.max(0, p - 11), p + 1))?.[0];
    if (word && /^(?:await|return|yield|typeof|new|void|delete|in|of|instanceof|else|case|extends)$/.test(word)) return false;
    let q = nl + 1;
    while (q < bare.length && /\s/.test(bare[q]!)) q++;
    return q < bare.length && !/[.?([+\-*/%=,:&|<>`]/.test(bare[q]!);
}

/** Whether a statement can start at `i`: the previous non-space char is `;`, `{`, `}` or none, or an ASI newline lies between. */
export function startsStatement(bare: string, i: number): boolean {
    let p = i - 1, nl = -1;
    // `nl` ends as the newline nearest the previous code (blank lines in between do not hide the break).
    while (p >= 0 && /\s/.test(bare[p]!)) { if (bare[p] === '\n') nl = p; p--; }
    if (p < 0 || bare[p] === ';' || bare[p] === '{' || bare[p] === '}') return true;
    return nl >= 0 && asiBreak(bare, nl);
}

/**
 * End (exclusive) of the expression starting at `from`: a `;` or `,` at depth 0, an unmatched closer, or a
 * newline at depth 0 not followed by a chain continuation (`.` / `?.`).
 */
export function chainEnd(bare: string, from: number): number {
    let depth = 0;
    for (let i = from; i < bare.length; i++) {
        const ch = bare[i]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return i; depth--; }
        else if (depth === 0 && (ch === ';' || ch === ',')) return i;
        else if (depth === 0 && ch === '\n' && !/^\s*\??\./.test(bare.slice(i + 1, i + 200))) return i;
    }
    return bare.length;
}

/**
 * The rest of the statement after `from`, climbing out of up to {@link MAX_CLIMB} enclosing calls — for an
 * argument (`d.prepare('SELECT …')`) whose chain continues after its call closes (`.first()`).
 */
export function statementTail(bare: string, from: number): string {
    let depth = 0;
    for (let i = from; i < bare.length; i++) {
        const ch = bare[i]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (--depth < -MAX_CLIMB) return bare.slice(from, i); }
        else if (depth <= 0 && ch === ';') return bare.slice(from, i);
        else if (depth <= 0 && ch === '\n' && !/^\s*\??\./.test(bare.slice(i + 1, i + 200))) return bare.slice(from, i);
    }
    return bare.slice(from);
}
const MAX_CLIMB = 4;

/**
 * Start (inclusive) of the statement holding `at`: just past the previous `;`, `{` or `}` at depth 0, an
 * unmatched `(` / `[` (the caller can tell an argument by `bare[start - 1]`), or a newline where ASI ends the
 * previous statement; else 0.
 */
export function statementStart(bare: string, at: number): number {
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
        const ch = bare[i]!;
        if (ch === ')' || ch === ']') depth++;
        else if (ch === '(' || ch === '[') { if (depth === 0) return i + 1; depth--; }
        else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) return i + 1;
        else if (depth === 0 && ch === '\n' && asiBreak(bare, i)) return i + 1;
    }
    return 0;
}

/** The top-level argument spans `[from, to)` of the call whose parens are at `open` / `close` (an empty trailing one dropped). */
export function topLevelArgs(bare: string, open: number, close: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let depth = 0, start = open + 1;
    for (let i = open + 1; i < close; i++) {
        const ch = bare[i]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) { out.push([start, i]); start = i + 1; }
    }
    if (bare.slice(start, close).trim() !== '') out.push([start, close]);
    return out;
}

const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=/g;

/** Every `const|let|var NAME = …` of one view (first declaration of a name wins) → its `[from, to)` span. One pass, memoized. */
export function declarationsOf(view: TextView): ReadonlyMap<string, readonly [number, number]> {
    return view.memo('declarations', () => {
        const out = new Map<string, readonly [number, number]>();
        for (const m of view.bare.matchAll(DECL)) {
            if (glued(view.bare, m.index) || out.has(m[1]!)) continue;
            out.set(m[1]!, [m.index, chainEnd(view.bare, m.index + m[0].length)]);
        }
        return out;
    });
}
