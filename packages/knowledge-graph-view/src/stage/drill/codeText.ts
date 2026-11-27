/**
 * The code band's text (PRD 43 B1a rule 9), pure:
 *
 *   - {@link codeTargetOf}: which lines of which file a method's code is — from its record's line to the line before the
 *     next definition in the same file (records name only where a definition starts), at most {@link MAX_SPAN} lines;
 *   - {@link syntaxLight}: a syntax-LIGHT tokenizer (comments, strings, numbers, keywords; no grammar, no dependency),
 *     carrying a block comment across lines;
 *   - {@link visibleWindow}: the rows a virtualized panel renders for a scroll offset;
 *   - the editor chrome read off the records: {@link callerIndex}, {@link lensRows} and {@link codeRows} (lens lines
 *     between source rows, one row height), {@link railKinds} (the gutter's type rail), {@link stickyChain} and
 *     {@link refsInView} (what Follow keeps lit on the stage).
 */

import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { compareCallSites } from '../../compute/tasks/placement/callIndex';
import { pathOf } from '../../graphModel';
import { typeShape, type NodeShape } from '../../shapes';
import { fileRefOf } from '../../surface/stations';
import { symbolChain } from '../../surface/transit/symbols';
import type { SymbolRecord } from '../../types';

/** Lines asked for when no later definition bounds a method (the host caps the read too). */
export const MAX_SPAN = 400;

/** Where the reading line sits in a following panel (fraction of its height): the line the stage follows. */
export const READING_AT = 0.3;

/**
 * Scroll offset (px) that brings `line` to the reading line of a panel `viewPx` tall (the top when `viewPx` is 0) whose
 * first rendered line is `firstLine`. Selecting or stepping a mark scrolls the open code panel with this, so the panel
 * and the stage stay on the same source.
 */
export function scrollTopForLine(line: number, firstLine: number, rowPx: number, viewPx = 0): number {
    if (!(rowPx > 0) || !(line >= firstLine)) return 0;
    return Math.max(0, (line - firstLine) * rowPx - viewPx * READING_AT);
}

/** The source line on the reading line of a panel `viewPx` tall scrolled to `scrollTop` (the top line when `viewPx` is 0). */
export function readingLineAt(scrollTop: number, viewPx: number, firstLine: number, rowPx: number): number {
    return rowPx > 0 ? firstLine + Math.floor((scrollTop + viewPx * READING_AT) / rowPx) : firstLine;
}

/** What a numbered step does to its target: a call, a read (memory's `uses`), or a call up to the class it extends. */
export type StepKind = 'calls' | 'reads' | 'extends';

/** One numbered step in a method's code: the line it is on, the ref it reaches and how. */
export interface CallStep { line: number; to: string; kind: StepKind }

/** The relation kinds that number a step, by the step kind they make (memory names a read `uses`). */
const STEP_KIND: Readonly<Record<string, StepKind>> = { calls: 'calls', reads: 'reads', uses: 'reads', extends: 'extends' };

/** `ref`'s sites in call order (its record's `calls`, `reads` / `uses` and `extends` relations, `compareCallSites`), one step per site with a line. */
export function callStepsOf(ref: string, records: readonly SymbolRecord[]): CallStep[] {
    return numberedSitesOf(ref, records).map(({ site, to, kind }) => ({ line: site.line, to, kind }));
}

export function numberedSitesOf(ref: string, records: readonly SymbolRecord[]): { site: CallSite; to: string; kind: StepKind }[] {
    const r = records.find((x) => x.ref === ref);
    if (!r?.relations) return [];
    const sites: { site: CallSite; to: string; kind: StepKind }[] = [];
    for (const rel of r.relations) {
        const kind = STEP_KIND[rel.kind];
        if (kind) for (const site of rel.sites ?? []) sites.push({ site, to: rel.to, kind });
    }
    return sites.sort((a, b) => compareCallSites(a.site, b.site)).filter((s) => s.site.line > 0);
}

const CALLERS = new WeakMap<readonly SymbolRecord[], ReadonlyMap<string, readonly string[]>>();

/** Each ref's callers (the `calls` relations inverted), in record order, once each. Built once per `records` array. */
export function callerIndex(records: readonly SymbolRecord[]): ReadonlyMap<string, readonly string[]> {
    const hit = CALLERS.get(records);
    if (hit) return hit;
    const out = new Map<string, string[]>();
    for (const r of records) {
        for (const rel of r.relations ?? []) {
            if (rel.kind !== 'calls') continue;
            const list = out.get(rel.to);
            if (!list) out.set(rel.to, [r.ref]);
            else if (!list.includes(r.ref)) list.push(r.ref);
        }
    }
    CALLERS.set(records, out);
    return out;
}

