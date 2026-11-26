import { describe, expect, it } from 'vitest';
import type { SourceText, SymbolRecord } from '../../types';
import { movedMarks, movedModules, movedSpans } from './movedMarks';

const FILE = 'src:r::api/big.ts';
const sym = (name: string, line: number, parent = FILE): SymbolRecord => ({ ref: `${FILE}#${name}@${line}`, name, kind: 'function', parent, line, exported: true });
const a = sym('a', 2), b = sym('b', 6), c = sym('c', 10);
const method: SymbolRecord = { ...sym('m', 7, b.ref), kind: 'method' };
const text: SourceText = { startLine: 1, lines: Array.from({ length: 12 }, (_, i) => `l${i + 1}`), truncated: false };
const MOD_A = 'src:r::api/big.a.ts', MOD_B = 'src:r::api/big.b.ts';

describe('movedMarks: a restructure marks the lines of the definitions that leave the file', () => {
    const moved = new Map([[a.ref, MOD_A], [b.ref, MOD_B], [method.ref, MOD_B]]);
    const spans = movedSpans([a, b, method, c], moved);

    it('a definition runs to the line before the next top-level one; the last runs to the end', () => {
        expect(spans).toEqual([{ path: 'api/big.ts', from: 2, to: 5, module: MOD_A }, { path: 'api/big.ts', from: 6, to: 9, module: MOD_B }]);
        expect(movedSpans([a, b, c], new Map([[c.ref, MOD_A]]))).toEqual([{ path: 'api/big.ts', from: 10, to: Infinity, module: MOD_A }]);
    });

    it('marks them removed in the one CodeMarks shape, leaving what stays unmarked', () => {
        const marks = movedMarks('api/big.ts', spans, text)!;
        expect([...marks.removed]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        expect(marks.added.size).toBe(0);
    });

    it('numbers by the text it was handed (a window that starts mid-file)', () => {
        const window = movedSpans([a, b, c], new Map([[b.ref, MOD_B]]));
        expect([...movedMarks('api/big.ts', window, { startLine: 8, lines: ['x', 'y', 'z'], truncated: false })!.removed]).toEqual([8, 9]);
    });

    it('names each module once, in file order; another file, or nothing moving, marks nothing', () => {
        expect(movedModules('api/big.ts', spans)).toEqual([MOD_A, MOD_B]);
        expect(movedMarks('api/other.ts', spans, text)).toBeNull();
        expect(movedMarks('api/big.ts', movedSpans([a, b, c], new Map()), text)).toBeNull();
    });
});
