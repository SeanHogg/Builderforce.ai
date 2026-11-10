/**
 * rules/support/taint.ts — C5.2 taint-lite over ONE side of ONE file, by text (WS4's tree-sitter def-use
 * and call facts replace the scan; the {@link TaintPath} shape stays). Deterministic and intra-procedural,
 * with closures:
 *
 *  1. `live` text: the source with comments AND string-literal contents blanked, template `${…}`
 *     interpolations kept, so a name inside a string never reads as a use and bracket matching holds.
 *  2. Each registry SINK (`taintSinks`) gets its argument: the first argument of `name(`, every argument of
 *     `name(*`, or the right-hand side of `x=`.
 *  3. Scope: the sink's enclosing FUNCTION bodies (a `{` after `)` / `=>` that is not an `if`/`for`/… block).
 *     Assignments BEFORE the sink in the sink's own function AND in every enclosing function (a closure sees
 *     its parents' variables: `db.transaction(async (tx) => …)`) are replayed in order; a sibling function's
 *     assignments are not. A right-hand side holding a registry SOURCE taints its names (plain names,
 *     destructured names, or member paths `o.cmd`); one naming a tainted variable (or a member path under
 *     one) carries the chain one hop further; a plain reassignment to something untainted clears it.
 *  4. SANITIZERS (`taintSanitizers`, grouped by the sink kind they protect, `*` = every kind) cut a path only
 *     when the source or tainted name sits INSIDE the sanitizer call's argument span; a value sanitized for
 *     `html` still reaches a `command-exec` sink.
 *
 * Memoized per {@link TextView}; pure.
 */

import type { RuleInput } from '../../contract.js';
import { compileEntries, type EntryHit, type EntryScanner } from './entryForms.js';
import { matchClose, matchOpen, perInput, type TextView } from './files.js';

export interface TaintRegistry {
    sources: EntryScanner;
    sinks: EntryScanner;
    /** Keyed by the sink kind each sanitizer protects (`*` = all). */
    sanitizers: EntryScanner;
}

/** The sanitizer group that protects every sink kind. */
export const ANY_SINK = '*';

export function taintRegistryOf(input: RuleInput): TaintRegistry {
    return perInput(input, 'taintRegistry', () => ({
        sources: compileEntries(input.registries.taintSources, 'any'),
        sinks: compileEntries(input.registries.taintSinks, 'unqualified'),
        sanitizers: compileEntries(input.registries.taintSanitizers, 'any'),
    }));
}

export interface TaintHop {
    offset: number;
    /** The source entry, a variable name, or the sink entry. */
    note: string;
}

export interface TaintPath {
    /** Sink kind (`command-exec`, `ssrf`, …) and its registry entry (the normalized callee). */
    sink: string;
    sinkEntry: string;
    sinkOffset: number;
    /** Source kind (`http-request`, …). */
    source: string;
    /** source → variables → sink, in CHAIN order. */
    hops: TaintHop[];
}

const MAX_HOPS = 8;
const MAX_RHS = 2000;
/** More paths than this in one file are dropped past the cap (deterministically, by offset). */
export const MAX_PATHS_PER_FILE = 200;
/** Assignments replayed per sink, at most (the nearest ones in scope); bounds the work per sink. */
const MAX_REPLAY_DEFS = 400;
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const CONTINUES = /^[.?:+\-*/|&]/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const PATH = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;
const DEF = new RegExp(String.raw`(?<![\w$.])(?:(?:const|let|var)\s+)?(${PATH}|\{[^{}]*\}|\[[^[\]]*\])\s*(?::\s*[^=;\n]{1,80}?)?(\+?=)(?![=>])`, 'g');
const PATH_USE = new RegExp(String.raw`(?<![\w$.])${PATH}`, 'g');
const KEYWORDS = new Set(['const', 'let', 'var', 'return', 'typeof', 'await', 'new', 'in', 'of', 'instanceof', 'void', 'delete', 'yield', 'this']);