/** How the code pane sorts a symbol: a type, a callable, or anything else a class holds (a field, a constant). */
export type RailKind = 'class' | 'method' | 'field';

const CLASS_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'type', 'module']);
const METHOD_KINDS: ReadonlySet<string> = new Set(['method', 'function']);

/** A record kind's {@link RailKind}. */
export function railKindOf(kind: string): RailKind {
    return CLASS_KINDS.has(kind) ? 'class' : METHOD_KINDS.has(kind) ? 'method' : 'field';
}

const KIND_SHAPE: Readonly<Record<RailKind, NodeShape>> = { class: typeShape('class'), method: typeShape('function'), field: typeShape('data') };

/** The stage's silhouette for a symbol kind (a field is drawn as the data drum): the outline's icon and the gutter's glyph. */
export const railShape = (kind: RailKind): NodeShape => KIND_SHAPE[kind];

/** A path's last segment. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export interface SymbolCounts { methods: number; fields: number; calls: number; callers: number }

/** What the symbol card says about `ref`: its methods and fields (the records whose `parent` it is), its calls and its callers. */
export function symbolCounts(ref: string, records: readonly SymbolRecord[]): SymbolCounts {
    let methods = 0, fields = 0;
    for (const r of records) {
        if (r.parent !== ref) continue;
        const kind = railKindOf(r.kind);
        if (kind === 'method') methods++; else if (kind === 'field') fields++;
    }
    return { methods, fields, calls: callStepsOf(ref, records).length, callers: callerIndex(records).get(ref)?.length ?? 0 };
}

const SPANS = new WeakMap<readonly SymbolRecord[], ReadonlyMap<string, CodeTarget>>();

/** Each of a file's symbols with its lines (`codeTargetOf`), computed once per `fileSymbols` array (`symbolsOfFile`). */
function spansOf(fileSymbols: readonly SymbolRecord[], records: readonly SymbolRecord[]): ReadonlyMap<string, CodeTarget> {
    const hit = SPANS.get(fileSymbols);
    if (hit) return hit;
    const out = new Map<string, CodeTarget>();
    for (const r of fileSymbols) { const t = codeTargetOf(r.ref, records); if (t) out.set(r.ref, t); }
    SPANS.set(fileSymbols, out);
    return out;
}

/** A lens line above a definition: the class or method it is for and its count (a class's references, a method's callers). */
export interface Lens { ref: string; kind: 'class' | 'method'; count: number }

/**
 * The lens per definition line of `fileSymbols` (classes and methods only; the first definition on a line wins): a
 * method counts its callers (`callers`, {@link callerIndex}), a class the symbols outside it with a relation to it or to
 * one of its members.
 */
export function lensRows(fileSymbols: readonly SymbolRecord[], records: readonly SymbolRecord[], callers: ReadonlyMap<string, readonly string[]>): Map<number, Lens> {
    const out = new Map<number, Lens>();
    for (const r of fileSymbols) {
        const kind = railKindOf(r.kind);
        if (kind === 'field' || out.has(r.line)) continue;
        out.set(r.line, { ref: r.ref, kind, count: kind === 'method' ? callers.get(r.ref)?.length ?? 0 : referencesOf(r.ref, records) });
    }
    return out;
}

/** The records outside class `ref` (not it, not its members) with a relation to it or to one of its members. */
function referencesOf(ref: string, records: readonly SymbolRecord[]): number {
    const inside = new Set<string>([ref]);
    for (const r of records) if (r.parent === ref) inside.add(r.ref);
    let n = 0;
    for (const r of records) if (!inside.has(r.ref) && r.relations?.some((rel) => inside.has(rel.to))) n++;
    return n;
}

/** A code row: a source line, or the lens line above the definition of `lens`. */
export type Row = { line: number } | { lens: string };

export interface CodeRows {
    rows: Row[];
    /** The row index of source `line`: its lens row when it has one (a jump to a definition shows its lens), else its own; clamped to the rows. */
    rowOfLine(line: number): number;
    /** The source line of row `row` (a lens row: the definition below it); clamped to the rows. */
    lineAtRow(row: number): number;
}

