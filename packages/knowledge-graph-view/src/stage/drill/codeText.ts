/**
 * The code band's text (PRD 43 B1a rule 9), pure:
 *
 *   - {@link codeTargetOf}: which lines of which file a method's code is — from its record's line to the line before the
 *     next definition in the same file (records name only where a definition starts), at most {@link MAX_SPAN} lines;
 *   - {@link syntaxLight}: a syntax-LIGHT tokenizer (comments, strings, numbers, keywords; no grammar, no dependency),
 *     carrying a block comment across lines;
 *   - {@link visibleWindow}: the rows a virtualized panel renders for a scroll offset.
 */

import { pathOf } from '../../graphModel';
import { fileRefOf } from '../../surface/stations';
import type { SymbolRecord } from '../../types';

/** Lines asked for when no later definition bounds a method (the host caps the read too). */
export const MAX_SPAN = 400;

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
