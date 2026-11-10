/**
 * knowledge/codeMask.ts — source text with its comments (and, in a second copy, its strings)
 * blanked out, length and line breaks preserved, so token counts and brace matching over
 * the result never see a decision word inside a string or a comment.
 *
 * ONE pass gives both copies: `code` (comments blanked, strings intact — for scans that read
 * string literals: routes, imports, patterns) and `bare` (comments and strings blanked — for
 * counting tokens: complexity).
 *
 * Comment syntax is per family: `c` (js/ts, go, rust, java-likes, …) and `hash` (python,
 * ruby, shell). JS/TS regex literals are recognised (a `/` after an operator or keyword), so
 * a backtick or `/*` inside one does not open a string or a comment. Rust lifetimes (`'a`)
 * are not strings, and a quote with no partner on its line (a JSX apostrophe) is plain text.
 * Pure.
 */

import { symbolLanguageOf } from '../symbols.js';

/** The ONE regex-literal escaper (preSearch.ts, pure), surfaced with the masker for scans over masked text. */
export { escapeRegex } from '../preSearch.js';

export type CommentFamily = 'c' | 'hash';

/** Shell-family extensions the symbol extractor does not know; they are code, never docs. */
export const SHELL_EXTENSIONS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'ps1']);

export function extensionOf(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export const isShellPath = (path: string): boolean => SHELL_EXTENSIONS.has(extensionOf(path));

/** The language family of a code path: the symbol extractor's, `powershell` for `.ps1`, else `shell`. */
export function codeLanguageOf(path: string): string | undefined {
    const known = symbolLanguageOf(path);
    if (known) return known;
    if (!isShellPath(path)) return undefined;
    return extensionOf(path) === 'ps1' ? 'powershell' : 'shell';
}

export function commentFamilyOf(language: string | undefined): CommentFamily {
    return language === 'python' || language === 'ruby' || language === 'shell' || language === 'powershell' ? 'hash' : 'c';
}

export interface MaskedSource {
    /** Comments blanked, strings intact. */
    code: string;
    /** Comments and strings blanked. */
    bare: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
/** Keywords after which a `/` starts a regex literal. */
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
    'return', 'typeof', 'case', 'delete', 'void', 'throw', 'in', 'of', 'instanceof', 'new', 'else', 'do', 'yield', 'await',
]);

/** The longest {@link REGEX_AFTER_WORD} entry: a longer word before a `/` is never one of them. */
const MAX_REGEX_WORD = 10;

/**
 * Whether a `/` after what was emitted so far (`out`, the masked `code` as chunks) starts a regex literal
 * rather than a division. Walks back over the chunks: whitespace, then the previous char or word.
 */
function startsRegex(out: readonly string[]): boolean {
    let word = '';
    for (let c = out.length - 1; c >= 0; c--) {
        const chunk = out[c]!;
        for (let k = chunk.length - 1; k >= 0; k--) {
            const ch = chunk[k]!;
            if (word === '' && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) continue;
            if (/[\w$]/.test(ch)) {
                word = ch + word;
                if (word.length > MAX_REGEX_WORD) return false;
                continue;
            }
            return word !== '' ? REGEX_AFTER_WORD.has(word) : !(ch === ')' || ch === ']' || ch === '}');
        }
    }
    return word === '' || REGEX_AFTER_WORD.has(word);
}

const blankRun = (s: string): string => s.replace(/[^\n\r]/g, ' ');

/** The end index (exclusive) of the regex literal opening at `at`, or -1 when none closes on its line. */
function regexEnd(text: string, at: number): number {
    let inClass = false;
    for (let i = at + 1; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === '\n') return -1;
        if (ch === '\\') { i++; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
            let end = i + 1;
            while (end < text.length && /[a-z]/i.test(text[end]!)) end++;
            return end;
        }
    }
    return -1;
}

/** The end index (exclusive) of the single-line quoted string opening at `at`, or -1 when its line has no closing quote. */
function lineStringEnd(text: string, at: number): number {
    const quote = text[at]!;
    for (let i = at + 1; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === '\n') return -1;
        if (ch === '\\') { i++; continue; }
        if (ch === quote) return i + 1;
    }
    return -1;
}

export function maskSource(text: string, language?: string): MaskedSource {
    const family = commentFamilyOf(language);
    const jsLike = language === 'js';
    const rust = language === 'rust';
    // Both outputs are built as CHUNKS (runs, not characters), so masking is linear with a small constant.
    const code: string[] = [];
    const bare: string[] = [];
    const n = text.length;
    const keep = (from: number, to: number): void => {
        if (to <= from) return;
        const s = text.slice(from, to);
        code.push(s);
        bare.push(s);
    };
    const blankBoth = (from: number, to: number): void => {
        if (to <= from) return;
        const s = blankRun(text.slice(from, to));
        code.push(s);
        bare.push(s);
    };
    const string = (from: number, to: number, quoteLen: number): void => {
        if (to <= from) return;
        const a = Math.min(to, from + quoteLen), b = Math.max(a, to - quoteLen);
        code.push(text.slice(from, to));
        bare.push(text.slice(from, a) + blankRun(text.slice(a, b)) + text.slice(b, to));
    };
    // The next char that can open a comment, a string or a regex literal; everything before it is kept as one run.
    const special = family === 'c' ? /[/'"`]/g : /[#'"`]/g;
    let i = 0;
    while (i < n) {
        special.lastIndex = i;
        const hit = special.exec(text);
        const runEnd = hit ? hit.index : n;
        if (runEnd > i) { keep(i, runEnd); i = runEnd; continue; }
        const ch = text[i]!;
        const next = text[i + 1];
        if (family === 'c' && ch === '/' && next === '/') {
            let e = i;
            while (e < n && text[e] !== '\n') e++;
            blankBoth(i, e);
            i = e;
            continue;
        }
        if (family === 'c' && ch === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            blankBoth(i, stop);
            i = stop;
            continue;
        }
        if (family === 'hash' && ch === '#') {
            let e = i;
            while (e < n && text[e] !== '\n') e++;
            blankBoth(i, e);
            i = e;
            continue;
        }
        if (jsLike && ch === '/' && startsRegex(code)) {
            const end = regexEnd(text, i);
            if (end > 0) { keep(i, end); i = end; continue; }
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            if (rust && ch === "'" && next !== undefined && IDENT_START.test(next)) {
                let k = i + 1;
                while (k < n && IDENT_PART.test(text[k]!)) k++;
                if (text[k] !== "'") { keep(i, i + 1); i++; continue; } // a lifetime, not a char literal
            }
            if (family === 'hash' && text.startsWith(ch.repeat(3), i)) {
                const close = text.indexOf(ch.repeat(3), i + 3);
                const stop = close < 0 ? n : close + 3;
                string(i, stop, 3);
                i = stop;
                continue;
            }
            if (ch === '`') {
                let k = i + 1;
                while (k < n && text[k] !== '`') k += text[k] === '\\' ? 2 : 1;
                const stop = Math.min(n, k + 1);
                string(i, stop, 1);
                i = stop;
                continue;
            }
            const end = lineStringEnd(text, i);
            if (end < 0) { keep(i, i + 1); i++; continue; } // no partner on its line: an apostrophe in text
            string(i, end, 1);
            i = end;
            continue;
        }
        keep(i, i + 1);
        i++;
    }
    return { code: code.join(''), bare: bare.join('') };
}
