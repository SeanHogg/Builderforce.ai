/**
 * The code band's text (PRD 43 B1a rule 9), pure:
 *
 *   - {@link codeTargetOf}: which lines of which file a method's code is — from its record's line to the line before the
 *     next definition in the same file (records name only where a definition starts), at most {@link MAX_SPAN} lines;
 *   - {@link syntaxLight}: a syntax-LIGHT tokenizer (comments, strings, numbers, keywords; no grammar, no dependency),
 *     carrying a block comment across lines;
 *   - {@link visibleWindow}: the rows a virtualized panel renders for a scroll offset.
 */

import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { compareCallSites } from '../../compute/tasks/placement/callIndex';
import { pathOf } from '../../graphModel';
import { fileRefOf } from '../../surface/stations';
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

/** One numbered call in a method's code: the line it is on and the ref it calls. */
export interface CallStep { line: number; to: string }

/** `ref`'s call sites in call order (its record's `calls` relations, `compareCallSites`), one step per site with a line. */
export function callStepsOf(ref: string, records: readonly SymbolRecord[]): CallStep[] {
    const r = records.find((x) => x.ref === ref);
    if (!r?.relations) return [];
    const sites: { site: CallSite; to: string }[] = [];
    for (const rel of r.relations) if (rel.kind === 'calls') for (const site of rel.sites ?? []) sites.push({ site, to: rel.to });
    return sites.sort((a, b) => compareCallSites(a.site, b.site)).filter((s) => s.site.line > 0).map((s) => ({ line: s.site.line, to: s.to }));
}

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

/** `ref` and its enclosing symbols, outermost first, by `parent` (stops at an unloaded parent, a self-parent or a cycle). */
export function symbolChain(ref: string | null, byRef: ReadonlyMap<string, SymbolRecord>): SymbolRecord[] {
    const out: SymbolRecord[] = [];
    const seen = new Set<string>();
    for (let r = ref ? byRef.get(ref) : undefined; r && !seen.has(r.ref); r = byRef.get(r.parent)) {
        seen.add(r.ref);
        out.push(r);
        if (r.parent === r.ref) break;
    }
    return out.reverse();
}

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

/** The rows `[from, to)` a panel of `viewRows` rows renders at `scrollTop` (px) with rows `rowPx` tall. */
export function visibleWindow(total: number, scrollTop: number, rowPx: number, viewRows: number): { from: number; to: number } {
    if (total <= VIRTUAL_AFTER) return { from: 0, to: total };
    const first = Math.max(0, Math.floor(scrollTop / rowPx) - OVERSCAN);
    return { from: first, to: Math.min(total, first + viewRows + 2 * OVERSCAN) };
}
