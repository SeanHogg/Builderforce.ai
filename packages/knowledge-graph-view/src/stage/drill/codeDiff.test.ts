import { describe, expect, it } from 'vitest';
import { keptLines, markLines } from './codeDiff';

const text = (lines: string[], startLine = 1) => ({ startLine, lines, truncated: false });

describe('keptLines', () => {
    it('keeps every line of identical versions', () => {
        expect(keptLines(['a', 'b'], ['a', 'b'])).toEqual([true, true]);
    });

    it('does not keep a line the other version lacks, and keeps the ones around it in order', () => {
        expect(keptLines(['a', 'x', 'b', 'c'], ['a', 'b', 'c'])).toEqual([true, false, true, true]);
        expect(keptLines(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual([true, true, true]);
    });

    it('reads an edited line as unkept and a moved block as one side unkept (longest common subsequence)', () => {
        expect(keptLines(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd'])).toEqual([true, false, true, true]);
        // `c` moved up: the longest common run (a, b, d) stays kept, the moved line does not.
        expect(keptLines(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd'])).toEqual([true, true, false, true]);
    });

    it('handles an empty side and a duplicate-heavy file', () => {
        expect(keptLines([], ['a'])).toEqual([]);
        expect(keptLines(['a', 'b'], [])).toEqual([false, false]);
        expect(keptLines(['x', 'x', 'x'], ['x'])).toEqual([true, false, false]);
    });

    it('gives up (null) rather than building a table past the cap', () => {
        const big = Array.from({ length: 3000 }, (_, i) => `a${i}`);
        const other = Array.from({ length: 3000 }, (_, i) => `b${i}`);
        expect(keptLines(big, other)).toBeNull();
    });
});

describe('markLines', () => {
    it('After marks the lines it added, numbered in its own text', () => {
        const marks = markLines('after', text(['a', 'new', 'b'], 10), text(['a', 'b']))!;
        expect([...marks.added]).toEqual([11]);
        expect(marks.removed.size).toBe(0);
    });

    it('Before marks the lines it has that After lost', () => {
        const marks = markLines('before', text(['a', 'gone', 'b'], 5), text(['a', 'b']))!;
        expect([...marks.removed]).toEqual([6]);
        expect(marks.added.size).toBe(0);
    });

    it('marks nothing when the two versions are the same, and is null when too large', () => {
        const same = markLines('after', text(['a']), text(['a']))!;
        expect(same.added.size + same.removed.size).toBe(0);
        const big = Array.from({ length: 3000 }, (_, i) => `a${i}`);
        expect(markLines('after', text(big), text(big.map((l) => `b${l}`)))).toBeNull();
    });
});