/** Comments and string contents blanked, template interpolations kept (same length and line layout). */
export function liveText(view: TextView): string {
    return view.memo('taint:live', () => {
        const { code, bare } = view;
        if (code === bare) return code;
        const n = code.length;
        // Segments, not one string per char: a 2 MB file stays a handful of slices.
        const out: string[] = [];
        let copyFrom = 0;
        for (let i = 0; i < n;) {
            const ch = code[i]!;
            if (bare[i] === ch) { i++; continue; }
            out.push(code.slice(copyFrom, i));
            if (ch === '$' && code[i + 1] === '{') {
                let depth = 0, j = i + 1;
                for (; j < n; j++) {
                    if (code[j] === '{') depth++;
                    else if (code[j] === '}' && --depth === 0) break;
                }
                const end = Math.min(j + 1, n);
                out.push(code.slice(i, end));
                i = copyFrom = end;
                continue;
            }
            out.push(ch === '\n' ? '\n' : ' ');
            i++;
            copyFrom = i;
        }
        out.push(code.slice(copyFrom));
        return out.join('');
    });
}

/** Where the expression starting at `start` ends: `;` / `,` at depth 0, a closer below depth 0, or a line end that does not continue. */
export function expressionEnd(live: string, start: number): number {
    let depth = 0;
    const limit = Math.min(live.length, start + MAX_RHS);
    for (let j = start; j < limit; j++) {
        const ch = live[j]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (--depth < 0) return j; }
        else if (depth === 0 && (ch === ';' || ch === ',')) return j;
        else if (depth === 0 && ch === '\n') {
            const before = live.slice(start, j).trimEnd();
            const after = live.slice(j + 1, Math.min(limit, j + 200)).trimStart();
            if (before.length > 0 && !/[=+\-*/|&?:,(]$/.test(before) && !CONTINUES.test(after)) return j;
        }
    }
    return limit;
}

/** The `(…)` call span opening at or after `from`: `[open, close]`, or undefined. */
export function callSpanAt(live: string, from: number): [number, number] | undefined {
    const open = live.indexOf('(', from);
    if (open < 0) return undefined;
    const close = matchClose(live, open);
    return close < 0 ? undefined : [open, close];
}

interface Def { offset: number; names: string[]; additive: boolean; rhsStart: number; rhsEnd: number }

function boundNames(pattern: string): string[] {
    if (!pattern.startsWith('{') && !pattern.startsWith('[')) return KEYWORDS.has(pattern) ? [] : [pattern];
    return pattern.slice(1, -1).split(',').map((part) => {
        let p = part.trim().replace(/^\.\.\./, '');
        if (p.includes(':')) p = p.slice(p.indexOf(':') + 1);
        return p.split('=')[0]!.trim();
    }).filter((p) => IDENT.test(p) && !KEYWORDS.has(p));
}

function defsOf(view: TextView, live: string): Def[] {
    return view.memo('taint:defs', () => {
        const out: Def[] = [];
        DEF.lastIndex = 0;
        for (let m = DEF.exec(live); m; m = DEF.exec(live)) {
            const names = boundNames(m[1]!);
            const rhsStart = m.index + m[0].length;
            if (names.length > 0) out.push({ offset: m.index, names, additive: m[2] === '+=', rhsStart, rhsEnd: expressionEnd(live, rhsStart) });
        }
        return out;
    });
}

const TOP = -1;

/** For each offset (ascending), the opens of its enclosing function bodies, outermost first: one sweep. */
function scopeStacks(view: TextView, live: string, offsets: readonly number[]): number[][] {
    const blocks = fnBlocks(view, live);
    const stack: Array<[number, number]> = [];
    const out: number[][] = [];
    let bi = 0;
    for (const at of offsets) {
        while (bi < blocks.length && blocks[bi]![0] < at) {
            const b = blocks[bi++]!;
            while (stack.length > 0 && stack[stack.length - 1]![1] < b[0]) stack.pop();
            stack.push(b);
        }
        while (stack.length > 0 && stack[stack.length - 1]![1] <= at) stack.pop();
        out.push(stack.map((b) => b[0]));
    }
    return out;
}

