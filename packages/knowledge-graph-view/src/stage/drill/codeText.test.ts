import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '../../types';
import {
    callerIndex, callStepsOf, codeRows, codeTargetOf, fileTargetOf, isAwaited, lensRows, MAX_SPAN, railKindOf, railKinds, READING_AT, readingLineAt, refsInView,
    scrollTopForLine, spanInFile, stepAt, stepOfCallee, stickyChain, STICKY_MAX, symbolAtLine, symbolChain, symbolsOfFile, type CallStep,
} from './codeText';

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

    it('callStepsOf orders the calls by site, ignores relations and sites with no line', () => {
        expect(callStepsOf(caller.ref, [caller])).toEqual([
            { line: 12, to: 'src:stock.ts#reserve', kind: 'calls' }, { line: 12, to: 'src:stock.ts#reserve', kind: 'calls' }, { line: 14, to: 'src:pay.ts#charge', kind: 'calls' },
        ]);
        expect(callStepsOf('missing', [caller])).toEqual([]);
    });

    it('callStepsOf numbers reads (memory `uses`) and super calls too, with their kind; other relations stay out', () => {
        const mixed: SymbolRecord = {
            ...caller, relations: [
                { kind: 'calls', to: 'src:pay.ts#charge', sites: [site(14, 3)] },
                { kind: 'reads', to: 'src:order.ts#status', sites: [site(11, 0)] },
                { kind: 'uses', to: 'src:order.ts#items', sites: [site(12, 1)] },
                { kind: 'extends', to: 'src:base.ts#Base', sites: [site(13, 2)] },
                { kind: 'implements', to: 'src:api.ts#Api', sites: [site(15, 4)] },
            ],
        };
        expect(callStepsOf(mixed.ref, [mixed]).map((s) => [s.line, s.kind])).toEqual([[11, 'reads'], [12, 'reads'], [13, 'extends'], [14, 'calls']]);
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
    const steps: CallStep[] = [
        { line: 12, to: 'src:stock.ts#reserve', kind: 'calls' }, { line: 13, to: 'src:pay.ts#charge', kind: 'calls' }, { line: 14, to: 'src:stock.ts#reserve', kind: 'calls' },
    ];

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

describe('the editor chrome read off the records', () => {
    const rec = (name: string, kind: string, parent: string, line: number, relations?: SymbolRecord['relations']): SymbolRecord =>
        ({ ref: `src:sys::order.ts#${name}`, name, kind, parent, line, exported: false, ...(relations ? { relations } : {}) });
    const FILE = 'src:sys::order.ts', ORDER = `${FILE}#Order`;
    const calls = (to: string) => ({ kind: 'calls', to });
    const chrome: SymbolRecord[] = [
        rec('Order', 'class', FILE, 3),
        rec('status', 'property', ORDER, 5),
        rec('place', 'method', ORDER, 10, [calls(`${FILE}#cancel`), calls(`${FILE}#cancel`)]),
        rec('cancel', 'method', ORDER, 20),
        { ref: 'src:sys::other.ts#main', name: 'main', kind: 'function', parent: 'src:sys::other.ts', line: 4, exported: false, relations: [calls(`${FILE}#place`), { kind: 'uses', to: `${FILE}#status` }] },
        { ref: 'src:sys::other.ts#boot', name: 'boot', kind: 'function', parent: 'src:sys::other.ts', line: 9, exported: false, relations: [calls(`${FILE}#place`), calls(ORDER)] },
    ];
    const chromePath = codeTargetOf(ORDER, chrome)!.path;
    const fileSymbols = symbolsOfFile(chrome, chromePath);
    const byRef = new Map(chrome.map((r) => [r.ref, r]));

    it('callerIndex inverts the calls, once per caller, and is built once per records array', () => {
        const idx = callerIndex(chrome);
        expect(idx.get(`${FILE}#place`)).toEqual(['src:sys::other.ts#main', 'src:sys::other.ts#boot']);
        expect(idx.get(`${FILE}#cancel`)).toEqual([`${FILE}#place`]);
        expect(idx.get(`${FILE}#status`)).toBeUndefined();
        expect(callerIndex(chrome)).toBe(idx);
        expect(callerIndex([...chrome])).not.toBe(idx);
    });

    it('railKindOf sorts a record kind into class, method or field', () => {
        expect(['class', 'interface', 'enum', 'method', 'function', 'property', 'const'].map(railKindOf)).toEqual(['class', 'class', 'class', 'method', 'method', 'field', 'field']);
    });

    it('lensRows puts a lens on each class and method line: callers for a method, outside references for a class; fields get none', () => {
        const lens = lensRows(fileSymbols, chrome, callerIndex(chrome));
        expect([...lens.keys()]).toEqual([3, 10, 20]);
        expect(lens.get(10)).toEqual({ ref: `${FILE}#place`, kind: 'method', count: 2 });
        expect(lens.get(20)).toEqual({ ref: `${FILE}#cancel`, kind: 'method', count: 1 });
        // main uses a member and boot calls the class and a member: two outside symbols; place → cancel is inside.
        expect(lens.get(3)).toEqual({ ref: ORDER, kind: 'class', count: 2 });
    });

    it('codeRows adds a lens row above each lens line, and rows and lines map both ways exactly', () => {
        const lens = new Map([[3, { ref: ORDER }], [10, { ref: `${FILE}#place` }]]);
        const { rows, rowOfLine, lineAtRow } = codeRows(12, 1, lens);
        expect(rows.length).toBe(14);
        expect(rows[2]).toEqual({ lens: ORDER });
        expect(rows[3]).toEqual({ line: 3 });
        expect(rowOfLine(1)).toBe(0);
        // A line with a lens scrolls to its lens row, which reads as the line below it.
        expect(rowOfLine(3)).toBe(2);
        expect(rowOfLine(4)).toBe(4);
        expect(rowOfLine(12)).toBe(13);
        for (let line = 1; line <= 12; line++) expect(lineAtRow(rowOfLine(line))).toBe(line);
        expect(lineAtRow(2)).toBe(3);
        expect(lineAtRow(-5)).toBe(1);
        expect(lineAtRow(99)).toBe(12);
        expect(rowOfLine(99)).toBe(13);
        const none = codeRows(5, 7, null);
        expect(none.rows).toEqual([7, 8, 9, 10, 11].map((line) => ({ line })));
        expect(none.rowOfLine(9)).toBe(2);
        expect(codeRows(0, 1, null).lineAtRow(0)).toBe(1);
    });

    it('railKinds marks every line with the kind of the symbol whose span covers it', () => {
        const rails = railKinds(fileSymbols, chrome);
        expect(rails.get(1)).toBeUndefined();
        expect([3, 4].map((l) => rails.get(l))).toEqual(['class', 'class']);
        expect([5, 9].map((l) => rails.get(l))).toEqual(['field', 'field']);
        expect([10, 19, 20, 25].map((l) => rails.get(l))).toEqual(['method', 'method', 'method', 'method']);
    });

    it('stickyChain keeps the enclosing classes and methods that start above the top line, at most STICKY_MAX', () => {
        expect(stickyChain(fileSymbols, byRef, 3)).toEqual([]);
        expect(stickyChain(fileSymbols, byRef, 4).map((r) => r.name)).toEqual(['Order']);
        // A field is not a scope: only its class sticks.
        expect(stickyChain(fileSymbols, byRef, 7).map((r) => r.name)).toEqual(['Order']);
        expect(stickyChain(fileSymbols, byRef, 10).map((r) => r.name)).toEqual(['Order']);
        expect(stickyChain(fileSymbols, byRef, 12).map((r) => r.name)).toEqual(['Order', 'place']);
        const deep: SymbolRecord[] = [
            rec('A', 'class', FILE, 1), rec('B', 'class', `${FILE}#A`, 2), rec('C', 'class', `${FILE}#B`, 3), rec('m', 'method', `${FILE}#C`, 4),
        ];
        const deepSorted = symbolsOfFile(deep, chromePath);
        expect(stickyChain(deepSorted, new Map(deep.map((r) => [r.ref, r])), 6).map((r) => r.name)).toEqual(['C', 'm']);
        expect(STICKY_MAX).toBe(2);
    });

    it('refsInView names the symbols whose lines meet the range, each followed by its file once', () => {
        expect(refsInView(fileSymbols, chrome, 1, 2)).toEqual([]);
        expect(refsInView(fileSymbols, chrome, 4, 11)).toEqual([ORDER, FILE, `${FILE}#status`, `${FILE}#place`]);
        expect(refsInView(fileSymbols, chrome, 30, 40)).toEqual([`${FILE}#cancel`, FILE]);
    });

    it('isAwaited finds an await keyword, not a word containing it', () => {
        expect(isAwaited('  const r = await pay.charge(o);')).toBe(true);
        expect(isAwaited('  awaitable.run();')).toBe(false);
        expect(isAwaited('  pay.charge(o);')).toBe(false);
    });
});
