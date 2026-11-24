import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '../../types';
import { codeTargetOf, fileTargetOf, MAX_SPAN, symbolAtLine, symbolsOfFile } from './codeText';

const records: SymbolRecord[] = [
    { ref: 'src:order.ts::place', name: 'place', kind: 'method', parent: 'src:order.ts::Order', line: 10, exported: false },
    { ref: 'src:other.ts::main', name: 'main', kind: 'function', parent: 'src:other.ts', line: 4, exported: false },
    { ref: 'src:order.ts::Order', name: 'Order', kind: 'class', parent: 'src:order.ts', line: 3, exported: true },
    { ref: 'src:order.ts::cancel', name: 'cancel', kind: 'method', parent: 'src:order.ts::Order', line: 20, exported: false },
];
const path = codeTargetOf('src:order.ts::place', records)!.path;

describe('the docked panel reads the whole file', () => {
    it('fileTargetOf starts at line 1 and keeps an end past MAX_SPAN', () => {
        const t = codeTargetOf('src:order.ts::place', records)!;
        expect(fileTargetOf(t)).toMatchObject({ ref: t.ref, path, startLine: 1, endLine: MAX_SPAN });
        expect(fileTargetOf({ ...t, endLine: MAX_SPAN + 50 }).endLine).toBe(MAX_SPAN + 50);
    });

    it('symbolsOfFile drops other files and sorts by line', () => {
        expect(symbolsOfFile(records, path).map((r) => r.line)).toEqual([3, 10, 20]);
    });

    it('symbolAtLine names the latest definition at or above the line', () => {
        const sorted = symbolsOfFile(records, path);
        expect(symbolAtLine(sorted, 2)).toBeNull();
        expect(symbolAtLine(sorted, 3)).toBe('src:order.ts::Order');
        expect(symbolAtLine(sorted, 12)).toBe('src:order.ts::place');
        expect(symbolAtLine(sorted, 999)).toBe('src:order.ts::cancel');
        expect(symbolAtLine([], 5)).toBeNull();
    });
});