function fnBlocks(view: TextView, live: string): Array<[number, number]> {
    return view.memo('taint:fnBlocks', () => {
        const fns: Array<[number, number]> = [];
        const stack: number[] = [];
        for (let i = 0; i < live.length; i++) {
            const ch = live[i]!;
            if (ch === '{') stack.push(i);
            else if (ch === '}') {
                const open = stack.pop();
                if (open !== undefined && isFunctionBody(live, open)) fns.push([open, i]);
            }
        }
        return fns.sort((a, b) => a[0] - b[0]);
    });
}

function isFunctionBody(live: string, open: number): boolean {
    let k = open - 1;
    while (k >= 0 && /\s/.test(live[k]!)) k--;
    if (k >= 1 && live[k] === '>' && live[k - 1] === '=') return true;
    if (live[k] !== ')') return false;
    let o = matchOpen(live, k) - 1;
    if (o < -1) return false;
    while (o >= 0 && /\s/.test(live[o]!)) o--;
    let w = o;
    while (w >= 0 && /[\w$]/.test(live[w]!)) w--;
    return !CONTROL.has(live.slice(w + 1, o + 1));
}

/** A tainted value: where it came from, how it travelled, and the sink kinds it was sanitized for. */
interface Chain { source: EntryHit; hops: TaintHop[]; cleanFor: ReadonlySet<string> }

/** What an expression holds, computed once: its sources and member-path uses, each with the sanitizer kinds wrapping it. */
interface Expr {
    sources: Array<{ hit: EntryHit; cleanFor: ReadonlySet<string> }>;
    uses: Array<{ path: string; cleanFor: ReadonlySet<string> }>;
}

const NONE: ReadonlySet<string> = new Set();

function exprOf(text: string, base: number, reg: TaintRegistry): Expr {
    const spans: Array<{ from: number; to: number; kind: string }> = [];
    for (const s of reg.sanitizers.scan(text)) {
        const open = s.offset + s.length - 1;
        const close = matchClose(text, open);
        if (close > open) spans.push({ from: open, to: close, kind: s.key });
    }
    const cleanAt = (at: number): ReadonlySet<string> => {
        if (spans.length === 0) return NONE;
        const kinds = spans.filter((s) => at > s.from && at < s.to).map((s) => s.kind);
        return kinds.length === 0 ? NONE : new Set(kinds);
    };
    const sources = reg.sources.scan(text).map((hit) => ({ hit: { ...hit, offset: base + hit.offset }, cleanFor: cleanAt(hit.offset) }));
    const uses: Expr['uses'] = [];
    PATH_USE.lastIndex = 0;
    for (let m = PATH_USE.exec(text); m; m = PATH_USE.exec(text)) uses.push({ path: m[0], cleanFor: cleanAt(m.index) });
    return { sources, uses };
}

/** The tainted chain of a member path or any of its prefixes (`o.cmd.x` → `o.cmd.x`, `o.cmd`, `o`). */
function chainOf(path: string, tainted: ReadonlyMap<string, Chain>): Chain | undefined {
    for (let p = path; ; p = p.slice(0, p.lastIndexOf('.'))) {
        const c = tainted.get(p);
        if (c) return c;
        if (!p.includes('.')) return undefined;
    }
}

const union = (a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> =>
    a.size === 0 ? b : b.size === 0 ? a : new Set([...a, ...b]);

/** The least-sanitized taint an expression carries (a raw use beats a wrapped one), or undefined. */
function resolve(e: Expr, tainted: ReadonlyMap<string, Chain>): Chain | undefined {
    let best: Chain | undefined;
    const consider = (c: Chain) => { if (!best || c.cleanFor.size < best.cleanFor.size) best = c; };
    for (const s of e.sources) consider({ source: s.hit, hops: [], cleanFor: s.cleanFor });
    if (tainted.size > 0) {
        for (const u of e.uses) {
            const c = chainOf(u.path, tainted);
            if (c) consider({ ...c, cleanFor: union(c.cleanFor, u.cleanFor) });
        }
    }
    return best;
}

const reaches = (c: Chain, sinkKind: string): boolean => !c.cleanFor.has(sinkKind) && !c.cleanFor.has(ANY_SINK);

/** The first index in `defs` (sorted by offset) whose offset is ≥ `at`. */
function firstDefAt(defs: readonly Def[], at: number): number {
    let lo = 0, hi = defs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (defs[mid]!.offset < at) lo = mid + 1; else hi = mid; }
    return lo;
}