/** The rows of `count` source lines from `first`, a lens row above each line in `lens`. Every row is one height, so a row index is an offset. */
export function codeRows(count: number, first: number, lens: ReadonlyMap<number, { ref: string }> | null | undefined): CodeRows {
    const rows: Row[] = [];
    const rowOf = new Int32Array(Math.max(count, 0));
    for (let n = 0; n < count; n++) {
        const line = first + n, l = lens?.get(line);
        rowOf[n] = rows.length;
        if (l) rows.push({ lens: l.ref });
        rows.push({ line });
    }
    const lineAt = (row: number): number => {
        const i = Math.min(Math.max(row, 0), rows.length - 1);
        const at = rows[i];
        if (!at) return first;
        return 'line' in at ? at.line : (rows[i + 1] as { line: number }).line;
    };
    return {
        rows,
        rowOfLine: (line) => count > 0 ? rowOf[Math.min(Math.max(line - first, 0), count - 1)]! : 0,
        lineAtRow: lineAt,
    };
}

/** The innermost symbol kind on each line (the shortest `codeTargetOf` span covering it): the gutter's type rail. */
export function railKinds(fileSymbols: readonly SymbolRecord[], records: readonly SymbolRecord[]): Map<number, RailKind> {
    const spans = spansOf(fileSymbols, records);
    const out = new Map<number, RailKind>(), width = new Map<number, number>();
    for (const r of fileSymbols) {
        const t = spans.get(r.ref);
        if (!t) continue;
        const kind = railKindOf(r.kind), w = t.endLine - t.startLine;
        for (let l = t.startLine; l <= t.endLine; l++) {
            if ((width.get(l) ?? Number.POSITIVE_INFINITY) <= w) continue;
            width.set(l, w);
            out.set(l, kind);
        }
    }
    return out;
}

/** At most this many enclosing symbols stay pinned above the code. */
export const STICKY_MAX = 2;

/** The sticky header at `firstLine` (the top visible line): the enclosing classes and methods that start above it, innermost {@link STICKY_MAX}, outermost first. */
export function stickyChain(fileSymbols: readonly SymbolRecord[], byRef: ReadonlyMap<string, SymbolRecord>, firstLine: number): SymbolRecord[] {
    return symbolChain(symbolAtLine(fileSymbols, firstLine), byRef)
        .filter((r) => r.line < firstLine && railKindOf(r.kind) !== 'field')
        .slice(-STICKY_MAX);
}

/** The symbols whose lines meet `[first, last]` (the code on screen), each followed by its file's ref the first time. */
export function refsInView(fileSymbols: readonly SymbolRecord[], records: readonly SymbolRecord[], first: number, last: number): string[] {
    const spans = spansOf(fileSymbols, records);
    const out: string[] = [], seen = new Set<string>();
    const add = (ref: string) => { if (!seen.has(ref)) { seen.add(ref); out.push(ref); } };
    for (const r of fileSymbols) {
        const t = spans.get(r.ref);
        if (!t || t.endLine < first || t.startLine > last) continue;
        add(r.ref);
        add(fileRefOf(r.ref));
    }
    return out;
}

/** A call on a line that awaits (the step card's awaited / sync chip). */
export const isAwaited = (text: string): boolean => /\bawait\b/.test(text);

/** The step on the reading line: the nearest step at or above it inside `span`; -1 outside the span or before the first call. Calls sharing a line: the first wins. */
export function stepAt(steps: readonly CallStep[], line: number, span: { startLine: number; endLine: number } | null): number {
    if (!span || line < span.startLine || line > span.endLine) return -1;
    let hit = -1;
    for (let i = 0; i < steps.length; i++) {
        const at = steps[i]!.line;
        if (at <= line && (hit < 0 || at > steps[hit]!.line)) hit = i;
    }
    return hit;
}

/** The first step that calls `ref`; -1 when the open method does not call it. */
export function stepOfCallee(steps: readonly CallStep[], ref: string | null): number {
    return ref ? steps.findIndex((s) => s.to === ref) : -1;
}

/** `ref`'s lines when it is a loaded symbol in `path`; null otherwise (a stage hover marks them in the panel). */
export function spanInFile(ref: string | null, records: readonly SymbolRecord[], path: string): { startLine: number; endLine: number } | null {
    const t = ref ? codeTargetOf(ref, records) : null;
    return t && t.path === path ? { startLine: t.startLine, endLine: t.endLine } : null;
}

export { symbolChain };

/** The symbol a method name in the panel drills to: same file first, else the first loaded record of that name. Keywords never drill. */
export function drillRefForName(name: string, records: readonly SymbolRecord[], path?: string): string | null {
    if (!name || KEYWORDS.has(name)) return null;
    let any: string | null = null;
    for (const r of records) {
        if (r.name !== name || !(r.line > 0)) continue;
        if (path && pathOf(fileRefOf(r.ref) as Parameters<typeof pathOf>[0]) === path) return r.ref;
        any ??= r.ref;
    }
    return any;
}

