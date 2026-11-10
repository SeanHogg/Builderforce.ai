/**
 * engine/text.ts — the B8.1 normal forms every input passes through once, at intake: POSIX, NFC
 * paths and LF text. After this, nothing downstream sees a backslash, a `./` prefix or a CR, so a
 * Windows `core.autocrlf` checkout and a Linux checkout of one tree give byte-identical rule input.
 */

import { compareStr, normalizePath } from '@seanhogg/builderforce-memory/knowledge';

/** Memory owns the ONE B8.1 path normalization and the code-unit order; re-exported for the engine. */
export { compareStr, normalizePath };

/** CRLF and lone CR → LF. */
export function normalizeEol(text: string): string {
    return text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n');
}

/** The 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
}

/** The full line (without its LF) holding a character offset. */
export function lineTextAt(text: string, offset: number): string {
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const end = text.indexOf('\n', offset);
    return text.slice(start, end < 0 ? text.length : end);
}

/** Lines in a text: 0 when empty, a trailing LF does not open a new line. */
export function lineCount(text: string): number {
    if (text.length === 0) return 0;
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return text.endsWith('\n') ? n - 1 : n;
}

/** Sorted, deduped copy. */
export function sortedUnique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort(compareStr);
}