function argumentOf(live: string, hit: EntryHit): { start: number; end: number } | undefined {
    if (hit.form === 'assign') {
        const start = hit.offset + hit.length;
        return { start, end: expressionEnd(live, start) };
    }
    if (hit.form !== 'call' && hit.form !== 'method' && hit.form !== 'call-any') return undefined;
    const open = hit.offset + hit.length - 1;
    const close = matchClose(live, open);
    if (close < 0) return undefined;
    if (hit.form === 'call-any') return { start: open + 1, end: close };
    let depth = 0;
    for (let j = open + 1; j < close; j++) {
        const ch = live[j]!;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) return { start: open + 1, end: j };
    }
    return { start: open + 1, end: close };
}

/** Every source → sink path on one side of one file, by sink offset. */
export function taintPaths(view: TextView, reg: TaintRegistry): TaintPath[] {
    return view.memo('taint:paths', () => {
        // Prefilter: no source in the masked text (and no template `${…}`, which `bare` blanks), no path.
        if (!reg.sources.mayMatch(view.bare) && !view.code.includes('${')) return [];
        const live = liveText(view);
        const firstSource = reg.sources.firstPerKey(live)[0];
        if (!firstSource) return [];
        // A sink ending before the first source cannot be reached (its argument may itself hold the source).
        const sinks = reg.sinks.scan(live).filter((s) => s.offset + s.length + MAX_RHS > firstSource.offset);
        if (sinks.length === 0) return [];
        const allDefs = defsOf(view, live);
        // A def whose right-hand side ends before the first source can neither taint nor matter (nothing is tainted yet).
        const firstLive = allDefs.findIndex((d) => d.rhsEnd > firstSource.offset);
        const defs = firstLive < 0 ? [] : allDefs.slice(firstLive);
        const defScope = scopeStacks(view, live, defs.map((d) => d.offset)).map((s) => s[s.length - 1] ?? TOP);
        const exprs: Array<Expr | undefined> = new Array(defs.length);
        const exprAt = (i: number): Expr => (exprs[i] ??= exprOf(live.slice(defs[i]!.rhsStart, defs[i]!.rhsEnd), defs[i]!.rhsStart, reg));
        const sinkScopes = scopeStacks(view, live, sinks.map((s) => s.offset));
        const out: TaintPath[] = [];
        for (const [k, sink] of sinks.entries()) {
            if (out.length >= MAX_PATHS_PER_FILE) break;
            const arg = argumentOf(live, sink);
            if (!arg || live.slice(arg.start, arg.end).trim() === '') continue;
            // In scope: the sink's own function and every enclosing one (closures), never a sibling's body.
            const visible = new Set([TOP, ...sinkScopes[k]!]);
            const replay: number[] = [];
            for (let i = firstDefAt(defs, sink.offset) - 1, steps = 0; i >= 0 && replay.length < MAX_REPLAY_DEFS && steps < 4 * MAX_REPLAY_DEFS; i--, steps++) {
                if (visible.has(defScope[i]!) && defs[i]!.rhsEnd <= sink.offset) replay.push(i);
            }
            const tainted = new Map<string, Chain>();
            for (const i of replay.reverse()) {
                const d = defs[i]!;
                const r = resolve(exprAt(i), tainted);
                for (const name of d.names) {
                    if (r) tainted.set(name, { ...r, hops: [...r.hops, { offset: d.offset, note: name }].slice(-MAX_HOPS) });
                    else if (!d.additive) tainted.delete(name);
                }
            }
            const r = resolve(exprOf(live.slice(arg.start, arg.end), arg.start, reg), tainted);
            if (!r || !reaches(r, sink.key)) continue;
            out.push({
                sink: sink.key, sinkEntry: sink.entry, sinkOffset: sink.offset, source: r.source.key,
                hops: [{ offset: r.source.offset, note: r.source.entry }, ...r.hops, { offset: sink.offset, note: sink.entry }],
            });
        }
        return out;
    });
}