export interface CodeTarget { ref: string; name: string; path: string; startLine: number; endLine: number }

/** The method `ref`'s code range, read off the loaded records; null when it is not a loaded record or has no path. */
export function codeTargetOf(ref: string, records: readonly SymbolRecord[]): CodeTarget | null {
    const r = records.find((x) => x.ref === ref);
    if (!r || !(r.line > 0)) return null;
    const file = fileRefOf(r.ref), path = pathOf(file as Parameters<typeof pathOf>[0]);
    if (!path) return null;
    let next = Number.POSITIVE_INFINITY;
    for (const o of records) if (o !== r && o.line > r.line && o.line < next && fileRefOf(o.ref) === file) next = o.line;
    const endLine = Math.min(r.line + MAX_SPAN - 1, Number.isFinite(next) ? next - 1 : Number.POSITIVE_INFINITY);
    return { ref, name: r.name, path, startLine: r.line, endLine: Math.max(r.line, endLine) };
}

/** The docked panel reads the whole file the target is in, from line 1, so scrolling walks every symbol in it. */
export function fileTargetOf(target: CodeTarget): CodeTarget {
    return { ...target, startLine: 1, endLine: Math.max(target.endLine, MAX_SPAN) };
}

/** `path`'s loaded symbols, by start line (what {@link symbolAtLine} scans; computed once per records/path). */
export function symbolsOfFile(records: readonly SymbolRecord[], path: string): SymbolRecord[] {
    return records
        .filter((r) => r.line > 0 && pathOf(fileRefOf(r.ref) as Parameters<typeof pathOf>[0]) === path)
        .sort((a, b) => a.line - b.line);
}

/** The symbol whose definition is the latest one starting at or above `line` (a class's method beats the class). */
export function symbolAtLine(sorted: readonly SymbolRecord[], line: number): string | null {
    let hit: string | null = null;
    for (const r of sorted) { if (r.line > line) break; hit = r.ref; }
    return hit;
}

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword';
export interface Token { text: string; kind: TokenKind }

const KEYWORDS = new Set([
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default', 'delete', 'do',
    'elif', 'else', 'enum', 'export', 'extends', 'false', 'final', 'finally', 'fn', 'for', 'from', 'func', 'function', 'if',
    'impl', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'match', 'mut', 'new', 'nil', 'null', 'private',
    'protected', 'pub', 'public', 'readonly', 'return', 'self', 'static', 'struct', 'super', 'switch', 'this', 'throw', 'trait',
    'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
]);

// One pass per line: a block comment's end, a line comment, a string, a number, a word, or one other character.
const TOKEN = /(\/\/.*$|#(?![{[]).*$)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)|(\s+|.)/g;

/** Each line's tokens; a `/* … *\/` comment left open runs on into the next lines. */
export function syntaxLight(lines: readonly string[]): Token[][] {
    let inBlock = false;
    return lines.map((line) => {
        const out: Token[] = [];
        let rest = line;
        if (inBlock) {
            const end = rest.indexOf('*/');
            if (end < 0) return [{ text: line, kind: 'comment' }];
            out.push({ text: rest.slice(0, end + 2), kind: 'comment' });
            rest = rest.slice(end + 2);
            inBlock = false;
        }
        for (const m of rest.matchAll(TOKEN)) {
            const [text, lineComment, block, str, num, word] = m;
            if (lineComment) out.push({ text, kind: 'comment' });
            else if (block) { out.push({ text, kind: 'comment' }); if (!block.endsWith('*/') || block.length < 4) inBlock = true; }
            else if (str) out.push({ text, kind: 'string' });
            else if (num) out.push({ text, kind: 'number' });
            else if (word) out.push({ text, kind: KEYWORDS.has(word) ? 'keyword' : 'plain' });
            else {
                const last = out[out.length - 1];
                if (last && last.kind === 'plain') last.text += text; else out.push({ text, kind: 'plain' });
            }
        }
        return out;
    });
}

/** Rendered as plain rows up to this many lines; past it the panel is virtualized. */
export const VIRTUAL_AFTER = 200;
const OVERSCAN = 8;

/** The rows `[from, to)` a panel of `viewRows` rows renders at `scrollTop` (px) with rows `rowPx` tall; every row up to `after` rows. */
export function visibleWindow(total: number, scrollTop: number, rowPx: number, viewRows: number, after: number = VIRTUAL_AFTER): { from: number; to: number } {
    if (total <= after) return { from: 0, to: total };
    const first = Math.max(0, Math.floor(scrollTop / rowPx) - OVERSCAN);
    return { from: first, to: Math.min(total, first + viewRows + 2 * OVERSCAN) };
}
