/**
 * dynamic/changedLines.ts — the after-side lines a run changed, per file: what diff coverage (C8.4) and
 * mutation restriction count.
 *
 * Deliberately not a positional diff: an after line is CHANGED when its trimmed text is not matched by an
 * unused occurrence of the same text on the before side (a multiset match). A moved, unchanged line is
 * therefore not "changed code", which is what coverage of a change should ignore; blank lines never count.
 * Linear and deterministic, LF/CRLF-agnostic.
 */

/** 1-based after-side line numbers changed relative to `before` (absent ⇒ every non-blank line is new). */
export function changedLines(before: string | undefined, after: string): number[] {
    const pool = new Map<string, number>();
    for (const line of (before ?? '').split(/\r?\n/)) {
        const t = line.trim();
        if (t) pool.set(t, (pool.get(t) ?? 0) + 1);
    }
    const out: number[] = [];
    after.split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (!t) return;
        const left = pool.get(t) ?? 0;
        if (left > 0) pool.set(t, left - 1);
        else out.push(i + 1);
    });
    return out;
}
