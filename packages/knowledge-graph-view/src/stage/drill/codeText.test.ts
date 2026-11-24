import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '../../types';
import { callStepsOf, codeTargetOf, fileTargetOf, MAX_SPAN, READING_AT, readingLineAt, scrollTopForLine, spanInFile, stepAt, stepOfCallee, symbolAtLine, symbolChain, symbolsOfFile } from './codeText';

const records: SymbolRecord[] = [
    { ref: 'src:sys::order.ts#place', name: 'place', kind: 'method', parent: 'src:sys::order.ts#Order', line: 10, exported: false },
    { ref: 'src:sys::other.ts#main', name: 'main', kind: 'function', parent: 'src:sys::other.ts', line: 4, exported: false },
    { ref: 'src:sys::order.ts#Order', name: 'Order', kind: 'class', parent: 'src:sys::order.ts', line: 3, exported: true },
    { ref: 'src:sys::order.ts#cancel', name: 'cancel', kind: 'method', parent: 'src:sys::order.ts#Order', line: 20, exported: false },
];
const path = codeTargetOf('src:sys::order.ts#place', records)!.path;

describe('the docked panel reads the whole file', () => {
    it('fileTargetOf starts at line 1 and keeps an end past MAX_SPAN', () => {
        const t = codeTargetOf('src:sys::order.ts#place', records)!;
        expect(fileTargetOf(t)).toMatchObject({ ref: t.ref, path, startLine: 1, endLine: MAX_SPAN });
        expect(fileTargetOf({ ...t, endLine: MAX_SPAN + 50 }).endLine).toBe(MAX_SPAN + 50);
    });

    it('symbolsOfFile drops other files and sorts by line', () => {
        expect(symbolsOfFile(records, path).map((r) => r.line)).toEqual([3, 10, 20]);
    });

    it('symbolAtLine names the latest definition at or above the line', () => {
        const sorted = symbolsOfFile(records, path);
        expect(symbolAtLine(sorted, 2)).toBeNull();
        expect(symbolAtLine(sorted, 3)).toBe('src:sys::order.ts#Order');
        expect(symbolAtLine(sorted, 12)).toBe('src:sys::order.ts#place');
        expect(symbolAtLine(sorted, 999)).toBe('src:sys::order.ts#cancel');
        expect(symbolAtLine([], 5)).toBeNull();
    });
});

describe('the reading line and the numbered calls of a method', () => {
    const site = (line: number, order: number) => ({ path: 'order.ts', line, column: 1, order });
    const caller: SymbolRecord = {
        ref: 'src:sys::order.ts#place', name: 'place', kind: 'method', parent: 'src:sys::order.ts#Order', line: 10, exported: false,
        relations: [
            { kind: 'calls', to: 'src:pay.ts#charge', sites: [site(14, 2)] },
            { kind: 'extends', to: 'src:base.ts::Base' },
            { kind: 'calls', to: 'src:stock.ts#reserve', sites: [site(12, 0), site(12, 1)] },
            { kind: 'calls', to: 'src:log.ts#info', sites: [site(0, 3)] },
        ],
    };

    it('readingLineAt sits READING_AT down the panel, the top line when the panel has no height', () => {
        expect(readingLineAt(0, 0, 1, 18)).toBe(1);
        expect(readingLineAt(18 * 4, 0, 1, 18)).toBe(5);
        expect(readingLineAt(0, 100 * 18, 1, 18)).toBe(1 + Math.floor(100 * READING_AT));
        expect(readingLineAt(50, 100, 7, 0)).toBe(7);
    });

    it('scrollTopForLine brings a line to the reading line, never above 0', () => {
        expect(scrollTopForLine(11, 1, 18)).toBe(180);
        expect(scrollTopForLine(11, 1, 18, 100)).toBe(180 - 100 * READING_AT);
        expect(scrollTopForLine(2, 1, 18, 1000)).toBe(0);
    });

    it('callStepsOf orders the calls by site, ignores other relations and sites with no line', () => {
        expect(callStepsOf(caller.ref, [caller])).toEqual([
            { line: 12, to: 'src:stock.ts#reserve' }, { line: 12, to: 'src:stock.ts#reserve' }, { line: 14, to: 'src:pay.ts#charge' },
        ]);
        expect(callStepsOf('missing', [caller])).toEqual([]);
    });

    it('stepAt is the nearest call at or above the line inside the span; the first call on a line wins', () => {
        const steps = callStepsOf(caller.ref, [caller]), span = { startLine: 10, endLine: 19 };
        expect(stepAt(steps, 11, span)).toBe(-1);
        expect(stepAt(steps, 12, span)).toBe(0);
        expect(stepAt(steps, 13, span)).toBe(0);
        expect(stepAt(steps, 15, span)).toBe(2);
        expect(stepAt(steps, 25, span)).toBe(-1);
        expect(stepAt(steps, 12, null)).toBe(-1);
    });

    it('symbolChain walks the parents outermost first and stops on a self-parent or a cycle', () => {
        const byRef = new Map(records.map((r) => [r.ref, r]));
        expect(symbolChain('src:sys::order.ts#place', byRef).map((r) => r.name)).toEqual(['Order', 'place']);
        expect(symbolChain(null, byRef)).toEqual([]);
        const self: SymbolRecord = { ref: 'a', name: 'a', kind: 'class', parent: 'a', line: 1, exported: false };
        expect(symbolChain('a', new Map([['a', self]])).map((r) => r.ref)).toEqual(['a']);
        const x: SymbolRecord = { ...self, ref: 'x', name: 'x', parent: 'y' }, y: SymbolRecord = { ...self, ref: 'y', name: 'y', parent: 'x' };
        expect(symbolChain('x', new Map([['x', x], ['y', y]])).map((r) => r.ref)).toEqual(['y', 'x']);
    });
});

describe('the stage meets the open method', () => {
    const steps = [{ line: 12, to: 'src:stock.ts#reserve' }, { line: 13, to: 'src:pay.ts#charge' }, { line: 14, to: 'src:stock.ts#reserve' }];

    it('stepOfCallee finds the first call of a ref, else -1', () => {
        expect(stepOfCallee(steps, 'src:stock.ts#reserve')).toBe(0);
        expect(stepOfCallee(steps, 'src:pay.ts#charge')).toBe(1);
        expect(stepOfCallee(steps, 'src:other.ts#x')).toBe(-1);
        expect(stepOfCallee(steps, null)).toBe(-1);
    });

    it('spanInFile gives a symbol its lines only in its own file', () => {
        expect(spanInFile('src:sys::order.ts#place', records, path)).toEqual({ startLine: 10, endLine: 19 });
        expect(spanInFile('src:sys::other.ts#main', records, path)).toBeNull();
        expect(spanInFile('src:sys::order.ts#nope', records, path)).toBeNull();
        expect(spanInFile(null, records, path)).toBeNull();
    });
});
