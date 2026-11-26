/**
 * The code pane's diff (PRD 43 Part C8): which lines of the shown version the other version does not have. A longest
 * common subsequence over whole lines (the prototype's `keptLines`), so a moved or edited block reads as removed there and
 * added here, and an untouched line is never marked. Pure.
 */

import type { SourceText } from '../../types';

/** The shown version's lines (1-based, in its own numbering) that the other version lacks. */
export interface CodeMarks { added: ReadonlySet<number>; removed: ReadonlySet<number> }

/** Past this many table cells the diff is not drawn (a vendored bundle, a generated file): the pane shows the text unmarked. */
const MAX_CELLS = 4_000_000;

/** Which lines of `mine` the other version also has, in order (the LCS); `null` when the two are too large to compare. */
export function keptLines(mine: readonly string[], theirs: readonly string[]): boolean[] | null {
    const kept = new Array<boolean>(mine.length).fill(false);
    // The common head and tail are kept without a table: most edits are a small change in the middle.
    let head = 0;
    while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) { kept[head] = true; head++; }
    let tailMine = mine.length, tailTheirs = theirs.length;
    while (tailMine > head && tailTheirs > head && mine[tailMine - 1] === theirs[tailTheirs - 1]) { tailMine--; tailTheirs--; kept[tailMine] = true; }
    const m = tailMine - head, n = tailTheirs - head;
    if (m === 0 || n === 0) return kept;
    if ((m + 1) * (n + 1) > MAX_CELLS) return null;

    const width = n + 1;
    const table = new Uint32Array((m + 1) * width);
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            table[i * width + j] = mine[head + i] === theirs[head + j]
                ? table[(i + 1) * width + j + 1]! + 1
                : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
    }
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (mine[head + i] === theirs[head + j]) { kept[head + i] = true; i++; j++; }
        else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
        else j++;
    }
    return kept;
}

/** The marks of the shown version against the other: After marks what is added, Before what is removed. `null` when too large to compare. */
export function markLines(side: 'before' | 'after', shown: SourceText, other: SourceText): CodeMarks | null {
    const kept = keptLines(shown.lines, other.lines);
    if (!kept) return null;
    const unmatched = new Set<number>();
    kept.forEach((k, i) => { if (!k) unmatched.add(shown.startLine + i); });
    const none = new Set<number>();
    return side === 'after' ? { added: unmatched, removed: none } : { added: none, removed: unmatched };
}
