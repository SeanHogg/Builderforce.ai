import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareMetrics, formatComparison, readBaseline, writeBaseline } from './baseline';

describe('compareMetrics', () => {
    it('flags any increase as a regression and a decrease as an improvement', () => {
        const c = compareMetrics({ a: 11, b: 4, c: 7 }, { a: 10, b: 5, c: 7 });
        expect(c.regressions).toEqual([{ id: 'a', was: 10, now: 11 }]);
        expect(c.improvements).toEqual([{ id: 'b', was: 5, now: 4 }]);
        expect(c.added).toEqual([]);
        expect(c.removed).toEqual([]);
    });

    it('reports added and removed ids', () => {
        const c = compareMetrics({ a: 1, n: 2 }, { a: 1, gone: 3 });
        expect(c.added).toEqual(['n']);
        expect(c.removed).toEqual(['gone']);
    });

    it('treats a missing baseline as everything added', () => {
        const c = compareMetrics({ a: 1, b: 2 }, null);
        expect(c.added).toEqual(['a', 'b']);
        expect(c.regressions).toEqual([]);
    });
});

describe('baseline file', () => {
    it('round-trips with sorted keys, 2-space JSON and a trailing newline', () => {
        const file = path.join(mkdtempSync(path.join(tmpdir(), 'kgperf-')), 'b.json');
        expect(readBaseline(file)).toBeNull();
        writeBaseline(file, { z: 1, a: 2 });
        expect(readFileSync(file, 'utf8')).toBe('{\n  "a": 2,\n  "z": 1\n}\n');
        expect(readBaseline(file)).toEqual({ a: 2, z: 1 });
    });

    it('formats a readable table', () => {
        const text = formatComparison(compareMetrics({ a: 12 }, { a: 10 }));
        expect(text).toContain('REGRESSIONS (1)');
        expect(text).toContain('+2');
        expect(formatComparison({ regressions: [], improvements: [], added: [], removed: [] })).toContain('no change');
    });
});
