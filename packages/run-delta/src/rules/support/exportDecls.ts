/**
 * rules/support/exportDecls.ts — the public API of one JS/TS file, by text (WS4 tree-sitter export
 * facts replace this): each exported name with its normalized declaration SIGNATURE, and for
 * interfaces/enums their member set (adding a member is not breaking, removing or changing one is).
 *
 * Signatures (whitespace collapsed, comments masked, string literals kept):
 *  - function: from `export` to the body's `{` (parameters and return type);
 *  - class: the header up to `{` (heritage);
 *  - interface / enum: the header, plus top-level members;
 *  - type: the whole alias up to its `;` at depth 0 (or the end of its last line);
 *  - const/let/var: the declared type, plus an arrow function's parameters and return type;
 *  - `export { a, b as c } [from '…']`: one entry per exported name.
 */

import { lineAt } from '../../engine/text.js';
import { masked, matchClose, squash } from './files.js';

export interface ExportDecl {
    name: string;
    signature: string;
    /** Interfaces and enums: normalized top-level members. */
    members?: string[];
    line: number;
}

const DECL = /(^|\n)[ \t]*export\s+(default\s+)?(?:declare\s+)?(?:async\s+)?(function\s*\*?|const\s+enum|const|let|var|abstract\s+class|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const LIST = /(?<![\w$])export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*(['"])([^'"\n]+)\2)?/g;

/** The first index ≥ `from` of a char in `stops` at bracket depth 0 (over masked text), or the text end. */
function depthZero(bare: string, from: number, stops: string): number {
    let depth = 0;
    for (let i = from; i < bare.length; i++) {
        const ch = bare[i]!;
        if (depth === 0 && stops.includes(ch)) return i;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        if (depth < 0) return i;
    }
    return bare.length;
}

/** Top-level members of the `{…}` body opening at `open`. */
function membersOf(code: string, bare: string, open: number): string[] {
    const close = matchClose(bare, open);
    if (close < 0) return [];
    const out: string[] = [];
    let start = open + 1;
    for (let i = open + 1; i <= close; i++) {
        const ch = bare[i]!;
        if (ch === '(' || ch === '[' || ch === '{') { const c = matchClose(bare, i); if (c > 0 && c < close) { i = c; continue; } }
        if (i === close || ch === ';' || ch === ',' || ch === '\n') {
            const m = squash(code.slice(start, i));
            if (m) out.push(m);
            start = i + 1;
        }
    }
    return [...new Set(out)].sort();
}

/** Where a `type X = …` alias ends: its `;` at depth 0, else the first line break at depth 0 not continued by `|`/`&`. */
function typeEnd(bare: string, from: number): number {
    let i = from;
    for (;;) {
        const stop = depthZero(bare, i, ';\n');
        if (stop >= bare.length || bare[stop] === ';') return stop;
        const before = bare.slice(from, stop).trimEnd();
        const next = bare.slice(stop + 1).trimStart();
        if (/[=|&,<(]$/.test(before) || /^[|&]/.test(next)) { i = stop + 1; continue; }
        return stop;
    }
}

export function exportsOf(text: string, path: string): Map<string, ExportDecl> {
    const { code, bare } = masked(text, path);
    const out = new Map<string, ExportDecl>();
    const put = (d: ExportDecl) => { if (!out.has(d.name)) out.set(d.name, d); };

    for (const m of bare.matchAll(DECL)) {
        const start = m.index + m[1]!.length;
        const kind = squash(m[3]!);
        const nameEnd = m.index + m[0].length;
        const name = m[2] ? 'default' : m[4]!;
        const line = lineAt(text, start);
        if (kind.startsWith('function')) {
            const end = depthZero(bare, nameEnd, '{;');
            put({ name, signature: squash(code.slice(start, end)), line });
        } else if (kind.endsWith('class')) {
            const end = depthZero(bare, nameEnd, '{;');
            put({ name, signature: squash(code.slice(start, end)), line });
        } else if (kind === 'interface' || kind.endsWith('enum')) {
            const open = depthZero(bare, nameEnd, '{;');
            put({ name, signature: squash(code.slice(start, open)), members: bare[open] === '{' ? membersOf(code, bare, open) : [], line });
        } else if (kind === 'type') {
            put({ name, signature: squash(code.slice(start, typeEnd(bare, nameEnd))), line });
        } else {
            const eq = depthZero(bare, nameEnd, '=;\n');
            let signature = squash(code.slice(start, eq));
            if (bare[eq] === '=') {
                const rhs = /^=\s*(?:async\s+)?(?:<[^>]*>\s*)?\(/.exec(bare.slice(eq));
                if (rhs) {
                    const open = eq + rhs[0].length - 1;
                    const close = matchClose(bare, open);
                    const arrow = close < 0 ? -1 : bare.indexOf('=>', close);
                    if (arrow > 0) signature += ` = ${squash(code.slice(eq + 1, arrow + 2))}`;
                }
            }
            put({ name, signature, line });
        }
    }

    for (const m of code.matchAll(LIST)) {
        if (bare[m.index] !== code[m.index]) continue;
        const from = m[3] ? ` from ${m[3]}` : '';
        for (const part of m[1]!.split(',')) {
            const spec = squash(part);
            if (!spec) continue;
            const alias = /\bas\s+([\w$]+)$/.exec(spec);
            const name = alias ? alias[1]! : spec.replace(/^type\s+/, '');
            put({ name, signature: `export { ${spec} }${from}`, line: lineAt(text, m.index) });
        }
    }
    return out;
}
