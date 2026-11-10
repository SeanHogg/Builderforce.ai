/**
 * rules/support/iteration.ts — every COLLECTION iteration of one JS/TS file, by text over masked
 * source (WS4 tree-sitter body facts replace this), for `nested-iteration` (C6.1):
 *
 *  - loops from {@link loopSpans}: `for (… of|in xs)`, index loops bounded by `xs.length`, and the
 *    `.map` / `.flatMap` / `.forEach` / `.reduce` callbacks (`while` / `do` are not collection loops);
 *  - linear scans: `.find` / `.findIndex` / `.findLast` / `.filter` / `.some` / `.every` (array-only:
 *    they take a callback) and `.includes` / `.indexOf` / `.lastIndexOf` (also string methods, so the
 *    rule only counts them on a receiver known to be a collection).
 *
 * Each carries the iterated expression, its root identifier and the names it binds, so the rule can
 * tell a tree walk (`items.map(i => i.tags.map(…))`, linear overall) from a quadratic lookup.
 * Computed once per {@link TextView}.
 */

import { matchClose, matchOpen, squash, type TextView } from './files.js';
import { loopsOf } from './loops.js';

export interface Iteration {
    /** `for-of`, `for-in`, `for-index`, `map`, `flatMap`, `forEach`, `reduce`, or a scan name (`find`, `includes`, …). */
    kind: string;
    /** Where the construct starts (the `for` keyword or the receiver): the evidence offset. */
    offset: number;
    /** Body / callback span `[from, to)` in the masked text. */
    from: number;
    to: number;
    /** The iterated expression, squashed (masked: strings blanked). */
    collection: string;
    /** Its root identifier (`this.` skipped); `''` when it has none (a literal, a call result). */
    root: string;
    /** Names the construct binds (loop variables, callback parameters). */
    bindings: string[];
    /** A linear scan rather than a loop. */
    scan: boolean;
    /** A scan that takes a callback (array-only, and itself an iteration over its receiver). */
    callback: boolean;
}

const SCAN = /\.\s*(find|findIndex|findLast|findLastIndex|filter|some|every|includes|indexOf|lastIndexOf)\s*\(/g;
const CALLBACK_SCANS: ReadonlySet<string> = new Set(['find', 'findIndex', 'findLast', 'findLastIndex', 'filter', 'some', 'every']);
const IDENT = /[A-Za-z_$][\w$]*/g;
const KEYWORDS: ReadonlySet<string> = new Set(['const', 'let', 'var', 'await', 'async', 'function', 'of', 'in']);

const skipBack = (s: string, i: number): number => { while (i >= 0 && /\s/.test(s[i]!)) i--; return i; };

/** Start of the receiver expression ending just before the `.` at `dot` (identifier chains, calls, indexing). */
function receiverStart(bare: string, dot: number): number {
    let i = skipBack(bare, dot - 1), start = dot;
    for (let guard = 0; guard < 64 && i >= 0; guard++) {
        if (bare[i] === ')' || bare[i] === ']') {
            const open = matchOpen(bare, i);
            if (open < 0) break;
            start = open;
            i = skipBack(bare, open - 1);
            if (!/[\w$]/.test(bare[i] ?? '')) break;
        }
        let j = i;
        while (j >= 0 && /[\w$]/.test(bare[j]!)) j--;
        if (j === i) break;
        start = j + 1;
        i = skipBack(bare, j);
        if (bare[i] === '.' ) { i = skipBack(bare, bare[i - 1] === '?' ? i - 2 : i - 1); continue; }
        break;
    }
    return start;
}

/** Identifiers declared by a binding pattern or a parameter list (type annotations and defaults dropped). */
function namesIn(pattern: string): string[] {
    const cleaned = pattern.replace(/:\s*[^,()[\]{}=]+/g, '').replace(/=[^,]*/g, '');
    return [...cleaned.matchAll(IDENT)].map((m) => m[0]).filter((n) => !KEYWORDS.has(n));
}

function rootOf(expr: string): string {
    const m = /^\s*(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)/.exec(expr);
    return m && !/^(?:new|await)$/.test(m[1]!) ? m[1]! : '';
}

/** The callback's parameter names at the start of a call's argument span. */
function callbackParams(args: string): string[] {
    const m = /^\s*(?:async\s+)?(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*(?::[^=]*)?=>/.exec(args)
        ?? /^\s*(?:async\s+)?function\b[^(]*\(([^()]*)\)/.exec(args);
    return m ? namesIn(m[1] ?? m[2] ?? '') : [];
}

function compute(view: TextView): Iteration[] {
    const bare = view.bare;
    const out: Iteration[] = [];
    for (const loop of loopsOf(view)) {
        if (loop.kind === 'while' || loop.kind === 'do') continue;
        if (loop.kind === 'for') {
            const open = matchOpen(bare, loop.from - 1);
            if (open < 0) continue;
            const header = bare.slice(open + 1, loop.from - 1);
            const keyword = bare.lastIndexOf('for', open);
            const ofIn = /^\s*(?:const|let|var)?\s*([\s\S]+?)\s+(of|in)\s+([\s\S]+)$/.exec(header);
            if (ofIn) {
                const collection = squash(ofIn[3]!);
                out.push({ kind: `for-${ofIn[2]}`, offset: keyword, from: loop.from, to: loop.to, collection, root: rootOf(collection), bindings: namesIn(ofIn[1]!), scan: false, callback: false });
                continue;
            }
            const bound = /([\w$.]+?)\s*\.\s*length\b/.exec(header);
            if (!bound) continue;
            const init = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)/.exec(header);
            out.push({ kind: 'for-index', offset: keyword, from: loop.from, to: loop.to, collection: bound[1]!, root: rootOf(bound[1]!), bindings: init ? [init[1]!] : [], scan: false, callback: false });
            continue;
        }
        // Call loops: the span is the argument list; the `.` sits before the method name.
        const dot = bare.lastIndexOf('.', loop.from - 1);
        const start = receiverStart(bare, dot);
        const collection = squash(bare.slice(start, dot));
        out.push({ kind: loop.kind, offset: start, from: loop.from, to: loop.to, collection, root: rootOf(collection), bindings: callbackParams(bare.slice(loop.from, loop.to)), scan: false, callback: false });
    }
    for (const m of bare.matchAll(SCAN)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0) continue;
        const start = receiverStart(bare, m.index);
        const collection = squash(bare.slice(start, m.index));
        const callback = CALLBACK_SCANS.has(m[1]!);
        out.push({
            kind: m[1]!, offset: start, from: open + 1, to: close, collection, root: rootOf(collection),
            bindings: callback ? callbackParams(bare.slice(open + 1, close)) : [], scan: true, callback,
        });
    }
    return out.sort((a, b) => a.offset - b.offset || a.from - b.from);
}

export function iterationsOf(view: TextView): Iteration[] {
    return view.memo('iterations', () => compute(view));
}

/** Whether `expr` mentions any of `names` as a whole identifier. */
export function mentions(expr: string, names: readonly string[]): boolean {
    return names.some((n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(expr));
}
