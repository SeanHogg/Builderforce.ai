/**
 * engine/text.ts — the B8.1 normal forms every input passes through once, at intake: POSIX, NFC
 * paths (memory `normalizePath`) and LF text; plus the linear line index every rule looks lines up
 * in (built once per text, binary-searched; never a scan from offset 0).
 */

import { compareStr, normalizePath } from '@seanhogg/builderforce-memory/knowledge';

/** Memory owns the ONE B8.1 path normalization and the code-unit order; re-exported for the engine. */
export { compareStr, normalizePath };

/** CRLF and lone CR → LF. */
export function normalizeEol(text: string): string {
    return text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n');
}

/** Offsets where each line starts (line 1 at index 0). O(n), once per text. */
export function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
}

/** The 1-based line of an offset, by binary search over {@link lineStarts}. */
export function lineOf(starts: readonly number[], offset: number): number {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
}

/** Lines in a text: 0 when empty, a trailing LF does not open a new line. */
export function lineCount(text: string): number {
    if (text.length === 0) return 0;
    let n = 1;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
    return text.endsWith('\n') ? n - 1 : n;
}

/** Sorted, deduped copy. */
export function sortedUnique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort(compareStr);
}
